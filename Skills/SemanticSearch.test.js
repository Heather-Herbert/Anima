const { describe, it, expect, beforeEach } = require('@jest/globals');
const fs = require('node:fs');

jest.mock('node:fs');
jest.mock('../app/Config', () => ({ workspaceDir: '/mock/workspace', LLMProvider: 'openrouter' }));

// Must require after mocks are set up
const { implementations, _test } = require('./SemanticSearch');
const { chunkText, tokenize, tfidfScore, cosineSimilarity, formatResults } = _test;

const VALID_INDEX = {
  version: 1,
  type: 'tfidf',
  builtAt: '2026-01-01T00:00:00.000Z',
  fileCount: 1,
  chunkCount: 1,
  chunks: [
    {
      filePath: 'app/Tools.js',
      text: 'function write_file(path, content) { fs.writeFileSync(path, content); }',
    },
  ],
};

describe('chunkText', () => {
  it('returns a single chunk for short text', () => {
    const chunks = chunkText('hello world', 'foo.js');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].filePath).toBe('foo.js');
    expect(chunks[0].text).toBe('hello world');
  });

  it('splits long text into overlapping chunks', () => {
    const text = 'a'.repeat(4000);
    const chunks = chunkText(text, 'big.js');
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk except the last should be CHUNK_SIZE characters
    expect(chunks[0].text).toHaveLength(1500);
  });

  it('does not produce duplicate trailing chunk', () => {
    // Exactly one chunk size worth of text should yield one chunk
    const text = 'x'.repeat(1500);
    const chunks = chunkText(text, 'exact.js');
    expect(chunks).toHaveLength(1);
  });
});

describe('tokenize', () => {
  it('splits into lowercase word tokens', () => {
    expect(tokenize('Hello World')).toEqual(['hello', 'world']);
  });

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('ignores punctuation', () => {
    expect(tokenize('foo.bar(baz)')).toEqual(['foo', 'bar', 'baz']);
  });
});

describe('tfidfScore', () => {
  it('returns higher score for more query term matches', () => {
    const tokens = tokenize('write file');
    const highDoc = 'write file to disk. write file again.';
    const lowDoc = 'read a document from disk.';
    expect(tfidfScore(tokens, highDoc)).toBeGreaterThan(tfidfScore(tokens, lowDoc));
  });

  it('returns 0 for a document with no matching terms', () => {
    expect(tfidfScore(tokenize('elephant'), 'the cat sat on the mat')).toBe(0);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });
});

describe('formatResults', () => {
  it('includes file path and score', () => {
    const results = [{ filePath: 'src/foo.js', text: 'some code here', score: 0.9321 }];
    const output = formatResults(results);
    expect(output).toContain('src/foo.js');
    expect(output).toContain('0.9321');
    expect(output).toContain('some code here');
  });

  it('separates multiple results with a divider', () => {
    const results = [
      { filePath: 'a.js', text: 'aaa', score: 0.9 },
      { filePath: 'b.js', text: 'bbb', score: 0.8 },
    ];
    expect(formatResults(results)).toContain('---');
  });
});

describe('semantic_search implementation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns results using TF-IDF when index exists', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify(VALID_INDEX));

    const result = await implementations.semantic_search({ query: 'write file' });
    expect(result).toContain('app/Tools.js');
  });

  it('builds index when none exists, then returns results', async () => {
    // First existsSync (index check) → false; subsequent calls (walkWorkspace) → false (empty dir)
    fs.existsSync
      .mockReturnValueOnce(false) // index not found
      .mockReturnValue(false); // Memory dir for mkdirSync, files
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    fs.readdirSync.mockReturnValue([]); // empty workspace

    const result = await implementations.semantic_search({ query: 'anything' });
    expect(result).toBe('No results found.');
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('semantic_index.json'),
      expect.any(String),
    );
  });

  it('returns "No results found." for an empty index', async () => {
    const emptyIndex = { ...VALID_INDEX, chunks: [] };
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify(emptyIndex));

    const result = await implementations.semantic_search({ query: 'anything' });
    expect(result).toBe('No results found.');
  });

  it('respects max_results parameter', async () => {
    const manyChunks = Array.from({ length: 10 }, (_, i) => ({
      filePath: `file${i}.js`,
      text: 'write file content here for scoring',
    }));
    const bigIndex = { ...VALID_INDEX, chunks: manyChunks };
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify(bigIndex));

    const result = await implementations.semantic_search({ query: 'write file', max_results: 2 });
    // Should contain [1] and [2] but not [3]
    expect(result).toContain('[1]');
    expect(result).toContain('[2]');
    expect(result).not.toContain('[3]');
  });

  it('returns error string on unexpected failure', async () => {
    fs.existsSync.mockImplementation(() => {
      throw new Error('disk failure');
    });
    const result = await implementations.semantic_search({ query: 'test' });
    expect(result).toContain('Error performing semantic search');
  });
});

describe('reindex_workspace implementation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes a new index and returns summary', async () => {
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    fs.readdirSync.mockReturnValue([]);

    const result = await implementations.reindex_workspace({});
    expect(result).toContain('re-indexed');
    expect(result).toContain('0 files');
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('semantic_index.json'),
      expect.any(String),
    );
  });

  it('returns error string on failure', async () => {
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockImplementation(() => {});
    fs.readdirSync.mockReturnValue([]);
    fs.writeFileSync.mockImplementation(() => {
      throw new Error('boom');
    });
    const result = await implementations.reindex_workspace({});
    expect(result).toContain('Error re-indexing');
  });
});

describe('index version mismatch', () => {
  it('treats stale index as missing and rebuilds', async () => {
    const staleIndex = { ...VALID_INDEX, version: 99 };
    fs.existsSync
      .mockReturnValueOnce(true) // index file exists
      .mockReturnValue(false);
    fs.readFileSync.mockReturnValueOnce(JSON.stringify(staleIndex));
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    fs.readdirSync.mockReturnValue([]);

    const result = await implementations.semantic_search({ query: 'anything' });
    expect(result).toBe('No results found.');
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('semantic_index.json'),
      expect.stringContaining('"version":1'),
    );
  });
});
