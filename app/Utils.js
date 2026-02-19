const config = require('./Config');

const callAI = async (messages, tools = null) => {
  const providerName = config.LLMProvider || 'openrouter';
  
  // Map of supported providers to their implementation files
  const providers = {
    'openrouter': './plugins/OpenRouter',
    // Add other providers here, e.g., 'openai': './providers/OpenAI'
  };

  const providerPath = providers[providerName.toLowerCase()];
  
  if (!providerPath) {
    throw new Error(`Unknown provider: ${providerName}. Supported providers: ${Object.keys(providers).join(', ')}`);
  }

  const provider = require(providerPath);
  return await provider.completion(messages, tools);
};

module.exports = { callAI };