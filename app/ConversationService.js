const fs = require('node:fs');
const path = require('node:path');
const { callAI, redact } = require('./Utils');
const toolDispatcher = require('./ToolDispatcher');
const config = require('./Config');

class ConversationService {
  constructor(agentName, activeTools, manifest, historyPath, auditService = null) {
    this.agentName = agentName;
    this.activeTools = activeTools;
    this.manifest = manifest;
    this.historyPath = historyPath;
    this.auditService = auditService;
    this.dangerousTools = [
      'run_command',
      'execute_code',
      'add_plugin',
      'write_file',
      'delete_file',
      'replace_in_file',
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
    const wrappedInput = `<user_input>\n${input}\n</user_input>`;
    conversationHistory.push({ role: 'user', content: wrappedInput });
    this.saveHistory(conversationHistory);

    let processing = true;
    let lastReply = '';
    let isTainted = false; // Reset taint per user input turn
    let iterations = 0;
    const MAX_ITERATIONS = 10;
    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let resetRequested = null;

    while (processing && iterations < MAX_ITERATIONS) {
      iterations++;
      let data;
      let attempts = 0;
      const maxAttempts = 3;

      const managedHistory = this.getManagedHistory(conversationHistory);

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
        conversationHistory.push({ role: 'assistant', content: reply });
        this.saveHistory(conversationHistory);
        lastReply = reply;
        processing = false;
      }
    }

    if (iterations >= MAX_ITERATIONS && processing) {
      const limitMessage = 'Max iterations reached. Stopping to prevent infinite loop.';
      conversationHistory.push({ role: 'assistant', content: limitMessage });
      this.saveHistory(conversationHistory);
      return { reply: limitMessage, usage: totalUsage, iterations, resetRequested };
    }

    return { reply: lastReply, usage: totalUsage, iterations, resetRequested };
  }

  getManagedHistory(history) {
    const systemPrompt = history.find((m) => m.role === 'system');
    const userMessages = history.filter((m) => m.role === 'user');
    const originalUserPrompt = userMessages[userMessages.length - 1];

    if (!originalUserPrompt) return history;

    const originalIdx = history.indexOf(originalUserPrompt);
    const intermediary = history.slice(originalIdx + 1);
    const recentIntermediary = intermediary.slice(-10);

    const managed = [];
    if (systemPrompt && history.indexOf(systemPrompt) < originalIdx) {
      managed.push(systemPrompt);
    }
    managed.push(originalUserPrompt);
    managed.push(...recentIntermediary);

    return managed;
  }

  saveHistory(history) {
    if (config.memoryMode === 'off') return;

    try {
      const secrets = this.auditService ? this.auditService.secrets : [];
      const redactedHistory = history.map((m) => ({
        ...m,
        content: m.content ? redact(m.content, secrets) : m.content,
      }));

      const fullPath = path.isAbsolute(this.historyPath)
        ? this.historyPath
        : path.resolve(config.workspaceDir || '.', this.historyPath);

      fs.writeFileSync(fullPath, JSON.stringify(redactedHistory, null, 2));

      if (process.platform !== 'win32' && fs.existsSync(fullPath)) {
        fs.chmodSync(fullPath, 0o600);
      }
    } catch (e) {
      /* ignore save errors in background */
    }
  }
}

module.exports = ConversationService;
