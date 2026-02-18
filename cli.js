const fs = require('node:fs');
const readline = require('node:readline');
const path = require('node:path');

const config = require('./app/Config');
const { tools, availableTools } = require('./app/Tools');
const ParturitionService = require('./app/ParturitionService');

const startSpinner = (text) => {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  process.stdout.write(`\x1b[33m${frames[0]} ${text}\x1b[0m`);
  return setInterval(() => {
    i = (i + 1) % frames.length;
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`\x1b[33m${frames[i]} ${text}\x1b[0m`);
  }, 80);
};

const stopSpinner = (interval) => {
  clearInterval(interval);
  readline.cursorTo(process.stdout, 0);
  readline.clearLine(process.stdout, 0);
};

const updateMemory = async () => {
  console.log('\nConsolidating memory...');
  
  // Filter for relevant messages (user and assistant, excluding initial system)
  const sessionMessages = conversationHistory.filter(msg => msg.role !== 'system');
  
  if (sessionMessages.length === 0) {
      console.log('No new interaction to remember.');
      return;
  }

  const consolidationPrompt = {
      role: 'system',
      content: `You are a memory consolidation system. 
      Analyze the conversation history provided by the user.
      Extract important facts and insights that should be preserved for the long term.
      
      Prioritize strictly in this order:
      1. Important facts about the **User** (preferences, current projects, specific instructions).
      2. Important facts about the **Agent** (self-corrections, new behaviors learned).
      3. Important facts about the **World** (external tools, libraries, context).

      Output ONLY the new facts as bullet points. 
      If there is nothing significant to save, output strictly "NO_UPDATE".
      The aim is to learn what the user wants so any positive feedback is to be Prioritize.
      Do not include conversational filler.`
  };

  const messagesForConsolidation = [
      consolidationPrompt,
      ...sessionMessages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }))
  ];

  try {
      const response = await fetch(config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`
          },
          body: JSON.stringify({
            model: config.model || "gpt-3.5-turbo",
            messages: messagesForConsolidation
          })
      });

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (content && content.trim() !== 'NO_UPDATE') {
          const memoryFile = path.join(__dirname, 'Memory', 'memory.md');
          const timestamp = new Date().toISOString().split('T')[0];
          const entry = `\n\n## Session ${timestamp}\n${content}`;
          
          fs.appendFileSync(memoryFile, entry);
          console.log(`Memory updated in ${memoryFile}`);
      } else {
          console.log('No significant memory updates.');
      }
  } catch (error) {
      console.error('Failed to update memory:', error.message);
  }
};

let rl;

const updateStatus = (text) => {
  readline.moveCursor(process.stdout, 0, -1);
  readline.clearLine(process.stdout, 0);
  process.stdout.write(`${text}\n`);
  rl.prompt(true);
};


const conversationHistory = [];
const generateHistoryPath = () => {
  const memoryDir = path.join(__dirname, 'Memory');
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
  return path.join(memoryDir, `memory-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
};
let historyPath = generateHistoryPath();

// Load system prompt from markdown files in 'Personality' directory and 'Memory/memory.md'
const loadPersona = () => {
  const personaDir = path.join(__dirname, 'Personality');
  let systemPrompt = '';

  if (fs.existsSync(personaDir)) {
    const files = fs.readdirSync(personaDir).filter(file => file.endsWith('.md'));
    const personalityContent = files.map(file => fs.readFileSync(path.join(personaDir, file), 'utf8')).join('\n\n');
    systemPrompt += personalityContent;
    console.log(`Loaded personality from ${files.length} file(s).`);
  }

  const memoryFile = path.join(__dirname, 'Memory', 'memory.md');
  if (fs.existsSync(memoryFile)) {
    const memoryContent = fs.readFileSync(memoryFile, 'utf8');
    systemPrompt += '\n\n' + memoryContent;
    console.log(`Loaded memory from ${memoryFile}.`);
  }

  if (systemPrompt.trim()) {
    conversationHistory.push({ role: "system", content: systemPrompt });
  }
};

async function main() {
    const parturition = new ParturitionService(__dirname);

    if (await parturition.isParturitionRequired()) {
        await parturition.performParturition(async (prompt) => {
            process.stdout.write('\x1b[33mGestating...\x1b[0m\n');
            const response = await fetch(config.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`
                },
                body: JSON.stringify({
                    model: config.model || "gpt-3.5-turbo",
                    messages: [{ role: "user", content: prompt }]
                })
            });
            const data = await response.json();
            return data.choices?.[0]?.message?.content || "";
        });
    }

    rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    let exitAttempt = false;
    rl.on('SIGINT', async () => {
        if (exitAttempt) {
            await updateMemory();
            process.exit(0);
        } else {
            exitAttempt = true;
            updateStatus('Press Ctrl+C again to exit (memory will be saved).');
            setTimeout(() => { 
                exitAttempt = false; 
                updateStatus('');
            }, 3000);
        }
    });

    loadPersona();

    const agentName = await parturition.getAgentName();

    console.log(`${agentName} CLI - Press Ctrl+C twice to quit.`);
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
        
        if (input.trim() === '/save') {
            await updateMemory();
            rl.prompt();
            return;
        }

        conversationHistory.push({ role: "user", content: input });
        fs.writeFileSync(historyPath, JSON.stringify(conversationHistory, null, 2));

        // UX: Show thinking state
        let spinner = startSpinner(`${agentName} is thinking...`);

        try {
        let processing = true;
        while (processing) {
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
                messages: conversationHistory,
                tools: tools
            })
            });

            const data = await response.json();
            const message = data.choices?.[0]?.message;

            if (message.tool_calls) {
            conversationHistory.push(message);
            
            stopSpinner(spinner);
            console.log(`\x1b[33mExecuting ${message.tool_calls.length} tool(s)...\x1b[0m`);

            for (const toolCall of message.tool_calls) {
                try {
                    const functionName = toolCall.function.name;
                    const functionArgs = JSON.parse(toolCall.function.arguments);

                    let confirmed = true;
                    if (['write_file', 'run_command', 'execute_code', 'delete_file'].includes(functionName)) {
                        const answer = await new Promise(resolve => {
                            rl.question(`\x1b[33mAllow ${functionName} with args ${JSON.stringify(functionArgs)}? (y/N): \x1b[0m`, resolve);
                        });
                        confirmed = answer.trim().toLowerCase() === 'y';
                    }

                    const toolResult = confirmed 
                    ? await availableTools[functionName](functionArgs)
                    : "User denied tool execution.";

                    conversationHistory.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: functionName,
                        content: toolResult
                    });
                } catch (error) {
                    console.error(`Error executing tool ${toolCall.function.name}:`, error.message);
                    conversationHistory.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolCall.function.name,
                        content: `Error: ${error.message}`
                    });
                }
            }
            spinner = startSpinner(`${agentName} is thinking...`);
            } else {
            stopSpinner(spinner);

            const reply = message.content || JSON.stringify(data, null, 2);
            conversationHistory.push({ role: "assistant", content: reply });
            fs.writeFileSync(historyPath, JSON.stringify(conversationHistory, null, 2));

            console.log(`\x1b[36m${agentName}: ${reply}\x1b[0m`);
            processing = false;
            }
        }
        } catch (error) {
          stopSpinner(spinner);
          console.error('Error:', error.message);
        }

        process.stdout.write('\n');
        rl.prompt();
    });
}

main();
