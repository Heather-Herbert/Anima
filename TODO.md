# Anima Testing Checklist

## Setup
- [ ] Run `npm install` to ensure dependencies are available.
- [ ] Create `Anima.config` with valid OpenRouter/OpenAI credentials.
- [ ] Ensure `persona/main.md` exists.

## CLI Interaction
- [ ] Start the CLI: `node cli.js`
- [ ] Verify initial prompt: "Anima CLI - Press Ctrl+C twice to quit."
- [ ] Type a message and press Enter.
- [ ] Verify AI response is received and displayed.
- [ ] Verify "Anima is thinking..." indicator appears while waiting.
- [ ] Verify AI output is colored (Cyan).

## Memory System
- [ ] Check directory for a new `memory-YYYY-MM-DD-....json` file after starting.
- [ ] Verify the JSON file contains the conversation history (System, User, Assistant).
- [ ] Restart the CLI and ensure a **new** memory file is created (no history carry-over from previous run).

## Commands
- [ ] Type `/new` during a session.
    - [ ] Verify "Session reset." message.
    - [ ] Verify a new `memory-....json` file is created immediately.
    - [ ] Verify conversation history is cleared (except for System prompt).

## Persona
- [ ] Edit `persona/main.md`.
- [ ] Run `/new` or restart CLI.
- [ ] Verify the system prompt loading message: "Loaded system prompt from X file(s)."

## Tool Usage (Read-Only)
- [ ] **List Files**: Ask "List files in this directory".
    - [ ] Verify `list_files` tool is executed automatically (no prompt).
    - [ ] Verify file list is returned.
- [ ] **Read File**: Ask "Read the content of README.md".
    - [ ] Verify `read_file` tool is executed automatically.
    - [ ] Verify content is displayed.
- [ ] **File Info**: Ask "Get info about package.json".
    - [ ] Verify `file_info` tool is executed automatically.
- [ ] **Search Files**: Ask "Search for 'TODO' in this directory".
    - [ ] Verify `search_files` tool is executed automatically.

## Tool Usage (Dangerous / Safety Checks)
- [ ] **Write File**: Ask "Create a file named test.txt with text 'hello'".
    - [ ] Verify prompt: `Allow write_file with args ...? (y/N):`
    - [ ] Test Denial: Type `n`. Verify "User denied tool execution."
    - [ ] Test Approval: Ask again, type `y`. Verify file is created.
- [ ] **Run Command**: Ask "Run the command 'ls -la'".
    - [ ] Verify prompt: `Allow run_command ...?`
    - [ ] Confirm `y`. Verify output.
- [ ] **Execute Code**: Ask "Write and run a python script that calculates 5+5".
    - [ ] Verify prompt: `Allow execute_code ...?`
    - [ ] Confirm `y`. Verify result "10".
- [ ] **Delete File**: Ask "Delete the test.txt file".
    - [ ] Verify prompt: `Allow delete_file ...?`
    - [ ] Confirm `y`. Verify file is deleted.

## Exit Handling
- [ ] Press `Ctrl+C` once. Verify warning: "Press Ctrl+C again to exit."
- [ ] Press `Ctrl+C` twice. Verify application exits.