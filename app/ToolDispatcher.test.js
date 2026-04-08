const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const toolDispatcher = require('./ToolDispatcher');
const { availableTools } = require('./Tools');

jest.mock('./Tools', () => {
  const original = jest.requireActual('./Tools');
  return {
    ...original,
    availableTools: {
      ...original.availableTools,
      test_tool: jest.fn().mockResolvedValue('success'),
    },
    tools: [
      ...original.tools,
      {
        type: 'function',
        function: {
          name: 'test_tool',
          parameters: {
            type: 'object',
            properties: {
              param1: { type: 'string' },
            },
            required: ['param1'],
          },
        },
      },
    ],
  };
});

describe('ToolDispatcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('successfully dispatches a valid tool call', async () => {
    const toolCall = {
      function: {
        name: 'test_tool',
        arguments: '{"param1": "value1"}',
      },
    };
    const result = await toolDispatcher.dispatch(toolCall, {});
    expect(result).toBe('success');
    expect(availableTools.test_tool).toHaveBeenCalledWith(
      { param1: 'value1' },
      { auditService: null },
    );
  });

  it('returns error for unknown tool', async () => {
    const toolCall = {
      function: {
        name: 'ghost_tool',
        arguments: '{}',
      },
    };
    const result = await toolDispatcher.dispatch(toolCall, {});
    expect(result).toContain("Unknown tool 'ghost_tool'");
  });

  it('returns error for malformed JSON', async () => {
    const toolCall = {
      function: {
        name: 'test_tool',
        arguments: '{ invalid json }',
      },
    };
    const result = await toolDispatcher.dispatch(toolCall, {});
    expect(result).toContain('Malformed JSON arguments');
  });

  it('validates required parameters', async () => {
    const toolCall = {
      function: {
        name: 'test_tool',
        arguments: '{}',
      },
    };
    const result = await toolDispatcher.dispatch(toolCall, {});
    expect(result).toContain("Missing required parameter: 'param1'");
  });

  it('validates parameter types', async () => {
    const toolCall = {
      function: {
        name: 'test_tool',
        arguments: '{"param1": 123}',
      },
    };
    const result = await toolDispatcher.dispatch(toolCall, {});
    expect(result).toContain("expected type 'string', got 'number'");
  });

  it('validates array parameters for advisory_council', async () => {
    const toolCall = {
      function: {
        name: 'advisory_council',
        arguments: '{"question": "test", "focus": "not an array"}',
      },
    };
    const result = await toolDispatcher.dispatch(toolCall, {});
    expect(result).toContain("expected type 'array', got 'string'");
  });

  describe('agent type enforcement', () => {
    afterEach(() => {
      // Reset to no type restriction after each test.
      toolDispatcher.setAgentType(null);
    });

    it('allows a tool that is in the agent type allowlist', async () => {
      // 'general' allows everything (*).
      toolDispatcher.setAgentType('general');
      const toolCall = {
        function: { name: 'test_tool', arguments: '{"param1": "hello"}' },
      };
      const result = await toolDispatcher.dispatch(toolCall, {});
      expect(result).toBe('success');
    });

    it('blocks a tool not in the agent type allowlist', async () => {
      // 'explore' allows only read-style tools — test_tool is not in its list.
      toolDispatcher.setAgentType('explore');
      const toolCall = {
        function: { name: 'test_tool', arguments: '{"param1": "hello"}' },
      };
      const result = await toolDispatcher.dispatch(toolCall, {});
      expect(result).toContain("not permitted for agent type 'explore'");
    });

    it('blocks all tools for guide type', async () => {
      toolDispatcher.setAgentType('guide');
      const toolCall = {
        function: { name: 'read_file', arguments: '{"path": "README.md"}' },
      };
      const result = await toolDispatcher.dispatch(toolCall, {});
      expect(result).toContain("not permitted for agent type 'guide'");
    });

    it('allows all tools for worker type', async () => {
      toolDispatcher.setAgentType('worker');
      const toolCall = {
        function: { name: 'test_tool', arguments: '{"param1": "hello"}' },
      };
      const result = await toolDispatcher.dispatch(toolCall, {});
      expect(result).toBe('success');
    });

    it('applies no restriction when agentType is null', async () => {
      toolDispatcher.setAgentType(null);
      const toolCall = {
        function: { name: 'test_tool', arguments: '{"param1": "hello"}' },
      };
      const result = await toolDispatcher.dispatch(toolCall, {});
      expect(result).toBe('success');
    });
  });
});
