# Anima CLI

An intelligent, CLI-based AI agent designed with persistent memory, system tool capabilities, and a unique personality generation process.

## Features

### 1. Parturition (Birth) Process
Upon the first run, if the agent has not yet been initialized, it enters a "Parturition" sequence.
- It checks for a `Personality/Parturition.md` file.
- It asks the user a defining question ("Who am I?").
- Using the genetic configuration and user input, it generates its own **Soul** (`Soul.md`) and **Identity** (`Identity.md`).
- Once "born," the bootstrap file is removed, and the agent is ready.

### 2. Persistent Memory
The agent possesses long-term memory capabilities.
- **Session Logs**: Every conversation is logged as a JSON file in the `Memory/` directory.
- **Consolidation**: At the end of a session (or via the `/save` command), the agent analyzes the conversation to extract important facts, preferences, and self-corrections. These are appended to `Memory/memory.md`, which is fed back into the context on subsequent runs.

### 3. Tool Integration
The agent can interact with the local system using defined tools. Dangerous actions require explicit user confirmation (y/N).
- **File Operations**: Read, write, delete, list, and search files.
- **Code Execution**: Execute JavaScript, Python, or Bash scripts.
- **System Commands**: Run shell commands.

## Directory Structure

- **`app/`**: Core application logic.
  - `Config.js`: Loads settings.
  - `Tools.js`: Defines available tools and their implementations.
  - `ParturitionService.js`: Handles the initialization/birth logic.
- **`Personality/`**: Stores Markdown files defining the agent's persona (`Soul.md`, `Identity.md`, etc.).
- **`Memory/`**: Stores conversation history and long-term memory.
- **`Settings/`**: Configuration location.

## Configuration

The application expects a configuration file at `../Settings/Anima.config` (relative to the app folder) containing JSON settings for the LLM endpoint:

```json
{
  "endpoint": "https://api.openai.com/v1/chat/completions",
  "apiKey": "sk-...",
  "model": "gpt-4"
}
```

## Usage

Run the application via Node.js:

```bash
node cli.js
```

### In-App Commands
- **`/new`**: Resets the current conversation context (starts a fresh session).
- **`/save`**: Forces an immediate memory consolidation update.
- **`Ctrl+C`**:
  - Press once to see a prompt to exit.
  - Press twice to exit and save memory.