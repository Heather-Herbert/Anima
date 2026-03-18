const { describe, it, expect, beforeEach } = require('@jest/globals');
const AnalysisService = require('./AnalysisService');
const { spawn } = require('node:child_process');
const EventEmitter = require('node:events');

jest.mock('node:child_process');

describe('AnalysisService', () => {
  let service;
  const baseDir = '/mock/dir';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AnalysisService(baseDir);
  });

  it('runs lint analysis and returns a health report', async () => {
    const mockChild = new EventEmitter();
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    spawn.mockReturnValue(mockChild);

    const mockResults = [
      {
        filePath: '/mock/dir/app/ConversationService.js',
        messages: [
          { ruleId: 'complexity', message: 'Complexity is too high', line: 10, severity: 1 },
          { ruleId: 'no-unused-vars', message: 'Unused variable', line: 5, severity: 2 },
        ],
        errorCount: 1,
        warningCount: 1,
      },
    ];

    const promise = service.runLintAnalysis();

    // Simulate stdout and close
    process.nextTick(() => {
      mockChild.stdout.emit('data', JSON.stringify(mockResults));
      mockChild.emit('close', 1);
    });

    const report = await promise;

    expect(report.status).toBe('CRITICAL');
    expect(report.totalIssues).toBe(2);
    expect(report.complexityIssues.length).toBe(1);
    expect(report.debtItems.length).toBe(1);
    expect(report.complexityIssues[0].rule).toBe('complexity');
    expect(report.debtItems[0].rule).toBe('no-unused-vars');
  });

  it('handles empty results as healthy', async () => {
    const mockChild = new EventEmitter();
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    spawn.mockReturnValue(mockChild);

    const mockResults = [
      {
        filePath: '/mock/dir/clean.js',
        messages: [],
        errorCount: 0,
        warningCount: 0,
      },
    ];

    const promise = service.runLintAnalysis();

    process.nextTick(() => {
      mockChild.stdout.emit('data', JSON.stringify(mockResults));
      mockChild.emit('close', 0);
    });

    const report = await promise;

    expect(report.status).toBe('HEALTHY');
    expect(report.totalIssues).toBe(0);
  });

  it('handles errors gracefully', async () => {
    const mockChild = new EventEmitter();
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    spawn.mockReturnValue(mockChild);

    const promise = service.runLintAnalysis();

    process.nextTick(() => {
      mockChild.stdout.emit('data', 'not json');
      mockChild.emit('close', 1);
    });

    const report = await promise;
    expect(report.summary).toContain('Failed to run lint analysis');
    expect(report.error).toBeDefined();
  });
});
