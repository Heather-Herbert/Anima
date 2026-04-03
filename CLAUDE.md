# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
node cli.js              # Run the agent
npm test                 # Run all tests
npm test -- --coverage   # Run tests with coverage
npm test -- --testPathPattern=app/Tools  # Run a single test file
npm run lint             # ESLint check
npm run format           # Prettier auto-format
npm reset                # Reset agent state (clears Memory/, Personality/ generated files)
```

## Workspace Mandates

1. Every update must keep documentation and tests current.
2. Every bug fix or UAT failure must include a specific regression test to prevent recurrence.
3. Focus on security at all times.

## Architecture

### Entry Point & Core Loop

`cli.js` is the main entry point. It handles CLI argument parsing, initial setup (plugin installation, config loading), the Parturition flow, and drives the interactive read-eval loop. The main conversation logic is delegated to `ConversationService`.

### app/ — Core Services

| File | Responsibility |
|------|---------------|
| `Config.js` | Loads `Settings/Anima.config.json` and provider settings files |
| `Tools.js` | Defines all tool schemas (OpenAI function-calling format) and `availableTools` implementations |
| `ToolDispatcher.js` | Validates LLM arguments against schemas (via Zod), dispatches to `availableTools`, enforces manifest permissions |
| `ConversationService.js` | Orchestrates the ReAct loop (Thought → Action → Observation, max 10 iterations), Advisory Council integration, sliding-window context management, taint tracking |
| `Utils.js` | `callAI()` (calls provider via isolated subprocess), `redact()`, `isPathAllowed()`, crypto helpers |
| `ProviderRunner.js` | Spawns LLM provider plugins in isolated child processes |
| `ParturitionService.js` | First-run identity generation: reads `Personality/Parturition.md`, generates `Identity.md` and `Soul.md` |
| `EvolutionService.js` | Shadow-tests identity changes against `npm test` before committing; auto-rollback on failure |
| `AdvisoryService.js` | Manages the Advisory Council (always/risk-based/on-demand modes) |
| `AnalysisService.js` | Runs periodic lint/code-debt analysis (every 5 turns) |
| `ReflectionService.js` | Daily self-reflection and failure logging |
| `AuditService.js` | Append-only `Memory/audit.log` — logs every tool call with redacted args and output hashes |
| `PatchService.js` | Automated Patching Loop for self-repair |

### Plugins/ — LLM Providers

Each provider is a pair: `ProviderName.js` + `ProviderName.manifest.json`. Providers run in isolated processes via `ProviderRunner.js`. The manifest controls which tools and filesystem paths the provider can access. Missing manifest → read-only mode.

Supported: `Anthropic`, `OpenAI`, `Gemini`, `DeepSeek`, `OpenRouter`, `Ollama`, `OpenClaw`.

### Skills/ — Tool Plugins

Skills are portable tool bundles: `SkillName.js` + `SkillName.manifest.json`. Auto-loaded at startup. Each `.js` exports `{ implementations }`. Available skills: `A2A` (agent-to-agent), `Database`, `GoogleCalendar`, `OpenClawBridge`.

### Key Security Patterns

- **Protected paths**: `Plugins/`, `Memory/`, `Personality/` are read-only by default; modifications require explicit justification and user confirmation (enforced in `ConversationService.isProtectedPath()`).
- **Taint mode**: After `web_search`, the session is marked tainted — `run_command` and `execute_code` are restricted until `decontaminate` is called.
- **No shell**: Commands use `spawn`, not `exec`, to prevent shell injection.
- **Path validation**: All filesystem tools call `isPathAllowed()` from `Utils.js`, locked to `workspaceDir`.
- **Input delimiters**: User input is wrapped in `<user_input>` tags in system prompts.
- **Redaction**: Use `redact()` from `Utils.js` for any output that might contain secrets.

### Adding a New Tool

1. Add tool schema to the `tools` array in `app/Tools.js` (OpenAI function-calling format). Include a `justification` parameter if the tool is dangerous.
2. Add implementation to the `availableTools` object in the same file.
3. The `ToolDispatcher` handles validation automatically.

### Adding a New LLM Provider

1. Create `Plugins/MyProvider.manifest.json` with `name` and `capabilities`.
2. Create `Plugins/MyProvider.js` exporting a `completion(messages, tools)` async function.

### Advisory Council

Configured in `Settings/Anima.config.json` under `advisoryCouncil`. Adviser prompts live in `Personality/Advisers/*.md`. Modes: `always`, `risk_based`, `on_demand`, `off`. Council memos are excluded from long-term memory by default.

### Memory & Personality Files

- `Memory/memory.md` — consolidated long-term facts (appended at session end)
- `Memory/*.json` — full session history logs
- `Memory/audit.log` — append-only security audit log
- `Personality/Identity.md` — agent's current identity (evolved by `EvolutionService`)
- `Personality/Soul.md` — agent's core directives
- `Personality/Parturition.md` — bootstrap config for first-run identity generation
