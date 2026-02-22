const fs = require('node:fs');
const path = require('node:path');

// Minimalistic runner for out-of-process providers
const providerPath = process.argv[2];

if (!providerPath || !fs.existsSync(providerPath)) {
  process.stderr.write(`Error: Provider path invalid: ${providerPath}
`);
  process.exit(1);
}

// Load the provider
const provider = require(providerPath);

// Buffer for stdin
let inputData = '';

process.stdin.on('data', (chunk) => {
  inputData += chunk;
});

process.stdin.on('end', async () => {
  try {
    const { messages, tools } = JSON.parse(inputData);
    const result = await provider.completion(messages, tools);
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
  } catch (error) {
    process.stderr.write(JSON.stringify({ error: error.message, stack: error.stack }));
    process.exit(1);
  }
});
