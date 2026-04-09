const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const SNAPSHOT_SUFFIX = '.snapshot.json';

class SessionRecoveryService {
  constructor(memoryDir) {
    this.memoryDir = memoryDir;
  }

  static generateSessionId() {
    return `session-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  }

  _snapshotPath(sessionId) {
    return path.join(this.memoryDir, `${sessionId}${SNAPSHOT_SUFFIX}`);
  }

  /**
   * Persist the current session state to disk.
   * @param {string} sessionId
   * @param {{ messages: Array, tokenUsage: object, taintStatus: boolean, workflowState: string }} data
   */
  save(sessionId, { messages, tokenUsage, taintStatus, workflowState }) {
    const snapshot = {
      schemaVersion: SCHEMA_VERSION,
      sessionId,
      messages,
      tokenUsage,
      taintStatus: taintStatus || false,
      workflowState: workflowState || 'idle',
      savedAt: new Date().toISOString(),
      complete: false,
    };
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }
    fs.writeFileSync(this._snapshotPath(sessionId), JSON.stringify(snapshot, null, 2));
  }

  /**
   * Mark a session as cleanly completed so it won't appear as unclean on next startup.
   */
  markComplete(sessionId) {
    const snapshotPath = this._snapshotPath(sessionId);
    if (!fs.existsSync(snapshotPath)) return;
    try {
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      snapshot.complete = true;
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
    } catch {
      /* ignore read/parse errors on completion marking */
    }
  }

  /**
   * Return all snapshots that were not cleanly completed, newest first.
   * @returns {Array<object>}
   */
  findUnclean() {
    if (!fs.existsSync(this.memoryDir)) return [];
    let files;
    try {
      files = fs.readdirSync(this.memoryDir).filter((f) => f.endsWith(SNAPSHOT_SUFFIX));
    } catch {
      return [];
    }
    const unclean = [];
    for (const file of files) {
      try {
        const snapshot = JSON.parse(fs.readFileSync(path.join(this.memoryDir, file), 'utf8'));
        if (!snapshot.complete) unclean.push(snapshot);
      } catch {
        /* skip corrupt snapshots */
      }
    }
    return unclean.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  /**
   * Load a specific snapshot by sessionId.
   * @param {string} sessionId
   * @returns {object} snapshot
   */
  load(sessionId) {
    const snapshotPath = this._snapshotPath(sessionId);
    if (!fs.existsSync(snapshotPath)) {
      throw new Error(`No snapshot found for session "${sessionId}"`);
    }
    return JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  }
}

module.exports = SessionRecoveryService;
