const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const fs = require('fs');

// Mock dependencies
jest.mock('fs');
jest.mock('../app/Config', () => ({
  model: 'test-model',
}));

// We need to require OpenClaw AFTER mocking
const OpenClaw = require('./OpenClaw');

describe('OpenClaw Plugin', () => {
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
          endpoint: 'http://localhost:18789/v1/chat/completions',
          apiKey: 'test-token',
          model: 'openclaw:test',
        }),
      );

      // Mock fetch for server check AND completion
      global.fetch
        .mockResolvedValueOnce({ ok: true }) // Server check
        .mockResolvedValueOnce({
          // Completion call
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Hello from OpenClaw',
                },
              },
            ],
          }),
        });

      const result = await OpenClaw.completion([{ role: 'user', content: 'hi' }]);

      expect(result.choices[0].message.content).toBe('Hello from OpenClaw');
      expect(global.fetch).toHaveBeenCalledTimes(2);

      const [url, options] = global.fetch.mock.calls[1];
      expect(url).toBe('http://localhost:18789/v1/chat/completions');
      expect(options.headers.Authorization).toBe('Bearer test-token');
      const body = JSON.parse(options.body);
      expect(body.model).toBe('test-model'); // mainConfig.model overrides providerConfig.model
    });

    it('throws error if server check fails', async () => {
      fs.existsSync.mockReturnValue(false); // Use defaults

      global.fetch.mockRejectedValue(new Error('Connection refused'));

      await expect(OpenClaw.completion([])).rejects.toThrow('OpenClaw server is not reachable');
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

      await expect(OpenClaw.completion([])).rejects.toThrow(
        'OpenClaw API Request failed: 500 Internal Server Error - Error message',
      );
    });

    it('handles authentication errors', async () => {
      fs.existsSync.mockReturnValue(false);

      global.fetch
        .mockResolvedValueOnce({ ok: true }) // Server check
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: async () => 'Invalid token',
        });

      await expect(OpenClaw.completion([])).rejects.toThrow('Invalid or expired OpenClaw API Key');
    });
  });
});
