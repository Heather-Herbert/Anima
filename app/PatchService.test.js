const { describe, it, expect, beforeEach } = require('@jest/globals');
const PatchService = require('./PatchService');
const fs = require('node:fs').promises;
const { existsSync } = require('node:fs');
const { spawn } = require('node:child_process');
const EventEmitter = require('node:events');
const path = require('node:path');

jest.mock('node:fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    unlink: jest.fn(),
    mkdir: jest.fn(),
    appendFile: jest.fn(),
  },
  existsSync: jest.fn(),
}));
jest.mock('node:child_process');

describe('PatchService', () => {
  let service;
  const baseDir = '/mock/dir';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PatchService(baseDir);
  });

  it('applies an automated patch successfully', async () => {
    const filePath = 'app/Utils.js';
    const newContent = 'new content';
    const mockChild = new EventEmitter();
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    spawn.mockReturnValue(mockChild);

    existsSync.mockReturnValue(true);
    fs.readFile.mockResolvedValue('original content');

    const promise = service.applyAutomatedPatch(filePath, newContent);

    // Simulate successful tests
    process.nextTick(() => mockChild.emit('close', 0));

    const result = await promise;

    expect(result.success).toBe(true);
    // Should have created a checkpoint
    expect(fs.writeFile).toHaveBeenCalledWith(expect.stringContaining('.Utils.js.bak'), 'original content');
    // Should have written to temp
    expect(fs.writeFile).toHaveBeenCalledWith(expect.stringContaining('.temp/app/Utils.js'), newContent);
    // Should have synced to original
    expect(fs.writeFile).toHaveBeenCalledWith(expect.stringContaining('app/Utils.js'), newContent);
    // Should have cleaned up backup and temp
    expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('.Utils.js.bak'));
    expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('.temp/app/Utils.js'));
  });

  it('rolls back and logs failure if tests fail', async () => {
    const filePath = 'app/Utils.js';
    const newContent = 'broken content';
    const mockChild = new EventEmitter();
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    spawn.mockReturnValue(mockChild);

    existsSync.mockReturnValue(true);
    fs.readFile.mockResolvedValue('original content');

    const promise = service.applyAutomatedPatch(filePath, newContent);

    // Simulate failing tests
    process.nextTick(() => {
      mockChild.stdout.emit('data', 'Test failed: Syntax error');
      mockChild.emit('close', 1);
    });

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('Tests failed');
    
    // Should have logged failure
    expect(fs.appendFile).toHaveBeenCalledWith(
        expect.stringContaining('patch_failures.log'),
        expect.stringContaining('Test failed: Syntax error')
    );
    
    // Should have cleaned up temp but kept backup
    expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('.temp/app/Utils.js'));
    expect(fs.unlink).not.toHaveBeenCalledWith(expect.stringContaining('.Utils.js.bak'));
  });
});
