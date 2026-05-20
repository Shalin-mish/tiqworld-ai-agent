import { getLog } from '../session.js';

export const recallSessionDefinition = {
  name: 'recall_session',
  description:
    'Returns a summary of all tool calls made in the current session — which files were read, what searches ran, which files were written. Use this before repeating a tool call to check if you already have the answer.',
  input_schema: {
    type: 'object',
    properties: {
      filter_tool: {
        type: 'string',
        description: 'Optional: only return calls for this tool name e.g. "read_file". Omit for all.',
      },
    },
  },
};

export function recallSession({ filter_tool } = {}) {
  const entries = getLog();
  const filtered = filter_tool
    ? entries.filter(e => e.tool === filter_tool)
    : entries;

  if (!filtered.length) {
    return { message: 'No tool calls recorded yet in this session.', entries: [] };
  }

  return {
    total_calls: filtered.length,
    entries: filtered,
  };
}
