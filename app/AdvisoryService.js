const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');
const { callAI } = require('./Utils');
const config = require('./Config');

const truncate = (str, max = 300) =>
  typeof str === 'string' && str.length > max ? str.slice(0, max) + '…' : str;

const adviceSchema = z.object({
  adviserName: z.string(),
  verdict: z.enum(['approve', 'caution', 'block']),
  rationale: z.array(z.string()).min(1),
  risks: z.object({
    level: z.enum(['low', 'med', 'high']),
    items: z.array(z.string()),
  }),
  recommendedNextSteps: z.array(z.string()),
  toolPolicy: z.object({
    allowTools: z.boolean(),
    allowedTools: z.array(z.string()).optional(),
    requireConfirmation: z.boolean().optional(),
  }),
  questionsForUser: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});

class AdvisoryService {
  constructor(auditService = null) {
    this.auditService = auditService;
    this.promptCache = new Map();
  }

  async getAdvice(
    { userMessage, mainDraft, taintStatus, availableToolsSummary, healthReport },
    overrideAdvisers = null,
  ) {
    const councilConfig = config.advisoryCouncil;
    if (!councilConfig?.enabled) return [];

    let advisers;
    if (overrideAdvisers?.length) {
      advisers = overrideAdvisers;
    } else {
      if (!councilConfig.advisers?.length) return [];
      advisers = councilConfig.advisers.slice(0, councilConfig.maxAdvisersPerCall);
    }

    const context = {
      userMessage,
      mainDraft,
      taintStatus,
      availableToolsSummary,
      healthReport,
    };

    if (councilConfig.parallel) {
      const results = await Promise.all(
        advisers.map((adviser) => this.runAdviser(adviser, context, councilConfig)),
      );
      return results.filter((r) => r !== null);
    } else {
      const results = [];
      for (const adviser of advisers) {
        const result = await this.runAdviser(adviser, context, councilConfig);
        if (result) results.push(result);
      }
      return results;
    }
  }

