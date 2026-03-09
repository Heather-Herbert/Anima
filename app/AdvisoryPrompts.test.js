const fs = require('node:fs');
const path = require('node:path');

describe('Advisory Council Prompts', () => {
  const advisersDir = path.resolve(__dirname, '../Personality/Advisers');

  const expectedPrompts = [
    'SecurityAuditor.md',
    'UXCritic.md',
    'CostOptimizer.md',
    'Architect.md',
    'DevOpsEngineer.md',
    'Ethicist.md',
    'LegalCounsel.md',
    'PrivacyExpert.md',
    'ProductManager.md',
    'SecurityOfficer.md',
    'TechnicalWriter.md',
    'UXDesigner.md',
  ];

  expectedPrompts.forEach((promptFile) => {
    it(`should have the ${promptFile} prompt file`, () => {
      const filePath = path.join(advisersDir, promptFile);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it(`${promptFile} should have content`, () => {
      const filePath = path.join(advisersDir, promptFile);
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content.length).toBeGreaterThan(0);
      expect(content).toContain('#'); // Should have at least one header
    });
  });
});
