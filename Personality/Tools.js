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
    return new Promise((resolve) => {
      execFile('grep', ['-rnI', '-e', term, dirPath], (error, stdout, stderr) => {
        if (error && error.code === 1) {
          resolve("No matches found.");
        } else if (error) {
          resolve(`Error searching files: ${error.message}`);
        } else {
          resolve(stdout);
        }
      });
    });
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
  }
};

module.exports = { tools, availableTools };