const { describe, it, expect, beforeEach } = require('@jest/globals');
const fs = require('node:fs');

jest.mock('node:fs');
jest.mock('../app/Config', () => ({ workspaceDir: '/mock/workspace' }));

const { implementations, _test } = require('./UserPreferences');
const { replaceSection, SECTION_HEADERS } = _test;

const TEMPLATE = `# User Preferences

## Coding Style

- No preferences recorded yet.

## Preferred Libraries & Frameworks

- No preferences recorded yet.

## Naming Conventions

- No preferences recorded yet.

## Architectural Preferences

- No preferences recorded yet.

## Communication Preferences

- No preferences recorded yet.
`;

describe('replaceSection', () => {
  it('replaces an existing section body', () => {
    const result = replaceSection(
      TEMPLATE,
      '## Coding Style',
      '- Uses 2 spaces\n- Single quotes\n',
    );
    // Extract just the Coding Style section body (up to the next heading)
    const sectionMatch = result.match(/## Coding Style\n([\s\S]*?)(?=\n## )/);
    expect(sectionMatch).not.toBeNull();
    const sectionBody = sectionMatch[1];
    expect(sectionBody).toContain('- Uses 2 spaces');
    expect(sectionBody).toContain('- Single quotes');
    expect(sectionBody).not.toContain('No preferences recorded yet.');
    // Other sections should be untouched
    expect(result).toContain('## Preferred Libraries & Frameworks');
  });

  it('replaces only the targeted section, leaving others intact', () => {
    const result = replaceSection(TEMPLATE, '## Naming Conventions', '- camelCase for variables\n');
    expect(result).toContain('- camelCase for variables');
    expect(result).toContain('## Coding Style');
    expect(result).toContain('## Architectural Preferences');
  });

  it('appends a new section when the heading is not found', () => {
    const content = '# File\n\n## Existing Section\n\n- item\n';
    const result = replaceSection(content, '## New Section', '- new item\n');
    expect(result).toContain('## New Section');
    expect(result).toContain('- new item');
    expect(result).toContain('## Existing Section');
  });

  it('trims trailing whitespace from new body', () => {
    const result = replaceSection(TEMPLATE, '## Coding Style', '- item   \n\n\n');
    expect(result).not.toMatch(/- item\s{3,}/);
  });
});

describe('SECTION_HEADERS', () => {
  it('has entries for all five sections', () => {
    const keys = Object.keys(SECTION_HEADERS);
    expect(keys).toContain('coding_style');
    expect(keys).toContain('libraries');
    expect(keys).toContain('naming_conventions');
    expect(keys).toContain('architecture');
    expect(keys).toContain('communication');
    expect(keys).toHaveLength(5);
  });
});

describe('update_user_preferences tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(TEMPLATE);
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
  });

  it('updates a valid section and writes the file', async () => {
    const result = await implementations.update_user_preferences({
      section: 'coding_style',
      content: '- 2 spaces\n- Single quotes\n',
      justification: 'Observed in user edits',
    });

    expect(result).toContain('coding_style');
    expect(result).toContain('UserPreferences.md');
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);

    const written = fs.writeFileSync.mock.calls[0][1];
    expect(written).toContain('- 2 spaces');
    expect(written).toContain('- Single quotes');
  });

  it('returns an error for an unknown section', async () => {
    const result = await implementations.update_user_preferences({
      section: 'unknown_section',
      content: '- something',
      justification: 'test',
    });
    expect(result).toContain("Unknown section 'unknown_section'");
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('returns an error when the preferences file cannot be read', async () => {
    fs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = await implementations.update_user_preferences({
      section: 'libraries',
      content: '- React\n',
      justification: 'test',
    });
    expect(result).toContain('Error');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('returns an error string when writeFileSync throws', async () => {
    fs.writeFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });
    const result = await implementations.update_user_preferences({
      section: 'architecture',
      content: '- Prefer MVC\n',
      justification: 'test',
    });
    expect(result).toContain('Error updating user preferences');
  });

  it('updates each valid section without error', async () => {
    const sections = [
      'coding_style',
      'libraries',
      'naming_conventions',
      'architecture',
      'communication',
    ];
    for (const section of sections) {
      jest.clearAllMocks();
      fs.readFileSync.mockReturnValue(TEMPLATE);
      fs.writeFileSync.mockImplementation(() => {});
      fs.mkdirSync.mockImplementation(() => {});

      const result = await implementations.update_user_preferences({
        section,
        content: `- preference for ${section}\n`,
        justification: 'test',
      });
      expect(result).not.toContain('Error');
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    }
  });
});
