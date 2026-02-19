const fs = require('node:fs');
const path = require('node:path');
const { exec, execFile } = require('node:child_process');

const tools = [
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a file with content",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file" },
          content: { type: "string", description: "Content to write" }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Execute a shell command",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command to execute" }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and directories in a specific path",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to list (default: .)" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search for a text pattern in files within a directory",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to search in (default: .)" },
          term: { type: "string", description: "The text or regex pattern to search for" }
        },
        required: ["term"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "execute_code",
      description: "Execute code in a specific language (creates a temp file and runs it)",
      parameters: {
        type: "object",
        properties: {
          language: { type: "string", description: "Language to use (javascript, python, bash)" },
          code: { type: "string", description: "The code to execute" }
        },
        required: ["language", "code"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "file_info",
      description: "Get metadata about a file (size, creation time, etc.)",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "file_info",
      description: "Get metadata about a file (size, creation time, etc.)",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "replace_in_file",
      description: "Replace text in a file using a regex pattern",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file" },
          search: { type: "string", description: "Regex pattern to search for" },
          replace: { type: "string", description: "Replacement text" }
        },
        required: ["path", "search", "replace"]
      }
    }
  }
];

const availableTools = {
  write_file: async ({ path: filePath, content }) => {
    try {
      const fullPath = path.resolve(process.cwd(), filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
      return `File ${filePath} written successfully.`;
    } catch (e) {
      return `Error writing file: ${e.message}`;
    }
  },
  read_file: async ({ path: filePath }) => {
     try {
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
                resolve(stdout || stderr || "Command executed successfully.");
            }
        });
    });
  },
  list_files: async ({ path: dirPath = '.' }) => {
    try {
      const fullPath = path.resolve(process.cwd(), dirPath);
      if (!fs.existsSync(fullPath)) return `Path not found: ${dirPath}`;
      
      const items = fs.readdirSync(fullPath, { withFileTypes: true });
      const formatted = items.map(item => item.isDirectory() ? `${item.name}/` : item.name).join('\n');
      return formatted || "(empty directory)";
    } catch (e) {
      return `Error listing files: ${e.message}`;
    }
  },
  search_files: async ({ path: dirPath = '.', term }) => {
    try {
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

      return results.length > 0 ? results.join('\n') : "No matches found.";
    } catch (e) {
      return `Error searching files: ${e.message}`;
    }
  },
  execute_code: async ({ language, code }) => {
    try {
      const timestamp = Date.now();
      let filename, command;
      
      switch(language.toLowerCase()) {
          case 'javascript':
          case 'js':
          case 'node':
              filename = `temp_${timestamp}.js`;
              command = `node ${filename}`;
              break;
          case 'python':
          case 'py':
              filename = `temp_${timestamp}.py`;
              command = `python3 ${filename}`;
              break;
          case 'bash':
          case 'sh':
              filename = `temp_${timestamp}.sh`;
              command = `bash ${filename}`;
              break;
          default:
              return "Unsupported language. Supported: javascript, python, bash.";
      }
      
      const fullPath = path.resolve(process.cwd(), filename);
      fs.writeFileSync(fullPath, code);
      
      return new Promise((resolve) => {
          exec(command, (error, stdout, stderr) => {
              try { fs.unlinkSync(fullPath); } catch(e) {}
              if (error) {
                  resolve(`Error: ${error.message}\nStderr: ${stderr}`);
              } else {
                  resolve(stdout || stderr || "Code executed successfully.");
              }
          });
      });
    } catch (e) {
      return `Error executing code: ${e.message}`;
    }
  },
  file_info: async ({ path: filePath }) => {
    try {
      const fullPath = path.resolve(process.cwd(), filePath);
      if (!fs.existsSync(fullPath)) return `File not found: ${filePath}`;
      const stats = fs.statSync(fullPath);
      return JSON.stringify({
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        isDirectory: stats.isDirectory()
      }, null, 2);
    } catch (e) {
      return `Error getting file info: ${e.message}`;
    }
  },
  delete_file: async ({ path: filePath }) => {
    try {
      const fullPath = path.resolve(process.cwd(), filePath);
      if (!fs.existsSync(fullPath)) return `File not found: ${filePath}`;
      fs.unlinkSync(fullPath);
      return `File ${filePath} deleted successfully.`;
    } catch (e) {
      return `Error deleting file: ${e.message}`;
    }
  },
  replace_in_file: async ({ path: filePath, search, replace }) => {
    try {
      const fullPath = path.resolve(process.cwd(), filePath);
      if (!fs.existsSync(fullPath)) return `File not found: ${filePath}`;

      const content = fs.readFileSync(fullPath, 'utf8');
      const regex = new RegExp(search, 'g');
      const newContent = content.replace(regex, replace);

      if (content === newContent) return "No matches found.";

      fs.writeFileSync(fullPath, newContent);
      return `Successfully replaced content in ${filePath}.`;
    } catch (e) {
      return `Error replacing in file: ${e.message}`;
    }
  }
};

module.exports = { tools, availableTools };