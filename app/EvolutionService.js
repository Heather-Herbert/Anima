const fs = require('node:fs').promises;
const existsSync = require('node:fs').existsSync;
const path = require('node:path');
const { spawn } = require('node:child_process');
const { callAI } = require('./Utils');

class EvolutionService {
  constructor(baseDir, auditService = null, advisoryService = null) {
    this.baseDir = baseDir;
    this.personalityDir = path.join(baseDir, 'Personality');
    this.memoryDir = path.join(baseDir, 'Memory');
    this.auditService = auditService;
    this.advisoryService = advisoryService;
  }

  /**
   * Runs the test suite to ensure system integrity.
   */
  async runTests() {
    return new Promise((resolve) => {
      const child = spawn('npm', ['test'], {
        cwd: this.baseDir,
        shell: true,
      });

      let output = '';
      child.stdout.on('data', (data) => (output += data));
      child.stderr.on('data', (data) => (output += data));

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          output: output,
        });
      });
    });
  }

  /**
   * Validates a proposal in shadow mode.
   * Supports both Identity.md updates and generic file changes.
   */
  async validateEvolution(proposal) {
    const fileChanges = [];

    // 1. Collect all intended changes
    if (proposal.proposedIdentityUpdate) {
      fileChanges.push({
        path: path.join(this.personalityDir, 'Identity.md'),
        content: proposal.proposedIdentityUpdate,
      });
    }

    if (proposal.proposedFileChanges && Array.isArray(proposal.proposedFileChanges)) {
      for (const change of proposal.proposedFileChanges) {
        fileChanges.push({
          path: path.isAbsolute(change.path) ? change.path : path.join(this.baseDir, change.path),
          content: change.content,
        });
      }
    }

    if (fileChanges.length === 0) return { success: true };

    const backups = [];
    const newFiles = [];

    try {
      // 2. Create backups or mark as new
      for (const change of fileChanges) {
        if (existsSync(change.path)) {
          const current = await fs.readFile(change.path, 'utf-8');
          const backupPath = change.path + '.bak';
          await fs.writeFile(backupPath, current);
          backups.push({ originalPath: change.path, backupPath, originalContent: current });
        } else {
          newFiles.push(change.path);
        }
      }

      // 3. Apply proposed updates temporarily
      for (const change of fileChanges) {
        const dir = path.dirname(change.path);
        if (!existsSync(dir)) {
          await fs.mkdir(dir, { recursive: true });
        }
        await fs.writeFile(change.path, change.content);
      }

      // 4. Run regression tests (100% pass rate required)
      process.stdout.write('[Evolution] Running regression tests in Shadow Mode...\n');
      const testResult = await this.runTests();

      if (!testResult.success) {
        process.stdout.write(`[Evolution] Tests FAILED post-evolution. Rolling back.\n`);
        await this.performRollback(backups, newFiles);

        // 5. Alert User/Council
        if (this.advisoryService) {
          await this.advisoryService.getAdvice({
            userMessage: 'CRITICAL: Evolution regression tests failed. System has performed an instant rollback.',
            mainDraft: `The following evolution proposal caused a regression:\n\n${JSON.stringify(proposal, null, 2)}\n\nTest Output:\n${testResult.output}`,
            managedHistorySummary: 'Evolution failure alert.',
            focus: ['security', 'quality'],
          });
        }

        return { success: false, error: 'Regression tests failed', output: testResult.output };
      }

      // 6. Success: Cleanup backups
      for (const backup of backups) {
        if (existsSync(backup.backupPath)) {
          await fs.unlink(backup.backupPath);
        }
      }
      process.stdout.write('[Evolution] Tests PASSED (100%). Evolution validated.\n');
      return { success: true };
    } catch (e) {
      // Rollback on unexpected error
      await this.performRollback(backups, newFiles);
      return { success: false, error: e.message };
    }
  }

  async performRollback(backups, newFiles) {
    // Restore existing files
    for (const backup of backups) {
      try {
        await fs.writeFile(backup.originalPath, backup.originalContent);
        if (existsSync(backup.backupPath)) {
          await fs.unlink(backup.backupPath);
        }
      } catch (err) {
        process.stderr.write(`Critical error during rollback of ${backup.originalPath}: ${err.message}\n`);
      }
    }
    // Delete newly created files
    for (const file of newFiles) {
      try {
        if (existsSync(file)) {
          await fs.unlink(file);
        }
      } catch (err) {
        process.stderr.write(`Error deleting new file during rollback: ${file}\n`);
      }
    }
  }

  /**
   * Proposes evolution steps based on recent conversation history.
   */
  async proposeEvolution(conversationHistory) {
    const identityFile = path.join(this.personalityDir, 'Identity.md');
    const milestonesFile = path.join(this.memoryDir, 'milestones.json');
    const memosDir = path.join(this.memoryDir, 'memos');

    let currentIdentity = 'No identity established yet.';
    if (existsSync(identityFile)) {
      currentIdentity = await fs.readFile(identityFile, 'utf-8');
    }

    let milestones = [];
    if (existsSync(milestonesFile)) {
      try {
        const content = await fs.readFile(milestonesFile, 'utf-8');
        milestones = JSON.parse(content);
      } catch (e) {
        milestones = [];
      }
    }

    let memos = [];
    if (existsSync(memosDir)) {
      try {
        const memoFiles = await fs.readdir(memosDir);
        for (const file of memoFiles.slice(-3)) {
          // Only take the 3 most recent memos to save tokens
          const content = await fs.readFile(path.join(memosDir, file), 'utf-8');
          memos.push(content);
        }
      } catch (e) {
        /* ignore read errors */
      }
    }

    const sessionMessages = conversationHistory.filter((msg) => msg.role !== 'system');
    if (sessionMessages.length === 0) return null;

    const evolutionPrompt = {
      role: 'system',
      content: `You are an Agent Evolution System. 
Analyze the recent conversation history, the agent's current identity, and external learned memos.
Identify significant achievements, new skills demonstrated, or shifts in the agent's role/expertise.

Current Identity:
${currentIdentity}

Recent Milestones:
${JSON.stringify(milestones.slice(-5))}

External Memos (Knowledge learned from other agents):
${memos.join('\n---\n')}

Task:
1. Identify any NEW milestones achieved in this session.
2. If the achievements or external learning warrant a "level up" or a refinement in the agent's role, propose a new Identity.md content.

Output strictly as a JSON object:
{
  "newMilestones": [
    { "type": "achievement" | "skill_learned", "content": "...", "justification": "..." }
  ],
  "proposedIdentityUpdate": "Full markdown content for Identity.md if evolution occurred, otherwise null",
  "evolutionSummary": "Short explanation of why the agent evolved."
}

If no evolution is needed, set proposedIdentityUpdate to null and newMilestones to [].`,
    };

    const messages = [
      evolutionPrompt,
      ...sessionMessages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
    ];

    try {
      const data = await callAI(messages);
      const content = data.choices?.[0]?.message?.content || '{}';
      const proposed = JSON.parse(content.replace(/```json|```/g, '').trim());
      return proposed;
    } catch (e) {
      process.stderr.write(`Evolution Proposal Error: ${e.message}
`);
      return null;
    }
  }

  /**
   * Applies the approved evolution with Shadow Testing and Rollback support.
   */
  async applyEvolution(proposal) {
    // 1. Manage Milestones
    if (proposal.newMilestones && proposal.newMilestones.length > 0) {
      const milestonesFile = path.join(this.memoryDir, 'milestones.json');
      let existing = [];
      if (existsSync(milestonesFile)) {
        const content = await fs.readFile(milestonesFile, 'utf-8');
        existing = JSON.parse(content);
      }
      const updated = [
        ...existing,
        ...proposal.newMilestones.map((m) => ({ ...m, date: new Date().toISOString() })),
      ];
      await fs.writeFile(milestonesFile, JSON.stringify(updated, null, 2));
    }

    // 2. Identity and File Updates with Shadow Testing
    if (proposal.proposedIdentityUpdate || (proposal.proposedFileChanges && proposal.proposedFileChanges.length > 0)) {
      const validation = await this.validateEvolution(proposal);
      if (!validation.success) {
        throw new Error(
          `Evolution rejected: ${validation.error}. Tests output:\n${validation.output}`,
        );
      }
      return true;
    }
    return false;
  }

  /**
   * Manual rollback to last stable state.
   */
  async rollback() {
    const identityFile = path.join(this.personalityDir, 'Identity.md');
    const backupFile = identityFile + '.bak';

    if (existsSync(backupFile)) {
      const original = await fs.readFile(backupFile, 'utf-8');
      await fs.writeFile(identityFile, original);
      await fs.unlink(backupFile);
      return true;
    }
    return false;
  }
}

module.exports = EvolutionService;
