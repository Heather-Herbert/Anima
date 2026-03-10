// Plugin for connecting Anima to an OpenClaw Agent.
// This implements an Agent-to-Agent (A2A) bridge using OpenClaw's OpenAI-compatible gateway.
// Anima acts as the local CLI shell, while the OpenClaw agent provides the 'brain'.
const fs = require('fs');
const path = require('path');
const mainConfig = require('../app/Config');

const loadProviderConfig = () => {
  const configPath = path.join(__dirname, '../Settings/openclaw.json');
  if (!fs.existsSync(configPath)) {
    // Return defaults if config file doesn't exist (useful for local instances)
    return {
      endpoint: 'http://127.0.0.1:18789/v1/chat/completions',
      apiKey: 'your-openclaw-token',
      model: 'openclaw:main',
    };
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
};

const completion = async (messages, tools = null) => {
  const providerConfig = loadProviderConfig();

  // Simple server check to ensure OpenClaw is reachable
  try {
    const url = new URL(providerConfig.endpoint);
    const baseUrl = `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}`;
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(2000) });
    // Any response (even 404) means the server is there
    if (!response.ok && response.status !== 404 && response.status !== 401) {
      // 401 is also fine, it just means we didn't provide a token yet
    }
  } catch (error) {
    throw new Error(
      `OpenClaw server is not reachable at ${providerConfig.endpoint}. Please ensure your OpenClaw Gateway is running.`,
    );
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${providerConfig.apiKey}`,
  };

  const body = {
    model: mainConfig.model || providerConfig.model || 'openclaw:main',
    messages: messages,
  };

  if (tools) {
    body.tools = tools;
  }

  const response = await fetch(providerConfig.endpoint, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Invalid or expired OpenClaw API Key (HTTP ${response.status}). Please check settings/openclaw.json.`,
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OpenClaw API Request failed: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  return await response.json();
};

module.exports = { completion };
