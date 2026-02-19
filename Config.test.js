const { describe, it, expect, beforeEach, afterAll, beforeAll, jest } = require('@jest/globals');

describe('Config.js', () => {
  let originalExit;
  let originalConsoleError;

  beforeAll(() => {
    originalExit = process.exit;
    originalConsoleError = console.error;
    process.exit = jest.fn();
    console.error = jest.fn();
  });

  afterAll(() => {
    process.exit = originalExit;
    console.error = originalConsoleError;
  });

  beforeEach(() => {
    jest.resetModules();
    process.exit.mockClear();
    console.error.mockClear();
  });

  it('loads valid configuration correctly', () => {
    jest.mock('../Anima.config', () => ({
      endpoint: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'gpt-4'
    }), { virtual: true });

    const config = require('../app/Config');
    expect(config.endpoint).toBe('https://api.example.com');
    expect(config.apiKey).toBe('test-key');
    expect(config.model).toBe('gpt-4');
  });

  it('exits if configuration file is missing', () => {
    jest.mock('../Anima.config', () => {
      const err = new Error('Cannot find module');
      err.code = 'MODULE_NOT_FOUND';
      err.message = "Cannot find module '../Anima.config'";
      throw err;
    }, { virtual: true });

    const config = require('../app/Config');
    
    // Access a property to trigger the proxy's lazy load
    const val = config.endpoint;
    
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Configuration file not found'));
  });

  it('exits if configuration is invalid', () => {
    jest.mock('../Anima.config', () => ({
      endpoint: 'not-a-url',
      apiKey: '',
      model: ''
    }), { virtual: true });

    const config = require('../app/Config');
    const val = config.endpoint; // Trigger load

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Configuration validation failed'));
  });
});