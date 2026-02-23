const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const fs = require('node:fs');
const child_process = require('node:child_process');

// Mock fs and child_process
jest.mock('node:fs');
jest.mock('node:child_process');
jest.mock('./Config', () => ({
  workspaceDir: '.',
}));

const { availableTools } = require('./Tools');

describe('Tools', () => {
  const fullPermissions = { filesystem: { read: ['*'], write: ['*'] } };

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

      const result = await availableTools.write_file(
        { path: 'test.txt', content: 'hello', justification: 'test' },
        fullPermissions,
      );

      expect(result).toContain('written successfully');
      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('test.txt'), 'hello');
    });

    it('handles errors', async () => {
      fs.mkdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = await availableTools.write_file(
        { path: 'test.txt', content: 'hello', justification: 'test' },
        fullPermissions,
      );
      expect(result).toContain('Error writing file');
    });
  });

  describe('read_file', () => {
    it('reads file successfully', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('file content');

      const result = await availableTools.read_file({ path: 'test.txt' }, fullPermissions);
      expect(result).toBe('file content');
    });

    it('returns error if file does not exist', async () => {
      fs.existsSync.mockReturnValue(false);
      const result = await availableTools.read_file({ path: 'missing.txt' }, fullPermissions);
      expect(result).toContain('File not found');
    });
  });

  describe('run_command', () => {
    const EventEmitter = require('node:events');

    it('executes command successfully', async () => {
      const mockChild = new EventEmitter();
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      child_process.spawn.mockReturnValue(mockChild);

      const promise = availableTools.run_command(
        { file: 'echo', args: ['hello'], justification: 'test' },
        fullPermissions,
      );

      mockChild.stdout.emit('data', 'hello output');
      mockChild.emit('close', 0);

      const result = await promise;
      expect(result).toBe('hello output');
      expect(child_process.spawn).toHaveBeenCalledWith(
        'echo',
        ['hello'],
        expect.objectContaining({ shell: false }),
      );
    });

    it('handles execution errors', async () => {
      const mockChild = new EventEmitter();
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      child_process.spawn.mockReturnValue(mockChild);

      const promise = availableTools.run_command(
        { file: 'false', justification: 'test' },
        fullPermissions,
      );

      mockChild.emit('close', 1);

      const result = await promise;
      expect(result).toContain('Command exited with code 1');
    });

    it('blocks commands in denylist', async () => {
      const result = await availableTools.run_command(
        { file: 'rm', args: ['-rf', '/'], justification: 'test' },
        fullPermissions,
      );
      expect(result).toContain('blocked by system security policy');
      expect(child_process.spawn).not.toHaveBeenCalled();
    });

    it('enforces manifest allowlist', async () => {
      const permissions = {
        commands: { allow: ['git'] },
        filesystem: { read: ['*'], write: ['*'] },
      };

      // Denied
      const resultDenied = await availableTools.run_command(
        { file: 'ls', justification: 'test' },
        permissions,
      );
      expect(resultDenied).toContain('not permitted by the active manifest');

      // Allowed
      const mockChild = new EventEmitter();
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      child_process.spawn.mockReturnValue(mockChild);

      const promise = availableTools.run_command(
        { file: 'git', args: ['status'], justification: 'test' },
        permissions,
      );
      mockChild.emit('close', 0);
      await promise;
      expect(child_process.spawn).toHaveBeenCalledWith('git', ['status'], expect.anything());
    });
  });

  describe('replace_in_file', () => {
    it('replaces content successfully', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('Hello World');
      fs.writeFileSync.mockImplementation(() => {});

      const result = await availableTools.replace_in_file(
        {
          path: 'test.txt',
          search: 'World',
          replace: 'Jest',
          justification: 'test',
        },
        fullPermissions,
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('test.txt'),
        'Hello Jest',
      );
      expect(result).toContain('Successfully replaced');
    });

    it('reports no matches found', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('Hello World');

      const result = await availableTools.replace_in_file(
        {
          path: 'test.txt',
          search: 'Universe',
          replace: 'Jest',
          justification: 'test',
        },
        fullPermissions,
      );
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

      const result = await availableTools.execute_code(
        {
          language: 'javascript',
          code: 'while(true){}',
          justification: 'test',
        },
        fullPermissions,
      );
      expect(result).toBe('Error: Execution timed out after 10 seconds.');
    });

    it('executes python code', async () => {
      fs.writeFileSync.mockImplementation(() => {});
      child_process.exec.mockImplementation((cmd, options, cb) => cb(null, 'Python Output', ''));

      const result = await availableTools.execute_code(
        {
          language: 'python',
          code: 'print("Hello")',
          justification: 'test',
        },
        fullPermissions,
      );
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

      const result = await availableTools.web_search({ query: 'Anima AI' }, fullPermissions);
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

      const result = await availableTools.web_search({ query: 'UnknownTerm123' }, fullPermissions);
      expect(result).toBe('No direct answer found.');
    });

    it('handles fetch errors', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));

      const result = await availableTools.web_search({ query: 'Anima AI' }, fullPermissions);
      expect(result).toContain('Error searching web: Network error');
    });

    it('handles HTTP errors', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await availableTools.web_search({ query: 'error' }, fullPermissions);
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

      const result = await availableTools.list_files({ path: '.' }, fullPermissions);
      expect(result).toContain('file1.txt');
      expect(result).toContain('dir1/');
    });
  });

  describe('search_files', () => {
    it('finds matches in files', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true });
      fs.readFileSync.mockReturnValue('line1\ntarget\nline3');

      const result = await availableTools.search_files(
        { path: 'f.txt', term: 'target' },
        fullPermissions,
      );
      expect(result).toContain('f.txt:2:target');
    });

    it('reports no matches', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true });
      fs.readFileSync.mockReturnValue('no match here');

      const result = await availableTools.search_files(
        { path: 'f.txt', term: 'target' },
        fullPermissions,
      );
      expect(result).toBe('No matches found.');
    });

    it('handles invalid regex', async () => {
      fs.existsSync.mockReturnValue(true);
      const result = await availableTools.search_files(
        { path: '.', term: '[' },
        fullPermissions,
      );
      expect(result).toContain('Invalid regex pattern');
    });
  });

  describe('execute_code', () => {
    it('executes bash code', async () => {
      fs.writeFileSync.mockImplementation(() => {});
      child_process.exec.mockImplementation((cmd, options, cb) => cb(null, 'Bash Output', ''));

      const result = await availableTools.execute_code(
        { language: 'bash', code: 'ls', justification: 'test' },
        fullPermissions,
      );
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

      const result = await availableTools.file_info({ path: 'test.txt' }, fullPermissions);
      expect(result).toContain('"size": 1024');
    });
  });

  describe('delete_file', () => {
    it('deletes file successfully', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.unlinkSync.mockImplementation(() => {});

      const result = await availableTools.delete_file(
        { path: 'test.txt', justification: 'test' },
        fullPermissions,
      );
      expect(result).toContain('deleted successfully');
      expect(fs.unlinkSync).toHaveBeenCalled();
    });
  });

  describe('add_plugin', () => {
    it('installs plugin successfully', async () => {
      // We need to mock the internal fs calls in add_plugin
      // It uses __dirname, so path.join works relative to that.
      // It writes to '../Plugins' dir.
      fs.existsSync.mockReturnValue(false); // Plugin dir doesn't exist initially
      fs.mkdirSync.mockImplementation(() => {});
      fs.writeFileSync.mockImplementation(() => {});

      const result = await availableTools.add_plugin(
        {
          name: 'test-plugin',
          code: 'module.exports = {}',
          manifest: JSON.stringify({ name: 'test' }),
          justification: 'test',
        },
        fullPermissions,
      );

      expect(result).toContain('installed successfully');
      expect(fs.writeFileSync).toHaveBeenCalledTimes(2); // Code and manifest
    });

    it('saves provenance information if provided', async () => {
      fs.existsSync.mockReturnValue(false); // Make sure plugin doesn't exist
      fs.writeFileSync.mockImplementation(() => {});

      const provenance = { source: 'http://example.com', hash: '123' };
      await availableTools.add_plugin(
        {
          name: 'prov-test',
          code: '...',
          manifest: '{}',
          provenance,
          justification: 'test',
        },
        fullPermissions,
      );

      expect(fs.writeFileSync).toHaveBeenCalledTimes(3); // Code, manifest, AND provenance
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('prov-test.provenance.json'),
        JSON.stringify(provenance, null, 2),
      );
    });

    it('refuses to overwrite existing plugin without isOverwrite flag', async () => {
      fs.existsSync.mockReturnValue(true); // Already exists
      const result = await availableTools.add_plugin(
        {
          name: 'exists',
          code: '...',
          manifest: '{}',
          justification: 'test',
        },
        fullPermissions,
      );
      expect(result).toContain('is already installed');
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('allows overwrite if isOverwrite flag is set', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.writeFileSync.mockImplementation(() => {});
      const result = await availableTools.add_plugin(
        {
          name: 'exists',
          code: '...',
          manifest: '{}',
          isOverwrite: true,
          justification: 'test',
        },
        fullPermissions,
      );
      expect(result).toContain('installed successfully');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('fails with invalid manifest', async () => {
      fs.existsSync.mockReturnValue(false);
      const result = await availableTools.add_plugin(
        {
          name: 'test-plugin-new',
          code: '...',
          manifest: '{ invalid json',
          justification: 'test',
        },
        fullPermissions,
      );
      expect(result).toContain('Error: Manifest is not valid JSON');
    });
  });
});
