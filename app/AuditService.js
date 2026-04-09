const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { redact } = require('./Utils');

const GENESIS_HMAC = 'GENESIS';

class AuditService {
  constructor(auditLogPath) {
    this.auditLogPath = auditLogPath;
    this.failureLogPath = auditLogPath.replace('audit.log', 'failures.log');
    this.keyPath = path.join(path.dirname(auditLogPath), 'audit.key');
    this.secrets = [];
    this._hmacKey = null;
    this._prevHmac = null; // tracks chain tip for the current process lifetime
  }

  _loadOrCreateKey() {
    if (this._hmacKey) return this._hmacKey;
    try {
      if (fs.existsSync(this.keyPath)) {
        this._hmacKey = fs.readFileSync(this.keyPath, 'utf8').trim();
      } else {
        this._hmacKey = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(this.keyPath, this._hmacKey, { mode: 0o600 });
      }
    } catch (e) {
      // Fall back to a session-only key — entries will still chain within the session
      this._hmacKey = crypto.randomBytes(32).toString('hex');
      process.stderr.write(`Audit Key Warning: ${e.message}\n`);
    }
    return this._hmacKey;
  }

  _computeHmac(payload, prevHmac) {
    const key = this._loadOrCreateKey();
    return crypto
      .createHmac('sha256', key)
      .update(JSON.stringify(payload) + prevHmac)
      .digest('hex');
  }

  _readLastHmac() {
    try {
      if (!fs.existsSync(this.auditLogPath)) return GENESIS_HMAC;
      const content = fs.readFileSync(this.auditLogPath, 'utf8').trimEnd();
      if (!content) return GENESIS_HMAC;
      const lines = content.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        const parsed = JSON.parse(line);
        if (parsed.hmac) return parsed.hmac;
      }
    } catch {
      // ignore parse errors — chain will break here, which is detectable
    }
    return GENESIS_HMAC;
  }

  addSecret(secret) {
    if (secret && !this.secrets.includes(secret)) {
      this.secrets.push(secret);
    }
  }

  log(entry) {
    const timestamp = new Date().toISOString();
    const payload = {
      timestamp,
      event: entry.event,
      tool: entry.tool,
      args: redact(JSON.stringify(entry.args || {}), this.secrets),
      result: entry.result,
      outputHash: entry.output
        ? crypto.createHash('sha256').update(JSON.stringify(entry.output)).digest('hex')
        : null,
    };

    // Resolve chain tip: use in-memory tip if available, else read from disk
    const prevHmac = this._prevHmac ?? this._readLastHmac();
    const hmac = this._computeHmac(payload, prevHmac);
    this._prevHmac = hmac;

    const signedEntry = { ...payload, prevHmac, hmac };

    try {
      fs.appendFileSync(this.auditLogPath, JSON.stringify(signedEntry) + '\n');
    } catch (e) {
      process.stderr.write(`Audit Log Error: ${e.message}\n`);
    }
  }

  logFailure(context, error, details = null) {
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      context,
      error: error instanceof Error ? error.message : error,
      details: redact(JSON.stringify(details || {}), this.secrets),
    };

    try {
      fs.appendFileSync(this.failureLogPath, JSON.stringify(entry) + '\n');
    } catch (e) {
      process.stderr.write(`Failure Log Error: ${e.message}\n`);
    }
  }

  _validateLine(line, prevHmac) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { ok: false };
    }
    const { hmac, prevHmac: storedPrev, ...payload } = parsed;
    if (storedPrev !== prevHmac) return { ok: false };
    const expected = this._computeHmac(payload, prevHmac);
    if (expected !== hmac) return { ok: false };
    return { ok: true, hmac };
  }

  /**
   * Validates the audit log's HMAC chain from genesis.
   * Returns { valid: boolean, entries: number, firstTamperedLine: number|null }
   */
  validateLog() {
    const result = { valid: true, entries: 0, firstTamperedLine: null };
    try {
      if (!fs.existsSync(this.auditLogPath)) return result;
      const lines = fs
        .readFileSync(this.auditLogPath, 'utf8')
        .split('\n')
        .filter((l) => l.trim());
      let prevHmac = GENESIS_HMAC;
      for (let i = 0; i < lines.length; i++) {
        result.entries++;
        const check = this._validateLine(lines[i], prevHmac);
        if (!check.ok) {
          result.valid = false;
          result.firstTamperedLine = i + 1;
          break;
        }
        prevHmac = check.hmac;
      }
    } catch {
      result.valid = false;
    }
    return result;
  }
}

module.exports = AuditService;
