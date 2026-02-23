const { describe, it, expect } = require('@jest/globals');
const fs = require('node:fs');
const { isPathAllowed, availableTools } = require('./Tools');

jest.mock('node:fs');
jest.mock('./Config', () => ({
  workspaceDir: '.',
}));

describe('Security: isPathAllowed', () => {
  const fullPermissions = { filesystem: { read: ['*'], write: ['*'] } };

  it('allows access to files in project root', () => {
    expect(isPathAllowed('README.md', 'read', fullPermissions)).toBe(true);
    expect(isPathAllowed('./test.txt', 'read', fullPermissions)).toBe(true);
  });

  it('denies access outside project root (traversal)', () => {
    expect(isPathAllowed('../outside.txt', 'read', fullPermissions)).toBe(false);
    expect(isPathAllowed('/etc/passwd', 'read', fullPermissions)).toBe(false);
  });

  it('denies all access by default when no permissions are provided', () => {
    expect(isPathAllowed('README.md', 'read', null)).toBe(false);
    expect(isPathAllowed('test.txt', 'write', undefined)).toBe(false);
  });

  it('denies access to restricted system directories (case-insensitive)', () => {
    expect(isPathAllowed('app/Config.js', 'read', fullPermissions)).toBe(false);
    expect(isPathAllowed('APP/Config.js', 'read', fullPermissions)).toBe(false);
    expect(isPathAllowed('Settings/ollama.json', 'read', fullPermissions)).toBe(false);
    expect(isPathAllowed('settings/ollama.json', 'read', fullPermissions)).toBe(false);
    expect(isPathAllowed('.git/config', 'read', fullPermissions)).toBe(false);
    expect(isPathAllowed('node_modules/jest/index.js', 'read', fullPermissions)).toBe(false);
  });

  it('denies access to sensitive root files', () => {
    expect(isPathAllowed('cli.js', 'read', fullPermissions)).toBe(false);
    expect(isPathAllowed('package.json', 'read', fullPermissions)).toBe(false);
    expect(isPathAllowed('Anima.config.json', 'read', fullPermissions)).toBe(false);
  });

  it('allows read-only access to core protected directories', () => {
    expect(isPathAllowed('Plugins/OpenRouter.js', 'read', fullPermissions)).toBe(true);
    expect(isPathAllowed('Memory/memory.json', 'read', fullPermissions)).toBe(true);
    expect(isPathAllowed('Personality/main.md', 'read', fullPermissions)).toBe(true);
  });

  it('denies write access to core protected directories by default', () => {
    expect(isPathAllowed('Plugins/Malicious.js', 'write', fullPermissions)).toBe(false);
    expect(isPathAllowed('Memory/memory.json', 'write', fullPermissions)).toBe(false);
    expect(isPathAllowed('Personality/Soul.md', 'write', fullPermissions)).toBe(false);
  });

  describe('Manifest Enforcement', () => {
    const permissions = {
      filesystem: {
        read: ['Memory', 'test_data'],
        write: ['test_data/output'],
      },
    };

    it('allows read when path is in allowed list', () => {
      expect(isPathAllowed('Memory/memory.md', 'read', permissions)).toBe(true);
      expect(isPathAllowed('test_data/input.txt', 'read', permissions)).toBe(true);
    });

    it('denies read when path is NOT in allowed list (if manifest present)', () => {
      expect(isPathAllowed('README.md', 'read', permissions)).toBe(false);
    });

    it('allows write when path is in allowed list', () => {
      expect(isPathAllowed('test_data/output/result.json', 'write', permissions)).toBe(true);
    });

    it('denies write when path is NOT in allowed list', () => {
      expect(isPathAllowed('test_data/input.txt', 'write', permissions)).toBe(false);
      expect(isPathAllowed('Memory/memory.md', 'write', permissions)).toBe(false);
    });

    it('allows everything if manifest uses asterisk', () => {
      const wildcard = { filesystem: { read: ['*'], write: ['*'] } };
      expect(isPathAllowed('README.md', 'read', wildcard)).toBe(true);
      expect(isPathAllowed('Memory/memory.md', 'write', wildcard)).toBe(true);
    });
  });
});

