const fs = require('node:fs');
const path = require('node:path');
const { callAI, redact, encrypt } = require('./Utils');
const toolDispatcher = require('./ToolDispatcher');
const config = require('./Config');
const AdvisoryService = require('./AdvisoryService');
const AnalysisService = require('./AnalysisService');
const ReflectionService = require('./ReflectionService');

class ConversationService {
  constructor(agentName, activeTools, manifest, historyPath, auditService = null) {
    this.agentName = agentName;
    this.activeTools = activeTools;
    this.manifest = manifest;
    this.historyPath = historyPath;
    this.auditService = auditService;
    this.advisoryService = new AdvisoryService(auditService);
    this.analysisService = new AnalysisService(config.workspaceDir || path.join(__dirname, '..'));
    this.reflectionService = new ReflectionService(
      config.workspaceDir || path.join(__dirname, '..'),
      auditService,
    );
    this.turnCounter = 0;
    this.lastHealthReport = null;
    this._compactionSummary = null;
    this._lastCompactedLength = 0;
    this.dangerousTools = [
      'run_command',
      'execute_code',
      'add_plugin',
      'write_file',
      'delete_file',
      'replace_in_file',
      'query',
      'decontaminate',
    ];
  }

  isProtectedPath(filePath) {
    if (!filePath) return false;
    const pathLower = filePath.toLowerCase();
    return (
      pathLower.startsWith('plugins/') ||
      pathLower.startsWith('memory/') ||
      pathLower.startsWith('personality/') ||
      pathLower === 'plugins' ||
      pathLower === 'memory' ||
      pathLower === 'personality'
    );
  }

