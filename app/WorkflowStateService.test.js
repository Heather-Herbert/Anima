const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const WorkflowStateService = require('./WorkflowStateService');
const fs = require('node:fs');
const path = require('node:path');

jest.mock('node:fs');

describe('WorkflowStateService', () => {
  const stateFilePath = 'Memory/workflow_state.json';
  let service;
  let mockAuditService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuditService = { log: jest.fn() };
    service = new WorkflowStateService(stateFilePath, mockAuditService);
  });

  it('starts with a default idle state', () => {
    const state = service.getWorkflowState();
    expect(state.state).toBe('idle');
    expect(state.completedSteps).toEqual([]);
    expect(state.transitionHistory).toEqual([]);
  });

  it('loads state from disk if it exists', () => {
    const savedState = {
      state: 'planning',
      sessionId: '2026-01-01',
      task: 'build a house',
      completedSteps: [],
      transitionHistory: [],
    };
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify(savedState));

    const state = service.load();
    expect(state.state).toBe('planning');
    expect(state.task).toBe('build a house');
  });

  it('starts fresh if saved state is corrupt', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('not-json');

    const state = service.load();
    expect(state.state).toBe('idle');
  });

  it('transitions to valid states and persists', () => {
    service.transition('planning', { task: 'new task' });
    const state = service.getWorkflowState();
    expect(state.state).toBe('planning');
    expect(state.task).toBe('new task');
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'workflow_transition', to: 'planning' }),
    );
  });

  it('throws on invalid state transition', () => {
    expect(() => service.transition('dancing')).toThrow("Invalid workflow state: 'dancing'");
  });

  it('records tool execution with checkpoints', () => {
    service.beforeTool('read_file', { path: 'test.txt' });
    let state = service.getWorkflowState();
    expect(state.state).toBe('executing');
    expect(state.checkpoint).toEqual(
      expect.objectContaining({
        toolName: 'read_file',
        args: { path: 'test.txt' },
      }),
    );

    service.afterTool('read_file', 'file content');
    state = service.getWorkflowState();
    expect(state.checkpoint).toBeNull();
    expect(state.completedSteps).toHaveLength(1);
    expect(state.completedSteps[0].toolName).toBe('read_file');
    expect(state.completedSteps[0].resultSummary).toBe('file content');
  });

  it('generates recovery context when interrupted', () => {
    service.transition('planning', { task: 'fix bug' });
    service.beforeTool('read_file', { path: 'bug.js' });

    const context = service.getRecoveryContext();
    expect(context).toContain('Previous session was interrupted in state: executing');
    expect(context).toContain('Current task: fix bug');
    expect(context).toContain('Last checkpoint: read_file');
  });

  it('returns null recovery context if idle or complete', () => {
    expect(service.getRecoveryContext()).toBeNull();
    service.transition('complete');
    expect(service.getRecoveryContext()).toBeNull();
  });

  it('resets session', () => {
    service.transition('planning', { task: 'task' });
    service.reset();
    const state = service.getWorkflowState();
    expect(state.state).toBe('idle');
    expect(state.task).toBeNull();
    expect(state.sessionId).toBeDefined();
  });
});
