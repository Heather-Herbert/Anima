const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const fs = require('fs');

jest.mock('fs');
jest.mock('../app/Config', () => ({
  model: 'test-model',
}));

const OpenAI = require('./OpenAI');
const DeepSeek = require('./DeepSeek');
const Anthropic = require('./Anthropic');
const Gemini = require('./Gemini');

describe('New Providers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  describe('OpenAI', () => {
    it('returns OpenAI response format', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ apiKey: 'key', endpoint: 'url' }));
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'OpenAI' } }] }),
      });
      const result = await OpenAI.completion([]);
      expect(result.choices[0].message.content).toBe('OpenAI');
    });
  });

  describe('DeepSeek', () => {
    it('returns DeepSeek response format', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ apiKey: 'key', endpoint: 'url' }));
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'DeepSeek' } }] }),
      });
      const result = await DeepSeek.completion([]);
      expect(result.choices[0].message.content).toBe('DeepSeek');
    });
  });

  describe('Anthropic', () => {
    it('normalizes Anthropic response format', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ apiKey: 'key' }));
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            { type: 'text', text: 'Anthropic content' },
            { type: 'tool_use', id: 'tool_1', name: 'my_tool', input: { a: 1 } },
          ],
        }),
      });
      const result = await Anthropic.completion([]);
      expect(result.choices[0].message.content).toBe('Anthropic content');
      expect(result.choices[0].message.tool_calls[0].function.name).toBe('my_tool');
    });
  });

  describe('Gemini', () => {
    it('normalizes Gemini response format', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ apiKey: 'key' }));
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  { text: 'Gemini content' },
                  { functionCall: { name: 'g_tool', args: { x: 10 } } },
                ],
              },
            },
          ],
        }),
      });
      const result = await Gemini.completion([]);
      expect(result.choices[0].message.content).toBe('Gemini content');
      expect(result.choices[0].message.tool_calls[0].function.name).toBe('g_tool');
    });
  });
});
