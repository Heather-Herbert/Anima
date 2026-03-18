const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

class AnalysisService {
  constructor(baseDir) {
    this.baseDir = baseDir;
  }

  /**
   * Runs ESLint and returns a structured health report.
   */
  async runLintAnalysis() {
    return new Promise((resolve) => {
      // Run eslint with JSON formatter to get structured data
      const child = spawn('npx', ['eslint', '.', '--format', 'json'], {
        cwd: this.baseDir,
        shell: true,
      });

      let output = '';
      child.stdout.on('data', (data) => (output += data));
      child.stderr.on('data', (data) => (output += data));

      child.on('close', (code) => {
        try {
          // ESLint returns non-zero code if it finds any errors/warnings, 
          // so we parse the output regardless of the exit code as long as it's valid JSON.
          const results = JSON.parse(output);
          const report = this.generateHealthReport(results);
          resolve(report);
        } catch (e) {
          // If JSON parsing fails, ESLint likely failed to run or there's a serious error
          resolve({
            summary: 'Failed to run lint analysis.',
            error: e.message,
            rawOutput: output.slice(0, 500)
          });
        }
      });
    });
  }

  /**
   * Generates a summary health report from ESLint JSON results.
   */
  generateHealthReport(results) {
    let totalErrors = 0;
    let totalWarnings = 0;
    const debtItems = [];
    const complexityIssues = [];

    for (const file of results) {
      totalErrors += file.errorCount;
      totalWarnings += file.warningCount;

      const relativePath = path.relative(this.baseDir, file.filePath);

      for (const msg of file.messages) {
        const item = {
          file: relativePath,
          line: msg.line,
          rule: msg.ruleId,
          severity: msg.severity === 2 ? 'Error' : 'Warning',
          message: msg.message
        };

        if (msg.ruleId === 'complexity' || msg.ruleId === 'max-statements') {
          complexityIssues.push(item);
        } else {
          debtItems.push(item);
        }
      }
    }

    return {
      status: totalErrors > 0 ? 'CRITICAL' : (totalWarnings > 0 ? 'WARNING' : 'HEALTHY'),
      summary: `Found ${totalErrors} errors and ${totalWarnings} warnings across ${results.length} files.`,
      complexityIssues: complexityIssues.slice(0, 10), // Limit to top 10 for context efficiency
      debtItems: debtItems.slice(0, 10), // Limit to top 10 for context efficiency
      totalIssues: totalErrors + totalWarnings,
      analyzedFiles: results.length
    };
  }
}

module.exports = AnalysisService;
