const config = require('./Config');
const fs = require('fs');
const path = require('path');

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

const encrypt = (text, key) => {
  if (!key) throw new Error('Encryption key is required');
  const hashedKey = crypto.createHash('sha256').update(key).digest();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, hashedKey, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
};

const decrypt = (encryptedText, key) => {
  if (!key) throw new Error('Encryption key is required');
  try {
    const hashedKey = crypto.createHash('sha256').update(key).digest();
    const [ivHex, tagHex, encrypted] = encryptedText.split(':');
    if (!ivHex || !tagHex || !encrypted) throw new Error('Invalid encrypted format');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, hashedKey, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    throw new Error(`Decryption failed: ${e.message}`);
  }
};

const resolvePluginFile = (name, suffix) => {
  const pluginsDir = path.join(__dirname, '..', 'Plugins');
  if (!fs.existsSync(pluginsDir)) return null;

  const target = (name + suffix).toLowerCase();
  const files = fs.readdirSync(pluginsDir);
  const match = files.find((f) => f.toLowerCase() === target);

  return match ? path.join(pluginsDir, match) : null;
};

const callAI = async (messages, tools = null) => {
  const providerName = config.LLMProvider || 'openrouter';

  // Dynamic provider loading from plugins directory (case-insensitive)
  const providerPath = resolvePluginFile(providerName, '.js');

  if (!providerPath) {
    throw new Error(`Unknown provider: ${providerName}. Plugin file not found in Plugins/`);
  }

  // Run provider out-of-process for isolation
  return new Promise((resolve, reject) => {
    const runnerPath = path.join(__dirname, 'ProviderRunner.js');

    // Whitelist environment variables if needed (e.g. PATH for node/python)
    const env = {
      PATH: process.env.PATH,
      NODE_PATH: process.env.NODE_PATH,
    };

    const child = spawn(process.execPath, [runnerPath, providerPath], {
      env: env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });

    child.on('close', (code) => {
      if (code !== 0) {
        try {
          const errObj = JSON.parse(stderr);
          reject(new Error(`Provider Process Error: ${errObj.error}`));
        } catch (e) {
          reject(new Error(`Provider Process exited with code ${code}. Stderr: ${stderr}`));
        }
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (e) {
        reject(new Error(`Failed to parse provider output: ${e.message}. Raw: ${stdout}`));
      }
    });

    child.stdin.write(JSON.stringify({ messages, tools }));
    child.stdin.end();
  });
};

const getProviderManifest = () => {
  const providerName = config.LLMProvider || 'openrouter';
  try {
    const manifestPath = resolvePluginFile(providerName, '.manifest.json');

    if (manifestPath && fs.existsSync(manifestPath)) {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }
  } catch (e) {
    /* ignore missing manifest */
  }
  // Secure by default: If no manifest is found, only allow read-only tools and read-only filesystem access.
  return {
    capabilities: {
      tools: ['read_file', 'list_files', 'search_files', 'file_info', 'web_search'],
    },
    permissions: {
      filesystem: {
        read: ['*'],
        write: [],
      },
    },
  };
};

const redact = (text, secrets = []) => {
  if (!text) return text;
  let redacted = typeof text === 'string' ? text : JSON.stringify(text);

  // Redact known secrets
  secrets.forEach((secret) => {
    if (!secret) return;
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'g');
    redacted = redacted.replace(re, '[REDACTED]');
  });

  // Pattern-based redaction (generic API keys, tokens, high-entropy strings)
  redacted = redacted.replace(
    /(api[_-]?key|token|auth|password|secret(?:\s+key|[_-]?key)?|key)["']?\s*(?:[:=]|\bis\b)\s*["']?([a-zA-Z0-9_-]{8,})["']?/gi,
    '$1: [REDACTED]',
  );
  redacted = redacted.replace(/Bearer\s+([a-zA-Z0-9_-]{10,})/gi, 'Bearer [REDACTED]');
  redacted = redacted.replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED]'); // OpenAI style keys

  return redacted;
};

const summariseHealth = (report) => {
  if (!report) return 'No health data.';
  const topItems = [...(report.complexityIssues || []), ...(report.debtItems || [])]
    .slice(0, 3)
    .map((i) => `${i.rule} in ${i.file}:${i.line}`)
    .join('; ');
  return `Status: ${report.status} | ${report.summary}${topItems ? ` | Top issues: ${topItems}` : ''}`;
};

module.exports = { callAI, getProviderManifest, redact, encrypt, decrypt, summariseHealth };
