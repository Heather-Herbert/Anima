const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const fs = require('node:fs');
const os = require('node:os');
const { implementations } = require('./OpenClawBridge');

jest.mock('node:fs');
jest.mock('node:os');

describe('OpenClawBridge Skill', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    fs.existsSync.mockReturnValue(false); // No config file by default
    os.networkInterfaces.mockReturnValue({
      eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.10' }],
    });
  });

  afterEach(() => {
    delete global.fetch;
  });

  describe('openclaw_delegate', () => {
    it('successfully delegates task in sync mode', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Task completed sync' } }],
        }),
      });

      const result = await implementations.openclaw_delegate(
        { task: 'Do something', mode: 'sync' },
        {},
      );

      expect(result).toContain('Result from OpenClaw (jennifer):');
      expect(result).toContain('Task completed sync');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('chat/completions'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('TASK DELEGATION (sync): Do something'),
        }),
      );
    });

    it('successfully delegates task in async mode', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ taskId: 'job-123' }),
      });

      const result = await implementations.openclaw_delegate(
        { task: 'Long task', mode: 'async', agentId: 'worker' },
        {},
      );

      expect(result).toContain('successfully delegated');
      expect(result).toContain('ASYNC mode');
      expect(result).toContain('job-123');
      expect(result).toContain('http://192.168.1.10:');

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.async).toBe(true);
      expect(body.webhook_url).toContain('192.168.1.10');
    });

    it('sets taint flag if remote response is tainted', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Tainted result', tainted: true } }],
        }),
      });

      const permissions = { _isTainted: false };
      const result = await implementations.openclaw_delegate(
        { task: 'Search web for me' },
        permissions,
      );

      expect(result).toContain('Remote response is TAINTED');
      expect(permissions._isTainted).toBe(true);
    });

    it('handles fetch errors', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await implementations.openclaw_delegate({ task: 'fail' }, {});

      expect(result).toContain('Error delegating to OpenClaw: Network timeout');
    });

    it('uses context snippets in request', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'OK' } }] }),
      });

      await implementations.openclaw_delegate(
        { task: 'use snippets', context_snippets: ['Snippet 1', 'Snippet 2'] },
        {},
      );

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.messages[0].content).toContain('Snippet 1');
      expect(body.messages[0].content).toContain('Snippet 2');
    });
  });
});
