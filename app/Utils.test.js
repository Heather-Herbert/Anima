const { describe, it, expect, beforeEach } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const config = require('./Config');
const { spawn } = require('node:child_process');
const EventEmitter = require('node:events');

jest.mock('fs');
jest.mock('node:child_process');
jest.mock('./Config', () => ({
  LLMProvider: 'test-provider',
}));

const Utils = require('./Utils');

describe('Utils', () => {
  const mockProviderPath = path.join(__dirname, '..', 'Plugins', 'test-provider.js');

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    config.LLMProvider = 'test-provider';
  });

  describe('callAI', () => {
    it('spawns a provider process and returns its output', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['test-provider.js']);

      const mockChild = new EventEmitter();
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.stdin = { write: jest.fn(), end: jest.fn() };

      spawn.mockReturnValue(mockChild);

      const promise = Utils.callAI([{ role: 'user', content: 'hi' }]);

      // Simulate output
      mockChild.stdout.emit(
        'data',
        JSON.stringify({ choices: [{ message: { content: 'hello' } }] }),
      );
      mockChild.emit('close', 0);

      const result = await promise;
      expect(result.choices[0].message.content).toBe('hello');
      expect(spawn).toHaveBeenCalledWith(
        process.execPath,
        [expect.stringContaining('ProviderRunner.js'), mockProviderPath],
        expect.anything(),
      );
    });

    it('handles provider process errors', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['test-provider.js']);

      const mockChild = new EventEmitter();
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.stdin = { write: jest.fn(), end: jest.fn() };

      spawn.mockReturnValue(mockChild);

      const promise = Utils.callAI([]);

      mockChild.stderr.emit('data', JSON.stringify({ error: 'Critical Failure' }));
      mockChild.emit('close', 1);

      await expect(promise).rejects.toThrow('Provider Process Error: Critical Failure');
    });

    it('throws error if provider does not exist', async () => {
      fs.existsSync.mockReturnValue(false);
      fs.readdirSync.mockReturnValue([]);
      await expect(Utils.callAI([])).rejects.toThrow('Unknown provider: test-provider');
    });

    it('resolves provider name case-insensitively', async () => {
      // REGRESSION: Fixed issue where 'openrouter' (lowercase) failed to find 'OpenRouter.js'
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['OpenRouter.js']);
      config.LLMProvider = 'openrouter';

      const mockChild = new EventEmitter();
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.stdin = { write: jest.fn(), end: jest.fn() };
      spawn.mockReturnValue(mockChild);

      const promise = Utils.callAI([{ role: 'user', content: 'hi' }]);
      mockChild.stdout.emit(
        'data',
        JSON.stringify({ choices: [{ message: { content: 'hello' } }] }),
      );
      mockChild.emit('close', 0);

      await promise;
      expect(spawn).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([expect.stringContaining('OpenRouter.js')]),
        expect.anything(),
      );
    });
  });

  describe('getProviderManifest', () => {
    it('returns manifest if it exists', () => {
      const pluginsDir = path.join(__dirname, '..', 'Plugins');
      const mockManifestPath = path.join(pluginsDir, 'test-provider.manifest.json');
      fs.readdirSync.mockReturnValue(['test-provider.manifest.json']);
      fs.existsSync.mockImplementation((p) => p === mockManifestPath || p === pluginsDir);
      fs.readFileSync.mockReturnValue(JSON.stringify({ capabilities: { tools: ['write_file'] } }));

      const manifest = Utils.getProviderManifest();

      expect(manifest).toEqual({ capabilities: { tools: ['write_file'] } });
    });

    it('resolves manifest case-insensitively', () => {
      // REGRESSION: Fixed issue where 'openrouter' failed to find 'OpenRouter.manifest.json'
      fs.readdirSync.mockReturnValue(['OpenRouter.manifest.json']);
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ name: 'OpenRouter' }));
      config.LLMProvider = 'openrouter';

      const manifest = Utils.getProviderManifest();

      expect(manifest.name).toBe('OpenRouter');
      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('OpenRouter.manifest.json'),
        'utf8',
      );
    });

    it('returns default secure manifest if file missing', () => {
      fs.existsSync.mockReturnValue(false);
      fs.readdirSync.mockReturnValue([]);

      const manifest = Utils.getProviderManifest();

      expect(manifest.capabilities.tools).toEqual([
        'read_file',
        'list_files',
        'search_files',
        'file_info',
        'web_search',
      ]);
      expect(manifest.permissions.filesystem.read).toEqual(['*']);
      expect(manifest.permissions.filesystem.write).toEqual([]);
    });
  });

  describe('encryption', () => {
    const key = 'test-secret-key';
    const text = 'Sensitive information';

    it('encrypts and decrypts text correctly', () => {
      const encrypted = Utils.encrypt(text, key);
      expect(encrypted).not.toBe(text);
      expect(encrypted.split(':')).toHaveLength(3);

      const decrypted = Utils.decrypt(encrypted, key);
      expect(decrypted).toBe(text);
    });

    it('throws error if key is missing', () => {
      expect(() => Utils.encrypt(text, '')).toThrow('Encryption key is required');
      expect(() => Utils.decrypt('...', '')).toThrow('Encryption key is required');
    });

    it('fails to decrypt with wrong key', () => {
      const encrypted = Utils.encrypt(text, key);
      expect(() => Utils.decrypt(encrypted, 'wrong-key')).toThrow('Decryption failed');
    });

    it('fails to decrypt malformed data', () => {
      expect(() => Utils.decrypt('invalid:data', key)).toThrow('Decryption failed');
    });

    it('redacts secrets with "is" separator - REGRESSION', () => {
      const text = "My secret key is 'AI-SECRET-999'.";
      const redacted = Utils.redact(text);
      expect(redacted).toContain('[REDACTED]');
      expect(redacted).not.toContain('AI-SECRET-999');
    });
  });
});
