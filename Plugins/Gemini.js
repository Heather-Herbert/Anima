const fs = require('fs');
const path = require('path');
const mainConfig = require('../app/Config');

const loadProviderConfig = () => {
  const configPath = path.join(__dirname, '../Settings/gemini.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Gemini configuration file not found at ${configPath}. Please create it in the settings folder with apiKey and model.`,
    );
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
};

const completion = async (messages, tools = null) => {
  const providerConfig = loadProviderConfig();

  const apiKey = providerConfig.apiKey;
  const model = mainConfig.model || providerConfig.model || 'gemini-1.5-pro-latest';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Convert OpenAI messages to Gemini format
  const geminiMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      let role = 'user';
      if (m.role === 'assistant') role = 'model';
      return {
        role: role,
        parts: [{ text: m.content || '' }],
      };
    });

  const systemMessage = messages.find((m) => m.role === 'system');

  const body = {
    contents: geminiMessages,
  };

  if (systemMessage) {
    body.system_instruction = {
      parts: [{ text: systemMessage.content }],
    };
  }

  if (tools) {
    body.tools = [
      {
        function_declarations: tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      },
    ];
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Invalid or expired Gemini API Key (HTTP ${response.status}). Please check settings/gemini.json.`,
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Gemini API Request failed: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  const data = await response.json();

  // Normalize Gemini response to match OpenAI format
  const message = {
    role: 'assistant',
    content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
  };

  const toolCalls = data.candidates?.[0]?.content?.parts?.filter((p) => p.functionCall);
  if (toolCalls && toolCalls.length > 0) {
    message.tool_calls = toolCalls.map((tc, index) => ({
      id: `call_${index}_${Date.now()}`,
      type: 'function',
      function: {
        name: tc.functionCall.name,
        arguments: JSON.stringify(tc.functionCall.args),
      },
    }));
  }

  return {
    choices: [{ message }],
  };
};

module.exports = { completion };
