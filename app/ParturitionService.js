const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

class ParturitionService {
  constructor(baseDir) {
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

    rl.close();

    const userResponse = answer.trim() || 'You are a helpful intelligent assistant.';

    console.log('Reading genetic configuration...');
    const parturitionContent = await fs.readFile(parturitionFile, 'utf-8');

    const userContent = this.extractBlock(parturitionContent, 'USER');
    if (userContent) {
      await fs.writeFile(path.join(this.personalityDir, 'user.md'), userContent);
    }

    console.log('Gestating personality via LLM...');
    const prompt = this.createPrompt(parturitionContent, userResponse);

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

  createPrompt(context, userResponse) {
    return `You are a new AI assistant for the Anima project, currently being initialized (born).

### Context (Parturition.md)
${context}

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

  extractBlock(text, blockName) {
    const startTag = `---START_${blockName}---`;
    const endTag = `---END_${blockName}---`;
    const pattern = new RegExp(`${startTag}\\s*([\\s\\S]*?)\\s*${endTag}`);
    const match = text.match(pattern);
    return match ? match[1].trim() : null;
  }
}

module.exports = ParturitionService;
