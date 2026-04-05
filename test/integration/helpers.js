const { spawn } = require('node:child_process');
const path = require('node:path');

const CLI_PATH = path.join(__dirname, '..', '..', 'cli.js');
const TEST_CONFIG_PATH = path.join(__dirname, 'fixtures', 'Anima.test.config');

// The CLI prints "You: " every time it is ready for the next line of input.
const PROMPT = 'You: ';

// Strip ANSI escape codes so assertions work on plain text.
// eslint-disable-next-line no-control-regex
const stripAnsi = (str) => str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

const promptRegex = new RegExp(PROMPT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

/**
 * Spawns the Anima CLI and feeds `inputs` one at a time, synchronised to the
 * "You: " prompt so that readline always has its interface set up before data
 * arrives.
 *
 * After the last input is fed the harness waits `responseTimeout` ms for the
 * final response, then kills the process with SIGTERM. A hard SIGKILL fires at
 * `killTimeout` ms regardless.
 *
 * @param {string[]} inputs          Lines to feed to the CLI in order.
 * @param {object}   [options]
 * @param {number}   [options.responseTimeout=15000]  ms to wait for final response after last input.
 * @param {number}   [options.killTimeout=90000]      Hard ceiling ms before SIGKILL.
 * @returns {Promise<{stdout: string, stderr: string, code: number|null, signal: string|null}>}
 */
const runCli = (inputs = [], options = {}) => {
  const responseTimeout = options.responseTimeout ?? 15000;
  const killTimeout = options.killTimeout ?? 90000;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH], {
      env: {
        ...process.env,
        ANIMA_CONFIG_PATH: TEST_CONFIG_PATH,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let rawStdout = '';
    let rawStderr = '';
    let settled = false;
    let promptsSeen = 0;
    const inputQueue = [...inputs];
    let responseTimer = null;

    const settle = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardKillTimer);
      clearTimeout(responseTimer);
      resolve({
        stdout: stripAnsi(rawStdout),
        stderr: stripAnsi(rawStderr),
        code,
        signal,
      });
    };

    const startResponseTimer = () => {
      clearTimeout(responseTimer);
      responseTimer = setTimeout(() => {
        if (!settled) child.kill('SIGTERM');
      }, responseTimeout);
    };

    child.stdout.on('data', (chunk) => {
      rawStdout += chunk.toString();

      // Count new "You: " prompts that have appeared since last check
      const totalPrompts = (rawStdout.match(promptRegex) || []).length;
      while (promptsSeen < totalPrompts) {
        promptsSeen++;
        if (inputQueue.length > 0) {
          const line = inputQueue.shift();
          child.stdin.write(line + '\n');
        }
        if (inputQueue.length === 0) {
          // All inputs sent — start countdown for final response
          startResponseTimer();
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      rawStderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code, signal) => settle(code, signal));

    // Hard ceiling to prevent a hung test from blocking the suite
    const hardKillTimer = setTimeout(() => {
      if (!settled) child.kill('SIGKILL');
    }, killTimeout);
  });
};

module.exports = { runCli, stripAnsi };
