const { describe, it, expect, beforeEach } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const config = require('./Config');

jest.mock('fs');
jest.mock('./Config', () => ({
  LLMProvider: 'test-provider'
}));

// We need to require Utils AFTER mocking Config
const Utils = require('./Utils');

describe('Utils', () => {
  const mockProviderPath = path.join(__dirname, '..', 'Plugins', 'test-provider.js');
  const mockManifestPath = path.join(__dirname, '..', 'Plugins', 'test-provider.manifest.json');

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    config.LLMProvider = 'test-provider';
    
    // Mock the dynamic plugin module
    jest.doMock(mockProviderPath, () => ({
      completion: jest.fn().mockResolvedValue({ choices: [{ message: { content: 'test response' } }] })
    }), { virtual: true });
  });

  describe('callAI', () => {
    it('calls the provider completion method', async () => {
      fs.existsSync.mockReturnValue(true); // Provider file exists
      
      const messages = [{ role: 'user', content: 'hi' }];
      
      // We need to re-require Utils because we reset modules? 
      // Actually doMock only affects subsequent requires. 
      // Utils.js is already required. But Utils.js calls require() dynamically inside callAI.
      // So doMock should affect that require call.
      
      const result = await Utils.callAI(messages);

      expect(result).toEqual({ choices: [{ message: { content: 'test response' } }] });
      expect(fs.existsSync).toHaveBeenCalledWith(mockProviderPath);
      
      // Verify the provider was called
      // We need to require the mocked module to check expectations
      const provider = require(mockProviderPath);
      expect(provider.completion).toHaveBeenCalledWith(messages, null);
    });

    it('throws error if provider does not exist', async () => {
      fs.existsSync.mockReturnValue(false);

      await expect(Utils.callAI([])).rejects.toThrow('Unknown provider: test-provider');
    });
  });

  describe('getProviderManifest', () => {
    it('returns manifest if it exists', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ capabilities: { tools: ['write_file'] } }));

      const manifest = Utils.getProviderManifest();
      
      expect(manifest).toEqual({ capabilities: { tools: ['write_file'] } });
      expect(fs.existsSync).toHaveBeenCalledWith(mockManifestPath);
      expect(fs.readFileSync).toHaveBeenCalledWith(mockManifestPath, 'utf8');
    });

    it('returns default manifest if file missing', () => {
      fs.existsSync.mockReturnValue(false);

      const manifest = Utils.getProviderManifest();
      
      expect(manifest).toEqual({ capabilities: { tools: ["*"] } });
    });
  });
});