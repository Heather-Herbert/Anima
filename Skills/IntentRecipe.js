const fs = require('node:fs');
const path = require('node:path');

const RECIPES_DIR = path.join(__dirname, '..', 'Recipes');
const DEFAULT_MAX_RESULTS = 3;
const MATCH_THRESHOLD = 0.01;
const BRANCH_LABELS = 'abcdefghijklmnopqrstuvwxyz';

// --- Recipe I/O ---

const getRecipesDir = () => RECIPES_DIR;

const loadAllRecipes = () => {
  const dir = getRecipesDir();
  if (!fs.existsSync(dir)) return [];

  const recipes = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(dir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (isValidRecipe(data)) recipes.push(data);
    } catch {
      /* skip malformed files */
    }
  }
  return recipes;
};

const loadRecipeById = (id) => {
  const filePath = path.join(getRecipesDir(), `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return isValidRecipe(data) ? data : null;
  } catch {
    return null;
  }
};

const saveRecipe = (recipe) => {
  const dir = getRecipesDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${recipe.id}.json`), JSON.stringify(recipe, null, 2), 'utf8');
};

// --- Validation ---

const RECIPE_REQUIRED_FIELDS = ['id', 'name', 'description', 'intents', 'steps'];

// Validators for optional input/output descriptor objects.
const isValidInput = (inp) =>
  inp != null &&
  typeof inp === 'object' &&
  typeof inp.name === 'string' &&
  inp.name.trim().length > 0 &&
  typeof inp.description === 'string' &&
  inp.description.trim().length > 0 &&
  (inp.required === undefined || typeof inp.required === 'boolean');

const isValidOutput = (out) =>
  out != null &&
  typeof out === 'object' &&
  typeof out.name === 'string' &&
  out.name.trim().length > 0 &&
  typeof out.description === 'string' &&
  out.description.trim().length > 0;

// A step is either a non-empty string or a conditional object { if, then, else? }.
// The then/else branches may themselves contain further steps (recursive).
const isValidStep = (step) => {
  if (typeof step === 'string') return step.trim().length > 0;
  if (step && typeof step === 'object') {
    if (typeof step.if !== 'string' || step.if.trim().length === 0) return false;
    if (!Array.isArray(step.then) || step.then.length === 0) return false;
    if (!step.then.every(isValidStep)) return false;
    if (step.else !== undefined) {
      if (!Array.isArray(step.else) || step.else.length === 0) return false;
      if (!step.else.every(isValidStep)) return false;
    }
    return true;
  }
  return false;
};

const isValidRecipe = (data) => {
  if (!data || typeof data !== 'object') return false;
  for (const field of RECIPE_REQUIRED_FIELDS) {
    if (!data[field]) return false;
  }
  if (!Array.isArray(data.intents) || data.intents.length === 0) return false;
  if (!Array.isArray(data.steps) || data.steps.length === 0) return false;
  if (!data.steps.every(isValidStep)) return false;
  // Optional fields — validate structure if present.
  if (data.version !== undefined && typeof data.version !== 'string') return false;
  if (
    data.inputs !== undefined &&
    (!Array.isArray(data.inputs) || !data.inputs.every(isValidInput))
  )
    return false;
  if (
    data.outputs !== undefined &&
    (!Array.isArray(data.outputs) || !data.outputs.every(isValidOutput))
  )
    return false;
  if (
    data.adviser_profile !== undefined &&
    (!Array.isArray(data.adviser_profile) ||
      !data.adviser_profile.every((s) => typeof s === 'string' && s.trim().length > 0))
  )
    return false;
  if (
    data.max_advisers !== undefined &&
    (!Number.isInteger(data.max_advisers) || data.max_advisers < 1)
  )
    return false;
  return true;
};

