const fs = require('node:fs');
const path = require('node:path');
const config = require('./Config');

const VALID_STATES = [
  'idle',
  'planning',
  'awaiting_approval',
  'executing',
  'waiting_on_external',
  'complete',
  'failed',
];

const MAX_TRANSITION_HISTORY = 50;
const MAX_COMPLETED_STEPS = 20;

const DEFAULT_STATE = () => ({
  state: 'idle',
  sessionId: null,
  task: null,
  updatedAt: null,
  checkpoint: null,
  completedSteps: [],
  transitionHistory: [],
});

class WorkflowStateService {
  constructor(stateFilePath, auditService = null) {
    this.stateFilePath = stateFilePath;
    this.auditService = auditService;
    this._state = DEFAULT_STATE();
    this._loaded = false;
  }

  /**
   * Load persisted state from disk on first access.
   * Silently resets to idle if the file is missing or corrupt.
   */
  load() {
    if (this._loaded) return this._state;
    this._loaded = true;
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const raw = fs.readFileSync(this.stateFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (VALID_STATES.includes(parsed.state)) {
          this._state = parsed;
        }
      }
    } catch {
      // Corrupt file — start fresh
    }
    return this._state;
  }

  /**
   * Transition to a new state.
   * Persists the change and emits an audit event.
   * @param {string} newState - One of VALID_STATES
   * @param {object} [metadata] - Optional context (task, reason, tool, …)
   */
  transition(newState, metadata = {}) {
    if (!VALID_STATES.includes(newState)) {
      throw new Error(`Invalid workflow state: '${newState}'`);
    }

    const from = this._state.state;
    const now = new Date().toISOString();

    this._state = {
      ...this._state,
      state: newState,
      updatedAt: now,
      ...(metadata.task !== undefined ? { task: metadata.task } : {}),
      // Clear checkpoint when leaving executing without entering it again
      ...(from === 'executing' && newState !== 'executing' ? { checkpoint: null } : {}),
    };

    const entry = {
      from,
      to: newState,
      at: now,
      ...(Object.keys(metadata).length ? { metadata } : {}),
    };
    this._state.transitionHistory = [
      ...this._state.transitionHistory,
      entry,
    ].slice(-MAX_TRANSITION_HISTORY);

    this._persist();

    if (this.auditService) {
      this.auditService.log({
        event: 'workflow_transition',
        from,
        to: newState,
        ...(Object.keys(metadata).length ? { metadata } : {}),
      });
    }

    return this._state;
  }

  /**
   * Record that a tool is about to execute.
   * Saves a checkpoint so a crash can be diagnosed.
   */
  beforeTool(toolName, args) {
    const now = new Date().toISOString();
    this._state = {
      ...this._state,
      state: 'executing',
      updatedAt: now,
      checkpoint: { toolName, args, startedAt: now },
    };
    this._persist();

    if (this.auditService) {
      this.auditService.log({ event: 'workflow_checkpoint', toolName, phase: 'before' });
    }
  }

  /**
   * Record that a tool completed successfully.
   * Clears the checkpoint and appends to completedSteps.
   */
  afterTool(toolName, result) {
    const now = new Date().toISOString();
    const raw = typeof result === 'string' ? result : JSON.stringify(result);
    const resultSummary = raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;

    const step = { toolName, completedAt: now, resultSummary };
    this._state = {
      ...this._state,
      updatedAt: now,
      checkpoint: null,
      completedSteps: [...this._state.completedSteps, step].slice(-MAX_COMPLETED_STEPS),
    };
    this._persist();

    if (this.auditService) {
      this.auditService.log({ event: 'workflow_checkpoint', toolName, phase: 'after' });
    }
  }

  /**
   * Returns the current workflow state snapshot (public API).
   */
  getWorkflowState() {
    return { ...this._state };
  }

  /**
   * Generate a recovery context string to inject when the agent restarts mid-task.
   * Returns null when no recovery is needed (state is idle or complete).
   */
  getRecoveryContext() {
    const s = this._state;
    if (s.state === 'idle' || s.state === 'complete') return null;

    const lines = [
      '<workflow_recovery>',
      `Previous session was interrupted in state: ${s.state}`,
    ];

    if (s.task) lines.push(`Current task: ${s.task}`);

    if (s.checkpoint) {
      lines.push(
        `Last checkpoint: ${s.checkpoint.toolName} started at ${s.checkpoint.startedAt} — this tool may not have completed`,
      );
    }

    if (s.completedSteps.length > 0) {
      const names = s.completedSteps.map((st) => st.toolName).join(', ');
      lines.push(`Completed steps this session: ${names}`);
      lines.push('Do not re-execute these steps unless explicitly asked to.');
    }

    lines.push('Resume the task from where you left off.');
    lines.push('</workflow_recovery>');

    return lines.join('\n');
  }

  /**
   * Reset to idle, starting a fresh session ID.
   * Call this when the user requests a new session.
   */
  reset() {
    const sessionId = new Date().toISOString();
    this._state = {
      ...DEFAULT_STATE(),
      sessionId,
      updatedAt: sessionId,
    };
    this._persist();
  }

  /** Write current state to disk (non-fatal on failure). */
  _persist() {
    if (config.memoryMode === 'off') return;

    try {
      const dir = path.dirname(this.stateFilePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.stateFilePath, JSON.stringify(this._state, null, 2), 'utf8');
    } catch {
      // State lives in memory even if disk write fails
    }
  }
}

module.exports = WorkflowStateService;
module.exports.VALID_STATES = VALID_STATES;
