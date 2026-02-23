const { availableTools, tools } = require('./Tools');

class ToolDispatcher {
  constructor() {
    this.toolsRegistry = tools.reduce((acc, t) => {
      acc[t.function.name] = t.function;
      return acc;
    }, {});
  }

  async dispatch(toolCall, permissions) {
    const { name, arguments: argsString } = toolCall.function;
    const toolDef = this.toolsRegistry[name];

    if (!toolDef) {
      return `Error: Unknown tool '${name}'. Please only use registered tools.`;
    }

    let args;
    try {
      args = JSON.parse(argsString);
    } catch (e) {
      return `Error: Malformed JSON arguments for tool '${name}'. Ensure valid JSON.`;
    }

    // Strict Input Validation
    const validationError = this.validateArgs(toolDef, args);
    if (validationError) {
      return `Error: Invalid arguments for tool '${name}': ${validationError}`;
    }

    try {
      const toolFn = availableTools[name];
      if (!toolFn) {
        return `Error: Tool '${name}' is defined but its implementation is missing.`;
      }
      return await toolFn(args, permissions);
    } catch (error) {
      return `Error: Execution of tool '${name}' failed: ${error.message}`;
    }
  }

  validateArgs(toolDef, args) {
    const schema = toolDef.parameters;
    if (!schema || schema.type !== 'object') return null;

    const required = schema.required || [];
    for (const prop of required) {
      if (args[prop] === undefined) {
        return `Missing required parameter: '${prop}'`;
      }
    }

    for (const [key, value] of Object.entries(args)) {
      const propDef = schema.properties[key];
      if (!propDef) {
        return `Unexpected parameter: '${key}'`;
      }

      // Type checks
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      let expectedType = propDef.type;
      
      // Normalize 'integer' to 'number' for simple check
      if (expectedType === 'integer') expectedType = 'number';

      if (actualType !== expectedType && expectedType !== 'object') {
         return `Parameter '${key}' expected type '${propDef.type}', got '${actualType}'`;
      }
    }

    return null;
  }
}

module.exports = new ToolDispatcher();
