const { describe, it, expect, beforeEach, afterAll, beforeAll } = require('@jest/globals');

describe('Config', () => {
  let originalExit;
  let originalConsoleError;

  beforeAll(() => {
    originalExit = process.exit;
    originalConsoleError = console.error;
    // Mocking process.exit to prevent test runner from exiting
    // but allowing us to check if it was called.
    Object.defineProperty(process, 'exit', {
      value: jest.fn(),
    });
    console.error = jest.fn();
  });

  afterAll(() => {
    Object.defineProperty(process, 'exit', {
      value: originalExit,
    });
    console.error = originalConsoleError;
  });

  beforeEach(() => {
    jest.resetModules();
    process.exit.mockClear();
    console.error.mockClear();
  });

  it('loads valid configuration correctly', () => {
    jest.mock(
      '../Settings/Anima.config',
      () => ({
        LLMProvider: 'gpt-4',
      }),
      { virtual: true },
    );

    const config = require('./Config');
    // Access property to trigger load
    expect(config.LLMProvider).toBe('gpt-4');
  });

  it('returns undefined if configuration file is missing', () => {
    // We mock require to throw error when loading the config file
    jest.mock(
      '../Settings/Anima.config',
      () => {
        throw new Error('Cannot find module');
      },
      { virtual: true },
    );

    const config = require('./Config');

    // Accessing a property should return undefined and NOT exit
    expect(config.LLMProvider).toBeUndefined();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('exits if configuration is invalid', () => {
    jest.mock(
      '../Settings/Anima.config',
      () => ({
        LLMProvider: 123, // Invalid type, should be string
      }),
      { virtual: true },
    );

    const config = require('./Config');

    try {
      config.LLMProvider;
    } catch (e) {
      // Expected validation error
    }

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Configuration validation failed'),
    );
  });

  it('proxy handlers work correctly', () => {
    jest.mock(
      '../Settings/Anima.config',
      () => ({
        LLMProvider: 'proxy-test',
        heartbeatInterval: 100,
      }),
      { virtual: true },
    );

    const config = require('./Config');

    // Test 'has'
    expect('LLMProvider' in config).toBe(true);
    expect('nonExistent' in config).toBe(false);

    // Test 'ownKeys'
    expect(Object.keys(config)).toContain('LLMProvider');

    // Test 'getOwnPropertyDescriptor'
    const desc = Object.getOwnPropertyDescriptor(config, 'LLMProvider');
    expect(desc).toBeDefined();
    expect(desc.value).toBe('proxy-test');

    // Test 'set'
    config.heartbeatInterval = 500;
    expect(config.heartbeatInterval).toBe(500);
  });

  it('proxy handles missing config gracefully', () => {
    jest.mock(
      '../Settings/Anima.config',
      () => {
        throw new Error('Missing');
      },
      { virtual: true },
    );

    const config = require('./Config');
    expect('any' in config).toBe(false);
    expect(Object.keys(config)).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(config, 'any')).toBeUndefined();

    // Test setting on missing config
    config.newProp = 'value';
    expect(config.newProp).toBe('value');
  });
});
