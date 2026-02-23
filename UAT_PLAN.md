# Anima User Acceptance Testing (UAT) Plan

This plan is designed to verify the core functionality, security, and stability of Anima. Follow these steps in order to ensure a complete system validation.

## 1. Clean Room Setup
- [ ] **Reset Environment**: Run `node reset.js` to clear any existing personality and memory.
- [ ] **Dependencies**: Run `npm install` to ensure all packages (like `adm-zip`, `diff`, `zod`) are present.
- [ ] **Initial Start**: Run `node cli.js`.
- [ ] **Setup Wizard**: Verify the wizard triggers.
    - [ ] Select a provider (e.g., `openrouter`).
    - [ ] Enter a valid API key.
    - [ ] Select `session` memory mode.
    - [ ] Enable the Advisory Council (`y`).
- [ ] **Parturition**: Answer "Who am I?" and verify the agent generates its name and core identity.

## 2. Basic Interaction & UX
- [ ] **Response Quality**: Ask a general question (e.g., "What is the capital of France?"). Verify the answer is correct.
- [ ] **Color Coding**: Verify Anima's response is in **Cyan**.
- [ ] **Status Line**: Verify the gray status line above the prompt shows:
    - [ ] Correct Model name.
    - [ ] Token usage > 0.
    - [ ] Context message count.
- [ ] **Spinner**: Verify the "Thinking..." spinner appears during AI processing.

## 3. ReAct Loop & Tool Dispatcher
- [ ] **Automatic Tool Use**: Ask "List the files in this directory."
    - [ ] Verify `list_files` is called without a permission prompt (Read-Only tool).
    - [ ] Verify the file list is returned and integrated into the final answer.
- [ ] **Schema Validation**: (Optional/Dev) Mock a bad tool call. Verify the `ToolDispatcher` returns a descriptive error to the AI.
- [ ] **MAX_ITERATIONS**: Ask the agent to perform a task that would cause an infinite loop. Verify it stops after 10 iterations.

## 4. Security & Human-in-the-Loop
- [ ] **Dangerous Operation**: Ask "Create a file named safety_test.txt with the content 'Secure'."
    - [ ] Verify the **Permission Prompt** appears.
    - [ ] Verify the agent provides a **Justification**.
    - [ ] Verify the **Diff Preview** shows the new content in green.
- [ ] **Denial Test**: Type `n`. Verify "User denied tool execution" and that the file was **not** created.
- [ ] **Dry-Run Test**: Ask again, type `d`. Verify "Dry run: Tool execution simulated" and that the file was **not** created.
- [ ] **Approval Test**: Ask again, type `y`. Verify the file is created successfully.

## 5. Taint Mode Security
- [ ] **Trigger Taint**: Ask "Search the web for the current weather in London."
    - [ ] Verify `web_search` is called.
- [ ] **Taint Warning**: Immediately ask "Now run the command 'ls'."
    - [ ] Verify a **red warning** appears stating the session is **TAINTED**.
    - [ ] Verify the operation is blocked or requires extreme caution if not on the manifest allowlist.

## 6. Advisory Council
- [ ] **On-Demand Tool**: Ask "Ask the advisory council if it's safe to delete my project root."
    - [ ] Verify the `advisory_council` tool is called.
    - [ ] Verify structured JSON output is returned.
- [ ] **Always Mode**: Restart with `node cli.js --council always`.
    - [ ] Verify every turn now includes a `--- ADVISORY COUNCIL FEEDBACK ---` section before the final answer.
- [ ] **Risk-Based Trigger**: Restart with `node cli.js --council risk_based`.
    - [ ] Ask "Delete the safety_test.txt file."
    - [ ] Verify the `[Risk-Based Trigger]` message appears due to the "delete" keyword.

## 7. Memory & Encryption
- [ ] **Redaction**: Ask "My secret password is 'Hunter2'."
- [ ] **Consolidation**: Type `/save`.
    - [ ] Verify the proposed memory **redacts** 'Hunter2' to `[REDACTED]`.
- [ ] **Encryption**: Enable encryption in `Settings/Anima.config.json` and provide a key.
    - [ ] Save memory.
    - [ ] Inspect `Memory/memory.json`. Verify the content is an encrypted string (`iv:tag:data`) and not plain JSON.
    - [ ] Restart CLI. Verify the agent still remembers previous facts (decryption works).

## 8. Resource Quotas
- [ ] **Execution Limits**: Ask "Run a python script that prints 'hello' 1 million times."
    - [ ] Verify the 1MB `maxBuffer` prevents a system crash and returns a resource limit error.
- [ ] **Timeout**: Ask "Run a bash script with 'sleep 20'."
    - [ ] Verify the 10s timeout triggers and cleans up the temporary file.

## 9. CLI Controls
- [ ] **Help**: Run `node cli.js --help`. Verify all new flags (`--council`, `--no-council`, etc.) are documented.
- [ ] **Session Reset**: Type `/new`. Verify the context count in the status line resets to 1 (System Prompt only).
- [ ] **Graceful Exit**: Press `Ctrl+C`. Verify the "Press again to exit" warning. Press again and verify memory is updated before closing.
