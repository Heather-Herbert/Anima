const { describe, it, expect, beforeEach } = require('@jest/globals');
const fs = require('node:fs');

jest.mock('node:fs');

// We need to control what agent_types.json returns, so mock it via fs.
const MOCK_TYPES = {
  explore: {
    description: 'Read-only research agent.',
    allowedTools: ['read_file', 'list_files', 'web_search'],
  },
  plan: {
    description: 'Planning agent.',
    allowedTools: ['read_file', 'advisory_council'],
  },
  verify: {
    description: 'Verification agent.',
    allowedTools: ['read_file', 'run_command'],
  },
  guide: {
    description: 'Conversational agent.',
    allowedTools: [],
  },
  worker: {
    description: 'Full-access agent.',
    allowedTools: ['*'],
  },
  general: {
    description: 'General-purpose agent.',
    allowedTools: ['*'],
  },
};

// Fake tool objects matching the shape used by ConversationService / cli.js
const makeTool = (name) => ({ type: 'function', function: { name, parameters: {} } });
const ALL_TOOLS = [
  makeTool('read_file'),
  makeTool('list_files'),
  makeTool('web_search'),
  makeTool('advisory_council'),
  makeTool('run_command'),
  makeTool('write_file'),
  makeTool('execute_code'),
];

const service = require('./AgentTypeService');

beforeEach(() => {
  jest.clearAllMocks();
  fs.readFileSync.mockReturnValue(JSON.stringify(MOCK_TYPES));
  fs.existsSync.mockReturnValue(true);
  service.clearCache();
});

// ---------------------------------------------------------------------------
// list / getType / isValidType
// ---------------------------------------------------------------------------

describe('list', () => {
  it('returns all six agent type names', () => {
    const types = service.list();
    expect(types).toEqual(
      expect.arrayContaining(['explore', 'plan', 'verify', 'guide', 'worker', 'general']),
    );
    expect(types).toHaveLength(6);
  });
});

describe('getType', () => {
  it('returns the config object for a known type', () => {
    const t = service.getType('explore');
    expect(t.description).toBe('Read-only research agent.');
    expect(t.allowedTools).toContain('read_file');
  });

  it('returns null for an unknown type', () => {
    expect(service.getType('nonexistent')).toBeNull();
  });
});

describe('isValidType', () => {
  it('returns true for all six types', () => {
    for (const name of ['explore', 'plan', 'verify', 'guide', 'worker', 'general']) {
      expect(service.isValidType(name)).toBe(true);
    }
  });

  it('returns false for an unknown type', () => {
    expect(service.isValidType('superuser')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isToolAllowed
// ---------------------------------------------------------------------------

describe('isToolAllowed', () => {
  it('allows listed tools for explore type', () => {
    expect(service.isToolAllowed('read_file', 'explore')).toBe(true);
    expect(service.isToolAllowed('web_search', 'explore')).toBe(true);
  });

  it('blocks unlisted tools for explore type', () => {
    expect(service.isToolAllowed('write_file', 'explore')).toBe(false);
    expect(service.isToolAllowed('execute_code', 'explore')).toBe(false);
  });

  it('allows no tools for guide type', () => {
    expect(service.isToolAllowed('read_file', 'guide')).toBe(false);
    expect(service.isToolAllowed('web_search', 'guide')).toBe(false);
  });

  it('allows all tools for worker type (wildcard)', () => {
    expect(service.isToolAllowed('write_file', 'worker')).toBe(true);
    expect(service.isToolAllowed('execute_code', 'worker')).toBe(true);
    expect(service.isToolAllowed('anything', 'worker')).toBe(true);
  });

  it('allows all tools for general type (wildcard)', () => {
    expect(service.isToolAllowed('write_file', 'general')).toBe(true);
  });

  it('returns false for an unknown agent type', () => {
    expect(service.isToolAllowed('read_file', 'nonexistent')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// filterTools
// ---------------------------------------------------------------------------

describe('filterTools', () => {
  it('returns only allowed tools for explore type', () => {
    const result = service.filterTools(ALL_TOOLS, 'explore');
    const names = result.map((t) => t.function.name);
    expect(names).toContain('read_file');
    expect(names).toContain('list_files');
    expect(names).toContain('web_search');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('execute_code');
  });

  it('returns only advisory_council and read_file for plan type', () => {
    const result = service.filterTools(ALL_TOOLS, 'plan');
    const names = result.map((t) => t.function.name);
    expect(names).toContain('advisory_council');
    expect(names).toContain('read_file');
    expect(names).not.toContain('run_command');
  });

  it('returns empty array for guide type', () => {
    expect(service.filterTools(ALL_TOOLS, 'guide')).toEqual([]);
  });

  it('returns all tools for worker type (wildcard)', () => {
    const result = service.filterTools(ALL_TOOLS, 'worker');
    expect(result).toHaveLength(ALL_TOOLS.length);
  });

  it('returns all tools for general type (wildcard)', () => {
    const result = service.filterTools(ALL_TOOLS, 'general');
    expect(result).toHaveLength(ALL_TOOLS.length);
  });

  it('returns empty array for an unknown type', () => {
    expect(service.filterTools(ALL_TOOLS, 'nonexistent')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

describe('caching', () => {
  it('reads the file only once and caches the result', () => {
    service.list(); // first call
    service.list(); // second call — should hit cache
    service.getType('explore');
    expect(fs.readFileSync).toHaveBeenCalledTimes(1);
  });

  it('re-reads the file after clearCache()', () => {
    service.list();
    service.clearCache();
    service.list();
    expect(fs.readFileSync).toHaveBeenCalledTimes(2);
  });
});