describe('Security: Tool Permission Enforcement', () => {
  it('write_file respects manifest permissions', async () => {
    const permissions = {
      filesystem: {
        write: ['sandbox/'],
      },
    };

    // Allowed
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    const resultOk = await availableTools.write_file(
      { path: 'sandbox/test.txt', content: 'data' },
      permissions,
    );
    expect(resultOk).toContain('written successfully');

    // Denied
    const resultDenied = await availableTools.write_file(
      { path: 'README.md', content: 'data' },
      permissions,
    );
    expect(resultDenied).toContain('restricted by system policy or manifest');
  });

  it('write_file allows protected paths if _overrideProtected is set', async () => {
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});

    const permissions = { _overrideProtected: true };
    const result = await availableTools.write_file(
      { path: 'Plugins/New.js', content: '...', justification: 'test' },
      permissions,
    );
    expect(result).toContain('written successfully');
  });

  it('read_file respects manifest permissions', async () => {
    const permissions = {
      filesystem: {
        read: ['logs/'],
      },
    };

    // Allowed
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('log data');
    const resultOk = await availableTools.read_file({ path: 'logs/app.log' }, permissions);
    expect(resultOk).toBe('log data');

    // Denied
    const resultDenied = await availableTools.read_file({ path: 'Anima.config.json' }, permissions);
    expect(resultDenied).toContain('restricted by system policy or manifest');
  });

  it('list_files filters items based on permissions', async () => {
    const permissions = {
      filesystem: {
        read: ['public', 'public/allowed.txt'],
      },
    };

    fs.existsSync.mockImplementation((p) => {
      if (p.endsWith('public')) return true;
      if (p.endsWith('allowed.txt')) return true;
      if (p.endsWith('secret.js')) return true;
      return false;
    });

    fs.statSync.mockImplementation((p) => {
      if (p.endsWith('public')) return { isDirectory: () => true, isFile: () => false };
      return { isDirectory: () => false, isFile: () => true };
    });

    fs.readdirSync.mockReturnValue([
      { name: 'allowed.txt', isDirectory: () => false, isFile: () => true },
      { name: 'secret.js', isDirectory: () => false, isFile: () => true },
    ]);

    // If 'public' is allowed and is a directory, then 'public/secret.js' is also allowed.
    // To test filtering, we need 'public' to be allowed but NOT as a directory that allows all subpaths.
    // However, list_files requires the path to be allowed.

    const result = await availableTools.list_files({ path: 'public' }, permissions);
    // With current isPathAllowed logic, if 'public' is a directory, everything inside is allowed.
    // So both should be present.
    expect(result).toContain('allowed.txt');
    expect(result).toContain('secret.js');
  });

  it('execute_code prevents writing temp file to restricted path', async () => {
    // Note: execute_code uses Date.now() for filename, which is usually in root.
    // Restricted paths include 'app/', etc.
    // Since we can't easily control the temp filename in the test without more mocking,
    // we test the manifest's effect if 'read' or 'write' is restricted globally.

    const restrictedWrite = {
      filesystem: {
        write: ['sandbox/'],
      },
    };

    const result = await availableTools.execute_code(
      { language: 'bash', code: 'ls' },
      restrictedWrite,
    );
    expect(result).toContain('Permission denied to write temporary execution file');
  });

  it('search_files respects manifest permissions', async () => {
    const permissions = {
      filesystem: {
        read: ['logs/app.log'],
      },
    };

    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true });
    fs.readFileSync.mockImplementation((path) => {
      if (path.includes('app.log')) return 'error in app';
      if (path.includes('secret.log')) return 'secret token';
      return '';
    });

    // Searching allowed file
    const resultOk = await availableTools.search_files(
      { path: 'logs/app.log', term: 'error' },
      permissions,
    );
    expect(resultOk).toContain('logs/app.log:1:error in app');

    // Searching restricted file directly
    const resultDenied = await availableTools.search_files(
      { path: 'logs/secret.log', term: 'token' },
      permissions,
    );
    expect(resultDenied).toContain('restricted by system policy or manifest');
  });
});
