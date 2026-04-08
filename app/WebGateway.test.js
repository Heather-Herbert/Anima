const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const http = require('node:http');

jest.mock('./ConversationService', () => {
  return jest.fn().mockImplementation(() => ({
    processInput: jest.fn().mockResolvedValue({ reply: 'Hello from agent' }),
  }));
});

jest.mock('./AuditService', () =>
  jest.fn().mockImplementation(() => ({ log: jest.fn(), secrets: [] })),
);

jest.mock('./Config', () => ({
  webGateway: { port: 0, sessionTtlMs: 900000 },
}));

jest.mock('node:fs', () => ({
  readFile: jest.fn((filePath, cb) => cb(null, Buffer.from('<html>test</html>'))),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(() => false),
  chmodSync: jest.fn(),
}));

const WebGateway = require('./WebGateway');

function request(server, method, path, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const port = addr.port;
    const opts = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (cookie) opts.headers['Cookie'] = cookie;

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch (_) {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function makeGateway(env = {}) {
  const oldEnv = { ...process.env };
  Object.assign(process.env, { GATEWAY_PASSWORD: 'test-secret', ...env });
  const gw = new WebGateway({
    agentName: 'Anima',
    tools: [],
    manifest: { permissions: { filesystem: { read: ['*'] } } },
    auditService: { log: jest.fn(), secrets: [] },
    parturition: {},
  });
  const server = gw.start(0, 900_000);
  return {
    gw,
    server,
    restore: () => {
      process.env = oldEnv;
    },
  };
}

async function login(server, password = 'test-secret') {
  const res = await request(server, 'POST', '/login', { body: { password } });
  const setCookie = res.headers['set-cookie'];
  const cookie = setCookie ? setCookie[0].split(';')[0] : null;
  return { res, cookie };
}

describe('WebGateway', () => {
  let gw, server, restore;

  beforeEach(() => {
    ({ gw, server, restore } = makeGateway());
  });

  afterEach(() => {
    gw.stop();
    restore();
  });

  // ── Auth ────────────────────────────────────────────────
  describe('authentication', () => {
    it('serves index.html at GET /', async () => {
      const res = await request(server, 'GET', '/');
      expect(res.status).toBe(200);
    });

    it('rejects login with wrong password', async () => {
      const { res } = await login(server, 'wrong');
      expect(res.status).toBe(401);
    });

    it('accepts login with correct password and sets session cookie', async () => {
      const { res, cookie } = await login(server);
      expect(res.status).toBe(200);
      expect(cookie).toMatch(/^anima_sid=/);
    });

    it('cookie is HttpOnly and SameSite=Strict', async () => {
      const { res } = await login(server);
      const setCookie = res.headers['set-cookie'][0];
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Strict');
    });

    it('returns 503 when GATEWAY_PASSWORD is not set', async () => {
      delete process.env.GATEWAY_PASSWORD;
      const res = await request(server, 'POST', '/login', { body: { password: 'x' } });
      expect(res.status).toBe(503);
    });
  });

  // ── Protected routes require auth ───────────────────────
  describe('protected routes reject unauthenticated requests', () => {
    it('GET /events returns 401', async () => {
      const res = await request(server, 'GET', '/events');
      expect(res.status).toBe(401);
    });

    it('POST /message returns 401', async () => {
      const res = await request(server, 'POST', '/message', { body: { message: 'hi' } });
      expect(res.status).toBe(401);
    });

    it('POST /confirm returns 401', async () => {
      const res = await request(server, 'POST', '/confirm', { body: { approved: true } });
      expect(res.status).toBe(401);
    });

    it('POST /ping returns 401', async () => {
      const res = await request(server, 'POST', '/ping');
      expect(res.status).toBe(401);
    });

    it('POST /logout returns 401', async () => {
      const res = await request(server, 'POST', '/logout');
      expect(res.status).toBe(401);
    });
  });

  // ── Messaging ───────────────────────────────────────────
  describe('messaging', () => {
    it('POST /message returns 202 and sends response event to SSE clients', async () => {
      const { cookie } = await login(server);
      const cookies = parseCookieHeader(cookie);
      const sid = cookies['anima_sid'];
      const session = gw.sessions.get(sid);

      // Inject a fake SSE client
      const events = [];
      const fakeClient = {
        write: (data) => {
          events.push(data);
        },
      };
      session.sseClients.add(fakeClient);

      const res = await request(server, 'POST', '/message', {
        body: { message: 'hello' },
        cookie,
      });
      expect(res.status).toBe(202);

      // Wait for the async processInput to complete
      await new Promise((r) => setTimeout(r, 50));

      const responseEvent = events
        .map((e) => {
          try {
            return JSON.parse(e.replace(/^data:\s*/, ''));
          } catch (_) {
            return null;
          }
        })
        .find((e) => e && e.type === 'response');

      expect(responseEvent).toBeDefined();
      expect(responseEvent.content).toBe('Hello from agent');
    });

    it('POST /message returns 400 when message field missing', async () => {
      const { cookie } = await login(server);
      const res = await request(server, 'POST', '/message', { body: {}, cookie });
      expect(res.status).toBe(400);
    });

    it('POST /message returns 409 when already processing', async () => {
      const { cookie } = await login(server);
      const cookies = parseCookieHeader(cookie);
      const sid = cookies['anima_sid'];
      const session = gw.sessions.get(sid);
      session.isProcessing = true;

      const res = await request(server, 'POST', '/message', { body: { message: 'hi' }, cookie });
      expect(res.status).toBe(409);
    });
  });

  // ── Confirmation flow ───────────────────────────────────
  describe('confirmation flow', () => {
    it('resolves pendingConfirm with approved=true and sends confirm_result via SSE', async () => {
      const { cookie } = await login(server);
      const cookies = parseCookieHeader(cookie);
      const sid = cookies['anima_sid'];
      const session = gw.sessions.get(sid);

      // Manually plant a pending confirm
      let resolved;
      const p = new Promise((resolve) => {
        resolved = resolve;
      });
      session.pendingConfirm = { resolve: resolved, details: { functionName: 'write_file' } };

      // Mock SSE client to capture events
      const events = [];
      const fakeClient = {
        write: (data) => {
          events.push(data);
        },
        destroyed: false,
      };
      session.sseClients.add(fakeClient);

      const res = await request(server, 'POST', '/confirm', { body: { approved: true }, cookie });
      expect(res.status).toBe(200);
      expect(res.body.approved).toBe(true);

      const value = await p;
      expect(value).toBe(true);
      expect(events.some((e) => e.includes('confirm_result'))).toBe(true);
    });

    it('resolves pendingConfirm with approved=false on denial', async () => {
      const { cookie } = await login(server);
      const cookies = parseCookieHeader(cookie);
      const sid = cookies['anima_sid'];
      const session = gw.sessions.get(sid);

      let resolved;
      const p = new Promise((resolve) => {
        resolved = resolve;
      });
      session.pendingConfirm = { resolve: resolved, details: {} };

      await request(server, 'POST', '/confirm', { body: { approved: false }, cookie });
      const value = await p;
      expect(value).toBe(false);
    });

    it('returns 409 when no pending confirmation', async () => {
      const { cookie } = await login(server);
      const res = await request(server, 'POST', '/confirm', { body: { approved: true }, cookie });
      expect(res.status).toBe(409);
    });
  });

  // ── Ping & session lifecycle ────────────────────────────
  describe('ping and session lifecycle', () => {
    it('POST /ping returns 200 and updates lastActivity', async () => {
      const { cookie } = await login(server);
      const cookies = parseCookieHeader(cookie);
      const sid = cookies['anima_sid'];
      const session = gw.sessions.get(sid);

      const before = session.lastActivity;
      await new Promise((r) => setTimeout(r, 5));
      const res = await request(server, 'POST', '/ping', { cookie });
      expect(res.status).toBe(200);
      expect(session.lastActivity).toBeGreaterThanOrEqual(before);
    });

    it('POST /logout destroys the session', async () => {
      const { cookie } = await login(server);
      const cookies = parseCookieHeader(cookie);
      const sid = cookies['anima_sid'];

      expect(gw.sessions.has(sid)).toBe(true);
      await request(server, 'POST', '/logout', { cookie });
      expect(gw.sessions.has(sid)).toBe(false);
    });

    it('expired sessions are culled', async () => {
      const { gw: shortGw, server: shortServer, restore: shortRestore } = makeGateway();
      try {
        const { cookie } = await login(shortServer);
        const cookies = parseCookieHeader(cookie);
        const sid = cookies['anima_sid'];
        const session = shortGw.sessions.get(sid);

        // Backdate lastActivity beyond TTL * grace multiplier
        session.lastActivity = Date.now() - 2_000_000;

        // Manually trigger the culler
        shortGw._startCuller(1);
        await new Promise((r) => setTimeout(r, 20));

        expect(shortGw.sessions.has(sid)).toBe(false);
      } finally {
        shortGw.stop();
        shortRestore();
      }
    });
  });

  // ── Webhook callback ────────────────────────────────────
  describe('webhook callback', () => {
    it('registers a callback handler with A2A when a message is sent', async () => {
      const { cookie } = await login(server);
      const cookies = parseCookieHeader(cookie);
      const sid = cookies['anima_sid'];
      const session = gw.sessions.get(sid);

      // Inject fake SSE client
      const events = [];
      session.sseClients.add({ write: (d) => events.push(d) });

      await request(server, 'POST', '/message', { body: { message: 'hello' }, cookie });
      await new Promise((r) => setTimeout(r, 50));

      // Simulate A2A callback arriving — the registered handler should push a response via SSE
      // We call _registerWebhookCallback directly to test the registration mechanism
      const mockA2a = {
        registerCallbackHandler: jest.fn(),
      };
      jest.doMock('../Skills/A2A', () => mockA2a);

      gw._registerWebhookCallback(session);
      expect(mockA2a.registerCallbackHandler).toHaveBeenCalled();

      jest.dontMock('../Skills/A2A');
    });
  });

  // ── Session isolation ───────────────────────────────────
  describe('session isolation', () => {
    it('two logins produce independent sessions with separate histories', async () => {
      const { cookie: cookie1 } = await login(server);
      const { cookie: cookie2 } = await login(server);

      const sid1 = parseCookieHeader(cookie1)['anima_sid'];
      const sid2 = parseCookieHeader(cookie2)['anima_sid'];

      expect(sid1).not.toBe(sid2);
      expect(gw.sessions.get(sid1).history).not.toBe(gw.sessions.get(sid2).history);
    });
  });

  // ── 404 ────────────────────────────────────────────────
  it('returns 404 for unknown routes', async () => {
    const { cookie } = await login(server);
    const res = await request(server, 'GET', '/unknown', { cookie });
    expect(res.status).toBe(404);
  });
});

function parseCookieHeader(cookieStr) {
  const result = {};
  if (!cookieStr) return result;
  cookieStr.split(';').forEach((part) => {
    const [k, ...v] = part.trim().split('=');
    result[k.trim()] = v.join('=').trim();
  });
  return result;
}
