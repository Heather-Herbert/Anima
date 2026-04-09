# Anima Roadmap

Ordered by priority: token efficiency first (immediate ROI on every run), then capability gaps that unlock the core use cases, then security hardening, then stretch features.

---

## Tier 1 — Token Efficiency (do these first, every run benefits)

| # | Issue | Why now |
|---|-------|---------|
| 1 | [#65 Truncate userMessage and mainDraft in advisory context](https://github.com/Heather-Herbert/Anima/issues/65) | Multiplied by adviser count — compounds quickly. |
| 2 | [#64 Compress health reports before sending to LLM](https://github.com/Heather-Herbert/Anima/issues/64) | Pretty-printed JSON sent to every adviser and reflection prompt. |
| 3 | [#68 Raise compaction threshold and batch self-verification](https://github.com/Heather-Herbert/Anima/issues/68) | Compaction fires too eagerly; verification is one call per tool. |
| 4 | [#66 Reduce token cost of Evolution LLM call](https://github.com/Heather-Herbert/Anima/issues/66) | Full conversation including tool outputs sent to evolution check. |
| 5 | [#67 Gate recipe hints on confidence threshold and first-turn only](https://github.com/Heather-Herbert/Anima/issues/67) | Steps injected every turn even mid-recipe. |
| 6 | [#72 Per-turn token usage logging](https://github.com/Heather-Herbert/Anima/issues/72) | Needed to verify efficiency improvements work and catch regressions. |
| 7 | [#69 Per-session token budget and cost cap](https://github.com/Heather-Herbert/Anima/issues/69) | Enforces efficiency as a hard constraint, not just a guideline. Feeds statusline. |

---

## Tier 2 — Core Capability (unlocks the stated use cases)

| # | Issue | Why now |
|---|-------|---------|
| 9  | [#74 Bootstrap user model from existing AI assistant personality files](https://github.com/Heather-Herbert/Anima/issues/74) | Parturition should learn from Claude/Gemini/etc. memory files so the user doesn't start cold. |
| 10 | [#71 Skill testing pattern (fixtures/stub mode)](https://github.com/Heather-Herbert/Anima/issues/71) | Establish before building any new skills — retrofitting four skills is painful. |
| 10 | [#70 Unified credential management](https://github.com/Heather-Herbert/Anima/issues/70) | Set the pattern before skills multiply. Inconsistent credentials become a security risk. |
| 11 | [#56 Email skill](https://github.com/Heather-Herbert/Anima/issues/56) | Admin assistant use case is blocked without it. Most fundamental missing primitive. |
| 12 | [#61 Prefer CLI tool wrappers over MCP](https://github.com/Heather-Herbert/Anima/issues/61) | Architectural principle that should guide all new skill work. Set this before building more skills. |
| 13 | [#73 Workspace file locking for concurrent access](https://github.com/Heather-Herbert/Anima/issues/73) | Must be in place before AnimaScript (#60) introduces background/foreground concurrency. |
| 14 | [#60 Proactive wake-up + AnimaScript](https://github.com/Heather-Herbert/Anima/issues/60) | Zero-token background monitoring. Unlocks scheduled tasks, inbox watching, post scheduling. |
| 15 | [#62 Configurable statusline](https://github.com/Heather-Herbert/Anima/issues/62) | Makes token burn and agent state visible. Reinforces efficiency discipline. |
| 16 | [#57 Finance skill](https://github.com/Heather-Herbert/Anima/issues/57) | Bookkeeping use case. No external dependency needed for MVP (local ledger files). |
| 17 | [#58 Social media skill](https://github.com/Heather-Herbert/Anima/issues/58) | Social media use case. Start with Mastodon (open API, no approval process). Depends on #60 for scheduling. |
| 18 | [#59 Design skill](https://github.com/Heather-Herbert/Anima/issues/59) | Design use case. MVP is just Mermaid + Graphviz CLI wrappers — low effort, zero API cost. |

---

## Tier 3 — Security Hardening

| # | Issue | Why now |
|---|-------|---------|
| 19 | [#51 Dynamic Tool Pool Assembly](https://github.com/Heather-Herbert/Anima/issues/51) | Session-scoped tool filtering. Reduces attack surface and also cuts token cost (fewer tools in context). |
| 20 | [#49 Permission Audit Trail](https://github.com/Heather-Herbert/Anima/issues/49) | First-class permission state. Needed before adding more external-facing skills (#56, #58). |
| 21 | [#37 Containerized Tool Execution](https://github.com/Heather-Herbert/Anima/issues/37) | Docker/WASM sandbox. Important but complex — do after the efficiency and capability work stabilises. |
| 22 | [#38 Encrypted Long-term Memory](https://github.com/Heather-Herbert/Anima/issues/38) | Personal data protection. Pair with #56 (email) since that skill will touch sensitive content. |

---

## Tier 4 — Stretch / Infrastructure

| # | Issue | Why |
|---|-------|-----|
| 23 | [#41 Pluggable Knowledge Store](https://github.com/Heather-Herbert/Anima/issues/41) | Useful for enterprise deployments. Not needed for core personal use cases. |
| 24 | [#47 Structured Streaming Events](https://github.com/Heather-Herbert/Anima/issues/47) | Nice for integrations and the statusline (#62). Do after statusline is working. |
| 25 | [#39 Rust bridge for filesystem ops](https://github.com/Heather-Herbert/Anima/issues/39) | Premature optimisation. Node fs is not the bottleneck. Revisit if profiling proves otherwise. |
