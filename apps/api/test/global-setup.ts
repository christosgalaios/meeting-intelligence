import pg from 'pg';

// The API tests need a real Postgres with pgvector. Without one, every DB test fails with a bare
// ECONNREFUSED, so check once up front and say how to start it.
export default async function checkDatabase(): Promise<void> {
  const url = process.env.DATABASE_URL ?? 'postgres://meetings:meetings@localhost:5432/meetings';
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } catch (err) {
    const code = (err as { code?: string }).code;
    const reason = (err instanceof Error && err.message) || code || String(err);
    throw new Error(
      `The API tests need Postgres with pgvector, and none answered at ${url.replace(/:[^:@/]+@/, ':***@')} (${reason}). ` +
        'Start it with `docker compose up -d db`, then run the tests again.',
      { cause: err },
    );
  } finally {
    await client.end().catch(() => {});
  }
}
