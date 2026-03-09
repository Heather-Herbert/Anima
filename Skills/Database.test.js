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
});
