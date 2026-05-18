import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export const explainRouteDefinition = {
  name: 'explain_route',
  description:
    'Given an Express route path (e.g. "/api/auth/login") or a route file path, traces the complete request flow: router → middleware → controller → service → model. Returns all relevant code so Claude can explain the full pipeline.',
  input_schema: {
    type: 'object',
    properties: {
      route_path: {
        type: 'string',
        description: 'The API route to trace, e.g. "/api/auth/login" or "/api/tracks/:id/modules".',
      },
      method: {
        type: 'string',
        description: 'HTTP method: GET, POST, PUT, DELETE, PATCH. Default: any.',
        enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'any'],
      },
      route_file: {
        type: 'string',
        description: 'Optional: directly specify the routes file, e.g. "backend/src/routes/auth.routes.js". Skips auto-discovery.',
      },
    },
    required: ['route_path'],
  },
};

const EXCLUDE_DIRS = ['node_modules', '.git', 'dist', 'build'];
const CODE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs'];

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

function readFileSafe(fullPath) {
  try {
    const stats = fs.statSync(fullPath);
    if (stats.size > 80 * 1024) return null; // skip huge files
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

// Normalize route path for comparison: remove leading slash, lowercase
function normalizeRoute(r) {
  return r.replace(/^\//, '').toLowerCase();
}

// Find route definition lines in a routes file
function findRouteInFile(content, routePath, method) {
  const lines = content.split('\n');
  const results = [];
  const normalTarget = normalizeRoute(routePath);
  const methodLower = method === 'any' ? null : method.toLowerCase();

  // Match patterns like: router.post('/login', ...) or router.get('/:id', ...)
  const routeRegex = /router\s*\.\s*(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  let match;
  while ((match = routeRegex.exec(content)) !== null) {
    const matchMethod = match[1].toLowerCase();
    const matchPath = match[2];

    // Normalize match path: convert :params to wildcards for comparison
    const normalMatch = normalizeRoute(matchPath).replace(/:[^/]+/g, ':param');
    const normalTarget2 = normalTarget.replace(/:[^/]+/g, ':param');

    const pathMatches = normalMatch === normalTarget2
      || normalTarget2.endsWith(normalMatch)
      || normalMatch.endsWith(normalTarget2);

    const methodMatches = !methodLower || matchMethod === methodLower;

    if (pathMatches && methodMatches) {
      // Find line number
      const before = content.slice(0, match.index);
      const lineNum = before.split('\n').length;
      results.push({ method: matchMethod.toUpperCase(), path: matchPath, line: lineNum });
    }
  }

  return results;
}

// Extract handler names from route definition (middleware + controller functions)
function extractHandlerNames(content, lineNum) {
  const lines = content.split('\n');
  // Get the route line and up to 5 continuation lines
  const routeBlock = lines.slice(lineNum - 1, lineNum + 5).join('\n');

  const handlerRegex = /\b([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)?)\s*(?:[,)])/g;
  const handlers = [];
  let m;

  while ((m = handlerRegex.exec(routeBlock)) !== null) {
    const name = m[1];
    // Skip common non-handler keywords
    if (!['router', 'app', 'get', 'post', 'put', 'delete', 'patch', 'use', 'true', 'false', 'null', 'undefined'].includes(name.toLowerCase())) {
      handlers.push(name);
    }
  }

  return [...new Set(handlers)];
}

// Search for a function definition in files
function findFunctionDefinition(funcName, files, codebasePath) {
  // Handle dot notation: "authController.login" → look for both
  const parts = funcName.split('.');
  const searchName = parts[parts.length - 1];

  const results = [];

  for (const filePath of files) {
    const content = readFileSafe(filePath);
    if (!content) continue;

    // Match: export async function login, login =, exports.login =, login:
    const patterns = [
      new RegExp(`(?:export\\s+(?:async\\s+)?function\\s+${searchName}|const\\s+${searchName}\\s*=|exports\\.${searchName}\\s*=|${searchName}\\s*:)`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(content);
      if (match) {
        const before = content.slice(0, match.index);
        const lineNum = before.split('\n').length;
        const lines = content.split('\n');
        const snippet = lines.slice(Math.max(0, lineNum - 1), lineNum + 15).join('\n');
        const relPath = path.relative(codebasePath, filePath).replace(/\\/g, '/');
        results.push({ file: relPath, line: lineNum, snippet });
        break;
      }
    }

    if (results.length >= 3) break; // cap per function
  }

  return results;
}

// Find route registration in main app/index file
function findRouteRegistration(routePath, files, codebasePath) {
  const segment = routePath.split('/').filter(Boolean)[1]; // e.g. "auth" from "/api/auth/login"
  if (!segment) return null;

  for (const filePath of files) {
    const name = path.basename(filePath);
    if (!['app.js', 'index.js', 'server.js', 'main.js', 'routes.js'].includes(name)) continue;

    const content = readFileSafe(filePath);
    if (!content) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(segment) && lines[i].includes('use(')) {
        const relPath = path.relative(codebasePath, filePath).replace(/\\/g, '/');
        return { file: relPath, line: i + 1, content: lines[i].trim() };
      }
    }
  }

  return null;
}

export function explainRoute({ route_path, method = 'any', route_file }) {
  try {
    const codebasePath = config.codebasePath;
    const allFiles = getAllSourceFiles(codebasePath);

    // 1. Find the routes file
    let routesFileResults = [];
    let routeFilePath = null;

    if (route_file) {
      // User specified directly
      const fullPath = path.join(codebasePath, route_file);
      const content = readFileSafe(fullPath);
      if (!content) return { error: `Cannot read route file: ${route_file}` };
      const matches = findRouteInFile(content, route_path, method);
      if (matches.length > 0) {
        routesFileResults = matches.map((m) => ({ ...m, file: route_file, content: content.slice(0, 2000) }));
        routeFilePath = fullPath;
      }
    } else {
      // Auto-discover: search route files
      const routeFiles = allFiles.filter((f) => {
        const name = path.basename(f).toLowerCase();
        return name.includes('route') || name.includes('router');
      });

      for (const filePath of routeFiles) {
        const content = readFileSafe(filePath);
        if (!content) continue;
        const matches = findRouteInFile(content, route_path, method);
        if (matches.length > 0) {
          const relPath = path.relative(codebasePath, filePath).replace(/\\/g, '/');
          routesFileResults = matches.map((m) => ({ ...m, file: relPath }));
          routeFilePath = filePath;
          break;
        }
      }
    }

    // 2. Find route registration in app.js/server.js
    const registration = findRouteRegistration(route_path, allFiles, codebasePath);

    // 3. Find handler function definitions
    const handlerDefinitions = {};
    if (routeFilePath) {
      const content = readFileSafe(routeFilePath);
      if (content && routesFileResults.length > 0) {
        const handlers = extractHandlerNames(content, routesFileResults[0].line);
        for (const handler of handlers.slice(0, 5)) {
          const defs = findFunctionDefinition(handler, allFiles, codebasePath);
          if (defs.length > 0) handlerDefinitions[handler] = defs;
        }
      }
    }

    // 4. Find middleware files (auth, validation, etc.) referenced
    const middlewareFiles = {};
    const middlewareKeywords = ['authenticate', 'authorize', 'validate', 'csrf', 'rateLimit', 'protect'];
    for (const kw of middlewareKeywords) {
      const middlewareMatches = allFiles
        .filter((f) => {
          const content = readFileSafe(f);
          return content && content.includes(kw) && path.basename(f).toLowerCase().includes('middleware');
        })
        .map((f) => path.relative(codebasePath, f).replace(/\\/g, '/'));
      if (middlewareMatches.length > 0) middlewareFiles[kw] = middlewareMatches[0];
    }

    const found = routesFileResults.length > 0;

    return {
      route: route_path,
      method: method === 'any' ? 'any' : method.toUpperCase(),
      found,
      route_definitions: routesFileResults,
      app_registration: registration,
      handler_definitions: handlerDefinitions,
      related_middleware: middlewareFiles,
      tip: found
        ? 'Use read_file on the handler files listed in handler_definitions to see the full implementation.'
        : `Route "${route_path}" not found in route files. Try search_code with the route segment as keyword.`,
    };
  } catch (err) {
    return {
      error: err.message,
      suggestion: 'Ensure the TIQ codebase path is set correctly and the route path format is valid',
    };
  }
}
