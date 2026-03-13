# Getting Started with Anima

Welcome to Anima! This guide will help you get up and running even if you've never used a command-line tool like this before.

## Prerequisites

Before you start, make sure you have the following installed on your computer:

1.  **Node.js (Version 18 or higher)**: This is the engine that runs Anima.
    - Download it from [nodejs.org](https://nodejs.org/).
    - Choose the "LTS" (Long Term Support) version.
2.  **Git**: This is used to download (clone) the Anima code.
    - Download it from [git-scm.com](https://git-scm.com/).
3.  **An API Key**: Anima needs to talk to an AI "brain" (like OpenAI or OpenRouter).
    - If you're new, we recommend creating an account at [OpenRouter.ai](https://openrouter.ai/) and adding a small amount of credit (e.g., $5).

## 1. Installation

Open your terminal (Command Prompt on Windows, Terminal on Mac/Linux) and run these commands one by one:

```bash
# Download the project
git clone https://github.com/Heather-Herbert/Anima.git

# Move into the folder
cd Anima

# Install the necessary components
npm install
```

## 2. Initial Setup

Start Anima for the first time by running:

```bash
node cli.js
```

Anima will detect that it's the first run and start a **Setup Wizard**:

1.  **Select Provider**: Choose your AI provider (e.g., `openrouter`, `openclaw`).
2.  **Enter API Key**: Paste the key you got from your provider.
3.  **Memory Mode**: Choose `session` (saves history for the current chat) or `longterm` (learns over time). We recommend `session` to start.
4.  **Advisory Council**: Type `y` if you want a second AI to check the first one's work for safety.

### Where is my key saved?

After the wizard finishes, your key is saved in a "Config File" (a simple text file) so you don't have to type it every time.

- **The Folder**: Open the `Settings` folder inside your Anima folder.
- **The File**: You will see a file named after your provider (like `openrouter.json`, `openai.json`, or `openclaw.json`).
- **How to edit it**: If you ever need to change your key, right-click that file and choose **"Open with..."** then select **Notepad** (on Windows) or **TextEdit** (on Mac).
- **The Content**: You will see your key inside the quotes after `"apiKey"`. Just paste your new key there, save the file, and restart Anima!

## 3. Basic Usage

Once the setup is done, you can start talking to Anima!

- **Ask Questions**: "What files are in this folder?"
- **Give Tasks**: "Create a new file called hello.txt with the text 'Hi Anima'."
- **Safety Checks**: If Anima wants to do something "dangerous" (like deleting a file), it will ask your permission. Type `y` to allow or `n` to stop it.

### Useful Commands

Type these directly into the chat:
- `/new`: Start a fresh conversation (wipes the current context).
- `/save`: Review and save important facts to long-term memory.
- `Ctrl+C`: Press once to cancel, or twice quickly to exit.

## 4. A2A Collaboration

Anima can discover and talk to other Anima instances or OpenClaw agents on your network.

- **Discovery**: Ask Anima to "discover agents" to find other AI peers.
- **Pairing Flow**: For security, connections require mutual consent.
  - If a peer tries to connect, you will see a **Pairing Request**.
  - Use the tool `manage_peers` with the `list` action to see requests.
  - Use `manage_peers` with `approve` and the `id` to establish trust.
- **Tiered Disclosure**: Once paired, you can set a peer's disclosure level to `public` (shared safe info) or `full` (shares your full Identity and Soul).
- **Learning**: Anima can "learn" from trusted agents to refine its personality and skills.
- **Collaboration**: Agents can delegate tasks to each other to help you.
- **Token Efficient**: Agents use a special "sub-agent" mode to talk to each other concisely, saving you tokens and credits.

## 5. Safety Modes

If you want to play it safe, you can start Anima in special modes:

```bash
# Read-Only: Anima can look but can't touch anything
node cli.js --read-only

# Safe Mode: Anima can write files but can't run system commands
node cli.js --safe
```

## Troubleshooting

- **"Command not found"**: Ensure you installed Node.js and restarted your terminal.
- **API Errors**: Check your API key and ensure you have credits with your provider.
- **Permission Denied**: On Linux/Mac, you might need to check folder permissions, but usually running within your Documents folder is fine.

Enjoy your new digital companion!
