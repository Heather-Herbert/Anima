# Anima CLI

[![Lint](https://github.com/HeatherHerbert/Anima/actions/workflows/lint.yml/badge.svg)](https://github.com/HeatherHerbert/Anima/actions/workflows/lint.yml)
[![Test](https://github.com/HeatherHerbert/Anima/actions/workflows/test.yml/badge.svg)](https://github.com/HeatherHerbert/Anima/actions/workflows/test.yml)

Anima is a command-line AI agent interface designed to evolve with you. It features persistent memory, tool execution capabilities, a unique "parturition" (birth) process, and a flexible **Plugin-based LLM Provider** architecture with manifest-level security.

## Features

- **Persistent Memory**:
  - **Short-term**: Session history is saved automatically to JSON files in `Memory/`.
  - **Long-term**: Important facts and insights are consolidated into `Memory/memory.md` upon exit or manual save.
- **Plugin-based LLM Providers**: Supports multiple AI providers (OpenRouter, Ollama, etc.) through a modular plugin system.
- **Manifest-level Security**: Tools and filesystem access are governed by provider-specific manifests, ensuring safe execution environments.
- **Tool Execution**: The agent can interact with your system (read/write/replace files, run shell commands, execute code, search the web) with user confirmation and dry-run support.
- **Parturition Service**: On the first run, the agent generates its own Identity (`Identity.md`) and Soul (`Soul.md`) based on user input.
- **Flexible Configuration**: Select providers and models via config files in the `Settings/` directory or CLI arguments.

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
   *Note: Node.js 18+ is required (tested on v22) for native fetch and module support.*

## Configuration

1. **Primary Config**: Create `Settings/Anima.config.js` or `Settings/Anima.config.json`.
   ```json
   {
     "LLMProvider": "openrouter"
   }
   ```
2. **Provider Settings**: Individual providers may require their own settings files in `Settings/` (e.g., `openrouter.json`, `ollama.json`).
   ```json
   {
     "apiKey": "YOUR_API_KEY_HERE",
     "model": "google/gemini-pro-1.5"
   }
   ```

## Usage

Start the CLI:
```bash
node cli.js
```

### CLI Arguments

- `--model <name>`: Override the model defined in the provider settings for this session.
- `--add-plugin <path|url>`: Install a plugin from a local JS file or a URL to a `.zip` archive.
- `--help`, `-h`: Display help information.

### In-Chat Commands

- `/save`: Force a memory consolidation update immediately.
- `/new`: Reset the current conversation context (starts a fresh session).
- `Ctrl+C`: Press once to see exit options, press again to save memory and exit.

## Capabilities

### Tools
The agent has access to a variety of tools. Dangerous operations require user confirmation (**y** to allow, **N** to deny, **d** for a simulated dry-run).

- `write_file`: Create or overwrite files.
- `read_file`: Read file contents.
- `replace_in_file`: Perform regex-based text replacements within a file.
- `run_command`: Execute shell commands.
- `list_files`: List directory contents.
- `search_files`: Grep-style search within files.
- `execute_code`: Run Python, JavaScript, or Bash code in a temporary environment.
- `web_search`: Search the web using DuckDuckGo.
- `file_info`: Get metadata about a file.
- `delete_file`: Remove a file.
- `add_plugin`: Install new plugins (agent-initiated).

### Provider Manifests
Plugins are accompanied by a `.manifest.json` file which defines:
- **Capabilities**: Which tools the provider is allowed to use.
- **Permissions**: Filesystem access restrictions (read/write paths).
- **Security**: The CLI enforces these constraints at runtime.

### Memory System
The system automatically manages context:
1. **Loading**: On startup, it loads personality files from `Personality/*.md` and long-term memory from `Memory/memory.md`.
2. **Consolidation**: When the session ends, the AI analyzes the conversation to extract important facts, appending them to `Memory/memory.md`.

### Parturition (Initialization)
If `Personality/Soul.md` or `Personality/Identity.md` are missing, the system enters "Parturition Mode":
1. It asks "Who am I?".
2. Based on your answer and the genetic configuration in `Personality/Parturition.md`, it generates its own name, role, and core directives.
3. It saves these to the `Personality/` directory and removes the bootstrap file.

## Project Structure

- `cli.js`: Main entry point and CLI loop.
- `app/`: Core services (`Config.js`, `Tools.js`, `ParturitionService.js`, `Utils.js`).
- `Plugins/`: LLM provider implementations and manifests.
- `Settings/`: Configuration and provider settings.
- `Memory/`: Stores session logs and consolidated memory.
- `Personality/`: Stores system prompts, identity files, and birth configuration.
