const fs = require('node:fs').promises;
const existsSync = require('node:fs').existsSync;
const path = require('node:path');
const { callAI, summariseHealth } = require('./Utils');

class ReflectionService {
  constructor(baseDir, auditService) {
    this.baseDir = baseDir;
    this.auditService = auditService;
    this.memoryDir = path.join(baseDir, 'Memory');
    this.reflectionStateFile = path.join(this.memoryDir, 'reflection_state.json');
  }

  /**
   * Checks if a reflection is due (once per day).
   */
  async isReflectionDue() {
    if (!existsSync(this.reflectionStateFile)) return true;
    try {
      const state = JSON.parse(await fs.readFile(this.reflectionStateFile, 'utf-8'));
      const lastReflection = new Date(state.lastReflectionDate);
      const now = new Date();
      return (
        lastReflection.getUTCDate() !== now.getUTCDate() ||
        lastReflection.getUTCMonth() !== now.getUTCMonth() ||
        lastReflection.getUTCFullYear() !== now.getUTCFullYear()
      );
    } catch (e) {
      return true;
    }
  }

  /**
   * Performs daily self-reflection based on logs and health reports.
   */
  async performReflection(latestHealthReport) {
    const failuresLog = path.join(this.memoryDir, 'failures.log');
    const patchFailuresLog = path.join(this.baseDir, 'Personality', 'Memory', 'patch_failures.log');

    let logs = [];

    if (existsSync(failuresLog)) {
      const content = await fs.readFile(failuresLog, 'utf-8');
      logs.push('--- GENERAL FAILURES ---\n' + content.split('\n').slice(-20).join('\n'));
    }

    if (existsSync(patchFailuresLog)) {
      const content = await fs.readFile(patchFailuresLog, 'utf-8');
      logs.push('--- PATCH FAILURES ---\n' + content.split('\n').slice(-20).join('\n'));
    }

    const reflectionPrompt = {
      role: 'system',
      content: `You are the Self-Reflection Module for Anima.
Your goal is to analyze recent failures, code debt, and strategic mistakes to identify how you can improve.

# INPUT DATA
- Health Report (Linting/Complexity): ${summariseHealth(latestHealthReport)}
- Recent Logs (Failures/Errors/Strategy Mistakes):
${logs.join('\n\n')}

# TASK
Ask yourself:
1. "How could I have done better in these failed scenarios? Was it a 'let's try this' approach that failed first time?"
2. "What specific code patterns, architectural weaknesses, or logical assumptions led to these issues?"
3. "What should I change in my Identity or Skills to prevent these in the future?"

# OUTPUT
Propose a 'Reflection Proposal' that includes:
1. 'newMilestones': Any lessons learned (type: "learning"). Focus on 'First-Time Resolution' improvements.
2. 'proposedIdentityUpdate': Refinements to your Identity.md to incorporate these lessons.
3. 'evolutionSummary': A summary of your self-reflection, focusing on why certain attempts failed and how you will improve.

Output strictly as a JSON object:
{
  "newMilestones": [
    { "type": "learning", "content": "...", "justification": "..." }
  ],
  "proposedIdentityUpdate": "Markdown content or null",
  "evolutionSummary": "Short explanation of the reflection."
}`,
    };

    try {
      process.stdout.write(
        '\x1b[35m[Reflection] Analyzing past performance for self-improvement...\x1b[0m\n',
      );
      const data = await callAI([reflectionPrompt]);
      const content = data.choices?.[0]?.message?.content || '{}';
      const proposal = JSON.parse(content.replace(/```json|```/g, '').trim());

      // Update state
      await fs.writeFile(
        this.reflectionStateFile,
        JSON.stringify(
          {
            lastReflectionDate: new Date().toISOString(),
          },
          null,
          2,
        ),
      );

      return proposal;
    } catch (e) {
      process.stderr.write(`[Reflection] Self-reflection failed: ${e.message}\n`);
      return null;
    }
  }
}

module.exports = ReflectionService;
