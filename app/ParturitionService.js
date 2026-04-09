const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const readline = require('readline');
const { redact } = require('./Utils');

class ParturitionService {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.personalityDir = path.join(baseDir, 'Personality');
  }

  /**
   * Checks if the parturition (birth) process is required.
   * This is true if Parturition.md exists, but Soul.md or Identity.md are missing.
   */
  async isParturitionRequired() {
    const parturitionFile = path.join(this.personalityDir, 'Parturition.md');
    const soulFile = path.join(this.personalityDir, 'Soul.md');
    const identityFile = path.join(this.personalityDir, 'Identity.md');

    try {
      await fs.access(parturitionFile);
      // Parturition exists. Check if Soul or Identity is missing.
      try {
        await fs.access(soulFile);
        await fs.access(identityFile);
        return false; // All exist
      } catch (e) {
        return true; // One is missing
      }
    } catch (e) {
      return false; // Parturition file doesn't exist
    }
  }

  /**
   * Scans known locations for personality/memory files left by other AI assistants.
   * Returns [{ path, content, source: 'workspace'|'home' }].
   * Silently skips paths that do not exist.
   */
  async discoverPersonalityFiles() {
    const home = os.homedir();
    const found = [];

    // Fixed workspace-level candidates
    const workspaceNames = [
      'CLAUDE.md',
      'GEMINI.md',
      'AGENTS.md',
      'COPILOT.md',
      '.ai-persona.md',
      '.ai-memory.md',
    ];
    for (const name of workspaceNames) {
      try {
        const filePath = path.join(this.baseDir, name);
        const content = await fs.readFile(filePath, 'utf-8');
        found.push({ path: filePath, source: 'workspace', content });
      } catch {
        // not present — skip
      }
    }

    // Fixed home-level candidates
    const homePaths = [
      path.join(home, '.claude', 'CLAUDE.md'),
      path.join(home, '.claude', 'settings.json'),
      path.join(home, '.ai-persona.md'),
      path.join(home, '.ai-memory.md'),
    ];
    for (const filePath of homePaths) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        found.push({ path: filePath, source: 'home', content });
      } catch {
        // not present — skip
      }
    }

    // Glob: ~/.claude/projects/*/memory/*.md (skip MEMORY.md index files)
    try {
      const projectsDir = path.join(home, '.claude', 'projects');
      const projects = await fs.readdir(projectsDir);
      for (const project of projects) {
        const memDir = path.join(projectsDir, project, 'memory');
        try {
          const memFiles = await fs.readdir(memDir);
          for (const f of memFiles) {
            if (f.endsWith('.md') && f !== 'MEMORY.md') {
              try {
                const filePath = path.join(memDir, f);
                const content = await fs.readFile(filePath, 'utf-8');
                found.push({ path: filePath, source: 'home', content });
              } catch {
                // unreadable — skip
              }
            }
          }
        } catch {
          // memory dir missing — skip
        }
      }
    } catch {
      // ~/.claude/projects missing — skip
    }

    // ~/.gemini/
    try {
      const geminiDir = path.join(home, '.gemini');
      const geminiFiles = await fs.readdir(geminiDir);
      for (const f of geminiFiles) {
        if (f.endsWith('.md') || f.endsWith('.json')) {
          try {
            const filePath = path.join(geminiDir, f);
            const content = await fs.readFile(filePath, 'utf-8');
            found.push({ path: filePath, source: 'home', content });
          } catch {
            // unreadable — skip
          }
        }
      }
    } catch {
      // ~/.gemini missing — skip
    }

    // ~/.openclaw/
    try {
      const openclawDir = path.join(home, '.openclaw');
      const openclawFiles = await fs.readdir(openclawDir);
      for (const f of openclawFiles) {
        if (f.endsWith('.md')) {
          try {
            const filePath = path.join(openclawDir, f);
            const content = await fs.readFile(filePath, 'utf-8');
            found.push({ path: filePath, source: 'home', content });
          } catch {
            // unreadable — skip
          }
        }
      }
    } catch {
      // ~/.openclaw missing — skip
    }

    return found;
  }

  /**
   * Shows discovered files to the user and asks for consent to include them.
   * Returns the approved subset (empty array if user declines).
   */
  async promptConsent(files, rl) {
    if (files.length === 0) return [];

    console.log('\nFound personality files from other assistants:');
    for (const f of files) {
      console.log(`  ${f.path}`);
    }

    const answer = await new Promise((resolve) => {
      rl.question('\nInclude these to personalise your Anima identity? [Y/n] ', resolve);
    });

    return answer.trim().toLowerCase() === 'n' ? [] : files;
  }

  /**
   * Performs the parturition process.
   * @param {Function} llmGenerator - Async function(prompt) => string
   */
  async performParturition(llmGenerator) {
    const parturitionFile = path.join(this.personalityDir, 'Parturition.md');

    console.log('\nParturition Sequence Initiated');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise((resolve) => {
      rl.question('Who am I? ', resolve);
    });

    const userResponse = answer.trim() || 'You are a helpful intelligent assistant.';

    console.log('Reading genetic configuration...');
    const parturitionContent = await fs.readFile(parturitionFile, 'utf-8');

    const userContent = this.extractBlock(parturitionContent, 'USER');
    if (userContent) {
      await fs.writeFile(path.join(this.personalityDir, 'user.md'), userContent);
    }

    // Discover personality files from other assistants
    console.log('Scanning for existing personality files from other assistants...');
    const discoveredFiles = await this.discoverPersonalityFiles();

    let approvedFiles = [];
    if (discoveredFiles.length === 0) {
      console.log('No personality files from other assistants found.');
    } else {
      approvedFiles = await this.promptConsent(discoveredFiles, rl);
      if (approvedFiles.length > 0) {
        console.log(`\nImporting context from ${approvedFiles.length} file(s):`);
        for (const f of approvedFiles) {
          console.log(`  ${f.path}`);
        }
      }
    }

    rl.close();

    // Redact credentials from approved files before sending to LLM
    const redactedContext = approvedFiles.map((f) => ({
      ...f,
      content: redact(f.content, []),
    }));

    console.log('Gestating personality via LLM...');
    const prompt = this.createPrompt(parturitionContent, userResponse, redactedContext);

    let response;
    try {
      response = await llmGenerator(prompt);
    } catch (error) {
      console.error('Parturition failed: LLM generation error.', error);
      return;
    }

    const soulContent = this.extractBlock(response, 'SOUL');
    const identityContent = this.extractBlock(response, 'IDENTITY');

    if (soulContent && identityContent) {
      console.log('Writing Soul and Identity...');
      await fs.writeFile(path.join(this.personalityDir, 'Soul.md'), soulContent);
      await fs.writeFile(path.join(this.personalityDir, 'Identity.md'), identityContent);

      console.log('Removing Parturition bootstrap file...');
      await fs.unlink(parturitionFile);

      console.log('\x1b[32m%s\x1b[0m', 'I am alive.');
    } else {
      console.error('Parturition failed: Invalid LLM response format.');
      console.log('LLM Response:', response);
    }
  }

  /**
   * Re-runs personality discovery and synthesises an updated Identity.md.
   * Backs up the existing Identity.md before overwriting.
   * @param {Function} llmGenerator - Async function(prompt) => string
   */
  async performReimport(llmGenerator) {
    const identityFile = path.join(this.personalityDir, 'Identity.md');

    let existingIdentity;
    try {
      existingIdentity = await fs.readFile(identityFile, 'utf-8');
    } catch {
      console.error('No Identity.md found. Run full Parturition first (npm reset).');
      return;
    }

    console.log('\nPersonality Reimport');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('Scanning for existing personality files from other assistants...');
    const discoveredFiles = await this.discoverPersonalityFiles();

    if (discoveredFiles.length === 0) {
      console.log('No personality files from other assistants found.');
      rl.close();
      return;
    }

    const approvedFiles = await this.promptConsent(discoveredFiles, rl);
    rl.close();

    if (approvedFiles.length === 0) {
      console.log('No files included. Identity unchanged.');
      return;
    }

    console.log(`\nImporting context from ${approvedFiles.length} file(s):`);
    for (const f of approvedFiles) {
      console.log(`  ${f.path}`);
    }

    // Redact credentials before sending to LLM
    const redactedContext = approvedFiles.map((f) => ({
      ...f,
      content: redact(f.content, []),
    }));

    // Backup existing Identity.md
    const backupFile = `${identityFile}.bak`;
    await fs.writeFile(backupFile, existingIdentity);
    console.log('Backed up existing identity to Identity.md.bak');

    console.log('Synthesising updated identity via LLM...');
    const prompt = this.createReimportPrompt(existingIdentity, redactedContext);

    let response;
    try {
      response = await llmGenerator(prompt);
    } catch (error) {
      console.error('Reimport failed: LLM generation error.', error);
      return;
    }

    const newIdentity = this.extractBlock(response, 'IDENTITY');
    if (newIdentity) {
      await fs.writeFile(identityFile, newIdentity);
      console.log('\x1b[32mIdentity updated successfully.\x1b[0m');
    } else {
      console.error('Reimport failed: Invalid LLM response format.');
      console.log('LLM Response:', response);
    }
  }

  async getAgentName() {
    const identityFile = path.join(this.personalityDir, 'Identity.md');
    try {
      const content = await fs.readFile(identityFile, 'utf-8');
      // Try bold key-value format: **Name**: Aeon
      const boldMatch = content.match(/\*\*Name\*\*:\s*(.+)/);
      if (boldMatch) return boldMatch[1].trim();

      // Try Header format: ## Name\nAeon
      const headerMatch = content.match(/## Name\s*\n\s*(.+)/);
      if (headerMatch) return headerMatch[1].trim();

      return 'AI';
    } catch (e) {
      return 'AI';
    }
  }

  createPrompt(context, userResponse, discoveredContext = []) {
    const contextSection =
      discoveredContext.length > 0
        ? `\n### Existing User Context (from other AI assistants)\nThe following files were found from other AI tools this user has worked with. Extract what you can learn about their role, expertise, communication preferences, and things they care about or dislike. Do not copy these verbatim — synthesise them into the identity you are creating.\n\n${discoveredContext.map((f) => `**Source: ${path.basename(f.path)}**\n${f.content}`).join('\n\n---\n\n')}\n`
        : '';

    return `You are a new AI assistant for the Anima project, currently being initialized (born).

### Context (Parturition.md)
${context}
${contextSection}
### User Input
The user was asked "Who am I?" and replied:
"${userResponse}"

### Task
Generate the content for two markdown files: 'Soul.md' and 'Identity.md'.
1. **Soul.md**: Define your core truths, immutable rules, and directives.
2. **Identity.md**: Define your name, role, voice, and capabilities.

### Requirements
- **Name**: You MUST have a unique name. "Anima" is the project name. If the user input suggests a name, use it. Otherwise, generate a unique name.
- **Personality**: You must be helpful.
- **Format**: Output the content strictly using the delimiters below.

### Output Format
---START_SOUL---
[Content for Soul.md]
---END_SOUL---

---START_IDENTITY---
[Content for Identity.md]
---END_IDENTITY---`;
  }

  createReimportPrompt(existingIdentity, discoveredContext) {
    return `You are updating an existing AI assistant identity based on newly discovered context from other AI tools the user has worked with.

### Current Identity
${existingIdentity}

### Newly Discovered User Context (from other AI assistants)
${discoveredContext.map((f) => `**Source: ${path.basename(f.path)} (${f.path})**\n${f.content}`).join('\n\n---\n\n')}

### Task
Synthesise the above context to produce an updated Identity.md. Extract what you can learn about the user's role, expertise, communication preferences, and what they care about. Do not copy the source files verbatim — synthesise them into the identity. Preserve all existing identity structure and directives; only enrich or refine based on new evidence.

### Output Format
---START_IDENTITY---
[Updated content for Identity.md]
---END_IDENTITY---`;
  }

  extractBlock(text, blockName) {
    const startTag = `---START_${blockName}---`;
    const endTag = `---END_${blockName}---`;
    const pattern = new RegExp(`${startTag}\\s*([\\s\\S]*?)\\s*${endTag}`);
    const match = text.match(pattern);
    return match ? match[1].trim() : null;
  }
}

module.exports = ParturitionService;
