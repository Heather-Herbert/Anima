const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const fs = require('fs');
const path = require('path');

// Mock dependencies
jest.mock('fs');
jest.mock('../app/Config', () => ({
  model: 'cli-override-model',
}));

const OpenRouter = require('./OpenRouter');

describe('OpenRouter Plugin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  describe('completion', () => {
    it('returns response on success', async () => {
      // Mock config loading
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          endpoint: 'https://openrouter.ai/api/v1/chat/completions',
          apiKey: 'test-key',
          model: 'openai/gpt-3.5-turbo',
        }),
      );

      // Mock successful fetch
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'OpenRouter response',
              },
            },
          ],
        }),
      });

      const result = await OpenRouter.completion([{ role: 'user', content: 'hi' }]);

      expect(result.choices[0].message.content).toBe('OpenRouter response');

      // Verify authorization header
      expect(global.fetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
          }),
          body: expect.stringContaining('cli-override-model'), // Should use override
        }),
      );
    });

    it('throws error if config missing', async () => {
      fs.existsSync.mockReturnValue(false);

      await expect(OpenRouter.completion([])).rejects.toThrow(
        'OpenRouter configuration file not found',
      );
    });

    it('handles unauthorized errors (401)', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          endpoint: '...',
          apiKey: 'bad-key',
        }),
      );

      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect(OpenRouter.completion([])).rejects.toThrow('Invalid or expired API Key');
    });

    it('handles general API errors', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          endpoint: '...',
          apiKey: 'key',
        }),
      );

      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        text: async () => 'Internal Error',
      });

      await expect(OpenRouter.completion([])).rejects.toThrow(
        'API Request failed: 500 Server Error - Internal Error',
      );
    });
  });
});
