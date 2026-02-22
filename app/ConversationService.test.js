const { describe, it, expect, beforeEach } = require('@jest/globals');
const ConversationService = require('./ConversationService');
const { callAI } = require('./Utils');
const { availableTools } = require('./Tools');
const fs = require('node:fs');

jest.mock('./Utils');
jest.mock('./Tools');
jest.mock('node:fs');

describe('ConversationService', () => {
  let service;
  const historyPath = 'history.json';
  const agentName = 'Anima';
  const manifest = { permissions: { filesystem: { read: ['*'] } } };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ConversationService(agentName, [], manifest, historyPath);
  });

  it('processes simple user input and returns assistant reply', async () => {
    callAI.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'Hello!' } }],
    });

    const history = [];
    const reply = await service.processInput('Hi', history, jest.fn());

    expect(reply).toBe('Hello!');
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({ role: 'user', content: 'Hi' });
    expect(history[1]).toEqual({ role: 'assistant', content: 'Hello!' });
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('handles tool calls and continues loop', async () => {
    // 1st call: tool call
    callAI.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call1',
                function: {
                  name: 'read_file',
                  arguments: '{"path":"test.txt","justification":"test"}',
                },
              },
            ],
          },
        },
      ],
    });
    // 2nd call: final response
    callAI.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: 'File content is here.' } }],
    });

    availableTools.read_file.mockResolvedValue('actual file content');

    const history = [];
    const reply = await service.processInput('Read file', history, jest.fn());

    expect(reply).toBe('File content is here.');
    expect(history).toHaveLength(4); // User, Assistant(ToolCall), Tool, Assistant(Final)
    expect(history[2].role).toBe('tool');
    expect(history[2].content).toBe('actual file content');
  });

  it('handles dangerous tool confirmation', async () => {
    callAI.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call2',
                function: {
                  name: 'write_file',
                  arguments: '{"path":"x.txt","content":"y","justification":"need it"}',
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

    const confirmMock = jest.fn().mockResolvedValue('y');
    availableTools.write_file.mockResolvedValue('written');

    const history = [];
    await service.processInput('Write it', history, confirmMock);

    expect(confirmMock).toHaveBeenCalledWith('write_file', expect.anything(), 'need it');
    expect(availableTools.write_file).toHaveBeenCalled();
  });

  it('respects denial of dangerous tool', async () => {
    callAI.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call3',
                function: {
                  name: 'run_command',
                  arguments: '{"file":"ls","args":["-la"],"justification":"check files"}',
                },
              },
            ],
          },
        },
      ],
    });
    callAI.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: 'OK' } }],
    });

    const confirmMock = jest.fn().mockResolvedValue('n'); // Denied

    const history = [];
    await service.processInput('danger', history, confirmMock);

    expect(availableTools.run_command).not.toHaveBeenCalled();
    expect(history[2].content).toBe('User denied tool execution.');
  });

  it('handles malformed AI response gracefully', async () => {
    callAI.mockImplementation(() => Promise.resolve({})); // No choices
    const history = [];
    await expect(service.processInput('fail', history, jest.fn())).rejects.toThrow(
      'Malformed response from AI provider',
    );
  });

  it('retries on AI failure and eventually throws', async () => {
    callAI.mockRejectedValue(new Error('API Error'));
    const history = [];
    await expect(service.processInput('retry', history, jest.fn())).rejects.toThrow('API Error');
    expect(callAI).toHaveBeenCalledTimes(3); // maxAttempts
  });

  it('immediately throws on 401/403 errors', async () => {
    callAI.mockRejectedValue(new Error('401 Unauthorized'));
    const history = [];
    await expect(service.processInput('auth', history, jest.fn())).rejects.toThrow(
      '401 Unauthorized',
    );
    expect(callAI).toHaveBeenCalledTimes(1);
  });

  it('handles tool execution errors', async () => {
    callAI.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            tool_calls: [{ id: 'c1', function: { name: 'bad', arguments: '{}' } }],
          },
        },
      ],
    });
    callAI.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: 'Err handled' } }],
    });

    availableTools.bad = jest.fn().mockRejectedValue(new Error('Tool Crash'));

    const history = [];
    await service.processInput('bad tool', history, jest.fn());
    expect(history[2].content).toContain('Error: Tool Crash');
  });
});
