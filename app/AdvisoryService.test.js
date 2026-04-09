const { describe, it, expect, beforeEach } = require('@jest/globals');
const AdvisoryService = require('./AdvisoryService');
const { callAI } = require('./Utils');
const config = require('./Config');
const fs = require('node:fs');

jest.mock('./Utils', () => ({
  callAI: jest.fn(),
  summariseHealth: jest.fn((report) =>
    report
      ? `Status: ${report.status} | ${report.summary} | Top issues: ${[
          ...(report.complexityIssues || []),
          ...(report.debtItems || []),
        ]
          .slice(0, 3)
          .map((i) => `${i.rule} in ${i.file}:${i.line}`)
          .join('; ')}`
      : 'No health data.',
  ),
}));
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

  it('uses overrideAdvisers instead of config advisers when provided', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('Override Adviser Prompt');

    callAI.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(validAdvice) } }],
    });

    const override = [{ name: 'LegalCounsel', role: 'Legal reviewer', promptFile: 'legal.md' }];
    const results = await service.getAdvice(
      {
        userMessage: 'hi',
        mainDraft: 'hello',
        taintStatus: false,
        availableToolsSummary: 'none',
      },
      override,
    );

    expect(results).toHaveLength(1);
    expect(results[0].adviserName).toBe('LegalCounsel');
  });

  it('returns empty array when council is disabled even with overrideAdvisers', async () => {
    config.advisoryCouncil.enabled = false;
    const override = [{ name: 'X', role: 'Y', promptFile: 'z.md' }];
    const results = await service.getAdvice({}, override);
    expect(results).toEqual([]);
    config.advisoryCouncil.enabled = true; // reset
  });

  it('summarises health report rather than sending raw JSON to adviser prompt', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('Adviser Prompt');

    callAI.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(validAdvice) } }],
    });

    const healthReport = {
      status: 'WARNING',
      summary: 'Found 0 errors and 3 warnings across 2 files.',
      complexityIssues: [{ rule: 'complexity', file: 'app/Foo.js', line: 42 }],
      debtItems: [],
    };

    await service.getAdvice({
      userMessage: 'hi',
      mainDraft: 'hello',
      taintStatus: false,
      availableToolsSummary: 'none',
      healthReport,
    });

    const userPromptContent = callAI.mock.calls[0][0].find((m) => m.role === 'user').content;

    expect(userPromptContent).toContain('Status: WARNING');
    expect(userPromptContent).toContain('complexity in app/Foo.js:42');
    expect(userPromptContent).not.toContain('"complexityIssues"');
    expect(userPromptContent).not.toContain('"severity"');
  });

  it('truncates long userMessage and mainDraft in adviser prompt', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('Adviser Prompt');

    callAI.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(validAdvice) } }],
    });

    const longUserMessage = 'A'.repeat(400);
    const longMainDraft = 'B'.repeat(600);

    await service.getAdvice({
      userMessage: longUserMessage,
      mainDraft: longMainDraft,
      taintStatus: false,
      availableToolsSummary: 'none',
    });

    const calledMessages = callAI.mock.calls[0][0];
    const userPromptContent = calledMessages.find((m) => m.role === 'user').content;

    expect(userPromptContent).toContain('A'.repeat(300) + '…');
    expect(userPromptContent).not.toContain('A'.repeat(301));
    expect(userPromptContent).toContain('B'.repeat(500) + '…');
    expect(userPromptContent).not.toContain('B'.repeat(501));
  });

  it('throws error if prompt file is missing', () => {
    fs.existsSync.mockReturnValue(false);
    expect(() => service.loadPrompt('missing.md')).toThrow('Prompt file not found');
  });

  it('generates a consolidated council memo', () => {
    const adviceList = [
      {
        adviserName: 'Security',
        verdict: 'block',
        rationale: ['Exploit'],
        risks: { level: 'high', items: ['Injection'] },
        recommendedNextSteps: ['Deny'],
        toolPolicy: { allowTools: false },
        confidence: 1.0,
      },
      {
        adviserName: 'Architect',
        verdict: 'approve',
        rationale: ['Efficient'],
        risks: { level: 'low', items: [] },
        recommendedNextSteps: ['Proceed'],
        toolPolicy: { allowTools: true },
        confidence: 0.8,
      },
    ];

    const memo = service.generateCouncilMemo(adviceList);
    expect(memo).toContain('Consensus Verdict**: BLOCK');
    expect(memo).toContain('Overall Risk Level**: HIGH');
    expect(memo).toContain(
      'Disagreements**: Security recommended BLOCK, Architect recommended APPROVE',
    );
    expect(memo).toContain('BLOCK ALL TOOLS');
  });

  it('correctly handles tool constraints in council memo', () => {
    const adviceList = [
      {
        adviserName: 'SafeGuard',
        verdict: 'caution',
        rationale: ['Limit access'],
        risks: { level: 'med', items: ['Network'] },
        recommendedNextSteps: ['Restrict'],
        toolPolicy: { allowTools: true, allowedTools: ['read_file', 'list_files'] },
        confidence: 1.0,
      },
    ];

    const memo = service.generateCouncilMemo(adviceList);
    expect(memo).toContain('Allow only: read_file, list_files');
  });

  it('produces a neutral memo when no risks identified', () => {
    const adviceList = [
      {
        adviserName: 'Helper',
        verdict: 'approve',
        rationale: ['Safe'],
        risks: { level: 'low', items: [] },
        recommendedNextSteps: ['Proceed'],
        toolPolicy: { allowTools: true },
        confidence: 1.0,
      },
    ];

    const memo = service.generateCouncilMemo(adviceList);
    expect(memo).toContain('Consensus Verdict**: APPROVE');
    expect(memo).toContain('Overall Risk Level**: LOW');
    expect(memo).toContain('Recommended Plan**: Proceed');
  });
});
