const { describe, it, expect, beforeEach } = require('@jest/globals');
const AdvisoryService = require('./AdvisoryService');
const { callAI } = require('./Utils');
const config = require('./Config');
const fs = require('node:fs');

jest.mock('./Utils');
jest.mock('./Config', () => ({
  advisoryCouncil: {
    enabled: true,
    mode: 'always',
    advisers: [
      { name: 'TestAdviser', role: 'Tester', promptFile: 'p.md' }
    ],
    maxAdvisersPerCall: 3,
    timeoutMs: 1000,
    parallel: true
  },
  workspaceDir: '.'
}));
jest.mock('node:fs');

describe('AdvisoryService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdvisoryService();
  });

  it('returns structured advice from advisers', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('Adviser Prompt');
    
    callAI.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            sentiment: 'positive',
            riskScore: 0.1,
            feedback: 'Looks good'
          })
        }
      }]
    });

    const results = await service.getAdvice({
      userMessage: 'hi',
      mainDraft: 'hello',
      managedHistorySummary: 'none',
      taintStatus: false,
      availableToolsSummary: 'none'
    });

    expect(results).toHaveLength(1);
    expect(results[0].adviser).toBe('TestAdviser');
    expect(results[0].sentiment).toBe('positive');
  });

  it('handles adviser failure gracefully', async () => {
    callAI.mockRejectedValue(new Error('API Failure'));

    const results = await service.getAdvice({
      userMessage: 'hi',
      mainDraft: 'hello'
    });

    expect(results).toEqual([]);
  });

  it('returns empty array if council is disabled', async () => {
    config.advisoryCouncil.enabled = false;
    const results = await service.getAdvice({});
    expect(results).toEqual([]);
    config.advisoryCouncil.enabled = true; // reset
  });

  it('validates adviser response format', async () => {
    callAI.mockResolvedValue({
      choices: [{
        message: {
          content: 'invalid json'
        }
      }]
    });

    const results = await service.getAdvice({});
    expect(results).toEqual([]);
  });
});
