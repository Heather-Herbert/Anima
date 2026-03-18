const fs = require('node:fs').promises;
const existsSync = require('node:fs').existsSync;
const path = require('node:path');
const { spawn } = require('node:child_process');

class PatchService {
  constructor(baseDir, auditService = null) {
    this.baseDir = baseDir;
    this.auditService = auditService;
    this.tempDir = path.join(baseDir, '.temp');
    this.memoryDir = path.join(baseDir, 'Memory');
    this.personalityDir = path.join(baseDir, 'Personality');
    this.failureLog = path.join(this.personalityDir, 'Memory', 'patch_failures.log');
  }

  /**
   * Step 1: Checkpoint. Create a hidden backup of the target file.
   */
  async createCheckpoint(filePath) {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(this.baseDir, filePath);
    const fileName = path.basename(absolutePath);
    const dirName = path.dirname(absolutePath);
    const backupPath = path.join(dirName, `.${fileName}.bak`);

    if (existsSync(absolutePath)) {
      const content = await fs.readFile(absolutePath, 'utf-8');
      await fs.writeFile(backupPath, content);
      return backupPath;
    }
    throw new Error(`File not found: ${filePath}`);
  }

  /**
   * Step 2: Dry-Run Rewrite. Propose change into .temp/.
   */
  async dryRunRewrite(filePath, newContent) {
    if (!existsSync(this.tempDir)) {
      await fs.mkdir(this.tempDir, { recursive: true });
    }

    const tempFilePath = path.join(this.tempDir, filePath);
    const tempFileDir = path.dirname(tempFilePath);

    if (!existsSync(tempFileDir)) {
      await fs.mkdir(tempFileDir, { recursive: true });
    }

    await fs.writeFile(tempFilePath, newContent);
    return tempFilePath;
  }

  /**
   * Step 3: Verification. Execute dedicated test script (npm test).
   * Runs regression suite against the modified file.
   * Note: In this system, we temporarily swap to run tests, then swap back or keep.
   */
  async verify(filePath, tempFilePath) {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(this.baseDir, filePath);
    const originalContent = await fs.readFile(absolutePath, 'utf-8');
    const patchedContent = await fs.readFile(tempFilePath, 'utf-8');

    try {
      // Temporarily apply patch to run tests in the real environment
      await fs.writeFile(absolutePath, patchedContent);

      return new Promise((resolve) => {
        const child = spawn('npm', ['test'], {
          cwd: this.baseDir,
          shell: true,
        });

        let output = '';
        child.stdout.on('data', (data) => (output += data));
        child.stderr.on('data', (data) => (output += data));

        child.on('close', async (code) => {
          // Restore original regardless of test result for now,
          // sync will do the final swap if successful.
          await fs.writeFile(absolutePath, originalContent);

          resolve({
            success: code === 0,
            output: output,
          });
        });
      });
    } catch (e) {
      await fs.writeFile(absolutePath, originalContent);
      throw e;
    }
  }

  /**
   * Step 4: Atomic Sync. Move .temp/ to original.
   */
  async atomicSync(filePath, tempFilePath) {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(this.baseDir, filePath);
    const content = await fs.readFile(tempFilePath, 'utf-8');
    await fs.writeFile(absolutePath, content);
    // Cleanup temp
    try {
      await fs.unlink(tempFilePath);
    } catch (e) {
      /* ignore cleanup errors */
    }
  }

  /**
   * Step 5: Recovery. Log failure to patch_failures.log.
   */
  async recover(filePath, tempFilePath, errorOutput) {
    if (this.auditService) {
      this.auditService.logFailure('Patch Failure', `Failed to apply patch to ${filePath}`, {
        testOutput: errorOutput,
      });
    }

    const logEntry =
      `[${new Date().toISOString()}] PATCH FAILURE: ${filePath}\n` +
      `Error Output:\n${errorOutput}\n` +
      `------------------------------------------\n`;

    const dir = path.dirname(this.failureLog);
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }

    await fs.appendFile(this.failureLog, logEntry);

    // Cleanup temp
    if (existsSync(tempFilePath)) {
      try {
        await fs.unlink(tempFilePath);
      } catch (e) {
        /* ignore cleanup errors */
      }
    }

    // Backup cleanup is optional, but usually good to keep until user confirms.
    // However, the prompt implies "automated", so we might want to keep it or delete it.
    // We'll leave it as a hidden file for manual recovery if needed.
  }

  /**
   * Orchestrator for the automated loop.
   */
  async applyAutomatedPatch(filePath, newContent) {
    let backupPath = null;
    let tempFilePath = null;

    try {
      // 1. Checkpoint
      backupPath = await this.createCheckpoint(filePath);

      // 2. Dry-Run
      tempFilePath = await this.dryRunRewrite(filePath, newContent);

      // 3. Verification
      const testResult = await this.verify(filePath, tempFilePath);

      if (testResult.success) {
        // 4. Atomic Sync
        await this.atomicSync(filePath, tempFilePath);

        // Cleanup hidden backup on success
        if (backupPath && existsSync(backupPath)) {
          await fs.unlink(backupPath);
        }

        return { success: true, message: 'Patch applied successfully.' };
      } else {
        // 5. Recovery
        await this.recover(filePath, tempFilePath, testResult.output);
        return {
          success: false,
          error: 'Tests failed. Patch rolled back.',
          details: testResult.output,
        };
      }
    } catch (e) {
      if (tempFilePath) {
        await this.recover(filePath, tempFilePath, e.message);
      }
      return { success: false, error: e.message };
    }
  }
}

module.exports = PatchService;
