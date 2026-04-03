const { describe, it, expect, beforeEach } = require('@jest/globals');
const fs = require('node:fs');

jest.mock('node:fs');
jest.mock('../app/Config', () => ({ workspaceDir: '/mock/workspace' }));

const { implementations, _test } = require('./WorkspaceSummary');
const {
  isConfigFile,
  extractFirstComment,
  formatRelativeTime,
  renderTree,
  scanRootFiles,
  getRecentFiles,
  buildSummary,
} = _test;

describe('isConfigFile', () => {
  it('matches package.json', () => expect(isConfigFile('package.json')).toBe(true));
  it('matches *.config.json', () => expect(isConfigFile('Anima.config.json')).toBe(true));
  it('matches *.config.js', () => expect(isConfigFile('jest.config.js')).toBe(true));
  it('matches README.md', () => expect(isConfigFile('README.md')).toBe(true));
  it('matches CLAUDE.md', () => expect(isConfigFile('CLAUDE.md')).toBe(true));
  it('does not match a regular JS file', () => expect(isConfigFile('Tools.js')).toBe(false));
  it('does not match a test file', () => expect(isConfigFile('Tools.test.js')).toBe(false));
});

describe('extractFirstComment', () => {
  beforeEach(() => jest.clearAllMocks());

  it('extracts a leading // comment', () => {
    fs.readFileSync.mockReturnValue('// Manages configuration loading\nconst x = 1;');
    expect(extractFirstComment('/some/file.js')).toBe('Manages configuration loading');
  });

  it('extracts a JSDoc * line', () => {
    fs.readFileSync.mockReturnValue('/**\n * Handles tool dispatch\n */\nclass X {}');
    expect(extractFirstComment('/some/file.js')).toBe('Handles tool dispatch');
  });

  it('returns empty string when no comment is found', () => {
    fs.readFileSync.mockReturnValue('const x = 1;\nconst y = 2;');
    expect(extractFirstComment('/some/file.js')).toBe('');
  });

  it('returns empty string on read error', () => {
    fs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(extractFirstComment('/no/file.js')).toBe('');
  });
});

describe('formatRelativeTime', () => {
  it('returns minutes for recent times', () => {
    expect(formatRelativeTime(Date.now() - 30 * 60 * 1000)).toBe('30m ago');
  });

  it('returns hours for times within a day', () => {
    expect(formatRelativeTime(Date.now() - 3 * 60 * 60 * 1000)).toBe('3h ago');
  });

  it('returns days for older times', () => {
    expect(formatRelativeTime(Date.now() - 2 * 24 * 60 * 60 * 1000)).toBe('2d ago');
  });
});

describe('renderTree', () => {
  beforeEach(() => jest.clearAllMocks());

  it('includes the root name', () => {
    fs.readdirSync.mockReturnValue([]);
    const tree = renderTree('/mock/workspace', 1);
    expect(tree).toContain('workspace/');
  });

  it('lists files at depth 1', () => {
    fs.readdirSync.mockReturnValue([
      { name: 'cli.js', isFile: () => true, isDirectory: () => false },
      { name: 'package.json', isFile: () => true, isDirectory: () => false },
    ]);
    const tree = renderTree('/mock/workspace', 1);
    expect(tree).toContain('cli.js');
    expect(tree).toContain('package.json');
  });

  it('skips node_modules', () => {
    fs.readdirSync.mockReturnValue([
      { name: 'node_modules', isFile: () => false, isDirectory: () => true },
    ]);
    const tree = renderTree('/mock/workspace', 2);
    expect(tree).not.toContain('node_modules');
  });

  it('handles readdirSync errors gracefully', () => {
    fs.readdirSync.mockImplementation(() => {
      throw new Error('EPERM');
    });
    expect(() => renderTree('/bad/path', 1)).not.toThrow();
  });
});

describe('scanRootFiles', () => {
  beforeEach(() => jest.clearAllMocks());

  it('identifies cli.js as an entry point', () => {
    fs.readdirSync.mockReturnValue([
      { name: 'cli.js', isFile: () => true, isDirectory: () => false },
    ]);
    fs.statSync.mockReturnValue({ size: 1234 });
    const { entryPoints } = scanRootFiles('/mock/workspace');
    expect(entryPoints[0]).toContain('cli.js');
    expect(entryPoints[0]).toContain('1234 bytes');
  });

  it('identifies package.json as a config file', () => {
    fs.readdirSync.mockReturnValue([
      { name: 'package.json', isFile: () => true, isDirectory: () => false },
    ]);
    const { configFiles } = scanRootFiles('/mock/workspace');
    expect(configFiles[0]).toContain('package.json');
  });

  it('returns empty arrays on readdirSync error', () => {
    fs.readdirSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const { entryPoints, configFiles } = scanRootFiles('/bad/path');
    expect(entryPoints).toEqual([]);
    expect(configFiles).toEqual([]);
  });
});

describe('getRecentFiles', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns files sorted by modification time', () => {
    const now = Date.now();
    fs.readdirSync.mockReturnValue([
      { name: 'old.js', isFile: () => true, isDirectory: () => false },
      { name: 'new.js', isFile: () => true, isDirectory: () => false },
    ]);
    fs.statSync.mockImplementation((p) => ({
      mtimeMs: p.includes('new') ? now - 1000 : now - 100000,
    }));
    const results = getRecentFiles('/mock/workspace', 5);
    expect(results[0]).toContain('new.js');
    expect(results[1]).toContain('old.js');
  });

  it('respects the limit', () => {
    fs.readdirSync.mockReturnValue([
      { name: 'a.js', isFile: () => true, isDirectory: () => false },
      { name: 'b.js', isFile: () => true, isDirectory: () => false },
      { name: 'c.js', isFile: () => true, isDirectory: () => false },
    ]);
    fs.statSync.mockReturnValue({ mtimeMs: Date.now() });
    const results = getRecentFiles('/mock/workspace', 2);
    expect(results).toHaveLength(2);
  });
});

describe('buildSummary', () => {
  beforeEach(() => jest.clearAllMocks());

  it('includes all four sections', () => {
    fs.readdirSync.mockReturnValue([]);
    fs.statSync.mockReturnValue({ size: 0, mtimeMs: Date.now() });
    const summary = buildSummary('/mock/workspace', 2, 5);
    expect(summary).toContain('## Directory Tree');
    expect(summary).toContain('## Entry Points');
    expect(summary).toContain('## Configuration Files');
    expect(summary).toContain('## Core Services');
    expect(summary).toContain('## Recent Modifications');
  });
});

describe('workspace_summary tool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns a summary string', async () => {
    fs.readdirSync.mockReturnValue([]);
    fs.statSync.mockReturnValue({ size: 0, mtimeMs: Date.now() });
    const result = await implementations.workspace_summary({});
    expect(typeof result).toBe('string');
    expect(result).toContain('## Directory Tree');
  });

  it('returns a valid summary even when the filesystem is unreadable', async () => {
    fs.readdirSync.mockImplementation(() => {
      throw new Error('EPERM');
    });
    const result = await implementations.workspace_summary({});
    // All sub-functions handle errors internally — the tool should still return all sections
    expect(result).toContain('## Directory Tree');
    expect(result).toContain('## Entry Points');
    expect(result).toContain('## Recent Modifications');
  });
});
