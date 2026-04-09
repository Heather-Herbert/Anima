const { describe, it, expect, beforeEach } = require('@jest/globals');
const readline = require('readline');
const os = require('os');

// Mock readline
jest.mock('readline');

// Mock os
jest.mock('os');

// Mock fs.promises via fs
jest.mock('fs', () => {
  return {
    promises: {
      access: jest.fn(),
      readFile: jest.fn(),
      readdir: jest.fn(),
      writeFile: jest.fn(),
      unlink: jest.fn(),
    },
  };
});

// Mock Utils (redact used in discovery flow)
jest.mock('./Utils', () => ({
  redact: jest.fn((text) => text),
}));

// We need to require fs to manipulate the mocks
const fs = require('fs').promises;
const { redact } = require('./Utils');

const ParturitionService = require('./ParturitionService');

describe('ParturitionService', () => {
  let service;
  const baseDir = '/test/dir';

  beforeEach(() => {
    service = new ParturitionService(baseDir);
    jest.clearAllMocks();
    os.homedir.mockReturnValue('/mock/home');
    // Default: all readdir calls throw (no dirs found)
    fs.readdir.mockRejectedValue(new Error('ENOENT'));
  });

  describe('isParturitionRequired', () => {
    it('returns false if Parturition.md does not exist', async () => {
      fs.access.mockRejectedValue(new Error('ENOENT'));
      const result = await service.isParturitionRequired();
      expect(result).toBe(false);
    });

    it('returns true if Parturition.md exists but Soul.md is missing', async () => {
      fs.access.mockImplementation((filePath) => {
        if (filePath.endsWith('Parturition.md')) return Promise.resolve();
        if (filePath.endsWith('Soul.md')) return Promise.reject(new Error('ENOENT'));
        return Promise.resolve();
      });
      const result = await service.isParturitionRequired();
      expect(result).toBe(true);
    });

    it('returns true if Parturition.md exists but Identity.md is missing', async () => {
      fs.access.mockImplementation((filePath) => {
        if (filePath.endsWith('Parturition.md')) return Promise.resolve();
        if (filePath.endsWith('Soul.md')) return Promise.resolve();
        if (filePath.endsWith('Identity.md')) return Promise.reject(new Error('ENOENT'));
        return Promise.resolve();
      });
      const result = await service.isParturitionRequired();
      expect(result).toBe(true);
    });

    it('returns false if all files exist', async () => {
      fs.access.mockResolvedValue();
      const result = await service.isParturitionRequired();
      expect(result).toBe(false);
    });
  });

  describe('discoverPersonalityFiles', () => {
    it('returns empty array when no known files exist', async () => {
      fs.readFile.mockRejectedValue(new Error('ENOENT'));
      const result = await service.discoverPersonalityFiles();
      expect(result).toEqual([]);
    });

    it('finds workspace-level files that exist', async () => {
      fs.readFile.mockImplementation((filePath) => {
        if (filePath === '/test/dir/CLAUDE.md') return Promise.resolve('# Claude config');
        if (filePath === '/test/dir/AGENTS.md') return Promise.resolve('# Agents');
        return Promise.reject(new Error('ENOENT'));
      });

      const result = await service.discoverPersonalityFiles();
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        path: '/test/dir/CLAUDE.md',
        source: 'workspace',
        content: '# Claude config',
      });
      expect(result[1]).toMatchObject({
        path: '/test/dir/AGENTS.md',
        source: 'workspace',
        content: '# Agents',
      });
    });

    it('finds home-level fixed files that exist', async () => {
      fs.readFile.mockImplementation((filePath) => {
        if (filePath === '/mock/home/.claude/CLAUDE.md')
          return Promise.resolve('global claude config');
        return Promise.reject(new Error('ENOENT'));
      });

      const result = await service.discoverPersonalityFiles();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ path: '/mock/home/.claude/CLAUDE.md', source: 'home' });
    });

    it('globs ~/.claude/projects/*/memory/*.md and skips MEMORY.md', async () => {
      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === '/mock/home/.claude/projects') return Promise.resolve(['my-project']);
        if (dirPath === '/mock/home/.claude/projects/my-project/memory')
          return Promise.resolve(['user_role.md', 'MEMORY.md', 'feedback.md']);
        return Promise.reject(new Error('ENOENT'));
      });

      fs.readFile.mockImplementation((filePath) => {
        if (filePath.endsWith('user_role.md')) return Promise.resolve('user is a dev');
        if (filePath.endsWith('feedback.md')) return Promise.resolve('prefers concise answers');
        return Promise.reject(new Error('ENOENT'));
      });

      const result = await service.discoverPersonalityFiles();

      const paths = result.map((f) => f.path);
      expect(paths).toContain('/mock/home/.claude/projects/my-project/memory/user_role.md');
      expect(paths).toContain('/mock/home/.claude/projects/my-project/memory/feedback.md');
      expect(paths).not.toContain('/mock/home/.claude/projects/my-project/memory/MEMORY.md');
    });

    it('silently skips unreadable memory files', async () => {
      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === '/mock/home/.claude/projects') return Promise.resolve(['proj']);
        if (dirPath === '/mock/home/.claude/projects/proj/memory')
          return Promise.resolve(['broken.md']);
        return Promise.reject(new Error('ENOENT'));
      });
      fs.readFile.mockRejectedValue(new Error('EACCES'));

      const result = await service.discoverPersonalityFiles();
      expect(result).toEqual([]);
    });
  });

  describe('promptConsent', () => {
    let mockRl;

    beforeEach(() => {
      mockRl = { question: jest.fn() };
    });

    it('returns all files when user presses Enter (default yes)', async () => {
      mockRl.question.mockImplementation((q, cb) => cb(''));
      const files = [{ path: '/some/file.md', source: 'home', content: 'x' }];
      const result = await service.promptConsent(files, mockRl);
      expect(result).toEqual(files);
    });

    it('returns all files when user types Y', async () => {
      mockRl.question.mockImplementation((q, cb) => cb('Y'));
      const files = [{ path: '/some/file.md', source: 'home', content: 'x' }];
      const result = await service.promptConsent(files, mockRl);
      expect(result).toEqual(files);
    });

    it('returns empty array when user types n', async () => {
      mockRl.question.mockImplementation((q, cb) => cb('n'));
      const files = [{ path: '/some/file.md', source: 'home', content: 'x' }];
      const result = await service.promptConsent(files, mockRl);
      expect(result).toEqual([]);
    });

    it('returns empty array for empty files list without prompting', async () => {
      const result = await service.promptConsent([], mockRl);
      expect(result).toEqual([]);
      expect(mockRl.question).not.toHaveBeenCalled();
    });
  });

  describe('performParturition', () => {
    it('performs the parturition process successfully with no discovered files', async () => {
      // Mock readline
      const mockRl = {
        question: jest.fn((q, cb) => cb('User Response')),
        close: jest.fn(),
      };
      readline.createInterface.mockReturnValue(mockRl);

      // No discovered files
      fs.readFile.mockImplementation((filePath) => {
        if (filePath.endsWith('Parturition.md'))
          return Promise.resolve('Parturition content ---START_USER--- User Info ---END_USER---');
        return Promise.reject(new Error('ENOENT'));
      });
      fs.writeFile.mockResolvedValue();
      fs.unlink.mockResolvedValue();

      // Mock LLM generator
      const mockLlm = jest.fn().mockResolvedValue(`
---START_SOUL---
Soul Content
---END_SOUL---

---START_IDENTITY---
**Name**: AnimaTest
Identity Content
---END_IDENTITY---
      `);

      await service.performParturition(mockLlm);

      expect(fs.writeFile).toHaveBeenCalledWith(expect.stringContaining('Soul.md'), 'Soul Content');
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('Identity.md'),
        expect.stringContaining('Identity Content'),
      );
      expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('Parturition.md'));
    });

    it('redacts discovered file content before passing to LLM', async () => {
      const mockRl = {
        question: jest.fn((q, cb) => cb(q.includes('Include') ? 'y' : 'Me')),
        close: jest.fn(),
      };
      readline.createInterface.mockReturnValue(mockRl);

      fs.readFile.mockImplementation((filePath) => {
        if (filePath.endsWith('Parturition.md')) return Promise.resolve('Parturition content');
        if (filePath === '/test/dir/CLAUDE.md') return Promise.resolve('api_key: sk-secret123');
        return Promise.reject(new Error('ENOENT'));
      });
      fs.writeFile.mockResolvedValue();
      fs.unlink.mockResolvedValue();

      redact.mockReturnValue('[REDACTED content]');

      const mockLlm = jest.fn().mockResolvedValue(`
---START_SOUL---Soul---END_SOUL---
---START_IDENTITY---Identity---END_IDENTITY---
      `);

      await service.performParturition(mockLlm);

      expect(redact).toHaveBeenCalledWith('api_key: sk-secret123', []);
      const promptArg = mockLlm.mock.calls[0][0];
      expect(promptArg).toContain('[REDACTED content]');
      expect(promptArg).not.toContain('sk-secret123');
    });

    it('handles LLM failure gracefully', async () => {
      readline.createInterface.mockReturnValue({
        question: jest.fn((q, cb) => cb('User Response')),
        close: jest.fn(),
      });

      fs.readFile.mockImplementation((filePath) => {
        if (filePath.endsWith('Parturition.md')) return Promise.resolve('Parturition content');
        return Promise.reject(new Error('ENOENT'));
      });
      const mockLlm = jest.fn().mockRejectedValue(new Error('LLM Error'));

      await service.performParturition(mockLlm);

      expect(mockLlm).toHaveBeenCalled();
      expect(fs.writeFile).not.toHaveBeenCalledWith(
        expect.stringContaining('Soul.md'),
        expect.any(String),
      );
    });
  });

  describe('createPrompt', () => {
    it('generates prompt without discovered context section when none provided', () => {
      const prompt = service.createPrompt('parturition content', 'I am a developer');
      expect(prompt).toContain('parturition content');
      expect(prompt).toContain('I am a developer');
      expect(prompt).not.toContain('Existing User Context');
    });

    it('includes synthesise instruction and file content when discovered context is provided', () => {
      const context = [
        { path: '/home/user/.claude/CLAUDE.md', source: 'home', content: 'User prefers brevity' },
      ];
      const prompt = service.createPrompt('parturition content', 'I am a developer', context);
      expect(prompt).toContain('Existing User Context');
      expect(prompt).toContain('User prefers brevity');
      expect(prompt).toContain('synthesise');
      expect(prompt).toContain('CLAUDE.md');
    });
  });

  describe('performReimport', () => {
    it('errors clearly if Identity.md does not exist', async () => {
      fs.readFile.mockRejectedValue(new Error('ENOENT'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await service.performReimport(jest.fn());

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No Identity.md found'));
      consoleSpy.mockRestore();
    });

    it('backs up Identity.md and writes new one on success', async () => {
      const mockRl = {
        question: jest.fn((q, cb) => cb('y')),
        close: jest.fn(),
      };
      readline.createInterface.mockReturnValue(mockRl);

      fs.readFile.mockImplementation((filePath) => {
        if (filePath.endsWith('Identity.md')) return Promise.resolve('# Existing Identity');
        if (filePath === '/test/dir/CLAUDE.md') return Promise.resolve('user is a senior dev');
        return Promise.reject(new Error('ENOENT'));
      });
      fs.writeFile.mockResolvedValue();

      const mockLlm = jest.fn().mockResolvedValue(`
---START_IDENTITY---
Updated Identity Content
---END_IDENTITY---
      `);

      await service.performReimport(mockLlm);

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('Identity.md.bak'),
        '# Existing Identity',
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('Identity.md'),
        'Updated Identity Content',
      );
    });

    it('returns without writing if user declines consent', async () => {
      const mockRl = {
        question: jest.fn((q, cb) => cb('n')),
        close: jest.fn(),
      };
      readline.createInterface.mockReturnValue(mockRl);

      fs.readFile.mockImplementation((filePath) => {
        if (filePath.endsWith('Identity.md')) return Promise.resolve('# Existing Identity');
        if (filePath === '/test/dir/CLAUDE.md') return Promise.resolve('some content');
        return Promise.reject(new Error('ENOENT'));
      });

      await service.performReimport(jest.fn());

      expect(fs.writeFile).not.toHaveBeenCalledWith(
        expect.stringContaining('Identity.md.bak'),
        expect.any(String),
      );
    });

    it('returns without writing if no personality files are discovered', async () => {
      readline.createInterface.mockReturnValue({ question: jest.fn(), close: jest.fn() });

      fs.readFile.mockImplementation((filePath) => {
        if (filePath.endsWith('Identity.md')) return Promise.resolve('# Existing Identity');
        return Promise.reject(new Error('ENOENT'));
      });

      await service.performReimport(jest.fn());

      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('getAgentName', () => {
    it('returns default name if Identity.md is missing or unreadable', async () => {
      fs.readFile.mockRejectedValue(new Error('ENOENT'));
      const name = await service.getAgentName();
      expect(name).toBe('AI');
    });

    it('returns extracted name from Identity.md (Bold format)', async () => {
      fs.readFile.mockResolvedValue('**Name**: TestAgent\nOther info...');
      const name = await service.getAgentName();
      expect(name).toBe('TestAgent');
    });

    it('returns extracted name from Identity.md (Header format) - REGRESSION', async () => {
      fs.readFile.mockResolvedValue('# Identity.md\n## Name\nAeon\n## Role\nAssistant');
      const name = await service.getAgentName();
      expect(name).toBe('Aeon');
    });

    it('returns "AI" if format is unexpected', async () => {
      fs.readFile.mockResolvedValue('Some random content without name field');
      const name = await service.getAgentName();
      expect(name).toBe('AI');
    });
  });
});
