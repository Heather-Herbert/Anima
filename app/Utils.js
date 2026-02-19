const config = require('./Config');
const fs = require('fs');
const path = require('path');

const callAI = async (messages, tools = null) => {
  const providerName = config.LLMProvider || 'openrouter';
  
  // Dynamic provider loading from plugins directory
  const providerPath = path.join(__dirname, 'plugins', `${providerName}.js`);
  
  if (!fs.existsSync(providerPath)) {
    throw new Error(`Unknown provider: ${providerName}. Plugin file not found at ${providerPath}`);
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