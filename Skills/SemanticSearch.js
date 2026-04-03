const fs = require('node:fs');
const path = require('node:path');
const config = require('../app/Config');

const INDEX_VERSION = 1;
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;
const DEFAULT_MAX_RESULTS = 5;
const INDEXED_EXTENSIONS = new Set(['.js', '.ts', '.py', '.md', '.json', '.txt', '.sh']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.temp', 'coverage']);

// --- Index I/O ---

const getIndexPath = () => {
  const root = path.resolve(config.workspaceDir || '.');
  return path.join(root, 'Memory', 'semantic_index.json');
};

const loadIndex = () => {
  const p = getIndexPath();
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return data.version === INDEX_VERSION ? data : null;
  } catch {
    return null;
  }
};

const saveIndex = (index) => {
  const p = getIndexPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(index));
};

// --- Text Chunking ---

const chunkText = (text, filePath) => {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push({ filePath, text: text.slice(start, end) });
    if (end === text.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
};

// --- File Walking ---

const walkWorkspace = (root) => {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && INDEXED_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(full);
      }
    }
  };
  walk(root);
  return files;
};

// --- Embedding Provider Detection ---

const readProviderSettings = (provider) => {
  try {
    const root = path.resolve(config.workspaceDir || '.');
    const p = path.join(root, 'Settings', `${provider}.json`);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
};

const getEmbeddingConfig = () => {
  const provider = (config.LLMProvider || 'openrouter').toLowerCase();
  const settings = readProviderSettings(provider);

  if (provider === 'ollama') {
    const endpoint = (settings.endpoint || 'http://localhost:11434').replace(/\/$/, '');
    return { type: 'ollama', endpoint, model: 'nomic-embed-text' };
  }

  if (settings.apiKey && ['openai', 'openrouter', 'deepseek'].includes(provider)) {
    const base = (settings.endpoint || 'https://api.openai.com/v1/chat/completions').replace(
      /\/chat\/completions$/,
      '',
    );
    return {
      type: 'openai',
      apiKey: settings.apiKey,
      endpoint: `${base}/embeddings`,
      model: 'text-embedding-3-small',
    };
  }

  return { type: 'tfidf' };
};

// --- Embedding API Calls ---

const fetchOllamaEmbedding = async (text, embConfig) => {
  const resp = await fetch(`${embConfig.endpoint}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: embConfig.model, prompt: text }),
  });
  if (!resp.ok) throw new Error(`Ollama embedding failed: ${resp.status}`);
  const data = await resp.json();
  return data.embedding || null;
};

const fetchOpenAIEmbedding = async (text, embConfig) => {
  const resp = await fetch(embConfig.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${embConfig.apiKey}`,
    },
    body: JSON.stringify({ model: embConfig.model, input: text }),
  });
  if (!resp.ok) throw new Error(`OpenAI embedding failed: ${resp.status}`);
  const data = await resp.json();
  return data.data?.[0]?.embedding || null;
};

const getEmbedding = async (text, embConfig) => {
  if (embConfig.type === 'ollama') return fetchOllamaEmbedding(text, embConfig);
  if (embConfig.type === 'openai') return fetchOpenAIEmbedding(text, embConfig);
  return null;
};

// --- Similarity & Scoring ---

const cosineSimilarity = (a, b) => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
};

const tokenize = (text) => text.toLowerCase().match(/\b\w+\b/g) || [];

const tfidfScore = (queryTokens, docText) => {
  const docTokens = tokenize(docText);
  const freq = new Map();
  for (const t of docTokens) freq.set(t, (freq.get(t) || 0) + 1);
  let score = 0;
  for (const qt of queryTokens) {
    if (freq.has(qt)) score += freq.get(qt);
  }
  return score / (docTokens.length || 1);
};

// --- Index Building ---

const collectChunks = (root) => {
  const files = walkWorkspace(root);
  const chunks = [];
  for (const file of files) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes('\0')) continue; // skip binary
      const rel = path.relative(root, file);
      chunks.push(...chunkText(text, rel));
    } catch {
      /* skip unreadable files */
    }
  }
  return { files, chunks };
};

const attachEmbeddings = async (chunks, embConfig) => {
  const indexed = [];
  for (const chunk of chunks) {
    const entry = { filePath: chunk.filePath, text: chunk.text };
    if (embConfig.type !== 'tfidf') {
      try {
        const embedding = await getEmbedding(chunk.text, embConfig);
        if (embedding) entry.embedding = embedding;
      } catch {
        /* fall through without embedding */
      }
    }
    indexed.push(entry);
  }
  return indexed;
};

const buildIndex = async () => {
  const root = path.resolve(config.workspaceDir || '.');
  const embConfig = getEmbeddingConfig();
  const { files, chunks } = collectChunks(root);

  process.stdout.write(
    `[SemanticSearch] Indexing ${chunks.length} chunks from ${files.length} files (${embConfig.type})...\n`,
  );

  const indexed = await attachEmbeddings(chunks, embConfig);

  const index = {
    version: INDEX_VERSION,
    type: embConfig.type,
    builtAt: new Date().toISOString(),
    fileCount: files.length,
    chunkCount: indexed.length,
    chunks: indexed,
  };

  saveIndex(index);
  return index;
};

// --- Search ---

const searchByEmbedding = async (query, maxResults, index, embConfig) => {
  const queryEmbedding = await getEmbedding(query, embConfig);
  if (!queryEmbedding) return null;

  return index.chunks
    .filter((c) => c.embedding)
    .map((c) => ({
      filePath: c.filePath,
      text: c.text,
      score: cosineSimilarity(queryEmbedding, c.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
};

const searchByTfidf = (query, maxResults, index) => {
  const queryTokens = tokenize(query);
  return index.chunks
    .map((c) => ({ filePath: c.filePath, text: c.text, score: tfidfScore(queryTokens, c.text) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
};

const searchIndex = async (query, maxResults, index) => {
  const embConfig = getEmbeddingConfig();
  const canEmbed = embConfig.type !== 'tfidf' && index.type !== 'tfidf';

  if (canEmbed) {
    const results = await searchByEmbedding(query, maxResults, index, embConfig);
    if (results) return results;
  }

  return searchByTfidf(query, maxResults, index);
};

// --- Result Formatting ---

const formatResults = (results) => {
  return results
    .map((r, i) => {
      const preview = r.text.slice(0, 300).replace(/\n/g, ' ').trim();
      return `[${i + 1}] ${r.filePath} (score: ${r.score.toFixed(4)})\n${preview}`;
    })
    .join('\n\n---\n\n');
};

// --- Skill Implementations ---

const implementations = {
  semantic_search: async ({ query, max_results = DEFAULT_MAX_RESULTS }, _permissions) => {
    try {
      let index = loadIndex();
      if (!index) {
        process.stdout.write('[SemanticSearch] No index found. Building now...\n');
        index = await buildIndex();
      }

      const results = await searchIndex(query, max_results, index);
      if (!results.length) return 'No results found.';

      return formatResults(results);
    } catch (e) {
      return `Error performing semantic search: ${e.message}`;
    }
  },

  reindex_workspace: async (_args, _permissions) => {
    try {
      const index = await buildIndex();
      return `Workspace re-indexed: ${index.fileCount} files, ${index.chunkCount} chunks (${index.type} mode). Built at ${index.builtAt}.`;
    } catch (e) {
      return `Error re-indexing workspace: ${e.message}`;
    }
  },
};

module.exports = {
  implementations,
  _test: {
    chunkText,
    tokenize,
    tfidfScore,
    cosineSimilarity,
    getEmbeddingConfig,
    walkWorkspace,
    formatResults,
  },
};
