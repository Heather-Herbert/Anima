const fs = require('node:fs');
const path = require('node:path');

// Load configuration from ../../Settings/Anima.config relative to this file
const configPath = path.join(__dirname, '../../Settings', 'Anima.config');
let config;

try {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Anima.config file not found at ${configPath}`);
  }
  const configFile = fs.readFileSync(configPath, 'utf8');
  config = JSON.parse(configFile);
} catch (error) {
  console.error('Error loading configuration:', error.message);
  process.exit(1);
}

module.exports = config;