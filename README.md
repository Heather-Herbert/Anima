# Anima

An Agentic CLI tool that interacts with LLMs via a configurable endpoint.

## Prerequisites

- Node.js (v18 or higher recommended for native `fetch` support).

## Setup

1.  **Install Dependencies** (Currently none, but good practice):
    ```bash
    npm install
    ```

2.  **Configuration**:
    Create a file named `Anima.config` in the root directory:
    ```json
    {
      "endpoint": "https://openrouter.ai/api/v1/chat/completions",
      "apiKey": "YOUR_API_KEY",
      "model": "openai/gpt-3.5-turbo"
    }
    ```

3.  **Persona**:
    Add Markdown files to the `persona/` directory to define the system prompt.

## Usage

Start the CLI:
```bash
npm start
```

- **Chat**: Type your message and press Enter.
- **Reset**: Type `/new` to start a fresh session (saves old memory to a file).
- **Exit**: Press `Ctrl+C` twice.