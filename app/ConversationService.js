const fs = require('node:fs');
const { callAI } = require('./Utils');
const { availableTools } = require('./Tools');

class ConversationService {
  constructor(agentName, activeTools, manifest, historyPath) {
    this.agentName = agentName;
    this.activeTools = activeTools;
    this.manifest = manifest;
    this.historyPath = historyPath;
    this.dangerousTools = [
      'write_file',
      'run_command',
      'execute_code',
      'delete_file',
      'replace_in_file',
      'add_plugin',
    ];
  }

  async processInput(input, conversationHistory, confirmCallback) {
    conversationHistory.push({ role: 'user', content: input });
    this.saveHistory(conversationHistory);

    let processing = true;
    let lastReply = '';

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

            let toolResult;
            if (this.dangerousTools.includes(functionName)) {
              const confirmed = await confirmCallback(functionName, functionArgs);
              if (confirmed === 'y') {
                toolResult = await availableTools[functionName](
                  functionArgs,
                  this.manifest.permissions,
                );
              } else if (confirmed === 'd') {
                toolResult = 'Dry run: Tool execution simulated successfully. No changes made.';
              } else {
                toolResult = 'User denied tool execution.';
              }
            } else {
              toolResult = await availableTools[functionName](
                functionArgs,
                this.manifest.permissions,
              );
            }

            conversationHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: functionName,
              content: toolResult,
            });
          } catch (error) {
            conversationHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: `Error: ${error.message}`,
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
    try {
      fs.writeFileSync(this.historyPath, JSON.stringify(history, null, 2));
    } catch (e) {
      /* ignore save errors in background */
    }
  }
}

module.exports = ConversationService;
