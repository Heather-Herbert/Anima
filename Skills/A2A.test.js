const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const fs = require('node:fs');

jest.mock('node:fs');
jest.mock('fs', () => require('node:fs'));

jest.mock('../app/Config', () => ({
  agentName: 'TestAnima',
  workspaceDir: '/test/workspace',
}));

const A2A = require('./A2A');

describe('A2A Skill', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  describe('learn_from_agent', () => {
    it('successfully fetches identity and saves memo', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'I am a Test Agent. Identity: Senior Dev. Soul: Helpful.',
            },
          },
        ],
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      fs.existsSync.mockReturnValue(false); // memos directory needs creating

      const result = await A2A.implementations.learn_from_agent({
        endpoint: 'http://localhost:18701/v1/chat/completions',
        agentId: 'other-agent',
      });

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('memos'), {
        recursive: true,
      });
      expect(result).toContain('Successfully learned from agent other-agent');
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('memo_'),
        'I am a Test Agent. Identity: Senior Dev. Soul: Helpful.',
      );
    });

    it('handles fetch errors', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await A2A.implementations.learn_from_agent({
        endpoint: 'http://localhost:18701/v1/chat/completions',
      });

      expect(result).toContain('Error learning from agent: HTTP 404');
    });
  });
});
