const { describe, it, expect, beforeEach, jest } = require('@jest/globals');
const fs = require('node:fs');
const path = require('node:path');
const child_process = require('node:child_process');

// Mock fs and child_process
jest.mock('node:fs');
jest.mock('node:child_process');

const { availableTools } = require('../app/Tools');

describe('Tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('write_file', () => {
    it('writes file successfully', async () => {
      fs.mkdirSync.mockImplementation(() => {});
      fs.writeFileSync.mockImplementation(() => {});
      
      const result = await availableTools.write_file({ path: 'test.txt', content: 'hello' });
      
      expect(result).toContain('written successfully');
      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('test.txt'), 'hello');
    });

    it('handles errors', async () => {
      fs.mkdirSync.mockImplementation(() => { throw new Error('Permission denied'); });
      
      const result = await availableTools.write_file({ path: 'test.txt', content: 'hello' });
      expect(result).toContain('Error writing file');
    });
  });

  describe('read_file', () => {
    it('reads file successfully', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('file content');
      
      const result = await availableTools.read_file({ path: 'test.txt' });
      expect(result).toBe('file content');
    });

    it('returns error if file does not exist', async () => {
      fs.existsSync.mockReturnValue(false);
      const result = await availableTools.read_file({ path: 'missing.txt' });
      expect(result).toContain('File not found');
    });
  });

  describe('run_command', () => {
    it('executes command successfully', async () => {
      child_process.exec.mockImplementation((cmd, cb) => cb(null, 'stdout output', ''));
      
      const result = await availableTools.run_command({ command: 'echo test' });
      expect(result).toBe('stdout output');
    });

    it('handles execution errors', async () => {
      child_process.exec.mockImplementation((cmd, cb) => cb(new Error('Command failed'), '', 'stderr output'));
      
      const result = await availableTools.run_command({ command: 'bad_cmd' });
      expect(result).toContain('Error: Command failed');
      expect(result).toContain('stderr output');
    });
  });

  describe('replace_in_file', () => {
    it('replaces content successfully', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('Hello World');
      fs.writeFileSync.mockImplementation(() => {});

      const result = await availableTools.replace_in_file({ path: 'test.txt', search: 'World', replace: 'Jest' });
      expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('test.txt'), 'Hello Jest');
      expect(result).toContain('Successfully replaced');
    });
  });

  describe('execute_code', () => {
    it('handles timeout correctly', async () => {
      fs.writeFileSync.mockImplementation(() => {});
      
      child_process.exec.mockImplementation((cmd, options, cb) => {
        const error = new Error('Command failed');
        error.killed = true;
        cb(error, '', '');
      });

      const result = await availableTools.execute_code({ language: 'javascript', code: 'while(true){}' });
      expect(result).toBe('Error: Execution timed out after 10 seconds.');
    });
  });
});