const config = require('./Config');
const fs = require('fs');
const path = require('path');

const { spawn } = require('node:child_process');

const callAI = async (messages, tools = null) => {
  const providerName = config.LLMProvider || 'openrouter';

  // Dynamic provider loading from plugins directory
  // Try to find the provider in ../Plugins, handling capitalization
  let providerFilename = `${providerName}.js`;
  let providerPath = path.join(__dirname, '..', 'Plugins', providerFilename);

  if (!fs.existsSync(providerPath)) {
    // Try capitalized version (e.g. openrouter -> OpenRouter.js)
    const capitalized = providerName.charAt(0).toUpperCase() + providerName.slice(1);
    providerPath = path.join(__dirname, '..', 'Plugins', `${capitalized}.js`);

    if (!fs.existsSync(providerPath)) {
      throw new Error(
        `Unknown provider: ${providerName}. Plugin file not found at ${providerPath}`,
      );
    }
  }

  // Run provider out-of-process for isolation
  return new Promise((resolve, reject) => {
    const runnerPath = path.join(__dirname, 'ProviderRunner.js');
    
    // Whitelist environment variables if needed (e.g. PATH for node/python)
    const env = {
        PATH: process.env.PATH,
        NODE_PATH: process.env.NODE_PATH
    };

    const child = spawn(process.execPath, [runnerPath, providerPath], {
      env: env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });

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
    // Assumes manifest is named {provider}.manifest.json in the Plugins directory
    let manifestFilename = `${providerName}.manifest.json`;
    let manifestPath = path.join(__dirname, '..', 'Plugins', manifestFilename);

    if (!fs.existsSync(manifestPath)) {
      // Try capitalized version
      const capitalized = providerName.charAt(0).toUpperCase() + providerName.slice(1);
      manifestPath = path.join(__dirname, '..', 'Plugins', `${capitalized}.manifest.json`);
    }

    if (fs.existsSync(manifestPath)) {
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
    /(api[_-]?key|token|auth|password|secret)["']?\s*[:=]\s*["']?([a-zA-Z0-9_\-]{8,})["']?/gi,
    '$1: [REDACTED]',
  );
  redacted = redacted.replace(/Bearer\s+([a-zA-Z0-9_\-\.]{10,})/gi, 'Bearer [REDACTED]');
  redacted = redacted.replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED]'); // OpenAI style keys

  return redacted;
};

module.exports = { callAI, getProviderManifest, redact };
