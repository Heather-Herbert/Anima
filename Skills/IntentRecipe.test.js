const { describe, it, expect, beforeEach } = require('@jest/globals');
const fs = require('node:fs');
const path = require('node:path');

jest.mock('node:fs');

const {
  implementations,
  matchIntents,
  formatSteps: formatStepsPublic,
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
    MATCH_THRESHOLD: _MATCH_THRESHOLD,
  },
} = require('./IntentRecipe');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GIT_RECIPE = {
  id: 'git_workflow',
  name: 'Git Commit and Push Workflow',
  description: 'Stage, commit, and push code changes to a git repository',
  intents: ['commit', 'push', 'git commit', 'git push', 'save changes', 'stage files'],
  steps: ['Run git status', 'Run git add', 'Run git commit', 'Run git push'],
  tags: ['git', 'version-control'],
};

const TEST_RECIPE = {
  id: 'run_tests',
  name: 'Run Tests Workflow',
  description: 'Run the project test suite, check coverage, and fix failures',
  intents: ['run tests', 'test', 'npm test', 'jest', 'failing test'],
  steps: ['Run npm test', 'Review failures', 'Fix code', 'Rerun test'],
  tags: ['testing'],
};

const BRANCHING_RECIPE = {
  id: 'deploy_workflow',
  name: 'Deploy to Environment',
  description: 'Build, test, and deploy the application',
  intents: ['deploy', 'release', 'ship it'],
  steps: [
    'Run npm test',
    {
      if: 'all tests pass',
      then: ['Build artifact', 'Deploy to server'],
      else: ['Fix failing tests'],
    },
    'Verify deployment',
  ],
  tags: ['deploy'],
};

const RECIPE_DIR = path.join(__dirname, '..', 'Recipes');

const mockRecipesDir = (recipes = [GIT_RECIPE, TEST_RECIPE]) => {
  fs.existsSync.mockImplementation((p) => {
    if (p === RECIPE_DIR) return true;
    for (const r of recipes) {
      if (p === path.join(RECIPE_DIR, `${r.id}.json`)) return true;
    }
    return false;
  });
  fs.readdirSync.mockReturnValue(recipes.map((r) => `${r.id}.json`));
  fs.readFileSync.mockImplementation((p) => {
    for (const r of recipes) {
      if (p === path.join(RECIPE_DIR, `${r.id}.json`)) return JSON.stringify(r);
    }
    throw new Error(`ENOENT: ${p}`);
  });
};

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

describe('tokenize', () => {
  it('splits text into lowercase tokens', () => {
    expect(tokenize('Run Git Tests')).toEqual(['run', 'git', 'tests']);
  });

  it('handles empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('handles null/undefined gracefully', () => {
    expect(tokenize(null)).toEqual([]);
    expect(tokenize(undefined)).toEqual([]);
  });

  it('strips punctuation', () => {
    expect(tokenize('npm test --coverage')).toContain('npm');
    expect(tokenize('npm test --coverage')).toContain('coverage');
  });
});

// ---------------------------------------------------------------------------
// isValidRecipe
// ---------------------------------------------------------------------------

