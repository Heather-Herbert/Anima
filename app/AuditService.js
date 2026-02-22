const fs = require('node:fs');
const crypto = require('node:crypto');
const { redact } = require('./Utils');

class AuditService {
  constructor(auditLogPath) {
    this.auditLogPath = auditLogPath;
    this.secrets = [];
  }

  addSecret(secret) {
    if (secret && !this.secrets.includes(secret)) {
      this.secrets.push(secret);
    }
  }

  log(entry) {
    const timestamp = new Date().toISOString();
    const redactedEntry = {
      timestamp,
      event: entry.event,
      tool: entry.tool,
      args: redact(JSON.stringify(entry.args || {}), this.secrets),
      result: entry.result,
      outputHash: entry.output
        ? crypto.createHash('sha256').update(JSON.stringify(entry.output)).digest('hex')
        : null,
    };

    try {
      fs.appendFileSync(this.auditLogPath, JSON.stringify(redactedEntry) + '\n');
    } catch (e) {
      process.stderr.write(`Audit Log Error: ${e.message}\n`);
    }
  }
}

module.exports = AuditService;
