const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');

const isPathAllowed = (filePath, mode = 'read', permissions = null) => {
  try {
    const cwd = process.cwd();
    const absolutePath = path.resolve(cwd, filePath);

    // Prevent path traversal outside of project root
    if (!absolutePath.startsWith(cwd)) {
      return false;
    }

    const relativePath = path.relative(cwd, absolutePath);
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

    // Check if path matches or is inside a restricted directory
    if (
      restrictedPrefixes.some(
        (prefix) => relativePathLower === prefix || relativePathLower.startsWith(prefix + path.sep),
      )
    ) {
      return false;
    }

    // Check Manifest Permissions
    if (permissions && permissions.filesystem) {
      const allowedPaths = permissions.filesystem[mode];
      if (!allowedPaths) return false; // If mode is restricted but not defined, deny
      if (allowedPaths.includes('*')) return true;

      return allowedPaths.some((allowed) => {
        const allowedAbs = path.resolve(cwd, allowed);

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

    // Default policy if no manifest filesystem restrictions
    return true;
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
        },
        required: ['path', 'content'],
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
      description: 'Execute a shell command',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to execute' },
        },
        required: ['command'],
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
      description: 'Search for a text pattern in files within a directory',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to search in (default: .)' },
          term: { type: 'string', description: 'The text or regex pattern to search for' },
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
        },
        required: ['language', 'code'],
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
        },
        required: ['path'],
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
        },
        required: ['path', 'search', 'replace'],
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
        },
        required: ['name', 'code', 'manifest'],
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
  write_file: async ({ path: filePath, content }, permissions) => {
    try {
      if (!isPathAllowed(filePath, 'write', permissions))
        return `Error: Access to ${filePath} is restricted by system policy or manifest.`;
      const fullPath = path.resolve(process.cwd(), filePath);
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
      const fullPath = path.resolve(process.cwd(), filePath);
      if (!fs.existsSync(fullPath)) return `File not found: ${filePath}`;
      return fs.readFileSync(fullPath, 'utf8');
    } catch (e) {
      return `Error reading file: ${e.message}`;
    }
  },
  run_command: async ({ command }) => {
    return new Promise((resolve) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          resolve(`Error: ${error.message}\nStderr: ${stderr}`);
        } else {
          resolve(stdout || stderr || 'Command executed successfully.');
        }
      });
    });
  },
  list_files: async ({ path: dirPath = '.' }, permissions) => {
    try {
      if (!isPathAllowed(dirPath, 'read', permissions))
        return `Error: Access to ${dirPath} is restricted by system policy or manifest.`;
      const fullPath = path.resolve(process.cwd(), dirPath);
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
  search_files: async ({ path: dirPath = '.', term }, permissions) => {
    try {
      if (!isPathAllowed(dirPath, 'read', permissions))
        return `Error: Access to ${dirPath} is restricted by system policy or manifest.`;
      const rootPath = path.resolve(process.cwd(), dirPath);
      if (!fs.existsSync(rootPath)) return `Path not found: ${dirPath}`;

      const results = [];
      let regex;
      try {
        regex = new RegExp(term);
      } catch (e) {
        return `Invalid regex pattern: ${e.message}`;
      }

      const searchFile = (filePath) => {
        if (!isPathAllowed(filePath, 'read', permissions)) return;
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          if (content.includes('\0')) return; // Skip binary files

          const lines = content.split(/\r?\n/);
          lines.forEach((line, index) => {
            if (regex.test(line)) {
              const relativePath = path.relative(process.cwd(), filePath);
              results.push(`${relativePath}:${index + 1}:${line}`);
            }
          });
        } catch (err) {
          // Ignore read errors
        }
      };

      const walkDir = (currentPath) => {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = path.join(currentPath, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue;
            walkDir(entryPath);
          } else if (entry.isFile()) {
            searchFile(entryPath);
          }
        }
      };

      const stats = fs.statSync(rootPath);
      if (stats.isFile()) {
        searchFile(rootPath);
      } else if (stats.isDirectory()) {
        walkDir(rootPath);
      }

      return results.length > 0 ? results.join('\n') : 'No matches found.';
    } catch (e) {
      return `Error searching files: ${e.message}`;
    }
  },
  execute_code: async ({ language, code }, permissions) => {
    try {
      const timestamp = Date.now();
      const isWindows = process.platform === 'win32';
      let filename, command;

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

      if (!isPathAllowed(filename, 'write', permissions))
        return `Error: Permission denied to write temporary execution file.`;
      const fullPath = path.resolve(process.cwd(), filename);
      fs.writeFileSync(fullPath, code);

      return new Promise((resolve) => {
        exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
          try {
            fs.unlinkSync(fullPath);
          } catch (e) {
            /* Ignore unlink error */
          }
          if (error) {
            if (error.killed) {
              resolve(`Error: Execution timed out after 10 seconds.`);
            } else {
              resolve(`Error: ${error.message}\nStderr: ${stderr}`);
            }
          } else {
            resolve(stdout || stderr || 'Code executed successfully.');
          }
        });
      });
    } catch (e) {
      return `Error executing code: ${e.message}`;
    }
  },
  file_info: async ({ path: filePath }, permissions) => {
    try {
      if (!isPathAllowed(filePath, 'read', permissions))
        return `Error: Access to ${filePath} is restricted by system policy or manifest.`;
      const fullPath = path.resolve(process.cwd(), filePath);
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
  delete_file: async ({ path: filePath }, permissions) => {
    try {
      if (!isPathAllowed(filePath, 'write', permissions))
        return `Error: Access to ${filePath} is restricted by system policy or manifest.`;
      const fullPath = path.resolve(process.cwd(), filePath);
      if (!fs.existsSync(fullPath)) return `File not found: ${filePath}`;
      fs.unlinkSync(fullPath);
      return `File ${filePath} deleted successfully.`;
    } catch (e) {
      return `Error deleting file: ${e.message}`;
    }
  },
  replace_in_file: async ({ path: filePath, search, replace }, permissions) => {
    try {
      if (!isPathAllowed(filePath, 'write', permissions))
        return `Error: Access to ${filePath} is restricted by system policy or manifest.`;
      const fullPath = path.resolve(process.cwd(), filePath);
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
  add_plugin: async ({ name, code, manifest }, _permissions) => {
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

      // Validate manifest JSON
      let parsedManifest;
      try {
        parsedManifest = typeof manifest === 'string' ? JSON.parse(manifest) : manifest;
      } catch (e) {
        return 'Error: Manifest is not valid JSON.';
      }

      fs.writeFileSync(jsPath, code);
      fs.writeFileSync(manifestPath, JSON.stringify(parsedManifest, null, 2));

      return `Plugin '${safeName}' installed successfully.`;
    } catch (e) {
      return `Error installing plugin: ${e.message}`;
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
