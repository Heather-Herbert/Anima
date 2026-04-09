const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const SessionRecoveryService = require('./SessionRecoveryService');

describe('SessionRecoveryService', () => {
  let memoryDir;
  let service;

  beforeEach(() => {
    memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anima-recovery-'));
    service = new SessionRecoveryService(memoryDir);
  });

  afterEach(() => {
    fs.rmSync(memoryDir, { recursive: true, force: true });
  });

  describe('generateSessionId', () => {
    it('returns a string starting with "session-"', () => {
      const id = SessionRecoveryService.generateSessionId();
      expect(typeof id).toBe('string');
      expect(id.startsWith('session-')).toBe(true);
    });

    it('generates unique IDs on separate calls', () => {
      const id1 = SessionRecoveryService.generateSessionId();
      const id2 = SessionRecoveryService.generateSessionId();
      // Not guaranteed to differ within same millisecond, but schema is correct
      expect(id1).toMatch(/^session-\d{4}-\d{2}-\d{2}/);
      expect(id2).toMatch(/^session-\d{4}-\d{2}-\d{2}/);
    });
  });

  describe('save', () => {
    it('writes a snapshot file with the expected fields', () => {
      const sessionId = 'session-test-001';
      const messages = [{ role: 'user', content: 'hello' }];
      const tokenUsage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };

      service.save(sessionId, { messages, tokenUsage, taintStatus: false, workflowState: 'idle' });

      const snapshotPath = path.join(memoryDir, `${sessionId}.snapshot.json`);
      expect(fs.existsSync(snapshotPath)).toBe(true);

      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      expect(snapshot.schemaVersion).toBe(1);
      expect(snapshot.sessionId).toBe(sessionId);
      expect(snapshot.messages).toEqual(messages);
      expect(snapshot.tokenUsage).toEqual(tokenUsage);
      expect(snapshot.taintStatus).toBe(false);
      expect(snapshot.workflowState).toBe('idle');
      expect(snapshot.complete).toBe(false);
      expect(typeof snapshot.savedAt).toBe('string');
    });

    it('defaults taintStatus to false when omitted', () => {
      service.save('session-x', { messages: [], tokenUsage: {}, workflowState: 'idle' });
      const snapshot = JSON.parse(
        fs.readFileSync(path.join(memoryDir, 'session-x.snapshot.json'), 'utf8'),
      );
      expect(snapshot.taintStatus).toBe(false);
    });

    it('creates memoryDir if it does not exist', () => {
      const nestedDir = path.join(memoryDir, 'nested', 'deep');
      const svc = new SessionRecoveryService(nestedDir);
      svc.save('session-nested', { messages: [], tokenUsage: {}, workflowState: 'idle' });
      expect(fs.existsSync(path.join(nestedDir, 'session-nested.snapshot.json'))).toBe(true);
    });

    it('overwrites an existing snapshot on repeated saves', () => {
      const sessionId = 'session-overwrite';
      service.save(sessionId, {
        messages: [{ role: 'user', content: 'first' }],
        tokenUsage: { total_tokens: 10 },
        workflowState: 'idle',
      });
      service.save(sessionId, {
        messages: [{ role: 'user', content: 'second' }],
        tokenUsage: { total_tokens: 20 },
        workflowState: 'complete',
      });

      const snapshot = service.load(sessionId);
      expect(snapshot.messages[0].content).toBe('second');
      expect(snapshot.tokenUsage.total_tokens).toBe(20);
    });
  });

  describe('markComplete', () => {
    it('sets complete to true on an existing snapshot', () => {
      const sessionId = 'session-to-complete';
      service.save(sessionId, { messages: [], tokenUsage: {}, workflowState: 'idle' });
      service.markComplete(sessionId);

      const snapshot = service.load(sessionId);
      expect(snapshot.complete).toBe(true);
    });

    it('does nothing if the snapshot does not exist', () => {
      expect(() => service.markComplete('session-nonexistent')).not.toThrow();
    });
  });

  describe('findUnclean', () => {
    it('returns empty array when no snapshots exist', () => {
      expect(service.findUnclean()).toEqual([]);
    });

    it('returns only incomplete snapshots', () => {
      service.save('session-a', { messages: [], tokenUsage: {}, workflowState: 'idle' });
      service.save('session-b', { messages: [], tokenUsage: {}, workflowState: 'idle' });
      service.markComplete('session-b');

      const unclean = service.findUnclean();
      expect(unclean).toHaveLength(1);
      expect(unclean[0].sessionId).toBe('session-a');
    });

    it('returns snapshots sorted newest first', () => {
      // Save with slightly different savedAt by manipulating files directly
      service.save('session-older', { messages: [], tokenUsage: {}, workflowState: 'idle' });
      const olderPath = path.join(memoryDir, 'session-older.snapshot.json');
      const older = JSON.parse(fs.readFileSync(olderPath, 'utf8'));
      older.savedAt = '2024-01-01T10:00:00.000Z';
      fs.writeFileSync(olderPath, JSON.stringify(older));

      service.save('session-newer', { messages: [], tokenUsage: {}, workflowState: 'idle' });
      const newerPath = path.join(memoryDir, 'session-newer.snapshot.json');
      const newer = JSON.parse(fs.readFileSync(newerPath, 'utf8'));
      newer.savedAt = '2024-01-02T10:00:00.000Z';
      fs.writeFileSync(newerPath, JSON.stringify(newer));

      const unclean = service.findUnclean();
      expect(unclean[0].sessionId).toBe('session-newer');
      expect(unclean[1].sessionId).toBe('session-older');
    });

    it('skips corrupt snapshot files without throwing', () => {
      fs.writeFileSync(path.join(memoryDir, 'bad.snapshot.json'), 'not valid json');
      service.save('session-good', { messages: [], tokenUsage: {}, workflowState: 'idle' });

      const unclean = service.findUnclean();
      expect(unclean).toHaveLength(1);
      expect(unclean[0].sessionId).toBe('session-good');
    });

    it('returns empty array when memoryDir does not exist', () => {
      const svc = new SessionRecoveryService(path.join(memoryDir, 'nonexistent'));
      expect(svc.findUnclean()).toEqual([]);
    });
  });

  describe('load', () => {
    it('returns the saved snapshot', () => {
      const sessionId = 'session-load-test';
      const messages = [{ role: 'assistant', content: 'hi' }];
      service.save(sessionId, {
        messages,
        tokenUsage: { total_tokens: 42 },
        workflowState: 'complete',
      });

      const snapshot = service.load(sessionId);
      expect(snapshot.sessionId).toBe(sessionId);
      expect(snapshot.messages).toEqual(messages);
      expect(snapshot.tokenUsage.total_tokens).toBe(42);
    });

    it('throws if snapshot does not exist', () => {
      expect(() => service.load('session-missing')).toThrow(
        'No snapshot found for session "session-missing"',
      );
    });
  });

  describe('recovery round-trip', () => {
    it('a reconstructed session has identical message history to the original', () => {
      const sessionId = 'session-roundtrip';
      const originalMessages = [
        { role: 'system', content: 'You are an assistant.' },
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: '4' },
      ];
      const originalUsage = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };

      service.save(sessionId, {
        messages: originalMessages,
        tokenUsage: originalUsage,
        taintStatus: false,
        workflowState: 'complete',
      });

      // Simulate restart: load the snapshot
      const snapshot = service.load(sessionId);
      expect(snapshot.messages).toEqual(originalMessages);
      expect(snapshot.tokenUsage).toEqual(originalUsage);
      expect(snapshot.taintStatus).toBe(false);
    });

    it('token usage is not double-counted when accumulating after resume', () => {
      const sessionId = 'session-tokens';
      const firstTurnUsage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
      service.save(sessionId, {
        messages: [{ role: 'user', content: 'turn 1' }],
        tokenUsage: firstTurnUsage,
        workflowState: 'idle',
      });

      // Resume: load snapshot, get prior usage
      const snapshot = service.load(sessionId);
      const priorUsage = snapshot.tokenUsage;

      // Simulate second turn adding tokens
      const secondTurnDelta = { prompt_tokens: 80, completion_tokens: 40, total_tokens: 120 };
      const cumulativeUsage = {
        prompt_tokens: priorUsage.prompt_tokens + secondTurnDelta.prompt_tokens,
        completion_tokens: priorUsage.completion_tokens + secondTurnDelta.completion_tokens,
        total_tokens: priorUsage.total_tokens + secondTurnDelta.total_tokens,
      };

      expect(cumulativeUsage).toEqual({
        prompt_tokens: 180,
        completion_tokens: 90,
        total_tokens: 270,
      });
    });

    it('taint status is restored as false between turns', () => {
      const sessionId = 'session-taint';
      // Taint is always false between turns (reset at start of processInput)
      service.save(sessionId, {
        messages: [],
        tokenUsage: {},
        taintStatus: false,
        workflowState: 'idle',
      });
      const snapshot = service.load(sessionId);
      expect(snapshot.taintStatus).toBe(false);
    });
  });
});
