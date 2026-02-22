const { z } = require('zod');

// Define the schema for the configuration
const configSchema = z.object({
  LLMProvider: z.string().default('openrouter'),
  heartbeatInterval: z.number().default(300), // Default to 300 seconds (5 minutes)
});

let loadedConfig = null;

function loadConfig() {
  if (loadedConfig) return loadedConfig;

  let configData;
  try {
    // Try to require the configuration file from the project root
    // This supports Anima.config.js or Anima.config.json
    configData = require('../Settings/Anima.config');
  } catch (error) {
    // Return null instead of exiting to allow for setup wizard
    return null;
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

module.exports = new Proxy(
  {},
  {
    get(_target, prop) {
      const config = loadConfig();
      if (!config) return undefined;
      return config[prop];
    },
    set(_target, prop, value) {
      const config = loadConfig();
      if (!config) {
        loadedConfig = { [prop]: value };
        return true;
      }
      config[prop] = value;
      return true;
    },
    has(_target, prop) {
      const config = loadConfig();
      if (!config) return false;
      return prop in config;
    },
    ownKeys(_target) {
      const config = loadConfig();
      if (!config) return [];
      return Reflect.ownKeys(config);
    },
    getOwnPropertyDescriptor(_target, prop) {
      const config = loadConfig();
      if (!config) return undefined;
      return Reflect.getOwnPropertyDescriptor(config, prop);
    },
  },
);
