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

  it('exits if configuration file is missing', () => {
    // We mock require to throw error when loading the config file
    jest.mock(
      '../Settings/Anima.config',
      () => {
        throw new Error('Cannot find module');
      },
      { virtual: true },
    );

    const config = require('./Config');

    // Trigger load
    try {
      config.LLMProvider;
    } catch (e) {
      // Expected to throw or exit
    }

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Configuration file not found'),
    );
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
});
