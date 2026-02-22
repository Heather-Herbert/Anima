const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const fs = require('node:fs');
const child_process = require('node:child_process');

// Mock fs and child_process
jest.mock('node:fs');
jest.mock('node:child_process');

const { availableTools } = require('./Tools');

describe('Tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  describe('write_file', () => {
    it('writes file successfully', async () => {
      fs.mkdirSync.mockImplementation(() => {});
      fs.writeFileSync.mockImplementation(() => {});

      const result = await availableTools.write_file({ path: 'test.txt', content: 'hello' });

      expect(result).toContain('written successfully');
      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('test.txt'), 'hello');
    });

    it('handles errors', async () => {
      fs.mkdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = await availableTools.write_file({ path: 'test.txt', content: 'hello' });
      expect(result).toContain('Error writing file');
    });
  });

  describe('read_file', () => {
    it('reads file successfully', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('file content');

      const result = await availableTools.read_file({ path: 'test.txt' });
      expect(result).toBe('file content');
    });

    it('returns error if file does not exist', async () => {
      fs.existsSync.mockReturnValue(false);
      const result = await availableTools.read_file({ path: 'missing.txt' });
      expect(result).toContain('File not found');
    });
  });

  describe('run_command', () => {
    it('executes command successfully', async () => {
      child_process.exec.mockImplementation((cmd, cb) => cb(null, 'stdout output', ''));

      const result = await availableTools.run_command({ command: 'echo test' });
      expect(result).toBe('stdout output');
    });

    it('handles execution errors', async () => {
      child_process.exec.mockImplementation((cmd, cb) =>
        cb(new Error('Command failed'), '', 'stderr output'),
      );

      const result = await availableTools.run_command({ command: 'bad_cmd' });
      expect(result).toContain('Error: Command failed');
      expect(result).toContain('stderr output');
    });
  });

  describe('replace_in_file', () => {
    it('replaces content successfully', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('Hello World');
      fs.writeFileSync.mockImplementation(() => {});

      const result = await availableTools.replace_in_file({
        path: 'test.txt',
        search: 'World',
        replace: 'Jest',
      });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('test.txt'),
        'Hello Jest',
      );
      expect(result).toContain('Successfully replaced');
    });

    it('reports no matches found', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('Hello World');

      const result = await availableTools.replace_in_file({
        path: 'test.txt',
        search: 'Universe',
        replace: 'Jest',
      });
      expect(result).toBe('No matches found.');
    });
  });

  describe('execute_code', () => {
    it('handles timeout correctly', async () => {
      fs.writeFileSync.mockImplementation(() => {});

      child_process.exec.mockImplementation((cmd, options, cb) => {
        const error = new Error('Command failed');
        error.killed = true;
        cb(error, '', '');
      });

      const result = await availableTools.execute_code({
        language: 'javascript',
        code: 'while(true){}',
      });
      expect(result).toBe('Error: Execution timed out after 10 seconds.');
    });

    it('executes python code', async () => {
      fs.writeFileSync.mockImplementation(() => {});
      child_process.exec.mockImplementation((cmd, options, cb) => cb(null, 'Python Output', ''));

      const result = await availableTools.execute_code({
        language: 'python',
        code: 'print("Hello")',
      });
      expect(result).toBe('Python Output');
      expect(child_process.exec).toHaveBeenCalledWith(
        expect.stringContaining('python3'),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('web_search', () => {
    it('returns search results successfully', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          AbstractText: 'Anima is an AI project.',
          AbstractURL: 'https://example.com/anima',
          RelatedTopics: [
            { Text: 'Related 1', FirstURL: 'http://url1' },
            { Text: 'Related 2', FirstURL: 'http://url2' },
          ],
        }),
      });

      const result = await availableTools.web_search({ query: 'Anima AI' });
      expect(result).toContain('Summary: Anima is an AI project.');
      expect(result).toContain('Source: https://example.com/anima');
      expect(result).toContain('Related 1');
    });

    it('handles no direct answer found', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          AbstractText: '',
          RelatedTopics: [],
        }),
      });

      const result = await availableTools.web_search({ query: 'UnknownTerm123' });
      expect(result).toBe('No direct answer found.');
    });

    it('handles fetch errors', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));

      const result = await availableTools.web_search({ query: 'Anima AI' });
      expect(result).toContain('Error searching web: Network error');
    });

    it('handles HTTP errors', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await availableTools.web_search({ query: 'error' });
      expect(result).toContain('Error: HTTP 500');
    });
  });

  describe('list_files', () => {
    it('lists files in directory', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        { name: 'file1.txt', isDirectory: () => false, isFile: () => true },
        { name: 'dir1', isDirectory: () => true, isFile: () => false },
      ]);
      // path.resolve needs to work, so we shouldn't mock it unless necessary.
      // But since isPathAllowed uses path.resolve(cwd, filePath), and we are mocking fs,
      // we assume path works as expected.
      // We need to make sure isPathAllowed allows these paths.
      // Since we can't easily mock isPathAllowed (it's internal), we rely on default behavior.
      // Default behavior allows paths inside CWD.

      const result = await availableTools.list_files({ path: '.' });
      expect(result).toContain('file1.txt');
      expect(result).toContain('dir1/');
    });
  });

  describe('search_files', () => {
    it('finds matches in files', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true });
      fs.readFileSync.mockReturnValue('line1\ntarget\nline3');

      const result = await availableTools.search_files({ path: 'f.txt', term: 'target' });
      expect(result).toContain('f.txt:2:target');
    });

    it('reports no matches', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true });
      fs.readFileSync.mockReturnValue('no match here');

      const result = await availableTools.search_files({ path: 'f.txt', term: 'target' });
      expect(result).toBe('No matches found.');
    });

    it('handles invalid regex', async () => {
      fs.existsSync.mockReturnValue(true);
      const result = await availableTools.search_files({ path: '.', term: '[' });
      expect(result).toContain('Invalid regex pattern');
    });
  });

  describe('execute_code', () => {
    it('executes bash code', async () => {
      fs.writeFileSync.mockImplementation(() => {});
      child_process.exec.mockImplementation((cmd, options, cb) => cb(null, 'Bash Output', ''));

      const result = await availableTools.execute_code({ language: 'bash', code: 'ls' });
      expect(result).toBe('Bash Output');
    });

    it('returns error for unsupported language', async () => {
      const result = await availableTools.execute_code({ language: 'cobol', code: '' });
      expect(result).toContain('Unsupported language');
    });
  });

  describe('file_info', () => {
    it('returns file stats', async () => {
      fs.existsSync.mockReturnValue(true);
      const mockStats = {
        size: 1024,
        birthtime: new Date(),
        mtime: new Date(),
        isDirectory: () => false,
      };
      fs.statSync.mockReturnValue(mockStats);

      const result = await availableTools.file_info({ path: 'test.txt' });
      expect(result).toContain('"size": 1024');
    });
  });

  describe('delete_file', () => {
    it('deletes file successfully', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.unlinkSync.mockImplementation(() => {});

      const result = await availableTools.delete_file({ path: 'test.txt' });
      expect(result).toContain('deleted successfully');
      expect(fs.unlinkSync).toHaveBeenCalled();
    });
  });

  describe('add_plugin', () => {
    it('installs plugin successfully', async () => {
      // We need to mock the internal fs calls in add_plugin
      // It uses __dirname, so path.join works relative to that.
      // It writes to 'plugins' dir.
      fs.existsSync.mockReturnValue(false); // Plugin dir doesn't exist initially
      fs.mkdirSync.mockImplementation(() => {});
      fs.writeFileSync.mockImplementation(() => {});

      const result = await availableTools.add_plugin({
        name: 'test-plugin',
        code: 'module.exports = {}',
        manifest: JSON.stringify({ name: 'test' }),
      });

      expect(result).toContain('installed successfully');
      expect(fs.writeFileSync).toHaveBeenCalledTimes(2); // Code and manifest
    });

    it('fails with invalid manifest', async () => {
      const result = await availableTools.add_plugin({
        name: 'test-plugin',
        code: '...',
        manifest: '{ invalid json',
      });
      expect(result).toContain('Error: Manifest is not valid JSON');
    });
  });
});
