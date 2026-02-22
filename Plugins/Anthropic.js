const fs = require('fs');
const path = require('path');
const mainConfig = require('../app/Config');

const loadProviderConfig = () => {
  const configPath = path.join(__dirname, '../Settings/anthropic.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Anthropic configuration file not found at ${configPath}. Please create it in the settings folder with endpoint, apiKey, and model.`);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
};

const completion = async (messages, tools = null) => {
  const providerConfig = loadProviderConfig();
  
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': providerConfig.apiKey,
    'anthropic-version': '2023-06-01'
  };

  // Convert OpenAI messages to Anthropic format
  // Anthropic has a 'system' parameter instead of a system message in the array
  const systemMessage = messages.find(m => m.role === 'system');
  const otherMessages = messages.filter(m => m.role !== 'system').map(m => {
      // Normalize 'assistant' tool calls for Anthropic if needed
      // (Simplified mapping)
      return {
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content
      };
  });

  const body = {
    model: mainConfig.model || providerConfig.model || "claude-3-opus-20240229",
    max_tokens: 4096,
    messages: otherMessages
  };

  if (systemMessage) {
      body.system = systemMessage.content;
  }

  if (tools) {
    body.tools = tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters
    }));
  }

  const response = await fetch(providerConfig.endpoint || "https://api.anthropic.com/v1/messages", {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API Request failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();

  // Map Anthropic response to OpenAI format
  const message = {
      role: 'assistant',
      content: data.content.find(c => c.type === 'text')?.text || ''
  };

  const toolCalls = data.content.filter(c => c.type === 'tool_use');
  if (toolCalls.length > 0) {
      message.tool_calls = toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
              name: tc.name,
              arguments: JSON.stringify(tc.input)
          }
      }));
  }

  return {
    choices: [{ message }]
  };
};

module.exports = { completion };