const validateNewRecipe = (args) => {
  if (!/^[a-z][a-z0-9_]*$/.test(args.id)) {
    return "Recipe 'id' must be snake_case starting with a letter (e.g. 'my_recipe').";
  }
  if (typeof args.name !== 'string' || args.name.trim().length === 0) {
    return "Recipe 'name' must be a non-empty string.";
  }
  if (typeof args.description !== 'string' || args.description.trim().length === 0) {
    return "Recipe 'description' must be a non-empty string.";
  }
  if (!Array.isArray(args.intents) || args.intents.length === 0) {
    return "Recipe 'intents' must be a non-empty array of strings.";
  }
  if (!Array.isArray(args.steps) || args.steps.length === 0) {
    return "Recipe 'steps' must be a non-empty array of steps.";
  }
  // Filter blanks first (add_recipe strips them on save) then validate structure.
  const nonBlankSteps = args.steps.filter((s) => typeof s !== 'string' || s.trim().length > 0);
  if (nonBlankSteps.length === 0) {
    return "Recipe 'steps' must contain at least one non-blank step.";
  }
  if (!nonBlankSteps.every(isValidStep)) {
    return "Recipe 'steps' contains invalid entries. Each step must be a non-empty string or a conditional object with 'if' and 'then' fields.";
  }
  if (
    args.version !== undefined &&
    (typeof args.version !== 'string' || args.version.trim().length === 0)
  ) {
    return "Recipe 'version' must be a non-empty string (e.g. '1.0.0').";
  }
  if (
    args.inputs !== undefined &&
    (!Array.isArray(args.inputs) || !args.inputs.every(isValidInput))
  ) {
    return "Recipe 'inputs' must be an array of objects each with 'name' and 'description' fields.";
  }
  if (
    args.outputs !== undefined &&
    (!Array.isArray(args.outputs) || !args.outputs.every(isValidOutput))
  ) {
    return "Recipe 'outputs' must be an array of objects each with 'name' and 'description' fields.";
  }
  if (
    args.adviser_profile !== undefined &&
    (!Array.isArray(args.adviser_profile) ||
      !args.adviser_profile.every((s) => typeof s === 'string' && s.trim().length > 0))
  ) {
    return "Recipe 'adviser_profile' must be an array of non-empty adviser name strings.";
  }
  if (
    args.max_advisers !== undefined &&
    (!Number.isInteger(args.max_advisers) || args.max_advisers < 1)
  ) {
    return "Recipe 'max_advisers' must be a positive integer.";
  }
  return null;
};

// --- Scoring ---

const tokenize = (text) => (text || '').toLowerCase().match(/\b\w+\b/g) || [];

const scoreRecipe = (queryTokens, recipe) => {
  if (queryTokens.length === 0) return 0;

  const queryText = queryTokens.join(' ');

  // Phrase matching against intent strings (highest weight)
  let phraseScore = 0;
  for (const intent of recipe.intents) {
    const intentLower = intent.toLowerCase();
    if (queryText.includes(intentLower) || intentLower.includes(queryText)) {
      phraseScore += 2;
    }
  }

  // Token overlap across intents + name + description
  const targetText = [
    ...recipe.intents,
    recipe.name,
    recipe.description,
    ...(recipe.tags || []),
  ].join(' ');
  const targetTokens = tokenize(targetText);
  const targetFreq = new Map();
  for (const t of targetTokens) targetFreq.set(t, (targetFreq.get(t) || 0) + 1);

  let overlapScore = 0;
  for (const qt of queryTokens) {
    if (targetFreq.has(qt)) overlapScore += targetFreq.get(qt);
  }
  overlapScore /= targetTokens.length || 1;

  return phraseScore + overlapScore;
};

// --- Public matching helper (used by ConversationService for auto-injection) ---

