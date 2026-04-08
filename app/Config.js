const { z } = require('zod');

const path = require('node:path');

// Define the schema for the configuration
const configSchema = z.object({
  LLMProvider: z.string().default('openrouter'),
  heartbeatInterval: z.number().default(300), // Default to 300 seconds (5 minutes)
  workspaceDir: z.string().default(path.join(__dirname, '..')),
  memoryMode: z.enum(['off', 'session', 'longterm']).default('session'),
  advisoryCouncil: z
    .object({
      enabled: z.boolean().default(false),
      mode: z.enum(['always', 'on_demand', 'risk_based']).default('on_demand'),
      advisers: z
        .array(
          z.object({
            name: z.string(),
            role: z.string(),
            promptFile: z.string(),
            weight: z.number().optional(),
            temperature: z.number().optional(),
            model: z.string().optional(),
          }),
        )
        .default([]),
      maxAdvisersPerCall: z.number().default(3),
      timeoutMs: z.number().default(30000),
      maxTokens: z.number().default(1000),
      parallel: z.boolean().default(true),
      storeCouncilMemos: z.boolean().default(false),
    })
    .default({}),
  encryption: z
    .object({
      enabled: z.boolean().default(false),
      key: z.string().optional(),
    })
    .default({}),
  compaction: z
    .object({
      enabled: z.boolean().default(true),
      threshold: z.number().default(20),
    })
    .default({}),
  tokenBudget: z
    .object({
      maxTotalTokens: z.number().nullable().default(null),
      maxInputTokens: z.number().nullable().default(null),
      maxOutputTokens: z.number().nullable().default(null),
      maxTurns: z.number().nullable().default(null),
    })
    .default({}),
  selfVerification: z
    .object({
      mode: z.enum(['off', 'on_destructive', 'always']).default('off'),
      maxConsecutiveFailures: z.number().default(3),
    })
    .default({}),
  webGateway: z
    .object({
      port: z.number().default(8080),
      sessionTtlMs: z.number().default(900000),
    })
    .default({}),
});

let loadedConfig = null;

function loadConfig() {
  if (loadedConfig) return loadedConfig;

  let configData;
  try {
    // Try to require the configuration file from the project root
    // This supports Anima.config.js or Anima.config.json
    const configPath = process.env.ANIMA_CONFIG_PATH
      ? path.resolve(process.env.ANIMA_CONFIG_PATH)
      : path.join(__dirname, '../Settings/Anima.config');
    configData = require(configPath);
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
