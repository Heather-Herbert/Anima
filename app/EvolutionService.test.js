const { describe, it, expect, beforeEach } = require('@jest/globals');
const EvolutionService = require('./EvolutionService');
const { callAI } = require('./Utils');
const fs = require('node:fs').promises;
const { existsSync } = require('node:fs');
const { spawn } = require('node:child_process');
const EventEmitter = require('node:events');

jest.mock('./Utils');
jest.mock('node:fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    unlink: jest.fn(),
  },
  existsSync: jest.fn(),
}));
jest.mock('node:child_process');

describe('EvolutionService', () => {
  let service;
  const baseDir = '/mock/dir';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EvolutionService(baseDir);
  });

  it('proposes evolution based on conversation history', async () => {
    const history = [{ role: 'user', content: 'You did a great job fixing that PHP bug!' }];

    existsSync.mockReturnValue(true);
    fs.readFile.mockResolvedValueOnce('Current Identity'); // Identity.md
    fs.readFile.mockResolvedValueOnce('[]'); // milestones.json

    const mockProposal = {
      newMilestones: [
        { type: 'achievement', content: 'Fixed PHP bug', justification: 'User praised the fix' },
      ],
      proposedIdentityUpdate: '# evolved identity',
      evolutionSummary: 'Became a Junior PHP Developer',
    };

    callAI.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(mockProposal) } }],
    });

    const proposal = await service.proposeEvolution(history);

    expect(proposal).toEqual(mockProposal);
    expect(callAI).toHaveBeenCalled();
  });

  it('handles errors in proposeEvolution', async () => {
    callAI.mockRejectedValueOnce(new Error('AI failure'));
    const history = [{ role: 'user', content: 'test' }];

    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => {});
    const proposal = await service.proposeEvolution(history);

    expect(proposal).toBeNull();
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Evolution Proposal Error: AI failure'),
    );
    stderrSpy.mockRestore();
  });

  describe('Shadow Testing & Rollback', () => {
    let mockChild;

    beforeEach(() => {
      mockChild = new EventEmitter();
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      spawn.mockReturnValue(mockChild);
    });

    it('validates evolution successfully when tests pass', async () => {
      const proposal = { proposedIdentityUpdate: '# success' };
      existsSync.mockReturnValue(true);
      fs.readFile.mockResolvedValue('original');

      const validationPromise = service.validateEvolution(proposal);

      // Simulate tests passing
      process.nextTick(() => mockChild.emit('close', 0));

      const result = await validationPromise;
      expect(result.success).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('Identity.md'),
        '# success',
      );
      expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('Identity.md.bak'));
    });

    it('rolls back automatically if tests fail', async () => {
      const proposal = { proposedIdentityUpdate: '# broken' };

      // Mock flow:
      // 1. exists(Identity.md) -> true
      // 2. readFile(Identity.md) -> 'original'
      // 3. exists(Identity.md.bak) -> true (during rollback cleanup)
      existsSync.mockReturnValue(true);
      fs.readFile.mockResolvedValue('original');

      const validationPromise = service.validateEvolution(proposal);

      // Simulate tests failing
      process.nextTick(() => mockChild.emit('close', 1));

      const result = await validationPromise;
      expect(result.success).toBe(false);
      expect(result.error).toBe('Regression tests failed');

      // Verify rollback occurred: original written back to Identity.md
      expect(fs.writeFile).toHaveBeenCalledWith(expect.stringContaining('Identity.md'), 'original');
    });

    it('manual rollback restores from backup', async () => {
      existsSync.mockReturnValue(true);
      fs.readFile.mockResolvedValueOnce('stable content');

      const result = await service.rollback();

      expect(result).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('Identity.md'),
        'stable content',
      );
      expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('Identity.md.bak'));
    });

    it('returns false if no backup exists for rollback', async () => {
      existsSync.mockReturnValue(false);
      const result = await service.rollback();
      expect(result).toBe(false);
    });
  });
});
