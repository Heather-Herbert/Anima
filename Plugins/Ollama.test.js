const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const fs = require('fs');
const path = require('path');

// Mock dependencies
jest.mock('fs');
jest.mock('../app/Config', () => ({
  model: 'test-model',
}));

// We need to require Ollama AFTER mocking
const Ollama = require('./Ollama');

describe('Ollama Plugin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  describe('completion', () => {
    it('returns normalized response on success', async () => {
      // Mock config loading
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          endpoint: 'http://localhost:11434/api/chat',
          model: 'llama3',
        }),
      );

      // Mock fetch for server check AND completion
      global.fetch
        .mockResolvedValueOnce({ ok: true }) // Server check
        .mockResolvedValueOnce({
          // Completion call
          ok: true,
          json: async () => ({
            message: {
              role: 'assistant',
              content: 'Hello world',
              tool_calls: [
                {
                  function: {
                    name: 'test_tool',
                    arguments: { arg1: 'val1' }, // Ollama returns objects
                  },
                },
              ],
            },
          }),
        });

      const result = await Ollama.completion([{ role: 'user', content: 'hi' }]);

      expect(result.choices[0].message.content).toBe('Hello world');
      // Verify tool argument normalization
      expect(typeof result.choices[0].message.tool_calls[0].function.arguments).toBe('string');
      expect(result.choices[0].message.tool_calls[0].function.arguments).toBe('{"arg1":"val1"}');

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('throws error if server check fails', async () => {
      fs.existsSync.mockReturnValue(false); // Use defaults

      global.fetch.mockRejectedValue(new Error('Connection refused'));

      await expect(Ollama.completion([])).rejects.toThrow('Ollama server is not reachable');
    });

    it('handles API errors', async () => {
      fs.existsSync.mockReturnValue(false);

      global.fetch
        .mockResolvedValueOnce({ ok: true }) // Server check
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'Error message',
        });

      await expect(Ollama.completion([])).rejects.toThrow(
        'Ollama API Request failed: 500 Internal Server Error - Error message',
      );
    });
  });
});