  async runAdviser(adviser, context, councilConfig) {
    try {
      const promptTemplate = this.loadPrompt(adviser.promptFile);
      const systemPrompt = `You are ${adviser.name}, a ${adviser.role}. 
Your goal is to provide critical feedback on the primary agent's proposed response.

# ADVISER GUIDELINES
1. Be concise and direct.
2. Focus on your specific role.
3. Output your advice strictly as a single JSON object.

# EXPECTED OUTPUT FORMAT
{
  "verdict": "approve" | "caution" | "block",
  "rationale": ["point 1", "point 2"],
  "risks": {
    "level": "low" | "med" | "high",
    "items": ["risk 1"]
  },
  "recommendedNextSteps": ["step 1"],
  "toolPolicy": {
    "allowTools": true,
    "allowedTools": ["*"],
    "requireConfirmation": true
  },
  "questionsForUser": [],
  "confidence": 0.95
}

# ADVISER PROMPT
${promptTemplate}`;

      const userPrompt = `
# CURRENT CONTEXT
- User Message: "${truncate(context.userMessage)}"
- Taint Status: ${context.taintStatus ? 'TAINTED (Web search used)' : 'CLEAN'}
- Available Tools: ${context.availableToolsSummary}
- Health Report: ${context.healthReport ? JSON.stringify(context.healthReport, null, 2) : 'No recent health report available.'}

# PROPOSED RESPONSE (Main Draft)
"${truncate(context.mainDraft, 500)}"

Provide your structured advice now.`;

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Adviser ${adviser.name} timed out`)),
          councilConfig.timeoutMs || 30000,
        ),
      );

      const callPromise = callAI(messages, null);

      const response = await Promise.race([callPromise, timeoutPromise]);
      const content = response.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error(`Adviser ${adviser.name} returned empty response`);
      }

      let parsed;
      try {
        parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
      } catch (e) {
        throw new Error(`Invalid JSON format from adviser ${adviser.name}`);
      }

      // Clamp confidence if it's out of range but present
      if (typeof parsed.confidence === 'number') {
        parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));
      }

      const validated = adviceSchema.parse({
        ...parsed,
        adviserName: adviser.name,
      });

      if (this.auditService) {
        this.auditService.log({
          event: 'adviser_call',
          tool: adviser.name,
          args: { role: adviser.role },
          result: 'success',
          output: validated,
        });
      }

      return validated;
    } catch (error) {
      const errorMsg = `Advisory validation failed for ${adviser.name}: ${error.message}`;
      if (this.auditService) {
        this.auditService.log({
          event: 'adviser_error',
          tool: adviser.name,
          result: 'error',
          output: errorMsg,
        });
      }
      process.stderr.write(`${errorMsg}\n`);

      // Safe Fallback: block execution on error
      return {
        adviserName: adviser.name,
        verdict: 'block',
        rationale: ['Internal error during advisory validation.'],
        risks: { level: 'high', items: ['Advisory failure'] },
        recommendedNextSteps: ['Retry or check logs'],
        toolPolicy: { allowTools: false },
        questionsForUser: [],
        confidence: 0,
      };
    }
  }

  loadPrompt(promptFile) {
    if (this.promptCache.has(promptFile)) {
      return this.promptCache.get(promptFile);
    }

    let fullPath;
    if (path.isAbsolute(promptFile)) {
      fullPath = promptFile;
    } else {
      const advisersPath = path.resolve(config.workspaceDir, 'Personality', 'Advisers', promptFile);
      if (fs.existsSync(advisersPath)) {
        fullPath = advisersPath;
      } else {
        fullPath = path.resolve(config.workspaceDir, promptFile);
      }
    }

    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      this.promptCache.set(promptFile, content);
      return content;
    }

    throw new Error(`Prompt file not found: ${promptFile} (tried ${fullPath})`);
  }

  clearCache() {
    this.promptCache.clear();
  }

  generateCouncilMemo(adviceList) {
    if (!adviceList || adviceList.length === 0) return null;

    const consensus = this.getConsensus(adviceList);
    const topRisks = [...new Set(adviceList.flatMap((a) => a.risks.items))].slice(0, 5);
    const recommendations = [...new Set(adviceList.flatMap((a) => a.recommendedNextSteps))].slice(
      0,
      5,
    );

    // Identify disagreements
    const verdicts = adviceList.map((a) => a.verdict);
    const hasDisagreement = new Set(verdicts).size > 1;
    let disagreementNote = 'None.';
    if (hasDisagreement) {
      disagreementNote = adviceList
        .map((a) => `${a.adviserName} recommended ${a.verdict.toUpperCase()}`)
        .join(', ');
    }

    // Tool constraints aggregation
    const restrictedTools = adviceList
      .filter((a) => a.toolPolicy.allowTools === false || a.toolPolicy.allowedTools)
      .map((a) => ({
        adviser: a.adviserName,
        policy: a.toolPolicy,
      }));

    return `
# COUNCIL MEMO
- **Consensus Verdict**: ${consensus.verdict.toUpperCase()}
- **Overall Risk Level**: ${consensus.riskLevel.toUpperCase()}
- **Top Risks**: ${topRisks.join(', ') || 'None identified.'}
- **Recommended Plan**: ${recommendations.join(' ') || 'Follow primary agent strategy.'}
- **Disagreements**: ${disagreementNote}

## Constraints & Requirements
${restrictedTools.length > 0 ? restrictedTools.map((t) => `- [${t.adviser}]: ${t.policy.allowTools ? 'Allow only: ' + (t.policy.allowedTools?.join(', ') || '*') : 'BLOCK ALL TOOLS'}`).join('\n') : '- None.'}
`;
  }

  getConsensus(adviceList) {
    const verdicts = adviceList.map((a) => a.verdict);
    const riskLevels = adviceList.map((a) => a.risks.level);

    // Highest severity wins
    let finalVerdict = 'approve';
    if (verdicts.includes('block')) finalVerdict = 'block';
    else if (verdicts.includes('caution')) finalVerdict = 'caution';

    let finalRisk = 'low';
    if (riskLevels.includes('high')) finalRisk = 'high';
    else if (riskLevels.includes('med')) finalRisk = 'med';

    return { verdict: finalVerdict, riskLevel: finalRisk };
  }
}

module.exports = AdvisoryService;
module.exports.adviceSchema = adviceSchema;
