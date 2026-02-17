const fs = require('node:fs');
const readline = require('node:readline');
const path = require('node:path');

// Load configuration
const configPath = path.join(__dirname, 'Anima.config');
let config;

try {
  if (!fs.existsSync(configPath)) {
    throw new Error('Anima.config file not found.');
  }
  const configFile = fs.readFileSync(configPath, 'utf8');
  config = JSON.parse(configFile);
} catch (error) {
  console.error('Error loading configuration:', error.message);
  process.exit(1);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const updateStatus = (text) => {
  readline.moveCursor(process.stdout, 0, -1);
  readline.clearLine(process.stdout, 0);
  process.stdout.write(`${text}\n`);
  rl.prompt(true);
};

let exitAttempt = false;
rl.on('SIGINT', () => {
  if (exitAttempt) {
    process.exit(0);
  } else {
    exitAttempt = true;
    updateStatus('Press Ctrl+C again to exit.');
    setTimeout(() => { 
      exitAttempt = false; 
      updateStatus('');
    }, 3000);
  }
});

const conversationHistory = [];
const generateHistoryPath = () => {
  return path.join(__dirname, `memory-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
};
let historyPath = generateHistoryPath();

// Load system prompt from markdown files in 'persona' directory
const loadPersona = () => {
  const personaDir = path.join(__dirname, 'persona');
  if (fs.existsSync(personaDir)) {
    const files = fs.readdirSync(personaDir).filter(file => file.endsWith('.md'));
    const systemPrompt = files.map(file => fs.readFileSync(path.join(personaDir, file), 'utf8')).join('\n\n');
    if (systemPrompt.trim()) {
      conversationHistory.push({ role: "system", content: systemPrompt });
      console.log(`Loaded system prompt from ${files.length} file(s).`);
    }
  }
};

loadPersona();

console.log("Anima CLI - Press Ctrl+C twice to quit.");
process.stdout.write('\n');

rl.setPrompt('You: ');
rl.prompt();

rl.on('line', async (input) => {
    if (input.trim() === '/new') {
      conversationHistory.length = 0;
      loadPersona();
      historyPath = generateHistoryPath();
      fs.writeFileSync(historyPath, JSON.stringify(conversationHistory, null, 2));
      console.log("Session reset.");
      rl.prompt();
      return;
    }

    conversationHistory.push({ role: "user", content: input });
    fs.writeFileSync(historyPath, JSON.stringify(conversationHistory, null, 2));

    // UX: Show thinking state
    process.stdout.write('\x1b[33mAnima is thinking...\x1b[0m\n');

    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
          'HTTP-Referer': 'https://github.com/HeatherHerbert/Anima', // Optional: For OpenRouter rankings
          'X-Title': 'Anima CLI' // Optional: For OpenRouter rankings
        },
        body: JSON.stringify({
          model: config.model || "gpt-3.5-turbo",
          messages: conversationHistory
        })
      });

      const data = await response.json();
      
      // UX: Clear thinking line
      readline.moveCursor(process.stdout, 0, -1);
      readline.clearLine(process.stdout, 0);

      // Adjust parsing logic based on the specific LLM API response structure
      const reply = data.choices?.[0]?.message?.content || JSON.stringify(data, null, 2);
      conversationHistory.push({ role: "assistant", content: reply });
      fs.writeFileSync(historyPath, JSON.stringify(conversationHistory, null, 2));

      console.log(`\x1b[36mAI: ${reply}\x1b[0m`);
    } catch (error) {
      readline.moveCursor(process.stdout, 0, -1);
      readline.clearLine(process.stdout, 0);
      console.error('Error:', error.message);
    }

    process.stdout.write('\n');
    rl.prompt();
});