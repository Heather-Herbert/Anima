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
    advisers: [{ name: 'TestAdviser', role: 'Tester', promptFile: 'p.md' }],
    maxAdvisersPerCall: 3,
    timeoutMs: 1000,
    parallel: true,
  },
  workspaceDir: '.',
}));
jest.mock('node:fs');

describe('AdvisoryService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdvisoryService();
  });

  const validAdvice = {
    verdict: 'approve',
    rationale: ['Logic is sound'],
    risks: { level: 'low', items: [] },
    recommendedNextSteps: ['Proceed'],
    toolPolicy: { allowTools: true },
    confidence: 0.9,
  };

  it('returns structured advice from advisers and caches prompts', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('Adviser Prompt');

    callAI.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify(validAdvice),
          },
        },
      ],
    });

    const context = {
      userMessage: 'hi',
      mainDraft: 'hello',
      managedHistorySummary: 'none',
      taintStatus: false,
      availableToolsSummary: 'none',
    };

    const results = await service.getAdvice(context);

    expect(results).toHaveLength(1);
    expect(results[0].adviserName).toBe('TestAdviser');
    expect(results[0].verdict).toBe('approve');
    expect(fs.readFileSync).toHaveBeenCalledTimes(1);
  });

  it('clamps confidence values out of range', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('p');
    callAI.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ ...validAdvice, confidence: 1.5 }) } }],
    });

    const results = await service.getAdvice({});
    expect(results[0].confidence).toBe(1);
  });

  it('provides a safe fallback on invalid JSON', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('p');
    callAI.mockResolvedValue({
      choices: [{ message: { content: 'invalid' } }],
    });

    const results = await service.getAdvice({});
    expect(results).toHaveLength(1);
    expect(results[0].verdict).toBe('block');
    expect(results[0].risks.level).toBe('high');
  });

  it('provides a safe fallback on schema violation', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('p');
    callAI.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ verdict: 'wrong' }) } }],
    });

    const results = await service.getAdvice({});
    expect(results[0].verdict).toBe('block');
  });

  it('returns empty array if council is disabled', async () => {
    config.advisoryCouncil.enabled = false;
    const results = await service.getAdvice({});
    expect(results).toEqual([]);
    config.advisoryCouncil.enabled = true; // reset
  });

  it('throws error if prompt file is missing', () => {
    fs.existsSync.mockReturnValue(false);
    expect(() => service.loadPrompt('missing.md')).toThrow('Prompt file not found');
  });
});