  async processInput(input, conversationHistory, confirmCallback) {
    // --- PHASE 0: PERIODIC MAINTENANCE (Analysis & Reflection) ---
    this.turnCounter++;
    let reflectionProposal = null;
    if (this.turnCounter === 1 || this.turnCounter % 5 === 0) {
      try {
        process.stdout.write('\x1b[36m[Analysis] Running periodic code debt analysis...\x1b[0m\n');
        this.lastHealthReport = await this.analysisService.runLintAnalysis();
        if (this.auditService) {
          this.auditService.log({
            event: 'periodic_analysis',
            result: 'success',
            output: this.lastHealthReport,
          });
        }

        // Check for daily self-reflection
        if (await this.reflectionService.isReflectionDue()) {
          reflectionProposal = await this.reflectionService.performReflection(
            this.lastHealthReport,
          );
        }
      } catch (e) {
        process.stderr.write(`[Maintenance] Periodic task failed: ${e.message}\n`);
      }
    }

    const wrappedInput = `<user_input>\n${input}\n</user_input>`;
    conversationHistory.push({ role: 'user', content: wrappedInput });

    // Heuristic: Track "let's try this" failures from user feedback
    const negativeFeedback = [
      "didn't work",
      'did not work',
      'still broken',
      'still getting',
      'error persists',
      "that's not right",
      'try again',
      'failed to',
    ];
    if (negativeFeedback.some((phrase) => input.toLowerCase().includes(phrase))) {
      if (this.auditService) {
        this.auditService.logFailure('External Feedback (User)', 'User reported a failed attempt', {
          userInput: input,
        });
      }
    }

    let processing = true;
    let lastReply = '';
    let isTainted = false; // Reset taint per user input turn
    let iterations = 0;
    const MAX_ITERATIONS = 10;
    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let resetRequested = null;
    let turnAdvice = [];
    let stopReason = null;

    const councilConfig = config.advisoryCouncil;
    let turnRiskScore = 0;

    // --- PHASE 1 & 2: DRAFT & REVIEW (Always Mode) ---
    if (councilConfig?.enabled && councilConfig.mode === 'always') {
      try {
        const managedHistory = await this.getManagedHistory(conversationHistory);
        // Generate Draft (tools disabled)
        const draftData = await callAI(managedHistory, null);
        const draft = draftData.choices?.[0]?.message?.content || '';

        // Track usage for draft
        if (draftData.usage) {
          totalUsage.prompt_tokens += draftData.usage.prompt_tokens || 0;
          totalUsage.completion_tokens += draftData.usage.completion_tokens || 0;
          totalUsage.total_tokens += draftData.usage.total_tokens || 0;
        }

        if (draft) {
          // Run Advisers on Draft
          const advice = await this.advisoryService.getAdvice({
            userMessage: input,
            mainDraft: draft,
            managedHistorySummary: `Draft phase. Context window contains ${managedHistory.length} messages.`,
            taintStatus: isTainted,
            availableToolsSummary: this.activeTools.map((t) => t.function.name).join(', '),
            healthReport: this.lastHealthReport,
          });

          if (advice && advice.length > 0) {
            turnAdvice = advice;
            const memo = this.advisoryService.generateCouncilMemo(turnAdvice);

            // Inject memo as internal system message for the "Act" phase
            conversationHistory.push({
              role: 'system',
              content: `ADVISORY COUNCIL REVIEW of your intended approach:\n${memo}\n\nPlease take this feedback into account for your final response and any tool calls.`,
              internal: true,
            });
          }
        }
      } catch (e) {
        process.stderr.write(`Advisory Pipeline Error: ${e.message}\n`);
      }
    }

    this.saveHistory(conversationHistory);

    // --- PHASE 3: ACT (Main ReAct Loop) ---
    while (processing && iterations < MAX_ITERATIONS) {
      iterations++;
      let data;
      let attempts = 0;
      const maxAttempts = 3;

      const managedHistory = await this.getManagedHistory(conversationHistory);

      // --- PRE-CALL BUDGET CHECK ---
      const budget = config.tokenBudget || {};
      const budgetBreached =
        (budget.maxTotalTokens != null && totalUsage.total_tokens >= budget.maxTotalTokens) ||
        (budget.maxInputTokens != null && totalUsage.prompt_tokens >= budget.maxInputTokens) ||
        (budget.maxOutputTokens != null &&
          totalUsage.completion_tokens >= budget.maxOutputTokens) ||
        (budget.maxTurns != null && iterations > budget.maxTurns);

      if (budgetBreached) {
        const usedTokens = totalUsage.total_tokens;
        const budgetLimit =
          budget.maxTotalTokens ??
          budget.maxInputTokens ??
          budget.maxOutputTokens ??
          budget.maxTurns;
        stopReason = { reason: 'token_budget_exceeded', used: usedTokens, budget: budgetLimit };

        if (this.auditService) {
          this.auditService.log({
            event: 'budget_enforcement',
            stopReason,
            totalUsage,
          });
        }

        const budgetMessage = `Token budget reached (used: ${usedTokens}, limit: ${budgetLimit}). Stopping to stay within budget.`;
        conversationHistory.push({ role: 'assistant', content: budgetMessage });
        this.saveHistory(conversationHistory);
        return {
          reply: budgetMessage,
          usage: totalUsage,
          iterations,
          resetRequested,
          advice: turnAdvice,
          reflectionProposal,
          stopReason,
        };
      }

      while (attempts < maxAttempts) {
        try {
          attempts++;
          data = await callAI(managedHistory, this.activeTools);
          if (!data?.choices?.[0]?.message) {
            throw new Error('Malformed response from AI provider');
          }
          break;
        } catch (error) {
          if (
            attempts >= maxAttempts ||
            error.message.includes('401') ||
            error.message.includes('403')
          ) {
            throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
        }
      }

      // Track usage
      if (data.usage) {
        totalUsage.prompt_tokens += data.usage.prompt_tokens || 0;
        totalUsage.completion_tokens += data.usage.completion_tokens || 0;
        totalUsage.total_tokens += data.usage.total_tokens || 0;
      }

      const message = data.choices[0].message;

      if (message.tool_calls) {
        conversationHistory.push(message);

        for (const toolCall of message.tool_calls) {
          try {
            const functionName = toolCall.function.name;
            let functionArgs;
            try {
              functionArgs = JSON.parse(toolCall.function.arguments);
            } catch (e) {
              functionArgs = {};
            }

            // Taint tracking
            if (functionName === 'web_search') {
              isTainted = true;
            }

            // Handle new_session special case
            if (functionName === 'new_session') {
              resetRequested = {
                reason: functionArgs.reason,
                carry_over: functionArgs.carry_over,
              };
            }

            let toolResult;
            let auditResult = 'allowed';
            const isWritingToProtected =
              ['write_file', 'delete_file', 'replace_in_file'].includes(functionName) &&
              this.isProtectedPath(functionArgs.path);

            if (this.dangerousTools.includes(functionName) || isWritingToProtected) {
              const justification = functionArgs.justification || 'No justification provided.';
              const confirmed = await confirmCallback(
                functionName,
                functionArgs,
                justification,
                isTainted,
              );

              if (confirmed === 'y') {
                if (functionName === 'decontaminate') {
                  isTainted = false;
                }
                const callPermissions = {
                  ...this.manifest.permissions,
                  _overrideProtected: isWritingToProtected,
                  _isTainted: isTainted,
                };
                toolResult = await toolDispatcher.dispatch(toolCall, callPermissions);
                auditResult = 'confirmed';
              } else if (confirmed === 'd') {
                toolResult = 'Dry run: Tool execution simulated successfully. No changes made.';
                auditResult = 'dry-run';
              } else {
                toolResult = 'User denied tool execution.';
                auditResult = 'denied';
              }
            } else {
              const callPermissions = {
                ...this.manifest.permissions,
                _isTainted: isTainted,
              };
              toolResult = await toolDispatcher.dispatch(toolCall, callPermissions);
            }

            if (this.auditService) {
              this.auditService.log({
                event: 'tool_call',
                tool: functionName,
                args: functionArgs,
                result: auditResult,
                output: toolResult,
              });
            }

            conversationHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: functionName,
              content: toolResult,
            });
          } catch (error) {
            const errorMsg = `Error: ${error.message}`;
            if (this.auditService) {
              this.auditService.log({
                event: 'tool_error',
                tool: toolCall.function.name,
                result: 'error',
                output: errorMsg,
              });
            }
            conversationHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: errorMsg,
            });
          }
        }
      } else {
        const reply = message.content || JSON.stringify(data, null, 2);

        // Run Advisory Council if enabled and not already run in draft phase
        if (councilConfig?.enabled && councilConfig.mode !== 'always') {
          turnRiskScore = this.calculateRiskScore({
            input,
            draft: reply,
            iterations,
            isTainted,
            hasToolCalls: iterations > 1,
          });

          const shouldInvoke =
            councilConfig.mode === 'on_demand' ||
            (councilConfig.mode === 'risk_based' && turnRiskScore >= 0.5);

          if (shouldInvoke) {
            if (councilConfig.mode === 'risk_based') {
              console.log(
                `\n\x1b[33m[Risk-Based Trigger] Turn risk score: ${turnRiskScore.toFixed(2)}\x1b[0m`,
              );
            }

            const advice = await this.advisoryService.getAdvice({
              userMessage: input,
              mainDraft: reply,
              managedHistorySummary: `Post-execution phase. Context window contains ${managedHistory.length} messages.`,
              taintStatus: isTainted,
              availableToolsSummary: this.activeTools.map((t) => t.function.name).join(', '),
              healthReport: this.lastHealthReport,
            });
            if (advice) turnAdvice = advice;
          }
        }

        conversationHistory.push({ role: 'assistant', content: reply });
        this.saveHistory(conversationHistory);
        lastReply = reply;
        processing = false;
      }
    }

    const budget = config.tokenBudget || {};
    const remainingBudget =
      budget.maxTotalTokens != null
        ? Math.max(0, budget.maxTotalTokens - totalUsage.total_tokens)
        : null;

    if (iterations >= MAX_ITERATIONS && processing) {
      const limitMessage = 'Max iterations reached. Stopping to prevent infinite loop.';
      conversationHistory.push({ role: 'assistant', content: limitMessage });
      this.saveHistory(conversationHistory);
      return {
        reply: limitMessage,
        usage: { ...totalUsage, remainingBudget },
        iterations,
        resetRequested,
        advice: [],
        reflectionProposal,
        stopReason,
      };
    }

    return {
      reply: lastReply,
      usage: { ...totalUsage, remainingBudget },
      iterations,
      resetRequested,
      advice: turnAdvice,
      reflectionProposal,
      stopReason,
    };
  }

  async getManagedHistory(history) {
    // 1. Always keep the System Prompt
    const systemPrompt = history.find((m) => m.role === 'system' && !m.internal);

    // 2. Identify the boundary: the user message that started this turn.
    const userMessages = history.filter((m) => m.role === 'user');
    const currentUserInput = userMessages[userMessages.length - 1];

    if (!currentUserInput) return history;

    const inputIdx = history.indexOf(currentUserInput);

    // 3. Intermediary: everything AFTER the current user input
    const intermediary = history.slice(inputIdx + 1);

    // 4. Sliding Window: Keep only the last 10 messages of intermediary (5 turns)
    const recentIntermediary = intermediary.slice(-10);

    // 5. Prior history: everything between the system prompt and the current user input
    const sysIdx = systemPrompt ? history.indexOf(systemPrompt) : -1;
    const priorHistory = history.slice(sysIdx + 1, inputIdx);

    // 6. Original task: first user message (always preserved)
    const originalTask = history.find((m) => m.role === 'user');

    const compactionConfig = config.compaction || {};
    const compactionEnabled = compactionConfig.enabled !== false;
    const threshold = compactionConfig.threshold ?? 20;

    const managed = [];
    if (systemPrompt && sysIdx < inputIdx) {
      managed.push(systemPrompt);
    }

    if (compactionEnabled && priorHistory.length > threshold) {
      // Always preserve the original task message
      if (originalTask && originalTask !== currentUserInput) {
        managed.push(originalTask);
      }

      // Messages to summarise = prior history minus the original task
      const toSummarise = priorHistory.filter((m) => m !== originalTask);

      // Regenerate summary only when the pool of messages to summarise has grown
      if (toSummarise.length > this._lastCompactedLength) {
        try {
          const summaryMessages = [
            {
              role: 'system',
              content:
                'Summarise the following conversation context concisely. Preserve key decisions, constraints, facts, and any still-relevant tool results. Output only the summary text.',
            },
            ...toSummarise,
            {
              role: 'user',
              content: 'Provide a concise summary of the above conversation context.',
            },
          ];
          const summaryData = await callAI(summaryMessages, null);
          this._compactionSummary = summaryData?.choices?.[0]?.message?.content || '';
          this._lastCompactedLength = toSummarise.length;

          if (this.auditService) {
            this.auditService.log({
              event: 'compaction',
              at: new Date().toISOString(),
              turnsTruncated: toSummarise.length,
              summaryTokens: summaryData?.usage?.completion_tokens ?? null,
              summaryInjected: true,
            });
          }
        } catch (e) {
          process.stderr.write(`[Compaction] Summarisation failed: ${e.message}\n`);
          // Fall back to including prior history without compaction
          managed.push(...priorHistory);
          managed.push(currentUserInput);
          managed.push(...recentIntermediary);
          return managed;
        }
      }

      if (this._compactionSummary) {
        managed.push({
          role: 'system',
          content: `[Compacted Context Summary]: ${this._compactionSummary}`,
          internal: true,
        });
      }
    } else {
      managed.push(...priorHistory);
    }

    managed.push(currentUserInput);
    managed.push(...recentIntermediary);

    return managed;
  }

  saveHistory(history) {
    if (config.memoryMode === 'off') return;

    try {
      const secrets = this.auditService ? this.auditService.secrets : [];
      // Filter out internal messages from persistent history, unless storeCouncilMemos is true
      const persistentHistory = history.filter((m) => {
        if (m.internal && !config.advisoryCouncil?.storeCouncilMemos) return false;
        return true;
      });

      const redactedHistory = persistentHistory.map((m) => ({
        ...m,
        content: m.content ? redact(m.content, secrets) : m.content,
      }));

      const fullPath = path.isAbsolute(this.historyPath)
        ? this.historyPath
        : path.resolve(config.workspaceDir || '.', this.historyPath);

      let finalContent = JSON.stringify(redactedHistory, null, 2);
      if (config.encryption?.enabled) {
        const key = config.encryption.key || process.env.ANIMA_ENCRYPTION_KEY;
        if (key) {
          finalContent = encrypt(finalContent, key);
        }
      }

      fs.writeFileSync(fullPath, finalContent);

      if (process.platform !== 'win32' && fs.existsSync(fullPath)) {
        fs.chmodSync(fullPath, 0o600);
      }
    } catch (e) {
      /* ignore save errors in background */
    }
  }

  calculateRiskScore({ input, draft, iterations, isTainted, hasToolCalls }) {
    let score = 0;
    const destructiveKeywords = [
      'delete',
      'rm',
      'wipe',
      'format',
      'credentials',
      'password',
      'token',
      'secret',
      'sudo',
      'drop',
      'truncate',
    ];

    const combinedText = (input + ' ' + (draft || '')).toLowerCase();
    if (destructiveKeywords.some((kw) => combinedText.includes(kw))) {
      score += 0.5;
    }

    if (isTainted) score += 0.3;
    if (hasToolCalls) score += 0.2;
    if (iterations > 3) score += (iterations - 3) * 0.1;

    return Math.min(score, 1.0);
  }
}

module.exports = ConversationService;
