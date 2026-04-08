# Contributing Recipes

This guide explains how to add new workflow recipes to Anima.

## What Is a Recipe?

A recipe is a JSON file in `Recipes/` that describes a reusable workflow. When a user's request matches a recipe's intent phrases, Anima injects the recipe's steps into the conversation as a guided plan. Recipes with an `adviser_profile` also trigger an automatic advisory council review before execution.

## File Format

Each recipe is a single JSON file named `{id}.json` (e.g. `meeting_prep.json`).

### Required Fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique snake_case identifier — must match the filename without `.json` (e.g. `my_workflow`) |
| `name` | string | Short human-readable name shown in the UI |
| `description` | string | One-sentence description of what the recipe accomplishes |
| `intents` | string[] | Keywords and phrases that trigger this recipe (at least one) |
| `steps` | Step[] | Ordered list of steps (see Step Types below) |

### Optional Fields

| Field | Type | Description |
|---|---|---|
| `version` | string | Semantic version string (e.g. `"1.0.0"`) — increment on breaking changes |
| `tags` | string[] | Categorisation tags (e.g. `["finance", "enterprise"]`) |
| `inputs` | Input[] | Declared inputs the recipe expects before starting |
| `outputs` | Output[] | Declared output artefacts the recipe produces |
| `adviser_profile` | string[] | Names of advisory council members to consult before execution |

### Step Types

Steps may be either a plain string or a conditional branch object.

**Plain string step:**
```json
"Run npm test to confirm all tests pass"
```

**Conditional branch step:**
```json
{
  "if": "all tests pass",
  "then": ["Build the artifact", "Deploy to server"],
  "else": ["Fix failing tests before continuing"]
}
```

- `if` — Natural-language description of the condition to evaluate (required)
- `then` — Steps to follow when the condition is true (required, at least one)
- `else` — Steps to follow when the condition is false (optional)
- Branches can be nested: `then`/`else` arrays may themselves contain further plain strings or conditional objects

### Input Object

```json
{ "name": "report_period", "description": "Time period the report covers", "required": true }
```

- `name` — Identifier for the input (required)
- `description` — What the input represents (required)
- `required` — Boolean; defaults to `true` if omitted

### Output Object

```json
{ "name": "summary_report", "description": "Final report document" }
```

- `name` — Identifier for the output artefact (required)
- `description` — What the output contains (required)

### adviser_profile

Names must exactly match adviser names configured in `Settings/Anima.config.json` under `advisoryCouncil.advisers[].name`. Available advisers are the `.md` files in `Personality/Advisers/` (e.g. `LegalCounsel`, `Ethicist`, `PrivacyExpert`, `SecurityAuditor`).

Use `adviser_profile` for workflows that involve sensitive data, legal exposure, financial decisions, or actions with compliance implications.

## Complete Example

```json
{
  "id": "incident_response",
  "version": "1.0.0",
  "name": "Security Incident Response",
  "description": "Triage, contain, and document a security incident",
  "intents": [
    "security incident",
    "incident response",
    "we have been breached",
    "data breach",
    "suspicious activity"
  ],
  "inputs": [
    { "name": "incident_description", "description": "What was observed and when", "required": true },
    { "name": "affected_systems",     "description": "Systems or services involved", "required": true },
    { "name": "severity",             "description": "Estimated severity: low, medium, or high", "required": false }
  ],
  "outputs": [
    { "name": "incident_report",  "description": "Structured incident report for stakeholders" },
    { "name": "containment_plan", "description": "Immediate steps to contain and remediate the incident" }
  ],
  "adviser_profile": ["SecurityAuditor", "LegalCounsel", "PrivacyExpert"],
  "steps": [
    "Gather the incident description, affected systems, and estimated severity from the user",
    {
      "if": "severity is high or a data breach is suspected",
      "then": [
        "Immediately advise the user to isolate affected systems",
        "Flag that legal and privacy notifications may be required"
      ],
      "else": [
        "Proceed with standard triage and investigation steps"
      ]
    },
    "Document the timeline of events, indicators of compromise, and initial impact assessment",
    "Propose containment and remediation steps",
    "Draft the incident report for stakeholder communication"
  ],
  "tags": ["security", "incident", "compliance", "enterprise"]
}
```

## How to Add a Recipe

1. Copy the template above into `Recipes/{your_id}.json`
2. Fill in all required fields; add optional fields as appropriate
3. Run `npm test` — the test suite validates all recipes in `Recipes/` are loadable
4. Add at least five varied `intents` so the matcher can recognise the workflow from different phrasings
5. If your recipe involves sensitive operations, add an `adviser_profile`
6. Increment the `version` field if you are updating an existing recipe in a breaking way
7. Submit a pull request — the PR description should explain the domain the recipe covers and any adviser choices

## Versioning

- Use [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`
- **PATCH** — non-breaking: fix a step description, add an intent phrase, improve wording
- **MINOR** — non-breaking addition: add new optional inputs/outputs, add steps that don't change existing flow
- **MAJOR** — breaking change: rename the recipe `id`, remove required inputs, restructure steps significantly

## Testing a Recipe

The `Skills/IntentRecipe.test.js` suite validates recipe loading and intent matching automatically. To verify your specific recipe manually:

```bash
npm test -- --testPathPattern=Skills/IntentRecipe
```

To check that the matcher picks up your recipe with representative phrases:

```bash
node -e "
  const { matchIntents } = require('./Skills/IntentRecipe');
  console.log(matchIntents('your intent phrase here', 3));
"
```
