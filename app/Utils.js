const config = require('./Config');
const fs = require('fs');
const path = require('path');

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

  const provider = require(providerPath);
  return await provider.completion(messages, tools);
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
  return { capabilities: { tools: ['*'] } };
};

module.exports = { callAI, getProviderManifest };
