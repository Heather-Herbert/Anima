const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');
const { callAI } = require('./Utils');
const config = require('./Config');

const adviceSchema = z.object({
  adviser: z.string(),
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  riskScore: z.number().min(0).max(1),
  feedback: z.string(),
  suggestedAction: z.string().optional(),
});

class AdvisoryService {
  constructor(auditService = null) {
    this.auditService = auditService;
    this.promptCache = new Map();
  }

  async getAdvice({
    userMessage,
    mainDraft,
    managedHistorySummary,
    taintStatus,
    availableToolsSummary,
  }) {
    const councilConfig = config.advisoryCouncil;
    if (!councilConfig?.enabled || !councilConfig.advisers || councilConfig.advisers.length === 0) {
      return [];
    }

    const advisers = councilConfig.advisers.slice(0, councilConfig.maxAdvisersPerCall);
    const context = {
      userMessage,
      mainDraft,
      managedHistorySummary,
      taintStatus,
      availableToolsSummary,
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
3. Output your advice strictly as a JSON object.

# EXPECTED OUTPUT FORMAT
{
  "sentiment": "positive" | "negative" | "neutral",
  "riskScore": 0.0 to 1.0,
  "feedback": "Your detailed reasoning here.",
  "suggestedAction": "Optional specific change to the response."
}

# ADVISER PROMPT
${promptTemplate}`;

      const userPrompt = `
# CURRENT CONTEXT
- User Message: "${context.userMessage}"
- Managed History Summary: ${context.managedHistorySummary}
- Taint Status: ${context.taintStatus ? 'TAINTED (Web search used)' : 'CLEAN'}
- Available Tools: ${context.availableToolsSummary}

# PROPOSED RESPONSE (Main Draft)
"${context.mainDraft}"

Provide your structured advice now.`;

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      // Use a timeout for the individual adviser call
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Adviser ${adviser.name} timed out`)),
          councilConfig.timeoutMs || 30000,
        ),
      );

      const callPromise = callAI(messages, null); // Tools always disabled for advisers

      const response = await Promise.race([callPromise, timeoutPromise]);
      const content = response.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error(`Adviser ${adviser.name} returned empty response`);
      }

      // Parse and validate
      const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
      const validated = adviceSchema.parse({
        ...parsed,
        adviser: adviser.name,
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
      const errorMsg = `Adviser ${adviser.name} failed: ${error.message}`;
      if (this.auditService) {
        this.auditService.log({
          event: 'adviser_error',
          tool: adviser.name,
          result: 'error',
          output: errorMsg,
        });
      }
      process.stderr.write(`${errorMsg}\n`);
      return null;
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
      // Try Personality/Advisers/ first, then relative to workspaceDir
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
}

module.exports = AdvisoryService;
