const fs = require('fs');
const path = require('path');
const mainConfig = require('../Config');

const loadProviderConfig = () => {
  const configPath = path.join(__dirname, '../../settings/ollama.json');
  if (!fs.existsSync(configPath)) {
    // Return defaults if config file doesn't exist
    return {
      endpoint: "http://127.0.0.1:11434/api/chat",
      model: "llama3"
    };
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
};

const completion = async (messages, tools = null) => {
  const providerConfig = loadProviderConfig();
  
  try {
    const url = new URL(providerConfig.endpoint);
    const baseUrl = `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}`;
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error('Server check failed');
  } catch (error) {
    throw new Error(`Ollama server is not reachable at ${providerConfig.endpoint}. Please ensure 'ollama serve' is running.`);
  }

  const body = {
    model: mainConfig.model || providerConfig.model || "llama3",
    messages: messages,
    stream: false
  };

  if (tools) {
    body.tools = tools;
  }

  const response = await fetch(providerConfig.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama API Request failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();

  // Normalize Ollama response to match OpenAI format expected by CLI
  const message = data.message;

  // Ensure tool arguments are strings (Ollama returns objects, OpenAI returns JSON strings)
  if (message.tool_calls) {
    message.tool_calls.forEach(tc => {
      if (typeof tc.function.arguments === 'object') {
        tc.function.arguments = JSON.stringify(tc.function.arguments);
      }
    });
  }

  return {
    choices: [{ message: message }]
  };
};

module.exports = { completion };