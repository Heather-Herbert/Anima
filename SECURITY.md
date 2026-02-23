# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability within Anima, please do not report it via public issues. Instead, email [heather.herbert.1975@gmail.com]. We will acknowledge your report within 48 hours and provide a timeline for a fix.

---

## Security Principles

Anima is built on a strict **Deny-by-Default** architecture. The agent's capabilities are strictly limited by:

1.  **Process Isolation**: LLM Providers run in separate, low-privilege processes.
2.  **Manifest Enforcement**: Providers can only use tools and access filesystem paths explicitly allowed in their `.manifest.json`. **If no manifest is found, Anima defaults to a high-restriction mode (Read-Only).**
3.  **Path Traversal Protection**: All filesystem tools are restricted to the project root and subject to manifest-level allowlists.
4.  **No Shell by Default**: `run_command` executes files directly without a shell to prevent injection attacks.
5.  **Human-in-the-loop**: All "dangerous" operations (including writes to core system directories) require explicit justification and human confirmation with a diff preview.

## Threat Model & User Guidance

### What Anima will NEVER do by default:
-   Execute shell commands through a shell (preventing pipes/redirects unless explicitly wrapped).
-   Modify its own "spinal cord" (`Plugins/`, `Memory/`, `Personality/`) without strong user confirmation.
-   Install or update plugins without showing a manifest and (optionally) verifying a SHA-256 hash.
-   Persist new "Instructions" or "Directives" to long-term memory without user review.

### Recommended Deployment
For maximum security, especially when using experimental plugins:
-   **Run as a low-privilege user**: Create a dedicated `anima` user with access only to the project directory.
-   **Sandbox the process**: Run the CLI inside a container (Docker), a VM, or using OS-level sandboxing (e.g., `firejail`, `bubblewrap`).
-   **Use --safe or --read-only**: When you don't need the agent to modify your system, use these flags to completely disable risk surfaces.

## Guidance for Plugin Authors

Plugin authors are expected to follow these standards:
-   **Minimal Permissions**: Only request the specific tools and paths needed for the provider to function.
-   **No Surprise Network Calls**: All external communication should be limited to the provider's primary API endpoint.
-   **Structured Outputs**: Ensure `completion` results are normalized to match the expected OpenAI format to prevent parser-level exploits.
-   **Provenance**: Provide SHA-256 hashes for your plugin releases to allow users to verify integrity.

## Development Policy

Every update must include:
-   **Documentation Check**: Ensure README.md, SECURITY.md, and all in-app help strings are up to date.
-   **Test Validation**: New features must include unit tests. Regression tests must pass before any merge.
-   **Security Audit**: Every tool change or provider update must be evaluated against the current threat model.

## Supply Chain Security


Anima treats plugin installation as a critical supply-chain event:
-   **Zip-Slip Protection**: Zip extraction explicitly validates entry names to prevent directory traversal attacks.
-   **Overwrite Policy**: Existing plugins cannot be overwritten without secondary user confirmation and an explicit override flag.
- **Hash Pinning**: Users are encouraged to use the `--hash` argument to pin remote installs to a specific content digest.

## Memory Security

Anima implements multiple layers of protection for persistent memory:
-   **Secret Redaction**: Common API key patterns (OpenAI, JWT, etc.) and known secrets are automatically redacted before session history or long-term insights are saved to disk.
-   **Memory Modes**: Users can select between `off`, `session`, and `longterm` modes to control the scope of data retention.
-   **Hardened Permissions**: On Linux/macOS, memory and audit files are created with `0600` permissions (read/write only by the owner).
-   **User Review**: All long-term memory updates require explicit user review and approval to prevent persistent prompt injection attacks.


