const { describe, it, expect, beforeEach } = require('@jest/globals');
const fs = require('node:fs');
const AuditService = require('./AuditService');

jest.mock('node:fs');

describe('AuditService', () => {
  const logPath = 'audit.log';
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuditService(logPath);
  });

  it('redacts known secrets', () => {
    service.addSecret('super-secret-key');
    const input = 'My key is super-secret-key';
    const redacted = service.redact(input);
    expect(redacted).toBe('My key is [REDACTED]');
  });

  it('redacts generic API keys and tokens', () => {
    const input = '{"api_key": "1234567890abcdef", "token": "Bearer abcdef123456"}';
    const redacted = service.redact(input);
    expect(redacted).toContain('api_key: [REDACTED]');
    expect(redacted).toContain('Bearer [REDACTED]');
  });

  it('logs redacted entries with output hashes', () => {
    fs.appendFileSync.mockImplementation(() => {});
    service.addSecret('secret123');

    const entry = {
      event: 'test_event',
      tool: 'test_tool',
      args: { key: 'secret123', safe: 'val' },
      result: 'success',
      output: 'some result',
    };

    service.log(entry);

    expect(fs.appendFileSync).toHaveBeenCalled();
    const logCall = fs.appendFileSync.mock.calls[0][1];
    const parsed = JSON.parse(logCall);

    expect(parsed.event).toBe('test_event');
    expect(parsed.args).toContain('[REDACTED]');
    expect(parsed.args).toContain('safe');
    expect(parsed.outputHash).toBeDefined();
    expect(parsed.outputHash).toHaveLength(64); // SHA-256 hex
  });
});
