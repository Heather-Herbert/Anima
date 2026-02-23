const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');

const config = require('./Config');

const isPathAllowed = (filePath, mode = 'read', permissions = null) => {
  try {
    const root = path.resolve(config.workspaceDir);
    const absolutePath = path.resolve(root, filePath);

    // Prevent path traversal outside of workspace root
    if (!absolutePath.startsWith(root)) {
      return false;
    }

    const relativePath = path.relative(root, absolutePath);
    const relativePathLower = relativePath.toLowerCase();
    const restrictedPrefixes = [
      'app',
      'settings',
      'node_modules',
      '.git',
      '.github',
      'cli.js',
      'package.json',
      'package-lock.json',
      'anima.config.js',
      'anima.config.json',
    ];

    // Core protected directories (for writes)
    const protectedPrefixes = ['plugins', 'memory', 'personality'];

    // 1. Check Restricted Prefixes (Deny all access)
    if (
      restrictedPrefixes.some(
        (prefix) => relativePathLower === prefix || relativePathLower.startsWith(prefix + path.sep),
      )
    ) {
      return false;
    }

    // 2. Check Protected Prefixes (Read-only by default unless explicitly allowed by manifest)
    // If mode is 'write', we still return false here to force the tool to check manifest or fail.
    // However, ConversationService handles the user-confirmation for writes to these.
    // To be safe, we deny writes to these in isPathAllowed unless we are in 'read' mode.
    if (
      protectedPrefixes.some(
        (prefix) => relativePathLower === prefix || relativePathLower.startsWith(prefix + path.sep),
      )
    ) {
      if (mode !== 'read') return false;
    }

    // Check Manifest Permissions
    if (permissions && permissions.filesystem) {
      const allowedPaths = permissions.filesystem[mode];
      if (!allowedPaths) return false; // If mode is restricted but not defined, deny
      if (allowedPaths.includes('*')) return true;

      return allowedPaths.some((allowed) => {
        const allowedAbs = path.resolve(root, allowed);

        // Check if explicitly allowed as directory or file
        if (absolutePath === allowedAbs) return true;

        // If not exact match, check if absolutePath is inside allowedAbs
        // We consider allowedAbs a directory if it ends with a slash OR has no extension OR exists as a directory
        const isDirectory =
          allowed.endsWith(path.sep) ||
          !path.extname(allowed) ||
          (fs.existsSync(allowedAbs) && fs.statSync(allowedAbs).isDirectory());

        if (isDirectory) {
          return absolutePath.startsWith(allowedAbs + path.sep);
        }
        return false;
      });
    }

    // Default policy if no manifest filesystem restrictions: Deny access.
    return false;
  } catch (e) {
    return false;
  }
};
const tools = [
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file with content',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file' },
          content: { type: 'string', description: 'Content to write' },
          justification: {
            type: 'string',
            description: 'A short explanation of why this file needs to be written.',
          },
        },
        required: ['path', 'content', 'justification'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a system command without a shell (safer)',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'The executable file to run (e.g., "git", "ls")' },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Arguments to pass to the executable',
          },
          justification: {
            type: 'string',
            description: 'A short explanation of why this command needs to be executed.',
          },
        },
        required: ['file', 'justification'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories in a specific path',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to list (default: .)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for a text pattern in files within a directory (ReDoS protected)',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to search in (default: .)' },
          term: { type: 'string', description: 'The text or regex pattern to search for' },
          max_depth: {
            type: 'integer',
            description: 'Maximum directory depth to search (default: 3)',
          },
        },
        required: ['term'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'execute_code',
      description: 'Execute code in a specific language (creates a temp file and runs it)',
      parameters: {
        type: 'object',
        properties: {
          language: { type: 'string', description: 'Language to use (javascript, python, bash)' },
          code: { type: 'string', description: 'The code to execute' },
          justification: {
            type: 'string',
            description: 'A short explanation of why this code needs to be executed.',
          },
        },
        required: ['language', 'code', 'justification'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_info',
      description: 'Get metadata about a file (size, creation time, etc.)',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file' },
          justification: {
            type: 'string',
            description: 'A short explanation of why this file needs to be deleted.',
          },
        },
        required: ['path', 'justification'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_in_file',
      description: 'Replace text in a file using a regex pattern',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file' },
          search: { type: 'string', description: 'Regex pattern to search for' },
          replace: { type: 'string', description: 'Replacement text' },
          justification: {
            type: 'string',
            description: 'A short explanation of why this replacement is necessary.',
          },
        },
        required: ['path', 'search', 'replace', 'justification'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_plugin',
      description: 'Add a new LLM provider plugin to the system. Requires code and manifest.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: "Name of the plugin (e.g., 'anthropic')" },
          code: { type: 'string', description: 'JavaScript code for the plugin' },
          manifest: { type: 'string', description: 'JSON manifest string' },
          provenance: { type: 'object', description: 'Provenance information' },
          isOverwrite: { type: 'boolean', description: 'Allow overwriting an existing plugin' },
          justification: {
            type: 'string',
            description: 'An explanation of why this plugin needs to be installed.',
          },
        },
        required: ['name', 'code', 'manifest', 'justification'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'new_session',
      description:
        'Request to start a new session. Use this when the current task is complete or the topic changes significantly.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Why a new session is being started.' },
          carry_over: {
            type: 'string',
            description: 'Important context or facts to preserve in the new session.',
          },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'advisory_council',
      description:
        'Request structured feedback from the advisory council on a specific question or plan.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The specific question for the council.' },
          draftPlan: { type: 'string', description: 'Optional draft plan or response to review.' },
          riskHints: {
            type: 'string',
            description: 'Optional hints about specific risks to check.',
          },
          focus: {
            type: 'array',
            items: { type: 'string', enum: ['security', 'planning', 'quality'] },
            description: 'Optional focus areas.',
          },
          maxAdvisers: { type: 'integer', description: 'Optional limit on number of advisers.' },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
        },
        required: ['query'],
      },
    },
  },
];

