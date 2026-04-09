const { describe, it, expect, beforeEach } = require('@jest/globals');
const fs = require('node:fs');
const AuditService = require('./AuditService');

jest.mock('node:fs');

describe('AuditService', () => {
  const logPath = '/tmp/audit.log';
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(false);
    fs.appendFileSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    service = new AuditService(logPath);
  });

  it('logs redacted entries with output hashes', () => {
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

  it('appends hmac and prevHmac fields to each log entry', () => {
    service.log({ event: 'e1', tool: 't1', args: {}, result: 'ok' });

    const logCall = fs.appendFileSync.mock.calls[0][1];
    const parsed = JSON.parse(logCall);

    expect(parsed.hmac).toBeDefined();
    expect(parsed.hmac).toHaveLength(64);
    expect(parsed.prevHmac).toBe('GENESIS');
  });

  it('chains entries so each prevHmac matches the previous hmac', () => {
    service.log({ event: 'e1', tool: 't1', args: {}, result: 'ok' });
    service.log({ event: 'e2', tool: 't2', args: {}, result: 'ok' });

    const first = JSON.parse(fs.appendFileSync.mock.calls[0][1]);
    const second = JSON.parse(fs.appendFileSync.mock.calls[1][1]);

    expect(second.prevHmac).toBe(first.hmac);
  });

  describe('validateLog', () => {
    it('returns valid=true with zero entries when log does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      const result = service.validateLog();
      expect(result.valid).toBe(true);
      expect(result.entries).toBe(0);
      expect(result.firstTamperedLine).toBeNull();
    });

    it('validates a correctly signed log', () => {
      // Write real entries by capturing appendFileSync output
      const lines = [];
      fs.appendFileSync.mockImplementation((p, data) => lines.push(data.trimEnd()));

      service.log({ event: 'e1', tool: 't1', args: {}, result: 'ok' });
      service.log({ event: 'e2', tool: 't2', args: {}, result: 'ok' });

      // Feed those lines back for validation
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(lines.join('\n'));

      const result = service.validateLog();
      expect(result.valid).toBe(true);
      expect(result.entries).toBe(2);
      expect(result.firstTamperedLine).toBeNull();
    });

    it('detects a tampered entry (modified field)', () => {
      const lines = [];
      fs.appendFileSync.mockImplementation((p, data) => lines.push(data.trimEnd()));

      service.log({ event: 'e1', tool: 't1', args: {}, result: 'ok' });
      service.log({ event: 'e2', tool: 't2', args: {}, result: 'ok' });

      // Tamper with the first entry
      const tampered = JSON.parse(lines[0]);
      tampered.event = 'tampered';
      lines[0] = JSON.stringify(tampered);

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(lines.join('\n'));

      const result = service.validateLog();
      expect(result.valid).toBe(false);
      expect(result.firstTamperedLine).toBe(1);
    });

    it('detects a deleted entry (broken chain)', () => {
      const lines = [];
      fs.appendFileSync.mockImplementation((p, data) => lines.push(data.trimEnd()));

      service.log({ event: 'e1', tool: 't1', args: {}, result: 'ok' });
      service.log({ event: 'e2', tool: 't2', args: {}, result: 'ok' });
      service.log({ event: 'e3', tool: 't3', args: {}, result: 'ok' });

      // Delete the first entry
      const remaining = lines.slice(1);

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(remaining.join('\n'));

      const result = service.validateLog();
      expect(result.valid).toBe(false);
      expect(result.firstTamperedLine).toBe(1);
    });
  });
});
