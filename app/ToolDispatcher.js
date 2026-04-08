const { availableTools, tools } = require('./Tools');
const agentTypeService = require('./AgentTypeService');

class ToolDispatcher {
  constructor() {
    this.auditService = null;
    this.agentType = null;
    this.toolsRegistry = tools.reduce((acc, t) => {
      acc[t.function.name] = t.function;
      return acc;
    }, {});
  }

  initialize(auditService) {
    this.auditService = auditService;
  }

  /** Set the active agent type for runtime tool enforcement. */
  setAgentType(typeName) {
    this.agentType = typeName;
  }

  async dispatch(toolCall, permissions) {
    const { name, arguments: argsString } = toolCall.function;

    // Agent-type enforcement: block tools not in the type's allowlist.
    if (this.agentType && !agentTypeService.isToolAllowed(name, this.agentType)) {
      const msg = `Error: Tool '${name}' is not permitted for agent type '${this.agentType}'.`;
      if (this.auditService) {
        this.auditService.logFailure(`AgentType Block: ${name}`, msg, {
          agentType: this.agentType,
        });
      }
      return msg;
    }

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
        const missingError = `Error: Tool '${name}' is defined but its implementation is missing.`;
        if (this.auditService) {
          this.auditService.logFailure(`Tool Dispatch: ${name}`, missingError, { args });
        }
        return missingError;
      }
      const toolPermissions = {
        ...permissions,
        auditService: this.auditService,
      };
      const result = await toolFn(args, toolPermissions);

      // Log "soft" failures (returned error strings)
      if (
        typeof result === 'string' &&
        (result.startsWith('Error:') || result.startsWith('Failure:'))
      ) {
        if (this.auditService) {
          this.auditService.logFailure(`Tool Logic Failure: ${name}`, result, { args });
        }
      }

      return result;
    } catch (error) {
      if (this.auditService) {
        this.auditService.logFailure(`Tool Execution: ${name}`, error, { args });
      }
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
        // We allow extra parameters for flexibility, or we could be strict.
        // Given we want to harden, let's be strict.
        return `Unexpected parameter: '${key}'`;
      }

      const actualType = Array.isArray(value) ? 'array' : typeof value;
      const expectedType = propDef.type;

      if (expectedType === 'integer') {
        if (!Number.isInteger(value)) {
          return `Parameter '${key}' expected type 'integer', got '${actualType}'`;
        }
      } else if (actualType !== expectedType && expectedType !== 'object') {
        return `Parameter '${key}' expected type '${expectedType}', got '${actualType}'`;
      }
    }

    return null;
  }
}

module.exports = new ToolDispatcher();