const availableTools = {
  write_file: async ({ path: filePath, content, justification: _justification }, permissions) => {
    try {
      if (!permissions?._overrideProtected && !isPathAllowed(filePath, 'write', permissions))
        return `Error: Access to ${filePath} is restricted by system policy or manifest.`;
      const root = path.resolve(config.workspaceDir);
      const fullPath = path.resolve(root, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
      return `File ${filePath} written successfully.`;
    } catch (e) {
      return `Error writing file: ${e.message}`;
    }
  },
  read_file: async ({ path: filePath }, permissions) => {
    try {
      if (!isPathAllowed(filePath, 'read', permissions))
        return `Error: Access to ${filePath} is restricted by system policy or manifest.`;
      const root = path.resolve(config.workspaceDir);
      const fullPath = path.resolve(root, filePath);
      if (!fs.existsSync(fullPath)) return `File not found: ${filePath}`;
      return fs.readFileSync(fullPath, 'utf8');
    } catch (e) {
      return `Error reading file: ${e.message}`;
    }
  },
  run_command: async ({ file, args = [], justification: _justification }, permissions) => {
    const denylist = [
      'rm',
      'curl',
      'wget',
      'sudo',
      'su',
      'mv',
      'chmod',
      'chown',
      'apt',
      'npm',
      'yarn',
      'docker',
    ];

    // 1. Policy: Denylist
    if (denylist.includes(file.toLowerCase())) {
      return `Error: Command '${file}' is blocked by system security policy.`;
    }

    // 2. Policy: Manifest Allowlist
    if (permissions?.commands?.allow) {
      if (!permissions.commands.allow.includes(file) && !permissions.commands.allow.includes('*')) {
        return `Error: Command '${file}' is not permitted by the active manifest.`;
      }
    }

    // 3. Policy: Taint Mode
    if (permissions?._isTainted) {
      const allowedInTaint = permissions?.commands?.allow || [];
      if (!allowedInTaint.includes(file)) {
        return `Error: Command '${file}' is blocked because the session is 'tainted' by a web search. Only explicitly allowed manifest commands can run in this state.`;
      }
    }

    return new Promise((resolve) => {
      const { spawn } = require('node:child_process');
      const root = path.resolve(config.workspaceDir);
      const child = spawn(file, args, {
        shell: false,
        cwd: root,
        env: { PATH: process.env.PATH }, // Minimal env
        timeout: 30000, // 30 second timeout
      });

      let stdout = '';
      let stderr = '';
      const maxOutput = 1024 * 100; // 100KB limit

      child.stdout.on('data', (data) => {
        if (stdout.length < maxOutput) stdout += data;
      });

      child.stderr.on('data', (data) => {
        if (stderr.length < maxOutput) stderr += data;
      });

      child.on('error', (err) => {
        resolve(`Error spawning command: ${err.message}`);
      });

      child.on('close', (code) => {
        let result = stdout || stderr;
        if (stdout.length >= maxOutput || stderr.length >= maxOutput) {
          result += '\n... [Output truncated due to size limit]';
        }
        if (code !== 0) {
          resolve(`Command exited with code ${code}.\nOutput: ${result}`);
        } else {
          resolve(result || 'Command executed successfully (no output).');
        }
      });
    });
  },
  list_files: async ({ path: dirPath = '.' }, permissions) => {
    try {
      if (!isPathAllowed(dirPath, 'read', permissions))
        return `Error: Access to ${dirPath} is restricted by system policy or manifest.`;
      const root = path.resolve(config.workspaceDir);
      const fullPath = path.resolve(root, dirPath);
      if (!fs.existsSync(fullPath)) return `Path not found: ${dirPath}`;

      const items = fs.readdirSync(fullPath, { withFileTypes: true });
      const formatted = items
        .filter((item) => isPathAllowed(path.join(dirPath, item.name), 'read', permissions))
        .map((item) => (item.isDirectory() ? `${item.name}/` : item.name))
        .join('\n');
      return formatted || '(empty directory)';
    } catch (e) {
      return `Error listing files: ${e.message}`;
    }
  },
  search_files: async ({ path: dirPath = '.', term, max_depth = 3 }, permissions) => {
    try {
      if (!isPathAllowed(dirPath, 'read', permissions))
        return `Error: Access to ${dirPath} is restricted by system policy or manifest.`;
      const root = path.resolve(config.workspaceDir);
      const rootPath = path.resolve(root, dirPath);
      if (!fs.existsSync(rootPath)) return `Path not found: ${dirPath}`;

      const results = [];
      const MAX_MATCHES = 100;
      const startTime = Date.now();
      const TIMEOUT_MS = 10000; // 10s timeout

      let regex;
      try {
        regex = new RegExp(term);
      } catch (e) {
        return `Invalid regex pattern: ${e.message}`;
      }

      const searchFile = (filePath) => {
        if (!isPathAllowed(filePath, 'read', permissions)) return;
        if (results.length >= MAX_MATCHES) return;
        if (Date.now() - startTime > TIMEOUT_MS) return;

        try {
          const content = fs.readFileSync(filePath, 'utf8');
          if (content.includes('\0')) return; // Skip binary files

          const lines = content.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (Date.now() - startTime > TIMEOUT_MS) break;
            if (regex.test(lines[i])) {
              const relativePath = path.relative(root, filePath);
              results.push(`${relativePath}:${i + 1}:${lines[i]}`);
              if (results.length >= MAX_MATCHES) break;
            }
          }
        } catch (err) {
          // Ignore read errors
        }
      };

      const walkDir = (currentPath, depth) => {
        if (depth > max_depth) return;
        if (results.length >= MAX_MATCHES) return;
        if (Date.now() - startTime > TIMEOUT_MS) return;

        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = path.join(currentPath, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue;
            walkDir(entryPath, depth + 1);
          } else if (entry.isFile()) {
            searchFile(entryPath);
          }
        }
      };

      const stats = fs.statSync(rootPath);
      if (stats.isFile()) {
        searchFile(rootPath);
      } else if (stats.isDirectory()) {
        walkDir(rootPath, 0);
      }

      let output = results.join('\n');
      if (results.length >= MAX_MATCHES) output += '\n... [Maximum match limit reached]';
      if (Date.now() - startTime > TIMEOUT_MS) output += '\n... [Search timed out]';

      return output || 'No matches found.';
    } catch (e) {
      return `Error searching files: ${e.message}`;
    }
  },
  execute_code: async ({ language, code, justification: _justification }, permissions) => {
    try {
      const timestamp = Date.now();
      const isWindows = process.platform === 'win32';
      let filename, command;

      // 1. Taint Mode check
      if (permissions?._isTainted && !permissions?.capabilities?.allow_code_in_taint) {
        return 'Error: Code execution is disabled because the session is tainted by a web search. This is a security measure to prevent prompt injection execution.';
      }

      switch (language.toLowerCase()) {
        case 'javascript':
        case 'js':
        case 'node':
          filename = `temp_${timestamp}.js`;
          command = `node ${filename}`;
          break;
        case 'python':
        case 'py':
          filename = `temp_${timestamp}.py`;
          // On Windows, 'python' is more common than 'python3'
          command = isWindows ? `python ${filename}` : `python3 ${filename}`;
          break;
        case 'bash':
        case 'sh':
          filename = `temp_${timestamp}.sh`;
          command = `bash ${filename}`;
          if (isWindows) {
            return 'Error: Bash is not natively supported on Windows. Please use javascript or python.';
          }
          break;
        default:
          return 'Unsupported language. Supported: javascript, python, bash.';
      }

      const root = path.resolve(config.workspaceDir);
      const tempDir = path.join(root, '.temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const fullPath = path.join(tempDir, filename);

      // Check if writing to .temp is allowed (it should be since it's in workspace)
      if (!isPathAllowed(path.join('.temp', filename), 'write', permissions))
        return `Error: Permission denied to write temporary execution file to .temp/`;

      fs.writeFileSync(fullPath, code);

      const isUnix = process.platform !== 'win32';
      // Basic resource limiting for Unix-like systems
      // 512MB virtual memory limit
      const quotaPrefix = isUnix ? 'ulimit -v 524288 && ' : '';
      const finalCommand = (language.toLowerCase() === 'bash' || language.toLowerCase() === 'python' || language.toLowerCase() === 'py') 
        ? `${quotaPrefix}${command}` 
        : command;

      return new Promise((resolve) => {
        exec(
          finalCommand,
          { 
            timeout: 10000, 
            cwd: tempDir,
            maxBuffer: 1024 * 1024 // 1MB output limit
          },
          (error, stdout, stderr) => {
            try {
              fs.unlinkSync(fullPath);
            } catch (e) {
              /* Ignore unlink error */
            }
            if (error) {
              if (error.killed) {
                resolve(`Error: Execution timed out or resource limit exceeded.`);
              } else {
                resolve(`Error: ${error.message}\nStderr: ${stderr}`);
              }
            } else {
              resolve(stdout || stderr || 'Code executed successfully.');
            }
          },
        );
      });
    } catch (e) {
      return `Error executing code: ${e.message}`;
    }
  },
  file_info: async ({ path: filePath }, permissions) => {
    try {
      if (!isPathAllowed(filePath, 'read', permissions))
        return `Error: Access to ${filePath} is restricted by system policy or manifest.`;
      const root = path.resolve(config.workspaceDir);
      const fullPath = path.resolve(root, filePath);
      if (!fs.existsSync(fullPath)) return `File not found: ${filePath}`;
      const stats = fs.statSync(fullPath);
      return JSON.stringify(
        {
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          isDirectory: stats.isDirectory(),
        },
        null,
        2,
      );
    } catch (e) {
      return `Error getting file info: ${e.message}`;
    }
  },
  delete_file: async ({ path: filePath, justification: _justification }, permissions) => {
    try {
      if (!permissions?._overrideProtected && !isPathAllowed(filePath, 'write', permissions))
        return `Error: Access to ${filePath} is restricted by system policy or manifest.`;
      const root = path.resolve(config.workspaceDir);
      const fullPath = path.resolve(root, filePath);
      if (!fs.existsSync(fullPath)) return `File not found: ${filePath}`;
      fs.unlinkSync(fullPath);
      return `File ${filePath} deleted successfully.`;
    } catch (e) {
      return `Error deleting file: ${e.message}`;
    }
  },
  replace_in_file: async (
    { path: filePath, search, replace, justification: _justification },
    permissions,
  ) => {
    try {
      if (!permissions?._overrideProtected && !isPathAllowed(filePath, 'write', permissions))
        return `Error: Access to ${filePath} is restricted by system policy or manifest.`;
      const root = path.resolve(config.workspaceDir);
      const fullPath = path.resolve(root, filePath);
      if (!fs.existsSync(fullPath)) return `File not found: ${filePath}`;

      const content = fs.readFileSync(fullPath, 'utf8');
      const regex = new RegExp(search, 'g');
      const newContent = content.replace(regex, replace);

      if (content === newContent) return 'No matches found.';

      fs.writeFileSync(fullPath, newContent);
      return `Successfully replaced content in ${filePath}.`;
    } catch (e) {
      return `Error replacing in file: ${e.message}`;
    }
  },
  add_plugin: async ({ name, code, manifest, provenance, isOverwrite }, _permissions) => {
    try {
      // Note: This tool bypasses isPathAllowed because it specifically writes to the Plugins directory.
      // Security is handled by the CLI confirmation step which shows the manifest.

      const pluginDir = path.join(__dirname, '..', 'Plugins');
      if (!fs.existsSync(pluginDir)) {
        fs.mkdirSync(pluginDir, { recursive: true });
      }

      const safeName = path.basename(name).replace(/[^a-zA-Z0-9_-]/g, '');
      if (!safeName) return 'Error: Invalid plugin name.';

      const jsPath = path.join(pluginDir, `${safeName}.js`);
      const manifestPath = path.join(pluginDir, `${safeName}.manifest.json`);
      const provenancePath = path.join(pluginDir, `${safeName}.provenance.json`);

      // Overwrite protection
      if (fs.existsSync(jsPath) && !isOverwrite) {
        return `Error: Plugin '${safeName}' is already installed. Use an explicit overwrite command or remove it first.`;
      }

      // Validate manifest JSON
      let parsedManifest;
      try {
        parsedManifest = typeof manifest === 'string' ? JSON.parse(manifest) : manifest;
      } catch (e) {
        return 'Error: Manifest is not valid JSON.';
      }

      fs.writeFileSync(jsPath, code);
      fs.writeFileSync(manifestPath, JSON.stringify(parsedManifest, null, 2));

      if (provenance) {
        fs.writeFileSync(provenancePath, JSON.stringify(provenance, null, 2));
      }

      return `Plugin '${safeName}' installed successfully.`;
    } catch (e) {
      return `Error installing plugin: ${e.message}`;
    }
  },
  new_session: async ({ reason, carry_over }, _permissions) => {
    return `New session requested. Reason: ${reason}${carry_over ? '\nCarry over: ' + carry_over : ''}`;
  },
  advisory_council: async (
    { question, draftPlan, riskHints, focus, maxAdvisers: _maxAdvisers },
    permissions,
  ) => {
    try {
      const AdvisoryService = require('./AdvisoryService');
      // Note: We don't have access to the main auditService here easily without refactor
      // But we can create a transient service for the tool call
      const service = new AdvisoryService();
      const advice = await service.getAdvice({
        userMessage: question,
        mainDraft: draftPlan || 'No draft provided.',
        managedHistorySummary: `On-demand council call. Focus: ${focus?.join(', ') || 'general'}. Risk Hints: ${riskHints || 'none'}`,
        taintStatus: permissions?._isTainted,
        availableToolsSummary: 'Internal tool call',
      });

      return JSON.stringify(advice, null, 2);
    } catch (e) {
      return `Error calling advisory council: ${e.message}`;
    }
  },
  web_search: async ({ query }, _permissions) => {
    try {
      if (typeof fetch === 'undefined') return 'Error: fetch is not defined. Node.js 18+ required.';
      const response = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`,
      );
      if (!response.ok) return `Error: HTTP ${response.status}`;
      const data = await response.json();

      if (!data.AbstractText && (!data.RelatedTopics || data.RelatedTopics.length === 0))
        return 'No direct answer found.';

      let output = '';
      if (data.AbstractText)
        output += `Summary: ${data.AbstractText}\nSource: ${data.AbstractURL}\n`;
      if (data.RelatedTopics) {
        output +=
          `\nRelated:\n` +
          data.RelatedTopics.filter((t) => t.Text && t.FirstURL)
            .slice(0, 5)
            .map((t) => `- ${t.Text}`)
            .join('\n');
      }
      return output;
    } catch (e) {
      return `Error searching web: ${e.message}`;
    }
  },
};

module.exports = { tools, availableTools, isPathAllowed };
