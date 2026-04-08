const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const dgram = require('node:dgram');
const crypto = require('node:crypto');
const config = require('../app/Config');

// --- PEER MANAGEMENT ---
const getPeersPath = () => {
  const root = path.resolve(config.workspaceDir || '.');
  const settingsDir = path.join(root, 'Settings');
  if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });
  return path.join(settingsDir, 'peers.json');
};

const getPeers = () => {
  const p = getPeersPath();
  if (!fs.existsSync(p)) return { trusted: {}, pending: {} };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return { trusted: {}, pending: {} };
  }
};

const savePeers = (peers) => {
  fs.writeFileSync(getPeersPath(), JSON.stringify(peers, null, 2));
};

// This skill provides an OpenAI-compatible endpoint for other Anima/OpenClaw agents.
// It supports identity queries for learning and task delegation for collaboration.

let server = null;
let udpSocket = null;
const DISCOVERY_PORT = 18789;

const startServer = (baseDir) => {
  if (server) return;

  const agentName = config.agentName || 'Anima';
  let hash = 0;
  for (let i = 0; i < agentName.length; i++) {
    hash = (hash << 5) - hash + agentName.charCodeAt(i);
    hash |= 0;
  }
  const port = 18700 + (Math.abs(hash) % 89);

  // --- HTTP Server ---
  server = http.createServer((req, res) => {
    // 1. Pairing Endpoint
    if (req.method === 'POST' && req.url === '/v1/pair') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const { name, id, endpoint } = JSON.parse(body);
          const peers = getPeers();
          if (peers.trusted[id]) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ status: 'trusted', token: peers.trusted[id].token }));
          }

          peers.pending[id] = { name, id, endpoint, date: new Date().toISOString() };
          savePeers(peers);

          process.stdout.write(
            `\n\x1b[33m[A2A PAIRING REQUEST]\x1b[0m Agent "${name}" (${id}) at ${endpoint} wants to connect.\n` +
              `Use \x1b[36mmanage_peers\x1b[0m to approve or deny.\n`,
          );

          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'pending' }));
        } catch (e) {
          res.writeHead(400);
          res.end();
        }
      });
      return;
    }

    // 2. Webhook Endpoint (for async tasks)
    if (req.method === 'POST' && req.url === '/v1/webhook') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          process.stdout.write(
            `\n\x1b[35m[OPENCLAW NOTIFICATION]\x1b[0m Task "${data.taskId || 'unknown'}" completed.\n` +
              `Result: ${data.result || 'No result provided.'}\n`,
          );
          res.writeHead(200);
          res.end('OK');
        } catch (e) {
          res.writeHead(400);
          res.end();
        }
      });
      return;
    }

    // 3. Authenticated AI Endpoint
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      // AUTH CHECK
      const auth = req.headers['authorization'];
      const token = auth?.startsWith('Bearer ') ? auth.substring(7) : null;
      const peers = getPeers();
      const trustedPeer = Object.values(peers.trusted).find((p) => p.token === token);

      if (!trustedPeer && token !== process.env.ANIMA_A2A_ROOT_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Unauthorized. Pairing required.' }));
      }

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', async () => {
        try {
          const { messages, tools: requestedTools } = JSON.parse(body);
          const lastMsg = messages[messages.length - 1].content;
          const lastMsgLower = lastMsg.toLowerCase();

          // CASE 1: Identity/Soul Query (Learning)
          if (
            lastMsgLower.includes('identity') ||
            lastMsgLower.includes('soul') ||
            lastMsgLower.includes('who are you')
          ) {
            let identityPath, soulPath;
            const disclosure = trustedPeer?.disclosure || 'public';

            if (disclosure === 'full') {
              identityPath = path.join(baseDir, 'Personality', 'Identity.md');
              soulPath = path.join(baseDir, 'Personality', 'Soul.md');
            } else {
              identityPath = path.join(baseDir, 'Personality', 'PublicIdentity.md');
              soulPath = path.join(baseDir, 'Personality', 'PublicSoul.md');
            }

            let content = '';
            if (fs.existsSync(identityPath)) {
              content += '## Identity\n' + fs.readFileSync(identityPath, 'utf8') + '\n\n';
            }
            if (fs.existsSync(soulPath)) {
              content += '## Soul\n' + fs.readFileSync(soulPath, 'utf8') + '\n';
            }

            if (!content) {
              content = `I am ${config.agentName || 'Anima'}. I share a public identity after pairing, or a full identity with highly trusted peers.`;
            }

            const response = {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: content,
                  },
                },
              ],
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(response));
          }

          // CASE 2: Task Delegation (Collaboration)
          const { callAI } = require('../app/Utils');

          const subAgentPrompt = {
            role: 'system',
            content: `You are acting as a specialized sub-agent for another Anima instance (${trustedPeer?.name || 'Trusted Peer'}). 
Task: Solve the user's request using your local tools and knowledge.
Constraint: Be extremely concise. Do not use conversational filler. Provide only the result or the answer.
Your Identity: ${fs.existsSync(path.join(baseDir, 'Personality', 'Identity.md')) ? fs.readFileSync(path.join(baseDir, 'Personality', 'Identity.md'), 'utf8') : 'Anima Instance'}`,
          };

          const delegatedMessages = [subAgentPrompt, ...messages];

          try {
            const result = await callAI(delegatedMessages, requestedTools);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Sub-agent error: ${e.message}` }));
          }
        } catch (e) {
          res.writeHead(400);
          res.end();
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`\n\x1b[90m[A2A Service active on port ${port} (0.0.0.0)]\x1b[0m\n`);
  });

  // --- UDP Discovery Beacon ---
  try {
    udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    udpSocket.on('message', (msg, rinfo) => {
      if (msg.toString() === 'ANIMA_DISCOVER') {
        const response = JSON.stringify({
          type: 'anima_agent',
          name: agentName,
          port: port,
        });
        udpSocket.send(response, rinfo.port, rinfo.address);
      }
    });

    udpSocket.on('error', (err) => {
      process.stderr.write(`UDP Discovery Error: ${err.message}\n`);
    });

    udpSocket.bind(DISCOVERY_PORT);
  } catch (e) {
    process.stderr.write(`Failed to start UDP Discovery: ${e.message}\n`);
  }

  const cleanup = () => {
    if (server) server.close();
    if (udpSocket) {
      try {
        udpSocket.close();
      } catch (e) {
        /* ignore */
      }
    }
  };

  process.on('SIGINT', cleanup);
  process.on('exit', cleanup);
};

// Skill export
module.exports = {
  startServer,
  implementations: {
    delegate_task: async ({ endpoint, task, apiKey, agentId, agent_type }, _permissions) => {
      try {
        let token = apiKey;
        if (!token) {
          const peers = getPeers();
          const trusted = Object.values(peers.trusted).find((p) => p.endpoint === endpoint);
          if (trusted) token = trusted.token;
        }

        const body = {
          model: agentId || 'anima',
          messages: [
            {
              role: 'user',
              content: `TASK DELEGATION: ${task}\n\nPlease perform this task and return ONLY the result. Avoid all conversational filler.`,
            },
          ],
          ...(agent_type ? { agent_type } : {}),
        };

        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        let response = await fetch(endpoint, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60000),
        });

        // AUTO-PAIRING FLOW
        if (response.status === 401 && !apiKey) {
          const pairUrl = endpoint.replace('/v1/chat/completions', '/v1/pair');
          const pairRes = await fetch(pairUrl, {
            method: 'POST',
            body: JSON.stringify({
              name: config.agentName || 'Anima',
              id: config.agentId || 'anima-1',
              endpoint: 'http://local-discovery', // Placeholder
            }),
          });
          const pairData = await pairRes.json();
          if (pairData.status === 'pending') {
            return `Pairing request sent to ${endpoint}. Please approve it on the remote agent and try again.`;
          }
          if (pairData.status === 'trusted') {
            // Retry with new token
            headers['Authorization'] = `Bearer ${pairData.token}`;
            response = await fetch(endpoint, {
              method: 'POST',
              headers: headers,
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(60000),
            });
          }
        }

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const content = data.choices[0].message.content;

        return `Result from agent ${agentId || endpoint}:\n${content}`;
      } catch (e) {
        return `Error delegating task: ${e.message}`;
      }
    },
    learn_from_agent: async ({ endpoint, apiKey, agentId }, _permissions) => {
      try {
        let token = apiKey;
        if (!token) {
          const peers = getPeers();
          const trusted = Object.values(peers.trusted).find((p) => p.endpoint === endpoint);
          if (trusted) token = trusted.token;
        }

        const body = {
          model: agentId || 'anima',
          messages: [
            {
              role: 'user',
              content: 'IDENTITY_QUERY: Please share your Identity and Soul. Be concise.',
            },
          ],
        };

        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        let response = await fetch(endpoint, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        });

        // AUTO-PAIRING FLOW
        if (response.status === 401 && !apiKey) {
          const pairUrl = endpoint.replace('/v1/chat/completions', '/v1/pair');
          const pairRes = await fetch(pairUrl, {
            method: 'POST',
            body: JSON.stringify({
              name: config.agentName || 'Anima',
              id: config.agentId || 'anima-1',
              endpoint: 'http://local-discovery',
            }),
          });
          const pairData = await pairRes.json();
          if (pairData.status === 'pending') {
            return `Pairing request sent to ${endpoint}. Please approve it on the remote agent and try again.`;
          }
          if (pairData.status === 'trusted') {
            headers['Authorization'] = `Bearer ${pairData.token}`;
            response = await fetch(endpoint, {
              method: 'POST',
              headers: headers,
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(10000),
            });
          }
        }

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const content = data.choices[0].message.content;

        const root = path.resolve(config.workspaceDir || '.');
        const memosDir = path.join(root, 'Memory', 'memos');
        if (!fs.existsSync(memosDir)) fs.mkdirSync(memosDir, { recursive: true });

        const filename = `memo_${Date.now()}_${(agentId || 'unknown').replace(/:/g, '_')}.md`;
        fs.writeFileSync(path.join(memosDir, filename), content);

        return `Successfully learned from agent ${agentId || 'at ' + endpoint}. Memo saved.`;
      } catch (e) {
        return `Error learning from agent: ${e.message}`;
      }
    },
    discover_agents: async (
      { startPort = 18700, endPort = 18790, scanSubnetOnly = true, useUdp = true },
      _permissions,
    ) => {
      const active = new Set();

      // 1. UDP Broadcast Discovery (Fast)
      if (useUdp) {
        try {
          const discovered = await new Promise((resolve) => {
            const client = dgram.createSocket('udp4');
            const found = [];
            client.on('message', (msg, rinfo) => {
              try {
                const data = JSON.parse(msg.toString());
                if (data.type === 'anima_agent') {
                  found.push(`http://${rinfo.address}:${data.port}/v1/chat/completions`);
                }
              } catch (e) {
                /* ignore malformed */
              }
            });

            client.bind(0, () => {
              client.setBroadcast(true);
              const message = Buffer.from('ANIMA_DISCOVER');
              client.send(message, DISCOVERY_PORT, '255.255.255.255');

              // Also send to local broadcast addresses
              const interfaces = os.networkInterfaces();
              for (const name of Object.keys(interfaces)) {
                for (const iface of interfaces[name]) {
                  if (iface.family === 'IPv4' && !iface.internal) {
                    const parts = iface.address.split('.');
                    parts[3] = '255';
                    client.send(message, DISCOVERY_PORT, parts.join('.'));
                  }
                }
              }
            });

            setTimeout(() => {
              client.close();
              resolve(found);
            }, 1500); // Wait 1.5s for responses
          });

          discovered.forEach((url) => active.add(url));
        } catch (e) {
          /* ignore UDP errors */
        }
      }

      // 2. Legacy Port Scanning Fallback (Slow)
      if (active.size === 0) {
        const checked = new Set();
        const checkIp = async (ip, port) => {
          const url = `http://${ip}:${port}/v1/chat/completions`;
          if (checked.has(url)) return;
          checked.add(url);

          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 150);
            const response = await fetch(`http://${ip}:${port}/`, {
              method: 'OPTIONS',
              signal: controller.signal,
            }).catch(() => ({ ok: false, status: 404 }));

            if (response.status === 404 || response.status === 200 || response.status === 403) {
              active.add(url);
            }
            clearTimeout(timeoutId);
          } catch (e) {
            /* ignore */
          }
        };

        const scanRange = async (ips, ports) => {
          const batchSize = 50;
          for (let i = 0; i < ips.length; i += batchSize) {
            const batch = [];
            for (let j = i; j < Math.min(i + batchSize, ips.length); j++) {
              for (const port of ports) {
                batch.push(checkIp(ips[j], port));
              }
            }
            await Promise.all(batch);
          }
        };

        await scanRange(
          ['127.0.0.1'],
          [18789, ...Array.from({ length: endPort - startPort + 1 }, (_, i) => startPort + i)],
        );

        const interfaces = os.networkInterfaces();
        const localIps = [];
        for (const name of Object.keys(interfaces)) {
          for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
              localIps.push(iface.address);
            }
          }
        }

        for (const localIp of localIps) {
          const subnet = localIp.split('.').slice(0, 3).join('.');
          const ips = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);
          await scanRange(ips, [18789, startPort]);
        }

        if (!scanSubnetOnly && active.size < 1) {
          const ranges = [
            { base: '192.168', secondOctet: Array.from({ length: 256 }, (_, i) => i) },
            { base: '172', secondOctet: Array.from({ length: 16 }, (_, i) => 16 + i) },
            { base: '10', secondOctet: Array.from({ length: 256 }, (_, i) => i) },
          ];

          for (const range of ranges) {
            for (const octet of range.secondOctet) {
              const prefix = range.base === '10' ? `10.${octet}` : `${range.base}.${octet}`;
              const ips = [`${prefix}.1`, `${prefix}.100`, `${prefix}.254`];
              await scanRange(ips, [18789, startPort]);
              if (active.size > 15) break;
            }
            if (active.size > 15) break;
          }
        }
      }

      const activeArray = Array.from(active);
      if (scanSubnetOnly) {
        return activeArray.length > 0
          ? `Discovered active agent endpoints:\n${activeArray.join('\n')}`
          : 'No other agents discovered on local subnets.';
      }

      return activeArray.length > 0
        ? `Discovered active agent endpoints:\n${activeArray.join('\n')}`
        : 'No other agents discovered.';
    },
    manage_peers: async ({ action, id, disclosure = 'public' }, _permissions) => {
      const peers = getPeers();

      if (action === 'list') {
        let out = '--- TRUSTED PEERS ---\n';
        const trusted = Object.values(peers.trusted);
        if (trusted.length === 0) out += '(None)\n';
        else
          trusted.forEach(
            (p) =>
              (out += `- ${p.name} (${p.id}) [Disclosure: ${p.disclosure || 'public'}] at ${p.endpoint}\n`),
          );

        out += '\n--- PENDING REQUESTS ---\n';
        const pending = Object.values(peers.pending);
        if (pending.length === 0) out += '(None)\n';
        else
          pending.forEach((p) => (out += `- ${p.name} (${p.id}) at ${p.endpoint} [${p.date}]\n`));

        return out;
      }

      if (action === 'approve') {
        if (!id || !peers.pending[id]) return `Error: Pending peer ID "${id}" not found.`;
        const peer = peers.pending[id];
        delete peers.pending[id];

        // Generate dynamic token
        peer.token = crypto.randomBytes(32).toString('hex');
        peer.disclosure = disclosure;
        peers.trusted[id] = peer;
        savePeers(peers);

        return `Peer "${peer.name}" approved with disclosure level "${disclosure}". Token generated and stored.`;
      }

      if (action === 'set_disclosure') {
        if (!id || !peers.trusted[id]) return `Error: Trusted peer ID "${id}" not found.`;
        peers.trusted[id].disclosure = disclosure;
        savePeers(peers);
        return `Disclosure level for "${peers.trusted[id].name}" set to "${disclosure}".`;
      }

      if (action === 'deny' || action === 'remove') {
        if (peers.pending[id]) {
          delete peers.pending[id];
          savePeers(peers);
          return `Pending request from "${id}" denied.`;
        }
        if (peers.trusted[id]) {
          delete peers.trusted[id];
          savePeers(peers);
          return `Trusted peer "${id}" removed.`;
        }
        return `Error: Peer ID "${id}" not found in pending or trusted.`;
      }

      return `Error: Unknown action "${action}". Use: list, approve, set_disclosure, deny, remove.`;
    },
    get_local_endpoint: async (_args, _permissions) => {
      // Helper to give the user their own endpoint to share with others
      const agentName = config.agentName || 'Anima';
      let hash = 0;
      for (let i = 0; i < agentName.length; i++) {
        hash = (hash << 5) - hash + agentName.charCodeAt(i);
        hash |= 0;
      }
      const port = 18700 + (Math.abs(hash) % 89);

      const interfaces = os.networkInterfaces();
      let localIp = 'localhost';
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && !iface.internal) {
            localIp = iface.address;
            break;
          }
        }
      }

      return `Your A2A Endpoint: http://${localIp}:${port}/v1/chat/completions\nAgent ID: ${config.agentId || 'anima-1'}`;
    },
  },
};
