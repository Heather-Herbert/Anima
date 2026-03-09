const { describe, it, expect, beforeEach } = require('@jest/globals');
const EvolutionService = require('./EvolutionService');
const { callAI } = require('./Utils');
const fs = require('node:fs').promises;
const existsSync = require('node:fs').existsSync;
const path = require('node:path');

jest.mock('./Utils');
jest.mock('node:fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
  },
  existsSync: jest.fn(),
}));

describe('EvolutionService', () => {
  let service;
  const baseDir = '/mock/dir';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EvolutionService(baseDir);
  });

  it('proposes evolution based on conversation history', async () => {
    const history = [{ role: 'user', content: 'You did a great job fixing that PHP bug!' }];
    
    // Mock file existence and content
    existsSync.mockReturnValue(true);
    fs.readFile.mockResolvedValueOnce('Current Identity'); // Identity.md
    fs.readFile.mockResolvedValueOnce('[]'); // milestones.json

    const mockProposal = {
      newMilestones: [{ type: 'achievement', content: 'Fixed PHP bug', justification: 'User praised the fix' }],
      proposedIdentityUpdate: '# evolved identity',
      evolutionSummary: 'Became a Junior PHP Developer'
    };

    callAI.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(mockProposal) } }]
    });

    const proposal = await service.proposeEvolution(history);

    expect(proposal).toEqual(mockProposal);
    expect(callAI).toHaveBeenCalled();
  });

  it('applies evolution by updating files', async () => {
    const proposal = {
      newMilestones: [{ type: 'achievement', content: 'Fixed PHP bug' }],
      proposedIdentityUpdate: '# evolved identity',
      evolutionSummary: 'Became a Junior PHP Developer'
    };

    existsSync.mockReturnValue(false); // No existing milestones

    await service.applyEvolution(proposal);

    expect(fs.writeFile).toHaveBeenCalledWith(
      path.join(baseDir, 'Memory', 'milestones.json'),
      expect.stringContaining('Fixed PHP bug')
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      path.join(baseDir, 'Personality', 'Identity.md'),
      '# evolved identity'
    );
  });
});
