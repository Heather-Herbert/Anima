const fs = require('node:fs');
const path = require('node:path');

const AGENT_TYPES_PATH = path.join(__dirname, '..', 'Settings', 'agent_types.json');

let _cache = null;

const load = () => {
  if (_cache) return _cache;
  const raw = fs.readFileSync(AGENT_TYPES_PATH, 'utf8');
  _cache = JSON.parse(raw);
  return _cache;
};

const list = () => Object.keys(load());

const getType = (name) => load()[name] || null;

const isValidType = (name) => Boolean(getType(name));

/**
 * Returns true if the given tool is permitted for the agent type.
 * Unknown types always return false.
 * Types with allowedTools: ["*"] permit everything.
 */
const isToolAllowed = (toolName, typeName) => {
  const type = getType(typeName);
  if (!type) return false;
  if (type.allowedTools.includes('*')) return true;
  return type.allowedTools.includes(toolName);
};

/**
 * Filters a tools array to only those permitted by the agent type.
 * Unknown types return an empty array.
 * Types with allowedTools: ["*"] return the full array unchanged.
 */
const filterTools = (tools, typeName) => {
  const type = getType(typeName);
  if (!type) return [];
  if (type.allowedTools.includes('*')) return tools;
  return tools.filter((t) => type.allowedTools.includes(t.function.name));
};

/** Clear the in-memory cache (used in tests). */
const clearCache = () => {
  _cache = null;
};

module.exports = { load, list, getType, isValidType, isToolAllowed, filterTools, clearCache };
