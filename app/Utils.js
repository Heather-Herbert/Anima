const config = require('./Config');

const callAI = async (messages, tools = null) => {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
    'HTTP-Referer': 'https://github.com/HeatherHerbert/Anima',
    'X-Title': 'Anima CLI'
  };

  const body = {
    model: config.model || "gpt-3.5-turbo",
    messages: messages
  };

  if (tools) {
    body.tools = tools;
  }

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(`Invalid or expired API Key (HTTP ${response.status}). Please check Anima.config.js/json.`);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Request failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return await response.json();
};

module.exports = { callAI };