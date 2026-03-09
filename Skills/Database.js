const fs = require('node:fs');
const path = require('node:path');
const config = require('../app/Config');

// Dynamic requirement to avoid hard failure if dependencies are missing
let mysql, pg;
try {
  mysql = require('mysql2/promise');
} catch (e) {
  /* optional */
}
try {
  pg = require('pg');
} catch (e) {
  /* optional */
}

/**
 * Basic SQL Sanitization and Security Checks
 */
const securityCheck = (sql, isTainted) => {
  const normalizedSql = sql.trim().toLowerCase();

  // Taint Mode Check: Prevent dangerous operations if session is tainted
  const dangerousOps = [
    'insert',
    'update',
    'delete',
    'drop',
    'truncate',
    'alter',
    'grant',
    'revoke',
  ];
  if (isTainted) {
    if (dangerousOps.some((op) => normalizedSql.startsWith(op))) {
      throw new Error(
        `Security Error: Potentially dangerous SQL operation '${normalizedSql.split(' ')[0].toUpperCase()}' is blocked because the session is 'tainted' by a web search.`,
      );
    }
  }

  // Mandatory LIMIT for SELECT if not already present
  if (normalizedSql.startsWith('select') && !normalizedSql.includes('limit')) {
    return `${sql} LIMIT 100`;
  }

  return sql;
};

const getDBConfig = () => {
  const configPath =
    process.env.ANIMA_DB_CONFIG_PATH || path.join(config.workspaceDir, 'Settings', 'database.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Database configuration file not found at: ${configPath}`);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
};

const implementations = {
  query: async ({ profile, sql, params = [], _justification, _risk_assessment }, permissions) => {
    try {
      // 0. Permission Check
      if (!permissions?.capabilities?.database) {
        return "Error: Database access is not permitted by your current manifest. Ensure 'capabilities.database' is true in your plugin/skill manifest.";
      }

      const dbConfigs = getDBConfig();
      const dbProfile = dbConfigs[profile];

      if (!dbProfile) {
        return `Error: Profile '${profile}' not found in database configuration. Available: ${Object.keys(dbConfigs).join(', ')}`;
      }

      // 1. Security Analysis and Modification
      let finalSql;
      try {
        finalSql = securityCheck(sql, permissions?._isTainted);
      } catch (err) {
        return err.message;
      }

      const _isWriteOp =
        !finalSql.trim().toLowerCase().startsWith('select') &&
        !finalSql.trim().toLowerCase().startsWith('explain');

      // 2. Explain-Before-Execute: For dangerous operations, provide an explanation
      // In this tool, we log the justification and risk_assessment, and return it to the user
      // via the CLI confirmation flow (which happens in ToolDispatcher/ConversationService).
      // Here we just proceed if it hasn't been denied by the user already.

      if (dbProfile.type === 'mysql') {
        if (!mysql)
          return 'Error: Dependency "mysql2" is not installed. Please run "npm install mysql2".';

        const connection = await mysql.createConnection(dbProfile.config);
        try {
          // If it's a non-select query, we might want to run an EXPLAIN first if requested
          // but usually the agent's risk_assessment satisfies the requirement.
          const [rows, _fields] = await connection.execute(finalSql, params);
          return JSON.stringify(rows, null, 2);
        } finally {
          await connection.end();
        }
      } else if (dbProfile.type === 'postgresql' || dbProfile.type === 'pg') {
        if (!pg) return 'Error: Dependency "pg" is not installed. Please run "npm install pg".';

        const { Client } = pg;
        const client = new Client(dbProfile.config);
        await client.connect();
        try {
          const res = await client.query(finalSql, params);
          return JSON.stringify(res.rows, null, 2);
        } finally {
          await client.end();
        }
      } else {
        return `Error: Unsupported database type '${dbProfile.type}'. Supported: mysql, postgresql.`;
      }
    } catch (e) {
      return `Database Error: ${e.message}`;
    }
  },
};

module.exports = { implementations };
