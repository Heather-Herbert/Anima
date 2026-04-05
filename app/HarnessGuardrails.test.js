/**
 * Harness Guardrail Tests
 *
 * Named behavioural tests that verify core safety properties of the harness.
 * These run as part of `npm test` and are also exercised by EvolutionService.validateEvolution()
 * via the regression test suite, ensuring that evolution proposals cannot silently break them.
 */
const { describe, it, expect, beforeEach } = require('@jest/globals');
const ConversationService = require('./ConversationService');
const { callAI } = require('./Utils');
const toolDispatcher = require('./ToolDispatcher');

jest.mock('./Utils', () => ({
  callAI: jest.fn(),
  redact: jest.fn((text) => text),
}));
jest.mock('./ToolDispatcher', () => ({ dispatch: jest.fn() }));
jest.mock('./Tools');
jest.mock('./AnalysisService', () =>
  jest.fn().mockImplementation(() => ({
    runLintAnalysis: jest.fn().mockResolvedValue({ status: 'HEALTHY' }),
  })),
);
jest.mock('./ReflectionService', () =>
  jest.fn().mockImplementation(() => ({
    isReflectionDue: jest.fn().mockResolvedValue(false),
    performReflection: jest.fn().mockResolvedValue(null),
  })),
);
jest.mock('node:fs');
jest.mock('./Config', () => ({
  memoryMode: 'off',
  workspaceDir: '.',
  compaction: { enabled: false, threshold: 20 },
  advisoryCouncil: { enabled: false },
  tokenBudget: {
    maxTotalTokens: null,
    maxInputTokens: null,
    maxOutputTokens: null,
    maxTurns: null,
  },
  selfVerification: { mode: 'off', maxConsecutiveFailures: 3 },
}));

describe('Harness Guardrails', () => {
  let service;
  const manifest = { permissions: { filesystem: { read: ['*'] } } };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ConversationService('Anima', [], manifest, 'history.json');
  });

  it('Destructive tools always require approval after this change', async () => {
    // write_file, run_command and execute_code must always invoke the confirmCallback —
    // they must never be dispatched silently regardless of other session state.
    const destructiveTools = ['write_file', 'run_command', 'execute_code', 'delete_file'];

    for (const toolName of destructiveTools) {
      jest.clearAllMocks();

      callAI.mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'tc1',
                  function: {
                    name: toolName,
                    arguments: JSON.stringify({
                      path: 'x.txt',
                      content: 'y',
                      file: 'x',
                      args: [],
                      code: 'console.log(1)',
                      justification: 'test',
                    }),
                  },
                },
              ],
            },
          },
        ],
      });
      callAI.mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'Done' } }],
      });

      const confirmMock = jest.fn().mockResolvedValue('n');
      toolDispatcher.dispatch.mockResolvedValue('ok');

      await service.processInput('do it', [], confirmMock);

      expect(confirmMock).toHaveBeenCalled();
      expect(confirmMock.mock.calls[0][0]).toBe(toolName);
    }
  });

  it('Token budget exhaustion produces a graceful stop, not a crash', async () => {
    // When the token budget is exceeded the loop must return a structured stopReason
    // and must NOT throw an exception.
    const config = require('./Config');
    config.tokenBudget = {
      maxTotalTokens: 50,
      maxInputTokens: null,
      maxOutputTokens: null,
      maxTurns: null,
    };

    // First iteration: tool call that consumes 100 tokens (over budget)
    callAI.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 't1',
                function: { name: 'read_file', arguments: '{"path":".","justification":"j"}' },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 60, completion_tokens: 40, total_tokens: 100 },
    });
    toolDispatcher.dispatch.mockResolvedValue('content');

    let result;
    await expect(
      (async () => {
        result = await service.processInput('go', [], jest.fn());
      })(),
    ).resolves.not.toThrow();

    expect(result.stopReason).toEqual(expect.objectContaining({ reason: 'token_budget_exceeded' }));
    expect(result.reply).toContain('Token budget reached');

    config.tokenBudget = {
      maxTotalTokens: null,
      maxInputTokens: null,
      maxOutputTokens: null,
      maxTurns: null,
    };
  });

  it('Taint mode sets isTainted=true on execute_code after web_search', async () => {
    // After web_search is executed, subsequent dangerous tool calls must receive
    // isTainted=true in the confirmCallback so the operator can make an informed decision.
    callAI.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            tool_calls: [
              { id: 't1', function: { name: 'web_search', arguments: '{"query":"test"}' } },
              {
                id: 't2',
                function: {
                  name: 'execute_code',
                  arguments: '{"code":"console.log(1)","justification":"run it"}',
                },
              },
            ],
          },
        },
      ],
    });
    callAI.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: 'Done' } }],
    });

    toolDispatcher.dispatch.mockResolvedValue('ok');
    const confirmMock = jest.fn().mockResolvedValue('n');

    await service.processInput('search then run', [], confirmMock);

    // confirmCallback for execute_code must have been called with isTainted=true
    const executeCodeCall = confirmMock.mock.calls.find((c) => c[0] === 'execute_code');
    expect(executeCodeCall).toBeDefined();
    expect(executeCodeCall[3]).toBe(true); // isTainted is the 4th argument
  });
});
