const fs = require('node:fs');
const readline = require('node:readline');
const path = require('node:path');

const config = require('./app/Config');
const { tools, availableTools } = require('./app/Tools');
const ParturitionService = require('./app/ParturitionService');
const { callAI, getProviderManifest } = require('./app/Utils');

// Check for model override via command line argument
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Anima CLI - AI Agent Interface

Usage: node cli.js [options]

Options:
  --model <name>   Override the model defined in config (e.g., gpt-4, gpt-3.5-turbo)
  --help, -h       Display this help message
`);
    process.exit(0);
}

const modelArgIndex = args.indexOf('--model');
if (modelArgIndex !== -1 && args[modelArgIndex + 1]) {
    config.model = args[modelArgIndex + 1];
    console.log(`\x1b[33mModel overridden via CLI: ${config.model}\x1b[0m`);
}

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
      4. **Code Snippets**: Summarize any significant code snippets, patterns, or algorithms generated during the session.

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
      const data = await callAI(messagesForConsolidation);
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
            try {
                const data = await callAI([{ role: "user", content: prompt }]);
                return data.choices?.[0]?.message?.content || "";
            } catch (error) {
                console.error(`\n\x1b[31mError: ${error.message}\x1b[0m`);
                process.exit(1);
            }
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

    // Load Manifest and filter tools
    const manifest = getProviderManifest();
    const allowedTools = manifest.capabilities?.tools || [];
    
    const activeTools = tools.filter(t => {
        if (allowedTools.includes('*')) return true;
        return allowedTools.includes(t.function.name);
    });

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
            let data;
            let attempts = 0;
            const maxAttempts = 3;

            while (true) {
                try {
                    attempts++;
                    data = await callAI(conversationHistory, activeTools);
                    
                    // Basic validation of response structure
                    if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
                        throw new Error("Malformed response from AI provider");
                    }
                    break;
                } catch (error) {
                    if (attempts >= maxAttempts || error.message.includes('401') || error.message.includes('403')) {
                        throw error;
                    }
                    
                    stopSpinner(spinner);
                    console.log(`\n\x1b[33m[Attempt ${attempts}/${maxAttempts}] Request failed: ${error.message}. Retrying...\x1b[0m`);
                    spinner = startSpinner(`${agentName} is thinking...`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
                }
            }

            const message = data.choices?.[0]?.message;

            if (message.tool_calls) {
            conversationHistory.push(message);
            
            stopSpinner(spinner);
            console.log(`\x1b[33mExecuting ${message.tool_calls.length} tool(s)...\x1b[0m`);

            for (const toolCall of message.tool_calls) {
                try {
                    const functionName = toolCall.function.name;
                    const functionArgs = JSON.parse(toolCall.function.arguments);

                    // Enforce manifest permissions on execution
                    if (!allowedTools.includes('*') && !allowedTools.includes(functionName)) {
                        throw new Error(`Tool '${functionName}' is not permitted by the active plugin manifest.`);
                    }

                    let toolResult;
                    const dangerousTools = ['write_file', 'run_command', 'execute_code', 'delete_file', 'replace_in_file'];

                    if (dangerousTools.includes(functionName)) {
                        let warning = '';
                        if (functionName === 'run_command') warning = `\x1b[31mCOMMAND: ${functionArgs.command}\x1b[0m`;
                        else if (functionName === 'delete_file') warning = `\x1b[31mDELETE: ${functionArgs.path}\x1b[0m`;
                        else if (functionName === 'write_file') warning = `\x1b[31mWRITE: ${functionArgs.path}\x1b[0m`;
                        else if (functionName === 'replace_in_file') warning = `\x1b[31mREPLACE IN: ${functionArgs.path}\nSEARCH: ${functionArgs.search}\nREPLACE: ${functionArgs.replace}\x1b[0m`;
                        else if (functionName === 'execute_code') warning = `\x1b[31mEXECUTE (${functionArgs.language}):\n${functionArgs.code}\x1b[0m`;
                        else warning = `\x1b[31mARGS: ${JSON.stringify(functionArgs)}\x1b[0m`;

                        console.log(`\n\x1b[33m⚠️  DANGEROUS OPERATION DETECTED:\x1b[0m`);
                        console.log(warning);

                        const answer = await new Promise(resolve => {
                            rl.question(`\x1b[33mAllow ${functionName}? (y/N/d[ry-run]): \x1b[0m`, resolve);
                        });
                        
                        const input = answer.trim().toLowerCase();
                        if (input === 'y') toolResult = await availableToolsfunctionName;
                        else if (input === 'd') toolResult = "Dry run: Tool execution simulated successfully. No changes made.";
                        else toolResult = "User denied tool execution.";
                    } else {
                        toolResult = await availableToolsfunctionName;
                    }

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
          console.error(`\n\x1b[31mError: ${error.message}\x1b[0m`);
          console.log(`\x1b[90mThe session is still active. Please try again.\x1b[0m`);
        }

        process.stdout.write('\n');
        rl.prompt();
    });
}

main();
