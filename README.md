# Anima CLI

Anima is a command-line AI agent interface designed to evolve with you. It features persistent memory, tool execution capabilities, and a unique "parturition" (birth) process that defines its personality and core directives based on your initial interaction.

## Features

- **Persistent Memory**:
  - **Short-term**: Session history is saved automatically to JSON files in `Memory/`.
  - **Long-term**: Important facts and insights are consolidated into `Memory/memory.md` upon exit or manual save.
- **Tool Execution**: The agent can interact with your system (read/write files, run shell commands, execute code) with user confirmation for safety.
- **Parturition Service**: On the first run, the agent generates its own Identity (`Identity.md`) and Soul (`Soul.md`) based on user input.
- **Flexible Configuration**: Supports custom endpoints (OpenAI, OpenRouter, etc.) and model selection via config or CLI arguments.

## Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd Anima
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

## Configuration

1. Create a configuration file in the root directory. You can use `Anima.config.js` or `Anima.config.json`.
2. Use the provided example as a template:
   ```bash
   cp Anima.config.example Anima.config.json
   ```
3. Edit the file with your API details:
   ```json
   {
     "endpoint": "https://api.openai.com/v1/chat/completions",
     "apiKey": "YOUR_API_KEY_HERE",
     "model": "gpt-4-turbo-preview"
   }
   ```

## Usage

Start the CLI:
```bash
node cli.js
```

### CLI Arguments

- `--model <name>`: Override the model defined in the config file for this session.
- `--help`, `-h`: Display help information.

### In-Chat Commands

- `/save`: Force a memory consolidation update immediately.
- `/new`: Reset the current conversation context (starts a fresh session).
- `Ctrl+C`: Press once to see exit options, press again to save memory and exit.

## Capabilities

### Tools
The agent has access to the following tools defined in `app/Tools.js`. Dangerous operations require user confirmation (y/N).

- `write_file`: Create or overwrite files.
- `read_file`: Read file contents.
- `run_command`: Execute shell commands.
- `list_files`: List directory contents.
- `search_files`: Grep search within files.
- `execute_code`: Run Python, JavaScript, or Bash code in a temporary environment.
- `file_info`: Get metadata about a file.
- `delete_file`: Remove a file.

### Memory System
The system automatically manages context:
1. **Loading**: On startup, it loads personality files from `Personality/*.md` and long-term memory from `Memory/memory.md`.
2. **Consolidation**: When the session ends, the AI analyzes the conversation to extract important facts about the User, the Agent, and the World, appending them to `Memory/memory.md`.

### Parturition (Initialization)
If `Personality/Soul.md` or `Personality/Identity.md` are missing, the system enters "Parturition Mode":
1. It asks "Who am I?".
2. Based on your answer and the genetic configuration in `Personality/Parturition.md`, it generates its own name, role, and core directives.
3. It saves these to the `Personality/` directory and deletes the bootstrap file.

## Project Structure

- `cli.js`: Main entry point and loop.
- `app/Config.js`: Configuration loader with validation (Zod).
- `app/Tools.js`: Tool definitions and implementations.
- `app/ParturitionService.js`: Logic for agent initialization.
- `app/Utils.js`: API communication helper.
- `Memory/`: Stores session logs and consolidated memory.
- `Personality/`: Stores system prompts and identity files.