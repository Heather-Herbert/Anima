const fs = require('node:fs');
const path = require('node:path');
const config = require('../app/Config');

const PREFERENCES_FILE = path.join('Personality', 'UserPreferences.md');

const SECTION_HEADERS = {
  coding_style: '## Coding Style',
  libraries: '## Preferred Libraries & Frameworks',
  naming_conventions: '## Naming Conventions',
  architecture: '## Architectural Preferences',
  communication: '## Communication Preferences',
};

const getPreferencesPath = () => {
  const root = path.resolve(config.workspaceDir || '.');
  return path.join(root, PREFERENCES_FILE);
};

const readPreferences = () => {
  try {
    return fs.readFileSync(getPreferencesPath(), 'utf8');
  } catch {
    return null;
  }
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Replace the body of a named section, leaving all other sections intact.
// A section body is everything between its ## heading and the next ## heading (or EOF).
const replaceSection = (fileContent, header, newBody) => {
  const escapedHeader = escapeRegex(header);
  const pattern = new RegExp(`(${escapedHeader}\\n)([\\s\\S]*?)(?=\\n## |$)`);
  const replacement = `$1${newBody.trimEnd()}\n`;

  if (pattern.test(fileContent)) {
    return fileContent.replace(pattern, replacement);
  }

  // Section heading not found — append it
  return `${fileContent.trimEnd()}\n\n${header}\n${newBody.trimEnd()}\n`;
};

const writePreferences = (content) => {
  const p = getPreferencesPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
};

const implementations = {
  update_user_preferences: async (
    { section, content, justification: _justification },
    _permissions,
  ) => {
    try {
      const header = SECTION_HEADERS[section];
      if (!header) {
        return `Error: Unknown section '${section}'. Valid sections: ${Object.keys(SECTION_HEADERS).join(', ')}.`;
      }

      const current = readPreferences();
      if (current === null) {
        return `Error: Could not read ${PREFERENCES_FILE}. Ensure the file exists.`;
      }

      const updated = replaceSection(current, header, content);
      writePreferences(updated);

      return `User preferences updated. Section '${section}' saved to ${PREFERENCES_FILE}.`;
    } catch (e) {
      return `Error updating user preferences: ${e.message}`;
    }
  },
};

module.exports = {
  implementations,
  _test: { replaceSection, escapeRegex, SECTION_HEADERS },
};
