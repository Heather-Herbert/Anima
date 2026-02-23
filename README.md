# Anima CLI

[![Lint](https://github.com/HeatherHerbert/Anima/actions/workflows/lint.yml/badge.svg)](https://github.com/HeatherHerbert/Anima/actions/workflows/lint.yml)
[![Test](https://github.com/HeatherHerbert/Anima/actions/workflows/test.yml/badge.svg)](https://github.com/HeatherHerbert/Anima/actions/workflows/test.yml)

Anima is a command-line AI agent interface designed to evolve with you. It features persistent memory, tool execution capabilities, a unique "parturition" (birth) process, and a flexible **Plugin-based LLM Provider** architecture with manifest-level security.

## Features

- **Persistent Memory**:
  - **Short-term**: Session history is saved automatically to JSON files in `Memory/`.
  - **Long-term**: Important facts and insights are consolidated into `Memory/memory.json` after a **User Review** step, where you can accept or reject individual items to prevent prompt injection persistence.
- **Plugin-based LLM Providers**: Supports multiple AI providers (**OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, Ollama**) through a modular plugin system. **Providers run in isolated separate processes** with restricted environment access for maximum security.
- **Manifest-level Security**: Tools and filesystem access are governed by provider-specific manifests, ensuring safe execution environments.
- **Core Directory Protection**: The agent's "spinal cord" (`Plugins/`, `Memory/`, `Personality/`) is **Read-Only by default**. Any attempt to modify these files requires an explicit justification and user confirmation, regardless of manifest settings.
- **Explainable Confirmations**: All dangerous operations require the agent to provide a **Justification**, show exactly what will be **Touched**, and provide a **Diff Preview** for file changes before user approval.
- **Tool Execution**: The agent can interact with your system (read/write/replace files, run shell commands, execute code, search the web) with user confirmation and dry-run support.
- **Parturition Service**: On the first run, the agent generates its own Identity (`Identity.md`) and Soul (`Soul.md`) based on user input.
- **Flexible Configuration**: Select providers and models via config files in the `Settings/` directory or CLI arguments.

## Security & Threat Model

Anima is designed with a **Deny-by-Default** security posture to prevent common AI agent pitfalls such as unintended system destruction or persistent prompt injection.

Key protections include:
- **Process Isolation**: LLM Providers run in separate, isolated processes.
- **Workspace Root**: All filesystem operations are locked to a configurable `workspaceDir` (defaulting to the project root), preventing access to the host system even if the CLI is launched from a sensitive directory.
- **Taint Mode**: If the agent performs a `web_search`, the current turn is marked as "tainted." In this state, command execution and code execution are strictly limited to explicit manifest allowlists to prevent remote prompt injection attacks.
- **Hardened Code Execution**: `execute_code` runs in a dedicated `.temp` directory within the workspace and features a 10s timeout and automatic cleanup.
- **No Shell**: Commands run directly (spawn), avoiding shell injection attacks.
- **Spinal Cord Protection**: Core files (`Plugins/`, `Memory/`, `Personality/`) are read-only by default.
- **Human-in-the-loop**: Structured memory and tool justifications require explicit approval.

For full details on our security architecture, reporting instructions, and sandboxing recommendations, see **[SECURITY.md](SECURITY.md)**.

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

On the first run, Anima will guide you through an automated **Setup Wizard** to configure your preferred LLM provider and API details.

### Manual Configuration

If you prefer to configure manually:

1. **Primary Config**: Create `Settings/Anima.config.json`.
   ```json
   {
     "LLMProvider": "openrouter",
     "heartbeatInterval": 300,
     "workspaceDir": "./my-workspace",
     "memoryMode": "session"
   }
   ```
2. **Provider Settings**: Create a settings file named after your provider (e.g., `openai.json`, `anthropic.json`, `gemini.json`, `deepseek.json`, `openrouter.json`, `ollama.json`) in the `Settings/` directory.
   ```json
   {
     "apiKey": "YOUR_API_KEY_HERE",
     "model": "gpt-4-turbo-preview",
     "endpoint": "https://api.openai.com/v1/chat/completions"
   }
   ```
   *Note: Standard endpoints are automatically provided for major services.*

## Usage

Start the CLI:
```bash
node cli.js
```

### CLI Arguments

- `--model <name>`: Override the model defined in the provider settings for this session.
- `--add-plugin <path|url>`: Install a plugin from a local JS file or a URL to a `.zip` archive.
- `--hash <sha256>`: (Optional) Verify the SHA-256 hash of a remote plugin archive before installation. Highly recommended for production stability.
- `--safe`: Disable all dangerous tools (run_command, write_file, etc.) for this session.
- `--read-only`: Restrict the agent to only use read-only inspection tools.
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
- `run_command`: Execute a system command without a shell (e.g., `git`, `ls`). Features a 30s timeout, 100KB output limit, and strict denylist/allowlist enforcement.
- `list_files`: List directory contents.
- `search_files`: Grep-style search within files.
- `execute_code`: Run Python, JavaScript, or Bash code in a temporary environment.
- `web_search`: Search the web using DuckDuckGo.
- `file_info`: Get metadata about a file.
- `delete_file`: Remove a file.
- `add_plugin`: Install new plugins (agent-initiated).

### Plugin Security

To ensure system integrity, Anima provides multiple layers of plugin security:

- **Isolated Execution**: Providers run in separate processes with restricted environment variables.
- **Provenance Tracking**: Every installed plugin stores its origin (source URL/path, date, and content hash) in a `.provenance.json` file.
- **Audit Logging**: An append-only log (`Memory/audit.log`) records every tool execution, including redacted arguments, user confirmation results, and cryptographic hashes of tool outputs for forensics.
- **Verification**: Remote plugins can be verified against a known SHA-256 hash using the `--hash` argument.
- **Security-First Development**: We follow a strict policy of keeping all documentation and tests up to date with every change, with a continuous focus on system hardening.

## Architecture

### ReAct Loop
Anima implements a **Reasoning and Action (ReAct)** loop. When a user provides input, the agent enter a cycle of thought and execution:
1.  **Thought**: The agent analyzes the current context and decides if a tool call is necessary.
2.  **Action**: If a tool is needed, the agent requests execution.
3.  **Observation**: The result of the tool execution is fed back into the context.
This loop continues until a final answer is produced or a hard limit of **10 iterations** is reached to prevent runaway processes.

### Context Management (Sliding Window)
To manage the LLM's token limit and maintain performance during long-running tasks, Anima uses a **Sliding Window** strategy for conversation history:
-   **Fixed Context**: The initial **System Prompt** and the **Original User Prompt** that started the current task are always preserved.
-   **Intermediary History**: Only the most recent **5 conversational turns** (approx. 10 messages) of tool calls and observations are retained in the active context window.
-   **Auditability**: While the active window is pruned, the full session history is always preserved in `Memory/*.json` files.

### Provider Manifests

Plugins are accompanied by a `.manifest.json` file which defines:

- **Capabilities**: Which tools the provider is allowed to use.
- **Permissions**: Filesystem access restrictions (read/write paths).
- **Security**: The CLI enforces these constraints at runtime. **If a manifest is missing, Anima defaults to a "Read-Only" mode**, allowing only safe inspection tools.

## Development

### Registering New Tools

To add a new capability to Anima, follow these steps in `app/Tools.js`:

1.  **Define the Schema**: Add a new tool definition to the `tools` array. Follow the OpenAI function calling format, including `name`, `description`, and `parameters`.
    ```javascript
    {
      type: 'function',
      function: {
        name: 'my_new_tool',
        description: 'Does something useful',
        parameters: {
          type: 'object',
          properties: {
            arg1: { type: 'string' }
          },
          required: ['arg1']
        }
      }
    }
    ```
2.  **Implement the Logic**: Add a corresponding async function to the `availableTools` object.
    ```javascript
    my_new_tool: async ({ arg1 }, permissions) => {
      // Your implementation here
      return `Result of my_new_tool with ${arg1}`;
    }
    ```
3.  **Validation**: The `ToolDispatcher` automatically validates LLM input against your schema before execution. If validation fails, an error is returned to the agent for self-correction.

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