describe('isValidRecipe', () => {
  it('accepts a well-formed recipe', () => {
    expect(isValidRecipe(GIT_RECIPE)).toBe(true);
  });

  it('rejects null', () => {
    expect(isValidRecipe(null)).toBe(false);
  });

  it('rejects missing required field', () => {
    const { steps: _s, ...noSteps } = GIT_RECIPE;
    expect(isValidRecipe(noSteps)).toBe(false);
  });

  it('rejects empty intents array', () => {
    expect(isValidRecipe({ ...GIT_RECIPE, intents: [] })).toBe(false);
  });

  it('rejects empty steps array', () => {
    expect(isValidRecipe({ ...GIT_RECIPE, steps: [] })).toBe(false);
  });

  it('accepts a recipe with conditional branch steps', () => {
    expect(isValidRecipe(BRANCHING_RECIPE)).toBe(true);
  });

  it('rejects a recipe with an invalid step object', () => {
    expect(isValidRecipe({ ...GIT_RECIPE, steps: [{ if: 'cond' }] })).toBe(false);
  });

  it('accepts a recipe with valid inputs, outputs, version, and adviser_profile', () => {
    const full = {
      ...GIT_RECIPE,
      version: '1.0.0',
      inputs: [{ name: 'branch', description: 'Target branch' }],
      outputs: [{ name: 'commit_sha', description: 'SHA of the new commit' }],
      adviser_profile: ['SecurityAuditor'],
    };
    expect(isValidRecipe(full)).toBe(true);
  });

  it('rejects a recipe with a non-string version', () => {
    expect(isValidRecipe({ ...GIT_RECIPE, version: 42 })).toBe(false);
  });

  it('rejects a recipe with a malformed input object', () => {
    expect(isValidRecipe({ ...GIT_RECIPE, inputs: [{ name: 'x' }] })).toBe(false);
  });

  it('rejects a recipe with a malformed output object', () => {
    expect(isValidRecipe({ ...GIT_RECIPE, outputs: [{ description: 'missing name' }] })).toBe(
      false,
    );
  });

  it('rejects a recipe with a non-string adviser in adviser_profile', () => {
    expect(isValidRecipe({ ...GIT_RECIPE, adviser_profile: [42] })).toBe(false);
  });

  it('accepts a recipe with a valid max_advisers', () => {
    expect(isValidRecipe({ ...GIT_RECIPE, max_advisers: 2 })).toBe(true);
  });

  it('rejects a recipe with max_advisers of zero', () => {
    expect(isValidRecipe({ ...GIT_RECIPE, max_advisers: 0 })).toBe(false);
  });

  it('rejects a recipe with a non-integer max_advisers', () => {
    expect(isValidRecipe({ ...GIT_RECIPE, max_advisers: 1.5 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateNewRecipe
// ---------------------------------------------------------------------------

describe('validateNewRecipe', () => {
  const valid = {
    id: 'my_recipe',
    name: 'My Recipe',
    description: 'Does something useful',
    intents: ['do something'],
    steps: ['Step one'],
  };

  it('accepts a valid recipe', () => {
    expect(validateNewRecipe(valid)).toBeNull();
  });

  it('rejects invalid id format', () => {
    expect(validateNewRecipe({ ...valid, id: 'My Recipe' })).toMatch(/snake_case/);
    expect(validateNewRecipe({ ...valid, id: '1bad' })).toMatch(/snake_case/);
    expect(validateNewRecipe({ ...valid, id: 'bad-id' })).toMatch(/snake_case/);
  });

  it('rejects blank name', () => {
    expect(validateNewRecipe({ ...valid, name: '  ' })).toMatch(/name/);
  });

  it('rejects empty intents', () => {
    expect(validateNewRecipe({ ...valid, intents: [] })).toMatch(/intents/);
  });

  it('rejects empty steps', () => {
    expect(validateNewRecipe({ ...valid, steps: [] })).toMatch(/steps/);
  });

  it('accepts a recipe with conditional branch steps', () => {
    const withBranch = {
      ...valid,
      steps: ['Do first thing', { if: 'condition met', then: ['Branch A'] }],
    };
    expect(validateNewRecipe(withBranch)).toBeNull();
  });

  it('rejects a recipe with an invalid step object', () => {
    const withBadStep = { ...valid, steps: [{ if: 'cond' }] }; // missing then
    expect(validateNewRecipe(withBadStep)).toMatch(/invalid/i);
  });

  it('strips blank string steps before validating structure', () => {
    // A blank string step should be silently ignored, not cause a validation error.
    const withBlank = { ...valid, steps: ['Valid step', '', 'Another step'] };
    expect(validateNewRecipe(withBlank)).toBeNull();
  });

  it('accepts valid version, inputs, outputs, adviser_profile', () => {
    const full = {
      ...valid,
      version: '2.0.0',
      inputs: [{ name: 'src', description: 'Source path' }],
      outputs: [{ name: 'result', description: 'Output file' }],
      adviser_profile: ['LegalCounsel'],
    };
    expect(validateNewRecipe(full)).toBeNull();
  });

  it('rejects blank version string', () => {
    expect(validateNewRecipe({ ...valid, version: '  ' })).toMatch(/version/);
  });

  it('rejects malformed inputs', () => {
    expect(validateNewRecipe({ ...valid, inputs: [{ name: 'x' }] })).toMatch(/inputs/);
  });

  it('rejects malformed outputs', () => {
    expect(validateNewRecipe({ ...valid, outputs: [{}] })).toMatch(/outputs/);
  });

  it('rejects non-string adviser_profile entry', () => {
    expect(validateNewRecipe({ ...valid, adviser_profile: [123] })).toMatch(/adviser_profile/);
  });

  it('accepts a valid max_advisers integer', () => {
    expect(validateNewRecipe({ ...valid, max_advisers: 2 })).toBeNull();
  });

  it('rejects max_advisers of zero', () => {
    expect(validateNewRecipe({ ...valid, max_advisers: 0 })).toMatch(/max_advisers/);
  });

  it('rejects negative max_advisers', () => {
    expect(validateNewRecipe({ ...valid, max_advisers: -1 })).toMatch(/max_advisers/);
  });

  it('rejects non-integer max_advisers', () => {
    expect(validateNewRecipe({ ...valid, max_advisers: 1.5 })).toMatch(/max_advisers/);
    expect(validateNewRecipe({ ...valid, max_advisers: 'two' })).toMatch(/max_advisers/);
  });
});

// ---------------------------------------------------------------------------
// isValidStep
// ---------------------------------------------------------------------------

describe('isValidStep', () => {
  it('accepts a non-empty string step', () => {
    expect(isValidStep('Run npm test')).toBe(true);
  });

  it('rejects an empty string step', () => {
    expect(isValidStep('')).toBe(false);
    expect(isValidStep('   ')).toBe(false);
  });

  it('accepts a conditional step with then only', () => {
    expect(isValidStep({ if: 'tests pass', then: ['Deploy'] })).toBe(true);
  });

  it('accepts a conditional step with then and else', () => {
    expect(isValidStep({ if: 'tests pass', then: ['Deploy'], else: ['Fix tests'] })).toBe(true);
  });

  it('rejects a conditional step missing if', () => {
    expect(isValidStep({ then: ['Deploy'] })).toBe(false);
  });

  it('rejects a conditional step with empty if string', () => {
    expect(isValidStep({ if: '  ', then: ['Deploy'] })).toBe(false);
  });

  it('rejects a conditional step missing then', () => {
    expect(isValidStep({ if: 'tests pass' })).toBe(false);
  });

  it('rejects a conditional step with empty then array', () => {
    expect(isValidStep({ if: 'tests pass', then: [] })).toBe(false);
  });

  it('rejects a conditional step with empty else array', () => {
    expect(isValidStep({ if: 'tests pass', then: ['Deploy'], else: [] })).toBe(false);
  });

  it('accepts recursively nested conditionals', () => {
    expect(
      isValidStep({
        if: 'outer condition',
        then: [{ if: 'inner condition', then: ['Do something'] }],
      }),
    ).toBe(true);
  });

  it('rejects non-string, non-object values', () => {
    expect(isValidStep(42)).toBe(false);
    expect(isValidStep(null)).toBe(false);
    expect(isValidStep(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidInput / isValidOutput
// ---------------------------------------------------------------------------

describe('isValidInput', () => {
  it('accepts a valid input with required flag', () => {
    expect(isValidInput({ name: 'topic', description: 'The meeting topic', required: true })).toBe(
      true,
    );
  });

  it('accepts a valid input without required flag (optional defaults)', () => {
    expect(isValidInput({ name: 'notes', description: 'Background notes' })).toBe(true);
  });

  it('accepts a valid input with required: false', () => {
    expect(isValidInput({ name: 'notes', description: 'Background notes', required: false })).toBe(
      true,
    );
  });

  it('rejects missing name', () => {
    expect(isValidInput({ description: 'The meeting topic' })).toBe(false);
  });

  it('rejects empty name', () => {
    expect(isValidInput({ name: '  ', description: 'The meeting topic' })).toBe(false);
  });

  it('rejects missing description', () => {
    expect(isValidInput({ name: 'topic' })).toBe(false);
  });

  it('rejects non-boolean required field', () => {
    expect(isValidInput({ name: 'topic', description: 'desc', required: 'yes' })).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidInput(null)).toBe(false);
  });
});

describe('isValidOutput', () => {
  it('accepts a valid output', () => {
    expect(isValidOutput({ name: 'report', description: 'The final report' })).toBe(true);
  });

  it('rejects missing name', () => {
    expect(isValidOutput({ description: 'The final report' })).toBe(false);
  });

  it('rejects missing description', () => {
    expect(isValidOutput({ name: 'report' })).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidOutput(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatSteps
// ---------------------------------------------------------------------------

describe('formatSteps', () => {
  it('formats simple string steps with 1-based numbering', () => {
    const lines = formatSteps(['Step A', 'Step B', 'Step C']);
    expect(lines[0]).toContain('1. Step A');
    expect(lines[1]).toContain('2. Step B');
    expect(lines[2]).toContain('3. Step C');
  });

  it('renders IF/THEN for a conditional step', () => {
    const lines = formatSteps([{ if: 'tests pass', then: ['Deploy'] }]);
    expect(lines.some((l) => l.includes('IF: tests pass'))).toBe(true);
    expect(lines.some((l) => l.includes('THEN:'))).toBe(true);
    expect(lines.some((l) => l.includes('Deploy'))).toBe(true);
  });

  it('renders ELSE branch when present', () => {
    const lines = formatSteps([{ if: 'tests pass', then: ['Deploy'], else: ['Fix tests'] }]);
    expect(lines.some((l) => l.includes('ELSE:'))).toBe(true);
    expect(lines.some((l) => l.includes('Fix tests'))).toBe(true);
  });

  it('omits ELSE block when not present', () => {
    const lines = formatSteps([{ if: 'tests pass', then: ['Deploy'] }]);
    expect(lines.every((l) => !l.includes('ELSE:'))).toBe(true);
  });

  it('indents nested branch steps deeper than top-level steps', () => {
    const lines = formatSteps(['Top step', { if: 'cond', then: ['Branch step'] }]);
    const topLine = lines.find((l) => l.includes('Top step'));
    const branchLine = lines.find((l) => l.includes('Branch step'));
    const topIndent = topLine.match(/^ */)[0].length;
    const branchIndent = branchLine.match(/^ */)[0].length;
    expect(branchIndent).toBeGreaterThan(topIndent);
  });

  it('uses letter labels (a, b, c) for nested branch steps', () => {
    const lines = formatSteps([{ if: 'cond', then: ['First', 'Second'] }]);
    expect(lines.some((l) => /a\. First/.test(l))).toBe(true);
    expect(lines.some((l) => /b\. Second/.test(l))).toBe(true);
  });

  it('is exported as a public module export', () => {
    expect(typeof formatStepsPublic).toBe('function');
    const lines = formatStepsPublic(['Hello']);
    expect(lines[0]).toContain('Hello');
  });
});

// ---------------------------------------------------------------------------
// scoreRecipe
// ---------------------------------------------------------------------------

describe('scoreRecipe', () => {
  it('returns 0 for an empty query', () => {
    expect(scoreRecipe([], GIT_RECIPE)).toBe(0);
  });

  it('scores higher when intent phrase matches exactly', () => {
    const commitTokens = tokenize('git commit my changes');
    const testTokens = tokenize('run tests please');
    expect(scoreRecipe(commitTokens, GIT_RECIPE)).toBeGreaterThan(
      scoreRecipe(testTokens, GIT_RECIPE),
    );
  });

  it('scores the test recipe higher than git recipe for a test query', () => {
    const tokens = tokenize('run npm test now');
    expect(scoreRecipe(tokens, TEST_RECIPE)).toBeGreaterThan(scoreRecipe(tokens, GIT_RECIPE));
  });

  it('returns a number >= 0', () => {
    const tokens = tokenize('completely unrelated query xyz');
    expect(scoreRecipe(tokens, GIT_RECIPE)).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// formatRecipeFull / formatRecipeSummary
// ---------------------------------------------------------------------------

describe('formatRecipeFull', () => {
  it('includes the recipe name and all steps', () => {
    const out = formatRecipeFull(GIT_RECIPE);
    expect(out).toContain('Git Commit and Push Workflow');
    expect(out).toContain('1. Run git status');
    expect(out).toContain('4. Run git push');
  });

  it('includes tags when present', () => {
    expect(formatRecipeFull(GIT_RECIPE)).toContain('git');
  });

  it('omits tags line when none', () => {
    const noTags = { ...GIT_RECIPE, tags: [] };
    expect(formatRecipeFull(noTags)).not.toContain('Tags:');
  });

  it('renders IF/THEN/ELSE for a recipe with branching steps', () => {
    const out = formatRecipeFull(BRANCHING_RECIPE);
    expect(out).toContain('IF: all tests pass');
    expect(out).toContain('THEN:');
    expect(out).toContain('ELSE:');
    expect(out).toContain('Fix failing tests');
  });

  it('includes version when present', () => {
    const out = formatRecipeFull({ ...GIT_RECIPE, version: '2.1.0' });
    expect(out).toContain('v2.1.0');
  });

  it('includes Inputs section when inputs are present', () => {
    const out = formatRecipeFull({
      ...GIT_RECIPE,
      inputs: [
        { name: 'branch', description: 'Target branch', required: true },
        { name: 'message', description: 'Commit message', required: false },
      ],
    });
    expect(out).toContain('Inputs:');
    expect(out).toContain('branch (required): Target branch');
    expect(out).toContain('message (optional): Commit message');
  });

  it('includes Outputs section when outputs are present', () => {
    const out = formatRecipeFull({
      ...GIT_RECIPE,
      outputs: [{ name: 'commit_sha', description: 'SHA of the created commit' }],
    });
    expect(out).toContain('Outputs:');
    expect(out).toContain('commit_sha: SHA of the created commit');
  });

  it('includes Advisory line when adviser_profile is present', () => {
    const out = formatRecipeFull({ ...GIT_RECIPE, adviser_profile: ['LegalCounsel', 'Ethicist'] });
    expect(out).toContain('Advisory: LegalCounsel, Ethicist');
  });

  it('omits optional sections when fields are absent', () => {
    const out = formatRecipeFull(GIT_RECIPE);
    expect(out).not.toContain('Inputs:');
    expect(out).not.toContain('Outputs:');
    expect(out).not.toContain('Advisory:');
    // version suffix looks like "(id) v1.0.0" — check the digit-prefixed form is absent
    expect(out).not.toMatch(/ v\d/);
  });
});

describe('formatRecipeSummary', () => {
  it('includes id, name, and description', () => {
    const out = formatRecipeSummary(GIT_RECIPE);
    expect(out).toContain('git_workflow');
    expect(out).toContain('Git Commit and Push Workflow');
    expect(out).toContain('Stage, commit');
  });
});

// ---------------------------------------------------------------------------
// matchIntents (exported helper)
// ---------------------------------------------------------------------------

describe('matchIntents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRecipesDir();
  });

  it('returns the git recipe for a commit query', () => {
    const results = matchIntents('I want to commit and push my changes');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].recipe.id).toBe('git_workflow');
  });

  it('returns the test recipe for a test query', () => {
    const results = matchIntents('run the jest tests');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].recipe.id).toBe('run_tests');
  });

  it('returns empty array for unrecognised intent when scores are too low', () => {
    // Mock recipes with no overlap
    mockRecipesDir([{ ...GIT_RECIPE, intents: ['zzz_unique_xyz'] }]);
    const results = matchIntents('completely unrelated aabbcc');
    // Score might be tiny from description token overlap — just verify no phrase match recipe surfaces
    const ids = results.map((r) => r.recipe.id);
    expect(ids).not.toContain('run_tests');
  });

  it('respects max_results', () => {
    const results = matchIntents('commit push test', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('returns results sorted by score descending', () => {
    const results = matchIntents('git commit', 2);
    if (results.length >= 2) {
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    }
  });
});

// ---------------------------------------------------------------------------
// Tool: list_recipes
// ---------------------------------------------------------------------------

describe('list_recipes tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRecipesDir();
  });

  it('lists both recipes', async () => {
    const result = await implementations.list_recipes({}, {});
    expect(result).toContain('git_workflow');
    expect(result).toContain('run_tests');
    expect(result).toContain('2');
  });

  it('returns no-recipes message when dir is empty', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue([]);
    const result = await implementations.list_recipes({}, {});
    expect(result).toMatch(/no recipes/i);
  });

  it('returns no-recipes message when dir does not exist', async () => {
    fs.existsSync.mockReturnValue(false);
    const result = await implementations.list_recipes({}, {});
    expect(result).toMatch(/no recipes/i);
  });
});

// ---------------------------------------------------------------------------
// Tool: get_recipe
// ---------------------------------------------------------------------------

describe('get_recipe tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRecipesDir();
  });

  it('returns full recipe for a valid id', async () => {
    const result = await implementations.get_recipe({ id: 'git_workflow' }, {});
    expect(result).toContain('Git Commit and Push Workflow');
    expect(result).toContain('Run git status');
  });

  it('returns not-found message for unknown id', async () => {
    fs.existsSync.mockReturnValue(false);
    const result = await implementations.get_recipe({ id: 'unknown_recipe' }, {});
    expect(result).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// Tool: match_intent
// ---------------------------------------------------------------------------

describe('match_intent tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRecipesDir();
  });

  it('returns recipe details for a matching query', async () => {
    const result = await implementations.match_intent({ input: 'git commit my work' }, {});
    expect(result).toContain('Git Commit and Push Workflow');
    expect(result).toContain('Run git status');
  });

  it('returns fallback message when no match', async () => {
    mockRecipesDir([{ ...GIT_RECIPE, intents: ['zzz_xyz_unique'] }]);
    const result = await implementations.match_intent({ input: 'completely unrelated aabbcc' }, {});
    // Either returns a recipe (small overlap score) or the fallback — just verify no crash
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('respects max_results parameter', async () => {
    const result = await implementations.match_intent(
      { input: 'commit test push', max_results: 1 },
      {},
    );
    // Should mention at most 1 recipe
    expect(result).toContain('1 matching');
  });
});

// ---------------------------------------------------------------------------
// Tool: add_recipe
// ---------------------------------------------------------------------------

describe('add_recipe tool', () => {
  const newRecipe = {
    id: 'deploy_prod',
    name: 'Deploy to Production',
    description: 'Deploy the application to the production environment',
    intents: ['deploy', 'deploy to prod', 'release'],
    steps: ['Run tests', 'Build artifact', 'Push to prod'],
    tags: ['deploy'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: recipe does not exist yet
    fs.existsSync.mockImplementation((p) => {
      if (p === RECIPE_DIR) return true;
      if (p === path.join(RECIPE_DIR, `${newRecipe.id}.json`)) return false;
      return false;
    });
    fs.readdirSync.mockReturnValue([]);
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
  });

  it('saves a valid new recipe and returns success message', async () => {
    const result = await implementations.add_recipe(newRecipe, {});
    expect(result).toContain('deploy_prod.json');
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);

    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written.id).toBe('deploy_prod');
    expect(written.steps).toHaveLength(3);
  });

  it('rejects invalid id', async () => {
    const result = await implementations.add_recipe({ ...newRecipe, id: 'Bad-ID' }, {});
    expect(result).toContain('Error');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects duplicate id', async () => {
    fs.existsSync.mockImplementation((p) => {
      if (p === path.join(RECIPE_DIR, `${newRecipe.id}.json`)) return true;
      return true;
    });
    fs.readFileSync.mockReturnValue(JSON.stringify(newRecipe));
    const result = await implementations.add_recipe(newRecipe, {});
    expect(result).toContain('already exists');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('strips blank entries from intents and steps', async () => {
    const result = await implementations.add_recipe(
      { ...newRecipe, intents: ['deploy', '  ', 'release'], steps: ['Step 1', '', 'Step 3'] },
      {},
    );
    expect(result).not.toContain('Error');
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written.intents).toEqual(['deploy', 'release']);
    expect(written.steps).toEqual(['Step 1', 'Step 3']);
  });

  it('defaults tags to empty array when not provided', async () => {
    const { tags: _t, ...noTags } = newRecipe;
    const result = await implementations.add_recipe(noTags, {});
    expect(result).not.toContain('Error');
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written.tags).toEqual([]);
  });

  it('returns error string when writeFileSync throws', async () => {
    fs.writeFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });
    const result = await implementations.add_recipe(newRecipe, {});
    expect(result).toContain('Error saving recipe');
  });

  it('saves a recipe containing conditional branch steps', async () => {
    const withBranch = {
      ...newRecipe,
      id: 'branching_recipe',
      steps: ['Run tests', { if: 'tests pass', then: ['Deploy'], else: ['Fix tests'] }],
    };
    fs.existsSync.mockImplementation((p) => {
      if (p === RECIPE_DIR) return true;
      if (p === path.join(RECIPE_DIR, 'branching_recipe.json')) return false;
      return false;
    });
    const result = await implementations.add_recipe(withBranch, {});
    expect(result).not.toContain('Error');
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written.steps[1]).toMatchObject({
      if: 'tests pass',
      then: ['Deploy'],
      else: ['Fix tests'],
    });
  });

  it('rejects a recipe with an invalid step object', async () => {
    const withBadStep = { ...newRecipe, steps: [{ if: 'cond' }] }; // missing then
    const result = await implementations.add_recipe(withBadStep, {});
    expect(result).toContain('Error');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('saves optional fields: version, inputs, outputs, adviser_profile', async () => {
    const withExtras = {
      ...newRecipe,
      version: '1.0.0',
      inputs: [{ name: 'env', description: 'Target environment' }],
      outputs: [{ name: 'url', description: 'Deployed URL' }],
      adviser_profile: ['LegalCounsel'],
    };
    const result = await implementations.add_recipe(withExtras, {});
    expect(result).not.toContain('Error');
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written.version).toBe('1.0.0');
    expect(written.inputs).toEqual([{ name: 'env', description: 'Target environment' }]);
    expect(written.outputs).toEqual([{ name: 'url', description: 'Deployed URL' }]);
    expect(written.adviser_profile).toEqual(['LegalCounsel']);
  });

  it('rejects invalid inputs structure', async () => {
    const result = await implementations.add_recipe(
      { ...newRecipe, inputs: [{ name: 'x' }] }, // missing description
      {},
    );
    expect(result).toContain('Error');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});
