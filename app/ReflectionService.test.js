const { describe, it, expect, beforeEach } = require('@jest/globals');
const ReflectionService = require('./ReflectionService');
const fs = require('node:fs').promises;
const { existsSync } = require('node:fs');
const { callAI } = require('./Utils');

jest.mock('./Utils');
jest.mock('node:fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
  },
  existsSync: jest.fn(),
}));

describe('ReflectionService', () => {
  let service;
  const baseDir = '/mock/dir';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReflectionService(baseDir, null);
  });

  it('determines reflection is due if no state exists', async () => {
    existsSync.mockReturnValue(false);
    const due = await service.isReflectionDue();
    expect(due).toBe(true);
  });

  it('determines reflection is due if last reflection was yesterday', async () => {
    existsSync.mockReturnValue(true);
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    fs.readFile.mockResolvedValue(JSON.stringify({ lastReflectionDate: yesterday.toISOString() }));

    const due = await service.isReflectionDue();
    expect(due).toBe(true);
  });

  it('determines reflection is NOT due if already reflected today', async () => {
    existsSync.mockReturnValue(true);
    const today = new Date();
    fs.readFile.mockResolvedValue(JSON.stringify({ lastReflectionDate: today.toISOString() }));

    const due = await service.isReflectionDue();
    expect(due).toBe(false);
  });

  it('performs reflection and returns a proposal', async () => {
    existsSync.mockReturnValue(true);
    fs.readFile.mockResolvedValue('mock log content');

    const mockProposal = {
      newMilestones: [
        { type: 'learning', content: 'Better error handling', justification: 'test' },
      ],
      proposedIdentityUpdate: '# Updated Identity',
      evolutionSummary: 'Improved based on failures',
    };

    callAI.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(mockProposal) } }],
    });

    const proposal = await service.performReflection({ status: 'HEALTHY' });

    expect(proposal).toEqual(mockProposal);
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('reflection_state.json'),
      expect.stringContaining(new Date().getUTCFullYear().toString()),
    );
  });
});
