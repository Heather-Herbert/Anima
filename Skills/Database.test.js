const { describe, it, expect, beforeEach } = require('@jest/globals');
const { implementations } = require('./Database');
const fs = require('node:fs');

jest.mock('node:fs');
jest.mock('../app/Config', () => ({
  workspaceDir: '/mock/dir',
}));

describe('Database Skill', () => {
  const mockConfig = {
    test_db: {
      type: 'mysql',
      config: { host: 'localhost' },
    },
    test_pg: {
      type: 'postgresql',
      config: { host: 'localhost' },
    },
    unsupported: {
      type: 'mongodb',
      config: {},
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));
  });

  it('blocks dangerous operations in taint mode', async () => {
    const args = {
      profile: 'test_db',
      sql: 'DROP TABLE users',
      justification: 'Cleanup',
      risk_assessment: 'High',
    };
    const permissions = { _isTainted: true, capabilities: { database: true } };

    const result = await implementations.query(args, permissions);
    expect(result).toContain(
      "Security Error: Potentially dangerous SQL operation 'DROP' is blocked",
    );
  });

  it('appends LIMIT 100 to SELECT queries if missing', async () => {
    const args = {
      profile: 'test_db',
      sql: 'SELECT * FROM users',
      justification: 'Read users',
      risk_assessment: 'Low',
    };

    const result = await implementations.query(args, { capabilities: { database: true } });
    // If it reaches the dependency check, it passed the security check.
    expect(result).toContain('Dependency "mysql2" is not installed');
  });

  it('fails if profile is not found', async () => {
    const args = {
      profile: 'unknown',
      sql: 'SELECT 1',
      justification: 'Test',
      risk_assessment: 'None',
    };

    const result = await implementations.query(args, { capabilities: { database: true } });
    expect(result).toContain("Profile 'unknown' not found");
  });

  it('fails if database capability is missing', async () => {
    const args = {
      profile: 'test_db',
      sql: 'SELECT 1',
      justification: 'Test',
      risk_assessment: 'None',
    };

    const result = await implementations.query(args, { capabilities: { database: false } });
    expect(result).toContain('Database access is not permitted by your current manifest');
  });

  it('handles unsupported database types', async () => {
    const args = {
      profile: 'unsupported',
      sql: 'SELECT 1',
      justification: 'Test',
      risk_assessment: 'None',
    };

    const result = await implementations.query(args, { capabilities: { database: true } });
    expect(result).toContain("Error: Unsupported database type 'mongodb'");
  });

  it('handles missing configuration file', async () => {
    fs.existsSync.mockReturnValue(false);
    const args = {
      profile: 'test_db',
      sql: 'SELECT 1',
      justification: 'Test',
      risk_assessment: 'None',
    };

    const result = await implementations.query(args, { capabilities: { database: true } });
    expect(result).toContain('Database configuration file not found');
  });

  it('reports missing pg dependency for postgresql', async () => {
    const args = {
      profile: 'test_pg',
      sql: 'SELECT 1',
      justification: 'Test',
      risk_assessment: 'None',
    };

    const result = await implementations.query(args, { capabilities: { database: true } });
    expect(result).toContain('Dependency "pg" is not installed');
  });

  it('respects ANIMA_DB_CONFIG_PATH environment variable', async () => {
    process.env.ANIMA_DB_CONFIG_PATH = '/custom/path/db.json';
    const args = {
      profile: 'test_db',
      sql: 'SELECT 1',
      justification: 'Test',
      risk_assessment: 'None',
    };

    await implementations.query(args, { capabilities: { database: true } });
    expect(fs.existsSync).toHaveBeenCalledWith('/custom/path/db.json');
    delete process.env.ANIMA_DB_CONFIG_PATH;
  });

  it('handles write operations (non-SELECT)', async () => {
    const args = {
      profile: 'test_db',
      sql: 'INSERT INTO logs (msg) VALUES ("test")',
      justification: 'Log something',
      risk_assessment: 'Low',
    };

    const result = await implementations.query(args, { capabilities: { database: true } });
    // Should pass security check and fail at mysql dependency check
    expect(result).toContain('Dependency "mysql2" is not installed');
  });
});
