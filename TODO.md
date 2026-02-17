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

## Exit Handling
- [ ] Press `Ctrl+C` once. Verify warning: "Press Ctrl+C again to exit."
- [ ] Press `Ctrl+C` twice. Verify application exits.