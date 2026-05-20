import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { getAllFiles, toRel, CODE_EXTS } from '../utils/fs.js';

export const schemaToApiDefinition = {
  name: 'schema_to_api',
  description:
    'Given a Mongoose model name, check which standard CRUD operations (GET list, GET by ID, POST create, PUT update, DELETE) are implemented and which are missing. Scans all route and controller files. Great for finding gaps when adding a new model.',
  input_schema: {
    type: 'object',
    properties: {
      model_name: {
        type: 'string',
        description: 'Mongoose model name to check, e.g. "Track", "Module", "Task", "Submission", "Certificate"',
      },
    },
    required: ['model_name'],
  },
};

// Each op has a verb pattern. MODEL is replaced with the actual model name at runtime.
const CRUD_OPS = [
  { name: 'GET list',    method: 'GET',    verbPattern: '(get|list|fetch|find).{0,20}MODELs?\\b' },
  { name: 'GET by ID',   method: 'GET',    verbPattern: '(get|find).{0,20}MODEL.{0,10}(by)?[Ii]d' },
  { name: 'POST create', method: 'POST',   verbPattern: '(create|add|insert).{0,20}MODEL' },
  { name: 'PUT update',  method: 'PUT',    verbPattern: '(update|edit|put|patch).{0,20}MODEL' },
  { name: 'DELETE',      method: 'DELETE', verbPattern: '(delete|remove|destroy).{0,20}MODEL' },
];

function makePattern(verbPattern, modelName) {
  return new RegExp(verbPattern.replace(/MODEL/g, modelName), 'i');
}

function collectRouteControllerContent(codebasePath) {
  return getAllFiles(codebasePath, CODE_EXTS)
    .filter(f => /route|router|controller|handler/i.test(f))
    .map(f => { try { return fs.readFileSync(f, 'utf-8'); } catch { return ''; } })
    .join('\n');
}

function findModelFile(codebasePath, modelName) {
  const lower = modelName.toLowerCase();
  const found = getAllFiles(codebasePath, CODE_EXTS).find(f => {
    const base = path.basename(f, path.extname(f)).toLowerCase();
    return base === lower || base === `${lower}.model` || base === `${lower}.schema`;
  });
  return found ? toRel(found, codebasePath) : null;
}

export function schemaToApi({ model_name } = {}) {
  try {
    if (!model_name?.trim()) {
      return { error: 'model_name is required', suggestion: 'e.g. "Track", "Module", "Task"' };
    }

    const combined = collectRouteControllerContent(config.codebasePath);
    const modelFile = findModelFile(config.codebasePath, model_name);

    const operations = CRUD_OPS.map(op => ({
      operation: op.name,
      method: op.method,
      status: makePattern(op.verbPattern, model_name).test(combined) ? 'found' : 'missing',
    }));

    return {
      model: model_name,
      model_file: modelFile ?? 'not found — check model name spelling',
      operations,
      missing: operations.filter(o => o.status === 'missing').map(o => `${o.method} ${o.name}`),
      found_count: operations.filter(o => o.status === 'found').length,
      scannedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { error: err.message, suggestion: 'Verify the model name and codebase path' };
  }
}
