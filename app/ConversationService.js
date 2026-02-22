const fs = require('node:fs');
const { callAI, redact } = require('./Utils');
const { availableTools } = require('./Tools');
const config = require('./Config');

class ConversationService {
  constructor(agentName, activeTools, manifest, historyPath, auditService = null) {
    this.agentName = agentName;
    this.activeTools = activeTools;
    this.manifest = manifest;
    this.historyPath = historyPath;
    this.auditService = auditService;
    this.dangerousTools = ['run_command', 'execute_code', 'add_plugin'];
  }

  isProtectedPath(filePath) {
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
    conversationHistory.push({ role: 'user', content: input });
    this.saveHistory(conversationHistory);

    let processing = true;
    let lastReply = '';
    let isTainted = false; // Reset taint per user input turn

    while (processing) {
      let data;
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          attempts++;
          data = await callAI(conversationHistory, this.activeTools);
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

      const message = data.choices[0].message;

      if (message.tool_calls) {
        conversationHistory.push(message);

        for (const toolCall of message.tool_calls) {
          try {
            const functionName = toolCall.function.name;
            const functionArgs = JSON.parse(toolCall.function.arguments);

            // Taint tracking: web_search taints the current turn
            if (functionName === 'web_search') {
              isTainted = true;
            }

            let toolResult;
            let auditResult = 'allowed';
            const isWritingToProtected =
              ['write_file', 'delete_file', 'replace_in_file'].includes(functionName) &&
              this.isProtectedPath(functionArgs.path);

            if (this.dangerousTools.includes(functionName) || isWritingToProtected) {
              const justification = functionArgs.justification || 'No justification provided.';
              
              // Pass taint info to confirmation callback if needed
              const confirmed = await confirmCallback(functionName, functionArgs, justification, isTainted);
              
              if (confirmed === 'y') {
                const callPermissions = {
                  ...this.manifest.permissions,
                  _overrideProtected: isWritingToProtected,
                  _isTainted: isTainted, // Pass taint flag to the tool itself
                };
                toolResult = await availableTools[functionName](functionArgs, callPermissions);
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
              toolResult = await availableTools[functionName](
                functionArgs,
                callPermissions,
              );
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
    return lastReply;
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
        : path.resolve(config.workspaceDir, this.historyPath);

      fs.writeFileSync(fullPath, JSON.stringify(redactedHistory, null, 2));

      // On Linux, set 0600 permissions
      if (process.platform !== 'win32' && fs.existsSync(fullPath)) {
        fs.chmodSync(fullPath, 0o600);
      }
    } catch (e) {
      /* ignore save errors in background */
    }
  }
}

module.exports = ConversationService;
