const { z } = require('zod');

// Define the schema for the configuration
const configSchema = z.object({
  LLMProvider: z.string().default('openrouter'),
});

let loadedConfig = null;

function loadConfig() {
  if (loadedConfig) return loadedConfig;

  let configData;
  try {
    // Try to require the configuration file from the project root
    // This supports Anima.config.js or Anima.config.json
    configData = require('../settings/Anima.config');
  } catch (error) {
    console.error('\x1b[31mError: Configuration file not found.\x1b[0m');
    console.error('Please ensure \x1b[33mAnima.config.js\x1b[0m or \x1b[33mAnima.config.json\x1b[0m exists in the settings folder.');
    process.exit(1);
  }

  // Validate the configuration
  const result = configSchema.safeParse(configData);

  if (!result.success) {
    console.error('\x1b[31mConfiguration validation failed:\x1b[0m');
    result.error.issues.forEach((issue) => {
      console.error(` - ${issue.path.join('.')}: ${issue.message}`);
    });
    process.exit(1);
  }

  loadedConfig = result.data;
  return loadedConfig;
}

module.exports = new Proxy({}, {
  get(target, prop) {
    return loadConfig()[prop];
  },
  set(target, prop, value) {
    loadConfig()[prop] = value;
    return true;
  },
  has(target, prop) {
    return prop in loadConfig();
  },
  ownKeys(target) {
    return Reflect.ownKeys(loadConfig());
  },
  getOwnPropertyDescriptor(target, prop) {
    return Reflect.getOwnPropertyDescriptor(loadConfig(), prop);
  }
});