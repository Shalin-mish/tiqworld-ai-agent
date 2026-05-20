import pg from 'pg';
import { config } from '../config.js';

const { Client } = pg;

export const dbQueryDefinition = {
  name: 'db_query',
  description:
    'Run a read-only SQL SELECT query against the TIQ World dev PostgreSQL database (requires SSM tunnel on localhost:5433). Use to answer questions about intern progress, track enrollments, submissions, assessments, and certificates. Only SELECT statements are permitted.',
  input_schema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'A read-only SQL SELECT statement. Examples: "SELECT COUNT(*) FROM interns", "SELECT name, status FROM tracks ORDER BY created_at DESC LIMIT 10".',
      },
      description: {
        type: 'string',
        description: 'Plain English description of what you are trying to find out — shown in logs.',
      },
    },
    required: ['sql'],
  },
};

// Keywords that indicate a write operation — block them unconditionally.
const WRITE_RE = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|REPLACE|MERGE|CALL|EXEC)\b/i;

export async function dbQuery({ sql, description = '' } = {}) {
  if (!sql?.trim()) return { error: 'sql is required' };

  if (WRITE_RE.test(sql)) {
    const match = WRITE_RE.exec(sql);
    return {
      error: `Write operations are not permitted. Blocked keyword: ${match?.[1]?.toUpperCase()}`,
      suggestion: 'Only SELECT statements are allowed',
    };
  }

  if (!config.dbUrl) {
    return {
      error: 'DB_URL not configured',
      suggestion: 'Add DB_URL=postgresql://user:pass@localhost:5433/dbname to your .env file and ensure the SSM tunnel is running',
    };
  }

  const client = new Client({ connectionString: config.dbUrl, connectionTimeoutMillis: 5000 });

  try {
    await client.connect();

    // Enforce read-only at the session level.
    await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');

    const start  = Date.now();
    const result = await client.query(sql);
    const ms     = Date.now() - start;

    return {
      ...(description && { description }),
      sql,
      row_count: result.rowCount,
      columns: result.fields.map(f => f.name),
      rows: result.rows.slice(0, 100),
      truncated: result.rows.length > 100,
      duration_ms: ms,
      executedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      error: err.message,
      suggestion: 'Check that the SSM tunnel is running on localhost:5433 and DB_URL is correct',
    };
  } finally {
    await client.end().catch(() => {});
  }
}
