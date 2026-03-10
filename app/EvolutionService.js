const fs = require('node:fs').promises;
const existsSync = require('node:fs').existsSync;
const path = require('node:path');
const { callAI } = require('./Utils');

class EvolutionService {
  constructor(baseDir, auditService = null) {
    this.baseDir = baseDir;
    this.personalityDir = path.join(baseDir, 'Personality');
    this.memoryDir = path.join(baseDir, 'Memory');
    this.auditService = auditService;
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
        for (const file of memoFiles.slice(-3)) { // Only take the 3 most recent memos to save tokens
          const content = await fs.readFile(path.join(memosDir, file), 'utf-8');
          memos.push(content);
        }
      } catch (e) { /* ignore read errors */ }
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
   * Applies the approved evolution.
   */
  async applyEvolution(proposal) {
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

    if (proposal.proposedIdentityUpdate) {
      const identityFile = path.join(this.personalityDir, 'Identity.md');
      await fs.writeFile(identityFile, proposal.proposedIdentityUpdate);
      return true;
    }
    return false;
  }
}

module.exports = EvolutionService;
