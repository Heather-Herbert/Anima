const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const config = require('../app/Config');

const getOpenClawConfig = () => {
  const root = path.resolve(config.workspaceDir || '.');
  const configPath = path.join(root, 'Settings', 'openclaw.json');
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      /* ignore */
    }
  }
  return {
    endpoint: process.env.OPENCLAW_ENDPOINT || 'http://localhost:18789/v1/chat/completions',
    apiKey: process.env.OPENCLAW_API_KEY || '',
  };
};

const getLocalWebhookUrl = () => {
  const agentName = config.agentName || 'Anima';
  let hash = 0;
  for (let i = 0; i < agentName.length; i++) {
    hash = (hash << 5) - hash + agentName.charCodeAt(i);
    hash |= 0;
  }
  const port = 18700 + (Math.abs(hash) % 89);

  const interfaces = os.networkInterfaces();
  let localIp = '127.0.0.1';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIp = iface.address;
        break;
      }
    }
  }
  return `http://${localIp}:${port}/v1/webhook`;
};

const implementations = {
  openclaw_delegate: async (
    { task, mode = 'sync', context_snippets = [], agentId = 'jennifer' },
    permissions,
  ) => {
    const ocConfig = getOpenClawConfig();
    const endpoint = ocConfig.endpoint;
    const apiKey = ocConfig.apiKey;

    const body = {
      model: agentId,
      messages: [],
    };

    let contextText = '';
    if (context_snippets.length > 0) {
      contextText = '--- LOCAL CONTEXT SNIPPETS ---\n' + context_snippets.join('\n---\n') + '\n\n';
    }

    body.messages.push({
      role: 'user',
      content: `${contextText}TASK DELEGATION (${mode}): ${task}`,
    });

    if (mode === 'async') {
      body.webhook_url = getLocalWebhookUrl();
      body.async = true;
    }

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(mode === 'sync' ? 120000 : 10000),
      });

      if (!response.ok) throw new Error(`OpenClaw Error: HTTP ${response.status}`);
      const data = await response.json();

      if (mode === 'async') {
        return `Task successfully delegated to OpenClaw (${agentId}) in ASYNC mode. You will be notified at ${body.webhook_url} when it completes. Task ID: ${data.taskId || 'pending'}`;
      }

      const content = data.choices?.[0]?.message?.content || 'No response from remote agent.';

      // Taint Awareness: If remote agent used untrusted sources, we must taint our session.
      if (data.tainted || data.choices?.[0]?.message?.tainted) {
        if (permissions) {
          permissions._isTainted = true;
        }
        return `\x1b[33m[WARNING: Remote response is TAINTED]\x1b[0m\nResult from OpenClaw (${agentId}):\n${content}`;
      }

      return `Result from OpenClaw (${agentId}):\n${content}`;
    } catch (e) {
      return `Error delegating to OpenClaw: ${e.message}`;
    }
  },
};

module.exports = { implementations };
