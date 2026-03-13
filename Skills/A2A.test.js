const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const fs = require('node:fs');
const http = require('node:http');
const EventEmitter = require('node:events');

jest.mock('node:fs');
jest.mock('fs', () => require('node:fs'));
jest.mock('node:http');

jest.mock('../app/Config', () => ({
  agentName: 'TestAnima',
  workspaceDir: '/test/workspace',
}));

// Mock app/Utils to prevent real AI calls
jest.mock('../app/Utils', () => ({
  callAI: jest.fn(),
}));

const A2A = require('./A2A');
const { callAI } = require('../app/Utils');

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

  describe('delegate_task', () => {
    it('successfully delegates task', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Task completed successfully' } }],
        }),
      });

      const result = await A2A.implementations.delegate_task({
        endpoint: 'http://other-agent/v1/chat/completions',
        task: 'Do something',
        agentId: 'worker-1',
      });

      expect(result).toContain('Result from agent worker-1:');
      expect(result).toContain('Task completed successfully');
      expect(global.fetch).toHaveBeenCalledWith(
        'http://other-agent/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('TASK DELEGATION: Do something'),
        }),
      );
    });

    it('handles delegation errors', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network failure'));

      const result = await A2A.implementations.delegate_task({
        endpoint: 'http://other-agent/v1/chat/completions',
        task: 'Do something',
      });

      expect(result).toContain('Error delegating task: Network failure');
    });
  });

  describe('discover_agents', () => {
    it('discovers agents on localhost', async () => {
      // Mock fetch for range scanning
      global.fetch.mockImplementation((url) => {
        if (url === 'http://127.0.0.1:18700/') {
          return Promise.resolve({ status: 200, ok: true });
        }
        return Promise.reject(new Error('Connection refused'));
      });

      // Mock os.networkInterfaces to avoid actual subnet scanning in test
      const os = require('node:os');
      jest.spyOn(os, 'networkInterfaces').mockReturnValue({});

      const result = await A2A.implementations.discover_agents({
        startPort: 18700,
        endPort: 18700,
        scanSubnetOnly: true,
      });

      expect(result).toContain('http://127.0.0.1:18700/v1/chat/completions');
    });

    it('reports no agents found', async () => {
      // Return a status that is NOT 200, 404, or 403 to trigger inactivity
      global.fetch.mockImplementation(() => Promise.resolve({ status: 500, ok: false }));

      const os = require('node:os');
      const networkSpy = jest.spyOn(os, 'networkInterfaces').mockReturnValue({});

      const result = await A2A.implementations.discover_agents({
        startPort: 18700,
        endPort: 18700,
        scanSubnetOnly: true,
      });

      expect(result).toBe('No other agents discovered on local subnets.');
      networkSpy.mockRestore();
    });
  });

  describe('startServer', () => {
    let mockReq, mockRes, serverHandler;

    beforeEach(() => {
      mockReq = new EventEmitter();
      mockRes = {
        writeHead: jest.fn(),
        end: jest.fn(),
      };
      http.createServer.mockImplementation((handler) => {
        serverHandler = handler;
        return {
          listen: jest.fn((port, host, cb) => cb && cb()),
          close: jest.fn(),
        };
      });
    });

    it('starts a server and handles Identity queries', async () => {
      A2A.startServer('/test/base');
      expect(http.createServer).toHaveBeenCalled();

      mockReq.method = 'POST';
      mockReq.url = '/v1/chat/completions';

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('Mock Identity Content');

      const promise = serverHandler(mockReq, mockRes);

      mockReq.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            messages: [{ role: 'user', content: 'who are you?' }],
          }),
        ),
      );
      mockReq.emit('end');

      await promise;

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.anything());
      expect(mockRes.end).toHaveBeenCalledWith(expect.stringContaining('Mock Identity Content'));
    });

    it('handles Task Delegation queries', async () => {
      A2A.startServer('/test/base');

      mockReq.method = 'POST';
      mockReq.url = '/v1/chat/completions';

      callAI.mockResolvedValueOnce({
        choices: [{ message: { content: 'Sub-agent result' } }],
      });

      const promise = serverHandler(mockReq, mockRes);

      mockReq.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            messages: [{ role: 'user', content: 'Perform task X' }],
          }),
        ),
      );
      mockReq.emit('end');

      await promise;

      expect(callAI).toHaveBeenCalled();
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.anything());
      expect(mockRes.end).toHaveBeenCalledWith(expect.stringContaining('Sub-agent result'));
    });

    it('handles 404 for wrong routes', () => {
      A2A.startServer('/test/base');
      mockReq.method = 'GET';
      mockReq.url = '/unknown';

      serverHandler(mockReq, mockRes);
      expect(mockRes.writeHead).toHaveBeenCalledWith(404);
    });
  });
});
