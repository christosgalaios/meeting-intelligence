import pg from 'pg';

export type Pool = pg.Pool;

// `schema` is only used by tests: each test file gets its own schema via search_path.
// `public` stays on the path so the pgvector type resolves.
export function createPool(databaseUrl: string, schema?: string): Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    ...(schema ? { options: `-c search_path=${schema},public` } : {}),
  });
}
