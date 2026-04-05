/**
 * Integration tests for the Anima CLI.
 *
 * Tests spawn a real `node cli.js` process using the Stub LLM provider so no
 * API keys or network access are required.
 *
 * Fast tests (no LLM call) complete in a few seconds.
 * Slow tests involve an LLM call + ESLint analysis on turn 1 (~15-25 s total).
 */

const { describe, it, expect, beforeAll } = require('@jest/globals');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { runCli } = require('./helpers');

jest.setTimeout(120000);

// ---------------------------------------------------------------------------
// Stub provider contract — verifies the provider works before testing the CLI.
// ---------------------------------------------------------------------------
describe('Stub provider contract', () => {
  it('returns a valid OpenAI-format completion', async () => {
    const runnerPath = path.join(__dirname, '..', '..', 'app', 'ProviderRunner.js');
    const stubPath = path.join(__dirname, '..', '..', 'Plugins', 'Stub.js');

    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [runnerPath, stubPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(`Runner exited ${code}`));
        resolve(JSON.parse(out));
      });
      child.stdin.write(
        JSON.stringify({ messages: [{ role: 'user', content: 'hello' }], tools: [] }),
      );
      child.stdin.end();
    });

    expect(result).toHaveProperty('choices');
    expect(result.choices[0].message.role).toBe('assistant');
    expect(result.choices[0].message.content).toContain('STUB_RESPONSE');
  });
});

// ---------------------------------------------------------------------------
// Fast tests — no LLM call, no ESLint pass.
// ---------------------------------------------------------------------------
describe('CLI fast path (no LLM)', () => {
  it('--help prints usage and exits 0', async () => {
    const result = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [path.join(__dirname, '..', '..', 'cli.js'), '--help'],
        {
          env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('close', (code) => resolve({ out, code }));
    });

    expect(result.code).toBe(0);
    expect(result.out).toContain('Usage');
    expect(result.out).toContain('--model');
    expect(result.out).toContain('--safe');
  });

  it('startup loads personality files and shows the prompt', async () => {
    // No inputs — just check what appears at startup before we kill
    const { stdout } = await runCli([], { responseTimeout: 3000 });
    expect(stdout).toContain('Loaded personality from');
    expect(stdout).toContain('You:');
  });

  it('/new resets the session without calling the LLM', async () => {
    const { stdout } = await runCli(['/new'], { responseTimeout: 3000 });
    expect(stdout).toContain('Session reset.');
  });

  it('empty lines are ignored and re-prompt without LLM call', async () => {
    const { stdout } = await runCli(['', '/new'], { responseTimeout: 3000 });
    expect(stdout).toContain('Session reset.');
  });
});

// ---------------------------------------------------------------------------
// Slow tests — involve a real LLM call through the Stub provider.
// ESLint analysis fires on turn 1, adding several seconds.
// ---------------------------------------------------------------------------
describe('CLI LLM integration (Stub provider)', () => {
  // Pre-warm: one throwaway call to let the OS cache the JS files.
  beforeAll(async () => {
    await runCli(['warmup'], { responseTimeout: 45000 });
  });

  it('responds to a basic message and echoes it via the Stub provider', async () => {
    const { stdout } = await runCli(['hello world'], { responseTimeout: 45000 });
    expect(stdout).toContain('STUB_RESPONSE');
    expect(stdout).toContain('hello world');
  });

  it('response contains the exact message text', async () => {
    const { stdout } = await runCli(['what is 2 plus 2'], { responseTimeout: 45000 });
    expect(stdout).toContain('STUB_RESPONSE');
    expect(stdout).toContain('what is 2 plus 2');
  });

  it('/new between messages resets context without error', async () => {
    const { stdout } = await runCli(['first message', '/new', 'second message'], {
      responseTimeout: 45000,
    });
    expect(stdout).toContain('Session reset.');
    expect(stdout).toContain('STUB_RESPONSE');
  });
});
