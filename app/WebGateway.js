const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ConversationService = require('./ConversationService');

const PING_GRACE_MULTIPLIER = 1.5;

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((part) => {
    const [key, ...rest] = part.trim().split('=');
    if (key) cookies[key.trim()] = rest.join('=').trim();
  });
  return cookies;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendSse(client, eventObj) {
  try {
    client.write(`data: ${JSON.stringify(eventObj)}\n\n`);
  } catch (_) {
    /* client disconnected */
  }
}

class WebGateway {
  constructor({ agentName, tools, manifest, auditService, parturition }) {
    this.agentName = agentName;
    this.tools = tools;
    this.manifest = manifest;
    this.auditService = auditService;
    this.parturition = parturition;

    this.sessions = new Map();
    this.server = null;
    this._cullerInterval = null;
  }

  _createSession() {
    const id = crypto.randomUUID();
    const historyPath = path.join(
      __dirname,
      '../Memory',
      `web-session-${Date.now()}-${id.slice(0, 8)}.json`,
    );
    const history = [];
    const conversationService = new ConversationService(
      this.agentName,
      this.tools,
      this.manifest,
      historyPath,
      this.auditService,
    );
    this.sessions.set(id, {
      conversationService,
      history,
      sseClients: new Set(),
      pendingConfirm: null,
      isProcessing: false,
      lastActivity: Date.now(),
    });
    return id;
  }

  _getSession(req) {
    const cookies = parseCookies(req.headers['cookie']);
    const sid = cookies['anima_sid'];
    return sid ? this.sessions.get(sid) : null;
  }

  _touchSession(session) {
    session.lastActivity = Date.now();
  }

  _destroySession(sid) {
    const session = this.sessions.get(sid);
    if (!session) return;
    session.sseClients.forEach((client) => {
      try {
        client.end();
      } catch (_) {
        /* ignore */
      }
    });
    this.sessions.delete(sid);
  }

  _startCuller(ttlMs) {
    const interval = Math.min(ttlMs / 6, 60_000);
    this._cullerInterval = setInterval(() => {
      const now = Date.now();
      for (const [sid, session] of this.sessions) {
        if (now - session.lastActivity > ttlMs * PING_GRACE_MULTIPLIER) {
          this._destroySession(sid);
        }
      }
    }, interval);
    this._cullerInterval.unref();
  }

  _registerWebhookCallback(session) {
    try {
      const a2aSkill = require('../Skills/A2A');
      if (!a2aSkill?.registerCallbackHandler) return;
      a2aSkill.registerCallbackHandler(async (taskId, result) => {
        const message = `[A2A Webhook] External task "${taskId}" completed:\n${result}`;
        session.sseClients.forEach((client) =>
          sendSse(client, {
            type: 'status',
            content: `External task "${taskId}" completed. Resuming…`,
          }),
        );
        try {
          const confirmCallback = this._buildConfirmCallback(session);
          const callbackResult = await session.conversationService.processInput(
            message,
            session.history,
            confirmCallback,
          );
          session.sseClients.forEach((client) =>
            sendSse(client, { type: 'response', content: callbackResult.reply }),
          );
        } catch (err) {
          session.sseClients.forEach((client) =>
            sendSse(client, { type: 'error', content: err.message }),
          );
        }
      });
    } catch (_) {
      /* A2A skill not available */
    }
  }

  _buildConfirmCallback(session) {
    return (functionName, functionArgs, justification, isTainted) => {
      return new Promise((resolve) => {
        const details = { functionName, functionArgs, justification, isTainted };
        session.pendingConfirm = {
          resolve,
          details,
        };
        session.sseClients.forEach((client) => sendSse(client, { type: 'confirm', details }));
      });
    };
  }

  async _handleLogin(req, res) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (_) {
        return sendJson(res, 400, { error: 'Invalid JSON' });
      }

      const expected = process.env.GATEWAY_PASSWORD;
      if (!expected) return sendJson(res, 503, { error: 'Gateway password not configured' });
      if (!parsed.password || parsed.password !== expected) {
        return sendJson(res, 401, { error: 'Invalid password' });
      }

