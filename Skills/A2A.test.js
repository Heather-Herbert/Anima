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

    it('handles auto-pairing flow in learn_from_agent', async () => {
      global.fetch.mockResolvedValueOnce({ status: 401, ok: false }); // Auth fail
      global.fetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ status: 'trusted', token: 'new-tok' }),
      }); // Pair success
      global.fetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Identity info' } }] }),
      }); // Identity success

      const result = await A2A.implementations.learn_from_agent(
        { endpoint: 'http://remote/v1/chat/completions' },
        {},
      );

      expect(result).toContain('Successfully learned');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer new-tok' }),
        }),
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
      // Ensure global fetch is always a mock within these tests
      global.fetch = jest.fn();
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

    it('handles fetch rejection in checkIp catch block', async () => {
      // Use a fresh mock that ALWAYS rejects
      const originalFetch = global.fetch;
      global.fetch = jest
        .fn()
        .mockImplementation(() => Promise.reject(new Error('Fetch Fatal Error')));

      const os = require('node:os');
      const networkSpy = jest.spyOn(os, 'networkInterfaces').mockReturnValue({});

      // We pass a port range that doesn't include common defaults
      const result = await A2A.implementations.discover_agents({
        useUdp: false,
        startPort: 18799,
        endPort: 18799,
        scanSubnetOnly: true,
      });

      // Because checkIp treats any 'error' or 'catch' as potential hit (legacy logic),
      // we expect it to find the IP we scanned.
      expect(result).toContain('http://127.0.0.1:18799/v1/chat/completions');

      global.fetch = originalFetch;
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

    it('handles Identity queries via HTTP with authentication', async () => {
      A2A.startServer('/test/base');

      mockReq.method = 'POST';
      mockReq.url = '/v1/chat/completions';
      mockReq.headers = { authorization: 'Bearer test-token' };

      // Mock peers to allow this token
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockImplementation((p) => {
        if (p.endsWith('peers.json')) {
          return JSON.stringify({
            trusted: { 'peer-1': { token: 'test-token', name: 'Peer 1' } },
            pending: {},
          });
        }
        return 'Mock Identity Content';
      });

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

    it('rejects unauthenticated Identity queries', async () => {
      A2A.startServer('/test/base');

      mockReq.method = 'POST';
      mockReq.url = '/v1/chat/completions';
      mockReq.headers = {}; // No auth

      fs.readFileSync.mockReturnValue(JSON.stringify({ trusted: {}, pending: {} }));

      const promise = serverHandler(mockReq, mockRes);
      mockReq.emit('end');
      await promise;

      expect(mockRes.writeHead).toHaveBeenCalledWith(401, expect.anything());
    });

    it('allows access with ANIMA_A2A_ROOT_KEY', async () => {
      A2A.startServer('/test/base');
      process.env.ANIMA_A2A_ROOT_KEY = 'root-secret';

      mockReq.method = 'POST';
      mockReq.url = '/v1/chat/completions';
      mockReq.headers = { authorization: 'Bearer root-secret' };

      fs.readFileSync.mockReturnValue(JSON.stringify({ trusted: {}, pending: {} }));

      const promise = serverHandler(mockReq, mockRes);
      mockReq.emit(
        'data',
        Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: 'soul' }] })),
      );
      mockReq.emit('end');
      await promise;

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.anything());
      delete process.env.ANIMA_A2A_ROOT_KEY;
    });

    it('handles Pairing requests', async () => {
      A2A.startServer('/test/base');

      mockReq.method = 'POST';
      mockReq.url = '/v1/pair';

      fs.readFileSync.mockReturnValue(JSON.stringify({ trusted: {}, pending: {} }));

      const promise = serverHandler(mockReq, mockRes);

      mockReq.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            name: 'New Agent',
            id: 'agent-99',
            endpoint: 'http://remote:18701',
          }),
        ),
      );
      mockReq.emit('end');

      await promise;

      expect(mockRes.writeHead).toHaveBeenCalledWith(202, expect.anything());
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('peers.json'),
        expect.stringContaining('agent-99'),
      );
    });

    it('handles Task Delegation queries via HTTP', async () => {
      A2A.startServer('/test/base');

      mockReq.method = 'POST';
      mockReq.url = '/v1/chat/completions';
      mockReq.headers = { authorization: 'Bearer test-token' };

      fs.readFileSync.mockImplementation((p) => {
        if (p.endsWith('peers.json')) {
          return JSON.stringify({
            trusted: { 'peer-1': { token: 'test-token', name: 'Peer 1' } },
            pending: {},
          });
        }
        return '{}';
      });

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

    it('serves Public identity for peers with public disclosure', async () => {
      A2A.startServer('/test/base');
      mockReq.method = 'POST';
      mockReq.url = '/v1/chat/completions';
      mockReq.headers = { authorization: 'Bearer pub-token' };

      fs.existsSync.mockImplementation((p) => {
        if (p.endsWith('peers.json')) return true;
        if (p.endsWith('PublicIdentity.md')) return true;
        return false;
      });

      fs.readFileSync.mockImplementation((p) => {
        if (p.endsWith('peers.json')) {
          return JSON.stringify({
            trusted: { p1: { token: 'pub-token', disclosure: 'public' } },
            pending: {},
          });
        }
        if (p.endsWith('PublicIdentity.md')) return 'Public Identity Content';
        return '';
      });

      const promise = serverHandler(mockReq, mockRes);
      mockReq.emit(
        'data',
        Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: 'who are you?' }] })),
      );
      mockReq.emit('end');
      await promise;

      expect(mockRes.end).toHaveBeenCalledWith(expect.stringContaining('Public Identity Content'));
      expect(mockRes.end).not.toHaveBeenCalledWith(expect.stringContaining('Full Soul'));
    });

    it('serves Full identity for peers with full disclosure', async () => {
      A2A.startServer('/test/base');
      mockReq.method = 'POST';
      mockReq.url = '/v1/chat/completions';
      mockReq.headers = { authorization: 'Bearer full-token' };

      fs.existsSync.mockImplementation(() => true);
      fs.readFileSync.mockImplementation((p) => {
        if (p.endsWith('peers.json')) {
          return JSON.stringify({
            trusted: { p1: { token: 'full-token', disclosure: 'full' } },
            pending: {},
          });
        }
        if (p.endsWith('Identity.md')) return 'Full Identity';
        if (p.endsWith('Soul.md')) return 'Full Soul';
        return '';
      });

      const promise = serverHandler(mockReq, mockRes);
      mockReq.emit(
        'data',
        Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: 'who are you?' }] })),
      );
      mockReq.emit('end');
      await promise;

      expect(mockRes.end).toHaveBeenCalledWith(expect.stringContaining('Full Identity'));
      expect(mockRes.end).toHaveBeenCalledWith(expect.stringContaining('Full Soul'));
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

    it('handles auto-pairing flow when unauthorized', async () => {
      // 1. Initial call returns 401
      global.fetch.mockResolvedValueOnce({
        status: 401,
        ok: false,
      });
      // 2. Pairing request returns 202 (pending)
      global.fetch.mockResolvedValueOnce({
        status: 202,
        ok: true,
        json: async () => ({ status: 'pending' }),
      });

      const result = await A2A.implementations.delegate_task(
        {
          endpoint: 'http://remote/v1/chat/completions',
          task: 'test',
        },
        {},
      );

      expect(result).toContain('Pairing request sent');
    });

    it('retries request after successful auto-pairing', async () => {
      // 1. Initial call returns 401
      global.fetch.mockResolvedValueOnce({
        status: 401,
        ok: false,
      });
      // 2. Pairing request returns 200 (trusted) with token
      global.fetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ status: 'trusted', token: 'new-token' }),
      });
      // 3. Retry call returns 200
      global.fetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Success after pairing' } }] }),
      });

      const result = await A2A.implementations.delegate_task(
        {
          endpoint: 'http://remote/v1/chat/completions',
          task: 'test',
        },
        {},
      );

      expect(result).toContain('Success after pairing');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer new-token' }),
        }),
      );
    });
  });

  describe('manage_peers', () => {
    it('lists peers', async () => {
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          trusted: { t1: { name: 'Trusted 1', id: 't1', endpoint: 'http://t1' } },
          pending: { p1: { name: 'Pending 1', id: 'p1', endpoint: 'http://p1', date: 'now' } },
        }),
      );

      const result = await A2A.implementations.manage_peers({ action: 'list' }, {});
      expect(result).toContain('Trusted 1');
      expect(result).toContain('Pending 1');
    });

    it('approves a peer', async () => {
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          trusted: {},
          pending: { p1: { name: 'Pending 1', id: 'p1', endpoint: 'http://p1' } },
        }),
      );

      const result = await A2A.implementations.manage_peers({ action: 'approve', id: 'p1' }, {});
      expect(result).toContain('Peer "Pending 1" approved');
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('peers.json'),
        expect.stringContaining('"token":'),
      );
    });

    it('denies a peer', async () => {
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          trusted: {},
          pending: { p1: { name: 'Pending 1', id: 'p1', endpoint: 'http://p1' } },
        }),
      );

      const result = await A2A.implementations.manage_peers({ action: 'deny', id: 'p1' }, {});
      expect(result).toContain('Pending request from "p1" denied');
    });

    it('sets disclosure level for a trusted peer', async () => {
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          trusted: { t1: { name: 'Trusted 1', id: 't1', token: 'tok' } },
          pending: {},
        }),
      );

      const result = await A2A.implementations.manage_peers(
        { action: 'set_disclosure', id: 't1', disclosure: 'full' },
        {},
      );
      expect(result).toContain('Disclosure level for "Trusted 1" set to "full"');
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('peers.json'),
        expect.stringContaining('"disclosure": "full"'),
      );
    });

    it('removes a trusted peer', async () => {
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          trusted: { t1: { name: 'Trusted 1', id: 't1', token: 'tok' } },
          pending: {},
        }),
      );

      const result = await A2A.implementations.manage_peers({ action: 'remove', id: 't1' }, {});
      expect(result).toContain('Trusted peer "t1" removed');
    });

    it('handles non-existent peer for deny/remove', async () => {
      fs.readFileSync.mockReturnValue(JSON.stringify({ trusted: {}, pending: {} }));
      const result = await A2A.implementations.manage_peers({ action: 'deny', id: 'none' }, {});
      expect(result).toContain('Error: Peer ID "none" not found');
    });

    it('handles invalid JSON in peers.json', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('invalid json');
      const result = await A2A.implementations.manage_peers({ action: 'list' }, {});
      expect(result).toContain('--- TRUSTED PEERS ---'); // Should return default empty peers
    });
  });

  describe('get_local_endpoint', () => {
    it('returns own endpoint info', async () => {
      const result = await A2A.implementations.get_local_endpoint({}, {});
      expect(result).toContain('Your A2A Endpoint:');
      expect(result).toContain('Agent ID:');
    });
  });
});
