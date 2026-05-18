import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export const mapDependenciesDefinition = {
  name: 'map_dependencies',
  description:
    'Build an import dependency graph for a file or directory. Shows what a file imports (outgoing) and which files import it (incoming). Useful for understanding blast radius of a change or tracing where a function is used.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Relative path to the file to analyze, e.g. "backend/src/middleware/auth.js". For a full directory graph use directory instead.',
      },
      directory: {
        type: 'string',
        description: 'Relative path to scan all files in a directory, e.g. "backend/src". Leave empty if using file_path.',
      },
      depth: {
        type: 'number',
        description: 'How many levels of imports to follow for outgoing graph. Default: 2. Max: 4.',
      },
    },
  },
};

const EXCLUDE_DIRS = ['node_modules', '.git', 'dist', 'build', '.vite', '.cache'];
const CODE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];

function getAllSourceFiles(dirPath, fileList = []) {
  if (!fs.existsSync(dirPath)) return fileList;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.includes(entry.name) && !entry.name.startsWith('.')) {
        getAllSourceFiles(fullPath, fileList);
      }
    } else if (CODE_EXTENSIONS.includes(path.extname(entry.name))) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

// Parse all local import/require statements from file content
function parseImports(content, filePath) {
  const dir = path.dirname(filePath);
  const importRegex = /(?:import\s+.*?\s+from\s+|require\s*\(\s*)['"](\.[^'"]+)['"]/g;
  const imports = [];
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    const resolved = path.resolve(dir, importPath);

    // Try with and without extensions
    const candidates = [resolved, ...CODE_EXTENSIONS.map((e) => resolved + e)];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        imports.push(candidate);
        break;
      }
    }
  }

  return [...new Set(imports)]; // deduplicate
}

// Build outgoing graph: what does this file import (recursively up to depth)
function buildOutgoingGraph(startFile, maxDepth, visited = new Set(), depth = 0) {
  if (depth >= maxDepth || visited.has(startFile)) return {};
  if (!fs.existsSync(startFile)) return {};

  visited.add(startFile);

  let content;
  try {
    content = fs.readFileSync(startFile, 'utf-8');
  } catch {
    return {};
  }

  const imports = parseImports(content, startFile);
  const node = { imports: imports.map((f) => path.relative(config.codebasePath, f).replace(/\\/g, '/')) };

  if (depth < maxDepth - 1) {
    node.children = {};
    for (const imp of imports) {
      const relPath = path.relative(config.codebasePath, imp).replace(/\\/g, '/');
      const children = buildOutgoingGraph(imp, maxDepth, visited, depth + 1);
      if (Object.keys(children).length > 0) {
        node.children[relPath] = children;
      }
    }
    if (Object.keys(node.children).length === 0) delete node.children;
  }

  return node;
}

// Build incoming graph: which files import the target file
function buildIncomingGraph(targetFile, allFiles, codebasePath) {
  const importers = [];

  for (const filePath of allFiles) {
    if (filePath === targetFile) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const imports = parseImports(content, filePath);
      if (imports.includes(targetFile)) {
        importers.push(path.relative(codebasePath, filePath).replace(/\\/g, '/'));
      }
    } catch { /* skip */ }
  }

  return importers;
}

// Build full graph for a directory (all files, 1-level imports only)
function buildDirectoryGraph(dirPath, codebasePath) {
  const allFiles = getAllSourceFiles(dirPath);
  const graph = {};

  for (const filePath of allFiles) {
    const relPath = path.relative(codebasePath, filePath).replace(/\\/g, '/');
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const imports = parseImports(content, filePath)
        .map((f) => path.relative(codebasePath, f).replace(/\\/g, '/'));
      if (imports.length > 0) graph[relPath] = imports;
    } catch { /* skip */ }
  }

  return graph;
}

export function mapDependencies({ file_path, directory, depth = 2 }) {
  try {
    const codebasePath = config.codebasePath;
    const safeDepth = Math.min(Math.max(1, depth), 4);

    // Directory-level graph
    if (directory && !file_path) {
      const dirPath = path.join(codebasePath, directory);
      if (!fs.existsSync(dirPath)) {
        return { error: `Directory not found: ${directory}`, suggestion: 'Use list_files with directory="" to explore structure' };
      }
      const graph = buildDirectoryGraph(dirPath, codebasePath);
      return {
        mode: 'directory',
        directory,
        total_files: Object.keys(graph).length,
        dependency_graph: graph,
        tip: 'Files listed have local imports. Files not listed import nothing locally (likely entry points or leaf nodes).',
      };
    }

    if (!file_path) {
      return { error: 'Provide either file_path or directory', suggestion: 'e.g. file_path: "backend/src/middleware/auth.js"' };
    }

    const fullPath = path.join(codebasePath, file_path);
    if (!fs.existsSync(fullPath)) {
      return { error: `File not found: ${file_path}`, suggestion: 'Use list_files to verify the path exists' };
    }

    // Outgoing: what this file imports
    const outgoing = buildOutgoingGraph(fullPath, safeDepth);

    // Incoming: who imports this file
    const allFiles = getAllSourceFiles(codebasePath);
    const incoming = buildIncomingGraph(fullPath, allFiles, codebasePath);

    return {
      mode: 'file',
      file: file_path,
      outgoing_depth: safeDepth,
      outgoing_imports: outgoing.imports ?? [],
      outgoing_graph: outgoing.children ?? {},
      incoming_importers: incoming,
      incoming_count: incoming.length,
      total_files_scanned: allFiles.length,
      summary: `"${file_path}" imports ${outgoing.imports?.length ?? 0} file(s) locally and is imported by ${incoming.length} file(s).`,
    };
  } catch (err) {
    return {
      error: err.message,
      suggestion: 'Check the file_path is a valid relative path within the TIQ codebase',
    };
  }
}