      const sid = this._createSession();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `anima_sid=${sid}; HttpOnly; SameSite=Strict; Path=/`,
      });
      res.end(JSON.stringify({ ok: true }));
    });
  }

  _handleLogout(req, res, sid) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    this._destroySession(sid);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'anima_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
    });
    res.end(JSON.stringify({ ok: true }));
  }

  _handleEvents(req, res, session) {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('\n');

    session.sseClients.add(res);
    this._touchSession(session);

    req.on('close', () => {
      session.sseClients.delete(res);
    });
  }

  _handleMessage(req, res, session) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    if (session.isProcessing) return sendJson(res, 409, { error: 'Already processing a message' });

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (_) {
        return sendJson(res, 400, { error: 'Invalid JSON' });
      }

      const content = parsed.message;
      if (!content || typeof content !== 'string') {
        return sendJson(res, 400, { error: 'message field required' });
      }

      this._touchSession(session);
      session.isProcessing = true;
      sendJson(res, 202, { ok: true });

      // Register this session as the active A2A webhook receiver (last active wins)
      this._registerWebhookCallback(session);

      try {
        const confirmCallback = this._buildConfirmCallback(session);
        const result = await session.conversationService.processInput(
          content,
          session.history,
          confirmCallback,
        );
        session.sseClients.forEach((client) =>
          sendSse(client, { type: 'response', content: result.reply }),
        );
      } catch (err) {
        session.sseClients.forEach((client) =>
          sendSse(client, { type: 'error', content: err.message }),
        );
      } finally {
        session.isProcessing = false;
      }
    });
  }

  _handleConfirm(req, res, session) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (_) {
        return sendJson(res, 400, { error: 'Invalid JSON' });
      }

      if (!session.pendingConfirm) return sendJson(res, 409, { error: 'No pending confirmation' });

      const { resolve } = session.pendingConfirm;
      const approved = parsed.approved === true;
      session.pendingConfirm = null;
      this._touchSession(session);

      session.sseClients.forEach((client) => sendSse(client, { type: 'confirm_result', approved }));

      resolve(approved);
      sendJson(res, 200, { ok: true, approved });
    });
  }

  _handlePing(req, res, session) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    this._touchSession(session);
    sendJson(res, 200, { ok: true });
  }

  _handleIndex(req, res) {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    const indexPath = path.join(__dirname, '../web/index.html');
    fs.readFile(indexPath, (err, data) => {
      if (err) return sendJson(res, 500, { error: 'UI not found' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  }

  _requireAuth(req, res) {
    const session = this._getSession(req);
    if (!session) {
      sendJson(res, 401, { error: 'Unauthorised' });
      return null;
    }
    const cookies = parseCookies(req.headers['cookie']);
    return { session, sid: cookies['anima_sid'] };
  }

  _handleRequest(req, res) {
    const url = new URL(req.url, `http://localhost`);
    const pathname = url.pathname;

    if (pathname === '/login') return this._handleLogin(req, res);

    if (pathname === '/') return this._handleIndex(req, res);

    const auth = this._requireAuth(req, res);
    if (!auth) return;
    const { session, sid } = auth;

    if (pathname === '/logout') return this._handleLogout(req, res, sid);
    if (pathname === '/events') return this._handleEvents(req, res, session);
    if (pathname === '/message') return this._handleMessage(req, res, session);
    if (pathname === '/confirm') return this._handleConfirm(req, res, session);
    if (pathname === '/ping') return this._handlePing(req, res, session);

    sendJson(res, 404, { error: 'Not found' });
  }

  start(port, ttlMs) {
    const effectiveTtl = ttlMs || 900_000;
    this.server = http.createServer((req, res) => {
      try {
        this._handleRequest(req, res);
      } catch (err) {
        sendJson(res, 500, { error: 'Internal server error' });
      }
    });
    this.server.listen(port, () => {
      process.stdout.write(`\x1b[36m[WebGateway] Listening on http://localhost:${port}\x1b[0m\n`);
    });
    this._startCuller(effectiveTtl);
    return this.server;
  }

  stop() {
    if (this._cullerInterval) {
      clearInterval(this._cullerInterval);
      this._cullerInterval = null;
    }
    for (const sid of this.sessions.keys()) {
      this._destroySession(sid);
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

module.exports = WebGateway;
