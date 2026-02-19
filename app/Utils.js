const config = require('./Config');
const fs = require('fs');
const path = require('path');

const callAI = async (messages, tools = null) => {
  const providerName = config.LLMProvider || 'openrouter';
  
  // Map of supported providers to their implementation files
  const providers = {
    'openrouter': './plugins/OpenRouter',
    'ollama': './plugins/Ollama',
    // Add other providers here, e.g., 'openai': './providers/OpenAI'
  };

  const providerPath = providers[providerName.toLowerCase()];
  
  if (!providerPath) {
    throw new Error(`Unknown provider: ${providerName}. Supported providers: ${Object.keys(providers).join(', ')}`);
  }

  const provider = require(providerPath);
  return await provider.completion(messages, tools);
};

const getProviderManifest = () => {
  const providerName = config.LLMProvider || 'openrouter';
  try {
    // Assumes manifest is named {provider}.manifest.json in the plugins directory
    const manifestPath = path.join(__dirname, 'plugins', `${providerName}.manifest.json`);
    if (fs.existsSync(manifestPath)) {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }
  } catch (e) { /* ignore missing manifest */ }
  return { capabilities: { tools: ["*"] } };
};

module.exports = { callAI, getProviderManifest };