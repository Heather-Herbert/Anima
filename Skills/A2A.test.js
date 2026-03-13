const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const fs = require('node:fs');
const http = require('node:http');
const dgram = require('node:dgram');
const EventEmitter = require('node:events');

jest.mock('node:fs');
jest.mock('fs', () => require('node:fs'));
jest.mock('node:http');
jest.mock('node:dgram');

jest.mock('../app/Config', () => ({
  agentName: 'TestAnima',
  workspaceDir: '/test/workspace',
}));

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

      fs.existsSync.mockReturnValue(false);

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
  });

  describe('discover_agents', () => {
    let mockUdpSocket;

    beforeEach(() => {
      mockUdpSocket = new EventEmitter();
      mockUdpSocket.bind = jest.fn((port, cb) => cb && cb());
      mockUdpSocket.setBroadcast = jest.fn();
      mockUdpSocket.send = jest.fn();
      mockUdpSocket.close = jest.fn();
      dgram.createSocket.mockReturnValue(mockUdpSocket);
    });

    it('discovers agents via UDP broadcast', async () => {
      const discoveryPromise = A2A.implementations.discover_agents({
        useUdp: true,
      });

      // Simulate receiving a UDP response
      const responseMsg = JSON.stringify({
        type: 'anima_agent',
        name: 'OtherAnima',
        port: 18705,
      });
      mockUdpSocket.emit('message', Buffer.from(responseMsg), { address: '192.168.1.50' });

      // Fast-forward the timeout in discover_agents (1.5s)
      // Actually, we'll just wait for the promise to resolve
      const result = await discoveryPromise;

      expect(result).toContain('http://192.168.1.50:18705/v1/chat/completions');
      expect(mockUdpSocket.setBroadcast).toHaveBeenCalledWith(true);
      expect(mockUdpSocket.send).toHaveBeenCalledWith(
        Buffer.from('ANIMA_DISCOVER'),
        18789,
        '255.255.255.255',
      );
    });

    it('falls back to port scanning if UDP finds nothing', async () => {
      // Mock fetch for port scan
      global.fetch.mockImplementation(() => Promise.resolve({ status: 500, ok: false }));

      const os = require('node:os');
      const networkSpy = jest.spyOn(os, 'networkInterfaces').mockReturnValue({});

      const result = await A2A.implementations.discover_agents({
        useUdp: true,
        startPort: 18700,
        endPort: 18700,
        scanSubnetOnly: true,
      });

      expect(result).toBe('No other agents discovered on local subnets.');
      networkSpy.mockRestore();
    });
  });

  describe('startServer', () => {
    let mockReq, mockRes, serverHandler, mockUdpSocket;

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

      mockUdpSocket = new EventEmitter();
      mockUdpSocket.bind = jest.fn();
      mockUdpSocket.send = jest.fn();
      mockUdpSocket.close = jest.fn();
      dgram.createSocket.mockReturnValue(mockUdpSocket);
    });

    it('starts HTTP and UDP discovery beacon', () => {
      A2A.startServer('/test/base');

      expect(http.createServer).toHaveBeenCalled();
      expect(dgram.createSocket).toHaveBeenCalled();
      expect(mockUdpSocket.bind).toHaveBeenCalledWith(18789);

      // Test UDP responder
      const discoverMsg = Buffer.from('ANIMA_DISCOVER');
      const rinfo = { address: '192.168.1.10', port: 12345 };
      mockUdpSocket.emit('message', discoverMsg, rinfo);

      expect(mockUdpSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"anima_agent"'),
        12345,
        '192.168.1.10',
      );
    });

    it('handles Identity queries via HTTP', async () => {
      A2A.startServer('/test/base');

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

    it('handles Task Delegation queries via HTTP', async () => {
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

    it('handles 404 for unknown routes', () => {
      A2A.startServer('/test/base');
      mockReq.method = 'GET';
      mockReq.url = '/unknown';

      serverHandler(mockReq, mockRes);
      expect(mockRes.writeHead).toHaveBeenCalledWith(404);
    });
  });

  describe('delegate_task', () => {
    it('successfully delegates task via fetch', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Remote result' } }],
        }),
      });

      const result = await A2A.implementations.delegate_task(
        {
          endpoint: 'http://remote/v1',
          task: 'test task',
          agentId: 'agent-1',
        },
        {},
      );

      expect(result).toContain('Result from agent agent-1');
      expect(result).toContain('Remote result');
    });

    it('handles delegation errors', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Fetch failed'));

      const result = await A2A.implementations.delegate_task(
        {
          endpoint: 'http://remote/v1',
          task: 'test task',
        },
        {},
      );

      expect(result).toContain('Error delegating task: Fetch failed');
    });
  });
});
