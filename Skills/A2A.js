const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const config = require('../app/Config');

// This skill provides an OpenAI-compatible endpoint for other Anima/OpenClaw agents.
// It supports identity queries for learning and task delegation for collaboration.

let server = null;

const startServer = (baseDir) => {
  if (server) return;

  const agentName = config.agentName || 'Anima';
  let hash = 0;
  for (let i = 0; i < agentName.length; i++) {
    hash = (hash << 5) - hash + agentName.charCodeAt(i);
    hash |= 0;
  }
  const port = 18700 + (Math.abs(hash) % 89);

  server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const { messages, tools: requestedTools } = JSON.parse(body);
          const lastMsg = messages[messages.length - 1].content;
          const lastMsgLower = lastMsg.toLowerCase();

          // CASE 1: Identity/Soul Query (Learning)
          if (lastMsgLower.includes('identity') || lastMsgLower.includes('soul') || lastMsgLower.includes('who are you')) {
            const identityPath = path.join(baseDir, 'Personality', 'Identity.md');
            const soulPath = path.join(baseDir, 'Personality', 'Soul.md');
            
            let content = '';
            if (fs.existsSync(identityPath)) {
              content += '## Identity\n' + fs.readFileSync(identityPath, 'utf8') + '\n\n';
            }
            if (fs.existsSync(soulPath)) {
              content += '## Soul\n' + fs.readFileSync(soulPath, 'utf8') + '\n';
            }

            const response = {
              choices: [{
                message: {
                  role: 'assistant',
                  content: content || 'I am a nascent Anima instance.'
                }
              }]
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(response));
          }

          // CASE 2: Task Delegation (Collaboration)
          // We use the main Anima logic to solve the task
          const { callAI } = require('../app/Utils');
          
          // Inject a strict sub-agent instruction to keep it concise and token-efficient
          const subAgentPrompt = {
            role: 'system',
            content: `You are acting as a specialized sub-agent for another Anima instance. 
Task: Solve the user's request using your local tools and knowledge.
Constraint: Be extremely concise. Do not use conversational filler. Provide only the result or the answer.
Your Identity: ${fs.existsSync(path.join(baseDir, 'Personality', 'Identity.md')) ? fs.readFileSync(path.join(baseDir, 'Personality', 'Identity.md'), 'utf8') : 'Anima Instance'}`
          };

          const delegatedMessages = [subAgentPrompt, ...messages];
          
          try {
            // We call our own local AI provider to handle the task
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

  process.on('SIGINT', () => { if(server) server.close(); });
  process.on('exit', () => { if(server) server.close(); });
};

// Skill export
module.exports = {
  startServer,
  implementations: {
    delegate_task: async ({ endpoint, task, apiKey, agentId }, permissions) => {
      try {
        const body = {
          model: agentId || 'anima',
          messages: [{ 
            role: 'user', 
            content: `TASK DELEGATION: ${task}\n\nPlease perform this task and return ONLY the result. Avoid all conversational filler.` 
          }]
        };

        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60000) // Longer timeout for actual tasks
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const content = data.choices[0].message.content;

        return `Result from agent ${agentId || endpoint}:\n${content}`;
      } catch (e) {
        return `Error delegating task: ${e.message}`;
      }
    },
    learn_from_agent: async ({ endpoint, apiKey, agentId }, permissions) => {
      try {
        const body = {
          model: agentId || 'anima',
          messages: [{ role: 'user', content: 'IDENTITY_QUERY: Please share your Identity and Soul. Be concise.' }]
        };

        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000)
        });

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
    discover_agents: async ({ startPort = 18700, endPort = 18790, scanSubnetOnly = true }, permissions) => {
      const active = [];
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
            signal: controller.signal 
          }).catch(() => ({ ok: false, status: 404 }));

          if (response.status === 404 || response.status === 200 || response.status === 403) {
            active.push(url);
          }
          clearTimeout(timeoutId);
        } catch (e) { /* ignore */ }
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

      await scanRange(['127.0.0.1'], [18789, ...Array.from({length: endPort - startPort + 1}, (_, i) => startPort + i)]);

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
        const ips = Array.from({length: 254}, (_, i) => `${subnet}.${i + 1}`);
        await scanRange(ips, [18789, startPort]);
      }

      if (scanSubnetOnly) {
         return active.length > 0 ? `Discovered active agent endpoints:\n${active.join('\n')}` : 'No other agents discovered on local subnets.';
      }

      const ranges = [
        { base: '192.168', secondOctet: Array.from({length: 256}, (_, i) => i) },
        { base: '172', secondOctet: Array.from({length: 16}, (_, i) => 16 + i) },
        { base: '10', secondOctet: Array.from({length: 256}, (_, i) => i) }
      ];

      for (const range of ranges) {
        for (const octet of range.secondOctet) {
          const prefix = range.base === '10' ? `10.${octet}` : `${range.base}.${octet}`;
          const ips = [`${prefix}.1`, `${prefix}.100`, `${prefix}.254`];
          await scanRange(ips, [18789, startPort]);
          if (active.length > 15) break;
        }
        if (active.length > 15) break;
      }

      return active.length > 0 ? `Discovered active agent endpoints:\n${active.join('\n')}` : 'No other agents discovered.';
    }
  }
};