const matchIntents = (input, maxResults = DEFAULT_MAX_RESULTS) => {
  const queryTokens = tokenize(input);
  const recipes = loadAllRecipes();

  return recipes
    .map((r) => ({ recipe: r, score: scoreRecipe(queryTokens, r) }))
    .filter(({ score }) => score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(({ recipe, score }) => ({ recipe, score }));
};

// --- Formatting ---

// Recursively formats an array of steps (strings or conditional branch objects).
// depth controls indentation; top-level steps are numbered 1, 2, 3…
// nested branch steps are labelled a, b, c… to visually distinguish them.
const formatSteps = (steps, depth = 0) => {
  const indent = '  '.repeat(depth + 1);
  const lines = [];
  steps.forEach((step, i) => {
    const label = depth === 0 ? `${i + 1}.` : `${BRANCH_LABELS[i] ?? i + 1}.`;
    if (typeof step === 'string') {
      lines.push(`${indent}${label} ${step}`);
    } else {
      lines.push(`${indent}${label} IF: ${step.if}`);
      lines.push(`${indent}   THEN:`);
      lines.push(...formatSteps(step.then, depth + 1));
      if (step.else?.length) {
        lines.push(`${indent}   ELSE:`);
        lines.push(...formatSteps(step.else, depth + 1));
      }
    }
  });
  return lines;
};

const formatRecipeFull = (recipe) => {
  const version = recipe.version ? ` v${recipe.version}` : '';
  const tags = recipe.tags?.length ? `\nTags: ${recipe.tags.join(', ')}` : '';

  let inputsStr = '';
  if (recipe.inputs?.length) {
    const lines = recipe.inputs.map((inp) => {
      const req = inp.required === false ? ' (optional)' : ' (required)';
      return `  - ${inp.name}${req}: ${inp.description}`;
    });
    inputsStr = `\nInputs:\n${lines.join('\n')}`;
  }

  let outputsStr = '';
  if (recipe.outputs?.length) {
    const lines = recipe.outputs.map((out) => `  - ${out.name}: ${out.description}`);
    outputsStr = `\nOutputs:\n${lines.join('\n')}`;
  }

  const adviserStr = recipe.adviser_profile?.length
    ? `\nAdvisory: ${recipe.adviser_profile.join(', ')} will review this workflow.`
    : '';

  const stepLines = formatSteps(recipe.steps).join('\n');
  return (
    `**${recipe.name}** (${recipe.id})${version}\n` +
    `${recipe.description}${tags}${inputsStr}${outputsStr}${adviserStr}\n\nSteps:\n${stepLines}`
  );
};

const formatRecipeSummary = (recipe) => {
  const tags = recipe.tags?.length ? ` [${recipe.tags.join(', ')}]` : '';
  return `- **${recipe.name}** (${recipe.id})${tags}: ${recipe.description}`;
};

// --- Tool Implementations ---

const implementations = {
  match_intent: async ({ input, max_results = DEFAULT_MAX_RESULTS }, _permissions) => {
    try {
      const matches = matchIntents(input, max_results);

      if (matches.length === 0) {
        return (
          'No matching recipes found for that request.\n\n' +
          'You can:\n' +
          '- Use `list_recipes` to browse all available recipes\n' +
          '- Use `add_recipe` to create a new recipe for this workflow'
        );
      }

      const parts = matches.map(({ recipe, score }) => {
        const scoreNote = `(match score: ${score.toFixed(3)})`;
        return `${formatRecipeFull(recipe)}\n${scoreNote}`;
      });

      return `Found ${matches.length} matching recipe(s):\n\n${parts.join('\n\n---\n\n')}`;
    } catch (e) {
      return `Error matching intent: ${e.message}`;
    }
  },

  list_recipes: async (_args, _permissions) => {
    try {
      const recipes = loadAllRecipes();
      if (recipes.length === 0) {
        return 'No recipes found. Use `add_recipe` to create your first recipe.';
      }
      const lines = recipes.map(formatRecipeSummary);
      return `Available recipes (${recipes.length}):\n\n${lines.join('\n')}`;
    } catch (e) {
      return `Error listing recipes: ${e.message}`;
    }
  },

  get_recipe: async ({ id }, _permissions) => {
    try {
      const recipe = loadRecipeById(id);
      if (!recipe) {
        return `Recipe '${id}' not found. Use \`list_recipes\` to see available recipes.`;
      }
      return formatRecipeFull(recipe);
    } catch (e) {
      return `Error loading recipe '${id}': ${e.message}`;
    }
  },

  add_recipe: async (args, _permissions) => {
    try {
      const validationError = validateNewRecipe(args);
      if (validationError) return `Error: ${validationError}`;

      const existing = loadRecipeById(args.id);
      if (existing) {
        return `Error: A recipe with id '${args.id}' already exists. Choose a different id.`;
      }

      const recipe = {
        id: args.id,
        name: args.name.trim(),
        description: args.description.trim(),
        intents: args.intents.map((s) => s.trim()).filter(Boolean),
        steps: args.steps
          .map((s) => (typeof s === 'string' ? s.trim() : s))
          .filter((s) => (typeof s === 'string' ? s.length > 0 : isValidStep(s))),
        tags: (args.tags || []).map((s) => s.trim()).filter(Boolean),
        ...(args.version ? { version: args.version.trim() } : {}),
        ...(args.inputs?.length ? { inputs: args.inputs } : {}),
        ...(args.outputs?.length ? { outputs: args.outputs } : {}),
        ...(args.adviser_profile?.length
          ? { adviser_profile: args.adviser_profile.map((s) => s.trim()).filter(Boolean) }
          : {}),
        ...(args.max_advisers !== undefined ? { max_advisers: args.max_advisers } : {}),
      };

      saveRecipe(recipe);
      return `Recipe '${recipe.name}' saved as '${recipe.id}.json' in Recipes/. It will be available immediately.`;
    } catch (e) {
      return `Error saving recipe: ${e.message}`;
    }
  },
};

module.exports = {
  implementations,
  matchIntents,
  formatSteps,
  _test: {
    tokenize,
    scoreRecipe,
    isValidInput,
    isValidOutput,
    isValidStep,
    isValidRecipe,
    validateNewRecipe,
    formatSteps,
    formatRecipeFull,
    formatRecipeSummary,
    loadAllRecipes,
    MATCH_THRESHOLD,
  },
};
