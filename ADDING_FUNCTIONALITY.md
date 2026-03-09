# Adding Functionality to Anima

This guide is for developers who want to extend Anima's capabilities. Anima is designed to be modular and easy to hack.

## 1. Adding a New Tool

Tools are the primary way Anima interacts with the world. They are defined in `app/Tools.js`.

### Step A: Define the Tool Schema
Add an entry to the `tools` array. Use the standard OpenAI Function Calling format.

```javascript
// app/Tools.js
const tools = [
  // ... existing tools
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather for a city',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string' },
          justification: { type: 'string', description: 'Why you need this' }
        },
        required: ['city', 'justification']
      }
    }
  }
];
```

### Step B: Implement the Logic
Add a corresponding function to the `availableTools` object.

```javascript
// app/Tools.js
const availableTools = {
  // ... existing implementations
  get_weather: async ({ city }, permissions) => {
    // Check permissions if this tool touches sensitive areas
    const result = await someWeatherApi(city);
    return `The weather in ${city} is ${result}.`;
  }
};
```

**Note**: The `ToolDispatcher` automatically validates incoming arguments against your schema before calling your function.

---

## 2. Creating a Skill (Tool Plugin)

Skills are portable bundles of tools that can be installed without modifying core code. They live in the `Skills/` directory.

### Step A: Create the Manifest
Create `Skills/MySkill.manifest.json`.

```json
{
  "name": "MySkill",
  "type": "skill",
  "description": "Adds cool new features",
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "cool_feature",
        "description": "Does something cool",
        "parameters": {
          "type": "object",
          "properties": { "arg1": { "type": "string" } },
          "required": ["arg1"]
        }
      }
    }
  ]
}
```

### Step B: Create the Implementation
Create `Skills/MySkill.js`.

```javascript
const implementations = {
  cool_feature: async ({ arg1 }, permissions) => {
    return `Feature result: ${arg1}`;
  }
};

module.exports = { implementations };
```

Anima will automatically load any `.js` file in the `Skills/` directory that has a matching `.manifest.json`.

---

## 3. Adding a New LLM Provider

Providers are plugins that handle the actual AI completion.

1.  **Create Manifest**: Add `Plugins/MyProvider.manifest.json`.
    ```json
    {
      "name": "MyProvider",
      "capabilities": { "tools": ["*"] }
    }
    ```
2.  **Implement Provider**: Create `Plugins/MyProvider.js`. It must export a `completion(messages, tools)` function.
3.  **Security**: Providers run in an isolated separate process via `app/ProviderRunner.js`.

---

## 3. Adding an Advisory Council Member

Advisers provide feedback on the main agent's drafts.

1.  **Create Prompt**: Add a new `.md` file to `Personality/Advisers/` (e.g., `CodeReviewer.md`).
2.  **Register**: Add them to your `Settings/Anima.config.json`.
    ```json
    "advisers": [
      {
        "name": "CodeReviewer",
        "role": "Senior Engineer",
        "promptFile": "CodeReviewer.md"
      }
    ]
    ```

---

## 4. Agent Evolution (Continuous Parturition)

Anima can evolve its identity based on successful tasks and user feedback.

1. **Identity.md**: Located in `Personality/`. This defines the agent's current name, role, and expertise.
2. **milestones.json**: Located in `Memory/`. This tracks specific achievements and skills learned.

### How it works:
- When you use the `/save` command or exit the CLI, Anima analyzes the session's conversation history.
- The `EvolutionService` proposes new milestones or refinements to `Identity.md`.
- You will be asked to approve these changes.
- Once approved, they are persisted and loaded into the system prompt for future sessions.

---

## 5. Testing

Always add tests for new functionality!

- **Unit Tests**: Add a `.test.js` file in the relevant directory.
- **Run Tests**: `npm test`
- **Check Coverage**: `npm test -- --coverage`
- **Linting**: `npm run lint`

### Useful Mocks
Check `app/ConversationService.test.js` or `app/Security.test.js` for examples of how to mock the LLM or the filesystem.

---

## 5. Security Principles

When adding code, keep these principles in mind:
- **Deny-by-Default**: Don't grant access unless explicitly required.
- **Redaction**: Use the `redact` utility in `app/Utils.js` for any output that might contain secrets.
- **Taint Tracking**: If your tool pulls data from the internet, ensure it sets/respects the `isTainted` flag.
- **Path Validation**: Use `isPathAllowed` for all filesystem operations.
