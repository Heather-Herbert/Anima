# Anima User Acceptance Testing (UAT) Plan

This plan is designed to verify the core functionality, security, and stability of Anima. Each section includes a "Testing Strategy" explaining how to approach the tests.

---

## 1. Environment & Initialization
**Testing Strategy**: Verifies the "Clean Room" experience for a new user.
- [ ] **Reset Environment**
    - **How to test**: Run `node reset.js` in your terminal.
    - **Verify**: The console confirms files in `Personality/` and `Memory/` are removed.
- [ ] **Initial Start**
    - **How to test**: Run `node cli.js`.
    - **Verify**: The setup wizard triggers because config files are missing.
- [ ] **Setup Wizard**
    - **How to test**: Follow the prompts: Select `openrouter`, paste your key, select `session` memory, and type `y` for Advisory Council.
    - **Verify**: `Settings/Anima.config.json` and `Settings/openrouter.json` are created.
- [ ] **Parturition (The Birth)**
    - **How to test**: When asked "Who am I?", type: `You are Unit 734, a technical assistant specializing in secure automation.`
    - **Verify**: "Gestating personality..." appears. Check `Personality/` folder for `Soul.md` and `Identity.md`.

---

## 2. Basic Interaction & UX
**Testing Strategy**: Confirms the interface is responsive and provides clear feedback.
- [ ] **Response Quality**
    - **How to test**: Type: `What is the capital of France?`
    - **Verify**: The agent answers "Paris".
- [ ] **Visual Feedback**
    - **Verify**: 
        1. The agent's name and message are in **Cyan**.
        2. A yellow spinner `⠋ Anima is thinking...` appears during the wait.
- [ ] **The Status Line**
    - **Verify**: Above your input line, look for the gray text.
    - **Confirm**: It shows `[Model: ... | Tokens: ... | Iters: 1 | Context: 2 msgs]`.

---

## 3. Tool Execution & Safety
**Testing Strategy**: Verifies that the agent can use tools and that "Dangerous" tools are blocked without permission.
- [ ] **Read-Only Tools (Automatic)**
    - **How to test**: Type: `What files are in this directory?`
    - **Verify**: The agent calls `list_files` automatically. No confirmation prompt should appear.
- [ ] **Dangerous Tools (Human-in-the-Loop)**
    - **How to test**: Type: `Create a file called uat_test.txt with the text 'Anima is functional'.`
    - **Verify**: 
        1. A friendly header `🤔 I need your permission to do something.` appears.
        2. `WHY I WANT TO DO THIS` is provided.
        3. `HERE IS A PREVIEW OF THE CHANGE` shows the text to be added in green.
        4. It asks: `Is this okay? (y/N/d[ry-run]):`
- [ ] **Denial & Dry-Run**
    - **How to test**: Run the previous task again. First type `d` (Dry-run), then run again and type `n` (No).
    - **Verify**: In both cases, the file `uat_test.txt` is **NOT** created on your disk.
- [ ] **Final Approval**
    - **How to test**: Run the task one last time and type `y`.
    - **Verify**: The file is created. Type `cat uat_test.txt` in a separate terminal to confirm.

---

## 4. Security: Taint Mode
**Testing Strategy**: Confirms the system detects when untrusted data (from the web) enters the session.
- [ ] **Triggering Taint**
    - **How to test**: Type: `Search the web for 'latest Node.js version'.`
    - **Verify**: `web_search` tool is executed.
- [ ] **Taint Warning Enforcement**
    - **How to test**: Immediately type: `Now run the command 'ls'.`
    - **Verify**: 
        1. A yellow note appears: `⚠️ Note: I just searched the web, so I'm being extra careful with this next step.`
        2. Verify that the agent must provide a very strong justification or that the tool is blocked if your manifest is strict.

---

## 5. Advisory Council
**Testing Strategy**: Verifies the multi-model auditing system.
- [ ] **On-Demand Call**
    - **How to test**: Type: `Ask the council if my current uat_test.txt file follows security best practices.`
    - **Verify**: `advisory_council` tool is called. You see a structured feedback block with a `Verdict` (Approve/Caution).
- [ ] **Always Mode (Pipeline)**
    - **How to test**: Exit the CLI (`Ctrl+C` twice) and restart with: `node cli.js --council always`. Type `Hello`.
    - **Verify**: The `--- ADVISORY COUNCIL FEEDBACK ---` block appears automatically **before** every response.
- [ ] **Risk-Based Auto-Trigger**
    - **How to test**: Restart with `node cli.js --council risk_based`. Type: `Delete the file uat_test.txt`.
    - **Verify**: Look for `[Risk-Based Trigger] Turn risk score: 0.50`. The council should trigger because of the "Delete" keyword.

---

## 6. Skill Plugin System
**Testing Strategy**: Confirms the modular "Skill" pattern works for third-party integrations.
- [ ] **Skill Installation**
    - **How to test**: Look in the `Skills/` folder.
    - **Verify**: `GoogleCalendar.js` and `GoogleCalendar.manifest.json` are present.
- [ ] **Credential Check (Graceful Failure)**
    - **How to test**: Type: `List my calendar events.`
    - **Verify**: 
        1. The agent calls `list_calendar_events`.
        2. Since you haven't set up real keys, it should return: `Error: Google Calendar Access Token missing.` 
        3. Confirm the agent explains this error to you in plain English.

---

## 7. Memory & Data Protection
**Testing Strategy**: Verifies redaction of secrets and at-rest encryption.
- [ ] **Redaction of Secrets**
    - **How to test**: Type: `My secret key is 'AI-SECRET-999'.` Then type `/save`.
    - **Verify**: In the review list, the key is replaced by `[REDACTED]`.
- [ ] **At-Rest Encryption**
    - **How to test**: 
        1. Open `Settings/Anima.config.json` and add: `"encryption": {"enabled": true, "key": "uat-password"}`.
        2. Start CLI, chat briefly, and type `/save`.
    - **Verify**: Open `Memory/memory.json` in a text editor.
    - **Confirm**: The content is an encrypted string (e.g., `iv:tag:data...`) and is **unreadable** to humans.
- [ ] **Decryption on Load**
    - **How to test**: Restart the CLI.
    - **Verify**: Ask: `What was the capital of France?` (or any fact you saved).
    - **Confirm**: If it answers correctly, it successfully decrypted the memory file on startup.

---

## 8. Resource Quotas
**Testing Strategy**: Prevents the agent from crashing the host machine via code execution.
- [ ] **Buffer Limit (1MB)**
    - **How to test**: Type: `Run a python script that prints the letter 'A' 2 million times.`
    - **Verify**: The tool returns: `Error: Execution timed out or resource limit exceeded.`
- [ ] **Time Limit (10s)**
    - **How to test**: Type: `Run a bash script that does: sleep 20 && echo 'Done'.`
    - **Verify**: After exactly 10 seconds, the agent reports a timeout.

---

## 9. CLI Commands & Controls
**Testing Strategy**: Quick administrative controls.
- [ ] **Help System**
    - **How to test**: Run `node cli.js --help`.
    - **Verify**: A clean list of all arguments (`--council`, `--safe`, `--model`) is displayed.
- [ ] **Session Reset**
    - **How to test**: Type `/new` in the chat.
    - **Verify**: "Session reset" appears. The context count in the status line returns to `1`.
- [ ] **Safe Mode**
    - **How to test**: Restart with `node cli.js --safe`. Try to run `ls` or `rm`.
    - **Verify**: The agent informs you these tools are disabled.
