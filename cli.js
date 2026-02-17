const fs = require('node:fs');
const readline = require('node:readline');
const path = require('node:path');
const { exec, execFile } = require('node:child_process');
const ParturitionService = require('./Personality/ParturitionService');

// Load configuration
const configPath = path.join(__dirname, 'Settings', 'Anima.config');
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

// Define available tools
const tools = [
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a file with content",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file" },
          content: { type: "string", description: "Content to write" }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Execute a shell command",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command to execute" }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and directories in a specific path",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to list (default: .)" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search for a text pattern in files within a directory",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to search in (default: .)" },
          term: { type: "string", description: "The text or regex pattern to search for" }
        },
        required: ["term"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "execute_code",
      description: "Execute code in a specific language (creates a temp file and runs it)",
      parameters: {
        type: "object",
        properties: {
          language: { type: "string", description: "Language to use (javascript, python, bash)" },
          code: { type: "string", description: "The code to execute" }
        },
        required: ["language", "code"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "file_info",
      description: "Get metadata about a file (size, creation time, etc.)",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file" }
        },
        required: ["path"]
      }
    }
  }
];

const availableTools = {
  write_file: async ({ path: filePath, content }) => {
    try {
      const fullPath = path.resolve(process.cwd(), filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
      return `File ${filePath} written successfully.`;
    } catch (e) {
      return `Error writing file: ${e.message}`;
    }
  },
  read_file: async ({ path: filePath }) => {
     try {
      const fullPath = path.resolve(process.cwd(), filePath);
      if (!fs.existsSync(fullPath)) return `File not found: ${filePath}`;
      return fs.readFileSync(fullPath, 'utf8');
    } catch (e) {
      return `Error reading file: ${e.message}`;
    }
  },
  run_command: async ({ command }) => {
    return new Promise((resolve) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                resolve(`Error: ${error.message}\nStderr: ${stderr}`);
            } else {
                resolve(stdout || stderr || "Command executed successfully.");
            }
        });
    });
  },
  list_files: async ({ path: dirPath = '.' }) => {
    try {
      const fullPath = path.resolve(process.cwd(), dirPath);
      if (!fs.existsSync(fullPath)) return `Path not found: ${dirPath}`;
      
      const items = fs.readdirSync(fullPath, { withFileTypes: true });
      const formatted = items.map(item => item.isDirectory() ? `${item.name}/` : item.name).join('\n');
      return formatted || "(empty directory)";
    } catch (e) {
      return `Error listing files: ${e.message}`;
    }
  },
  search_files: async ({ path: dirPath = '.', term }) => {
    return new Promise((resolve) => {
      execFile('grep', ['-rnI', '-e', term, dirPath], (error, stdout, stderr) => {
        if (error && error.code === 1) {
          resolve("No matches found.");
        } else if (error) {
          resolve(`Error searching files: ${error.message}`);
        } else {
          resolve(stdout);
        }
      });
    });
  },
  execute_code: async ({ language, code }) => {
    try {
      const timestamp = Date.now();
      let filename, command;
      
      switch(language.toLowerCase()) {
          case 'javascript':
          case 'js':
          case 'node':
              filename = `temp_${timestamp}.js`;
              command = `node ${filename}`;
              break;
          case 'python':
          case 'py':
              filename = `temp_${timestamp}.py`;
              command = `python3 ${filename}`;
              break;
          case 'bash':
          case 'sh':
              filename = `temp_${timestamp}.sh`;
              command = `bash ${filename}`;
              break;
          default:
              return "Unsupported language. Supported: javascript, python, bash.";
      }
      
      const fullPath = path.resolve(process.cwd(), filename);
      fs.writeFileSync(fullPath, code);
      
      return new Promise((resolve) => {
          exec(command, (error, stdout, stderr) => {
              try { fs.unlinkSync(fullPath); } catch(e) {}
              if (error) {
                  resolve(`Error: ${error.message}\nStderr: ${stderr}`);
              } else {
                  resolve(stdout || stderr || "Code executed successfully.");
              }
          });
      });
    } catch (e) {
      return `Error executing code: ${e.message}`;
    }
  },
  file_info: async ({ path: filePath }) => {
    try {
      const fullPath = path.resolve(process.cwd(), filePath);
      if (!fs.existsSync(fullPath)) return `File not found: ${filePath}`;
      const stats = fs.statSync(fullPath);
      return JSON.stringify({
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        isDirectory: stats.isDirectory()
      }, null, 2);
    } catch (e) {
      return `Error getting file info: ${e.message}`;
    }
  },
  delete_file: async ({ path: filePath }) => {
    try {
      const fullPath = path.resolve(process.cwd(), filePath);
      if (!fs.existsSync(fullPath)) return `File not found: ${filePath}`;
      fs.unlinkSync(fullPath);
      return `File ${filePath} deleted successfully.`;
    } catch (e) {
      return `Error deleting file: ${e.message}`;
    }
  }
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
  return path.join(__dirname, 'Memory', `memory-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
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
        process.stdout.write(`\x1b[33m${agentName} is thinking...\x1b[0m\n`);

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
            
            readline.moveCursor(process.stdout, 0, -1);
            readline.clearLine(process.stdout, 0);
            console.log(`\x1b[33mExecuting ${message.tool_calls.length} tool(s)...\x1b[0m`);

            for (const toolCall of message.tool_calls) {
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
                ? await availableToolsfunctionName
                : "User denied tool execution.";

                conversationHistory.push({
                role: "tool",
                tool_call_id: toolCall.id,
                name: functionName,
                content: toolResult
                });
            }
            process.stdout.write(`\x1b[33m${agentName} is thinking...\x1b[0m\n`);
            } else {
            readline.moveCursor(process.stdout, 0, -1);
            readline.clearLine(process.stdout, 0);

            const reply = message.content || JSON.stringify(data, null, 2);
            conversationHistory.push({ role: "assistant", content: reply });
            fs.writeFileSync(historyPath, JSON.stringify(conversationHistory, null, 2));

            console.log(`\x1b[36m${agentName}: ${reply}\x1b[0m`);
            processing = false;
            }
        }
        } catch (error) {
        readline.moveCursor(process.stdout, 0, -1);
        readline.clearLine(process.stdout, 0);
        console.error('Error:', error.message);
        }

        process.stdout.write('\n');
        rl.prompt();
    });
}

main();