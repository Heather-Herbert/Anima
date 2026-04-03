const fs = require('node:fs');
const path = require('node:path');
const config = require('../app/Config');

const DEFAULT_DEPTH = 3;
const DEFAULT_RECENT_LIMIT = 10;
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', '.temp']);
const ENTRY_POINT_NAMES = new Set(['cli.js', 'index.js', 'main.js', 'app.js', 'server.js']);
const CONFIG_PATTERNS = [
  /\.config\.(js|json)$/,
  /^package\.json$/,
  /^\.env(\.example)?$/,
  /^CLAUDE\.md$/,
  /^README\.md$/,
];
const SERVICE_DIRS = ['app', 'Skills', 'Plugins'];

// --- Directory Tree ---

const treePrefix = (isLast) => (isLast ? '└── ' : '├── ');
const treeIndent = (isLast) => (isLast ? '    ' : '│   ');

const buildTree = (dirPath, depth, maxDepth, indent) => {
  if (depth > maxDepth) return [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const visible = entries.filter((e) => !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'));
  const lines = [];

  visible.forEach((entry, i) => {
    const isLast = i === visible.length - 1;
    lines.push(`${indent}${treePrefix(isLast)}${entry.name}${entry.isDirectory() ? '/' : ''}`);
    if (entry.isDirectory()) {
      const sub = buildTree(
        path.join(dirPath, entry.name),
        depth + 1,
        maxDepth,
        indent + treeIndent(isLast),
      );
      lines.push(...sub);
    }
  });

  return lines;
};

const renderTree = (root, maxDepth) => {
  const name = path.basename(root);
  const lines = [`${name}/`, ...buildTree(root, 1, maxDepth, '')];
  return lines.join('\n');
};

// --- Entry Points & Config Files ---

const isConfigFile = (name) => CONFIG_PATTERNS.some((p) => p.test(name));

const scanRootFiles = (root) => {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { entryPoints: [], configFiles: [] };
  }

  const entryPoints = [];
  const configFiles = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (ENTRY_POINT_NAMES.has(entry.name)) {
      const size = safeStatSize(path.join(root, entry.name));
      entryPoints.push(`  ${entry.name} (${size} bytes)`);
    } else if (isConfigFile(entry.name)) {
      configFiles.push(`  ${entry.name}`);
    }
  }

  return { entryPoints, configFiles };
};

// --- Service Descriptions ---

const safeStatSize = (filePath) => {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
};

const extractFirstComment = (filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines.slice(0, 20)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') && trimmed.length > 2) {
        return trimmed.replace(/^\/\/\s*/, '');
      }
      if (trimmed.startsWith('*') && trimmed.length > 1) {
        return trimmed.replace(/^\*+\s*/, '');
      }
    }
  } catch {
    /* ignore */
  }
  return '';
};

const scanServiceDir = (root, dirName) => {
  const dirPath = path.join(root, dirName);
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.js') && !e.name.endsWith('.test.js'))
    .map((e) => {
      const filePath = path.join(dirPath, e.name);
      const comment = extractFirstComment(filePath);
      const desc = comment ? ` — ${comment}` : '';
      return `  ${dirName}/${e.name}${desc}`;
    });
};

// --- Recent Modifications ---

const collectFiles = (dirPath, files) => {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, files);
    } else if (entry.isFile()) {
      try {
        const { mtimeMs } = fs.statSync(full);
        files.push({ full, mtimeMs });
      } catch {
        /* skip */
      }
    }
  }
};

const formatRelativeTime = (mtimeMs) => {
  const diffMs = Date.now() - mtimeMs;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
};

const getRecentFiles = (root, limit) => {
  const files = [];
  collectFiles(root, files);
  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((f) => `  ${path.relative(root, f.full)} (${formatRelativeTime(f.mtimeMs)})`);
};

// --- Assembly ---

const buildSummary = (root, depth, recentLimit) => {
  const sections = [];

  sections.push('## Directory Tree');
  sections.push(renderTree(root, depth));

  const { entryPoints, configFiles } = scanRootFiles(root);
  sections.push('\n## Entry Points');
  sections.push(entryPoints.length ? entryPoints.join('\n') : '  (none found)');
  sections.push('\n## Configuration Files');
  sections.push(configFiles.length ? configFiles.join('\n') : '  (none found)');

  sections.push('\n## Core Services');
  for (const dir of SERVICE_DIRS) {
    const lines = scanServiceDir(root, dir);
    if (lines.length) sections.push(lines.join('\n'));
  }

  sections.push('\n## Recent Modifications');
  const recent = getRecentFiles(root, recentLimit);
  sections.push(recent.length ? recent.join('\n') : '  (no files found)');

  return sections.join('\n');
};

// --- Skill Implementation ---

const implementations = {
  workspace_summary: async (
    { depth = DEFAULT_DEPTH, recent_limit = DEFAULT_RECENT_LIMIT },
    _permissions,
  ) => {
    try {
      const root = path.resolve(config.workspaceDir || '.');
      return buildSummary(root, depth, recent_limit);
    } catch (e) {
      return `Error generating workspace summary: ${e.message}`;
    }
  },
};

module.exports = {
  implementations,
  _test: {
    buildTree,
    renderTree,
    isConfigFile,
    scanRootFiles,
    extractFirstComment,
    scanServiceDir,
    formatRelativeTime,
    getRecentFiles,
    buildSummary,
  },
};
