const { describe, it, expect, beforeEach } = require('@jest/globals');
const path = require('path');
const readline = require('readline');

// Mock readline
jest.mock('readline');

// Mock fs.promises via fs
jest.mock('fs', () => {
  return {
    promises: {
      access: jest.fn(),
      readFile: jest.fn(),
      writeFile: jest.fn(),
      unlink: jest.fn(),
    },
  };
});

// We need to require fs to manipulate the mocks
const fs = require('fs').promises;

const ParturitionService = require('./ParturitionService');

describe('ParturitionService', () => {
  let service;
  const baseDir = '/test/dir';
  const personalityDir = path.join(baseDir, 'Personality');

  beforeEach(() => {
    service = new ParturitionService(baseDir);
    jest.clearAllMocks();
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

  describe('performParturition', () => {
    it('performs the parturition process successfully', async () => {
      // Mock readline
      const mockRl = {
        question: jest.fn((q, cb) => cb('User Response')),
        close: jest.fn(),
      };
      readline.createInterface.mockReturnValue(mockRl);

      // Mock fs operations
      fs.readFile.mockResolvedValue(
        'Parturition content ---START_USER--- User Info ---END_USER---',
      );
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

      // Verify
      expect(mockRl.question).toHaveBeenCalled();
      // We use expect.stringContaining because path.join might use varying separators
      expect(fs.readFile).toHaveBeenCalledWith(expect.stringContaining('Parturition.md'), 'utf-8');
      expect(fs.writeFile).toHaveBeenCalledWith(expect.stringContaining('user.md'), 'User Info');
      expect(mockLlm).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalledWith(expect.stringContaining('Soul.md'), 'Soul Content');
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('Identity.md'),
        expect.stringContaining('Identity Content'),
      );
      expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('Parturition.md'));
    });

    it('handles LLM failure gracefully', async () => {
      readline.createInterface.mockReturnValue({
        question: jest.fn((q, cb) => cb('User Response')),
        close: jest.fn(),
      });

      fs.readFile.mockResolvedValue('Parturition content');
      const mockLlm = jest.fn().mockRejectedValue(new Error('LLM Error'));

      await service.performParturition(mockLlm);

      expect(mockLlm).toHaveBeenCalled();
      // Should not write soul/identity if LLM fails
      expect(fs.writeFile).not.toHaveBeenCalledWith(
        expect.stringContaining('Soul.md'),
        expect.any(String),
      );
    });
  });

  describe('getAgentName', () => {
    it('returns default name if Identity.md is missing or unreadable', async () => {
      fs.readFile.mockRejectedValue(new Error('ENOENT'));
      const name = await service.getAgentName();
      expect(name).toBe('AI');
    });

    it('returns extracted name from Identity.md', async () => {
      fs.readFile.mockResolvedValue('**Name**: TestAgent\nOther info...');
      const name = await service.getAgentName();
      expect(name).toBe('TestAgent');
    });

    it('returns "AI" if format is unexpected', async () => {
      fs.readFile.mockResolvedValue('Some random content without name field');
      const name = await service.getAgentName();
      expect(name).toBe('AI');
    });
  });
});
