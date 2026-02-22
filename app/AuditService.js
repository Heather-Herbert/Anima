const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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

  redact(text) {
    if (typeof text !== 'string') text = JSON.stringify(text);
    let redacted = text;

    // Redact known secrets
    this.secrets.forEach((secret) => {
      const escaped = secret.replace(/[.*+?^${}()|[\]\]/g, '\$&');
      const re = new RegExp(escaped, 'g');
      redacted = redacted.replace(re, '[REDACTED]');
    });

    // Pattern-based redaction (generic API keys, tokens)
    redacted = redacted.replace(/(api[_-]?key|token|auth|password|secret)["']?\s*[:=]\s*["']?([a-zA-Z0-9_\-]{8,})["']?/gi, '$1: [REDACTED]');
    redacted = redacted.replace(/Bearer\s+([a-zA-Z0-9_\-\.]{10,})/gi, 'Bearer [REDACTED]');

    return redacted;
  }

  log(entry) {
    const timestamp = new Date().toISOString();
    const redactedEntry = {
      timestamp,
      event: entry.event,
      tool: entry.tool,
      args: this.redact(JSON.stringify(entry.args || {})),
      result: entry.result,
      outputHash: entry.output ? crypto.createHash('sha256').update(JSON.stringify(entry.output)).digest('hex') : null,
    };

    try {
      fs.appendFileSync(this.auditLogPath, JSON.stringify(redactedEntry) + '
');
    } catch (e) {
      process.stderr.write(`Audit Log Error: ${e.message}
`);
    }
  }
}

module.exports = AuditService;
