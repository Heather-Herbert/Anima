const fs = require('fs');
const path = require('path');
const mainConfig = require('../app/Config');

const loadProviderConfig = () => {
  const configPath = path.join(__dirname, '../Settings/deepseek.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`DeepSeek configuration file not found at ${configPath}. Please create it in the settings folder with endpoint, apiKey, and model.`);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
};

const completion = async (messages, tools = null) => {
  const providerConfig = loadProviderConfig();
  
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${providerConfig.apiKey}`
  };

  const body = {
    model: mainConfig.model || providerConfig.model || "deepseek-chat",
    messages: messages
  };

  if (tools) {
    body.tools = tools;
  }

  const response = await fetch(providerConfig.endpoint || "https://api.deepseek.com/chat/completions", {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(`Invalid or expired DeepSeek API Key (HTTP ${response.status}). Please check settings/deepseek.json.`);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API Request failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return await response.json();
};

module.exports = { completion };
