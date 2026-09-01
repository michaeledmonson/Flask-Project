// Postgres access. One pool, plain SQL, no ORM (DESIGN.md §11).
//
// `@neondatabase/serverless` speaks the Postgres wire protocol over a WebSocket, so
// it works both against Neon in production and against any Postgres reachable
// through a WebSocket proxy in local development.

import { Pool, neonConfig } from "@neondatabase/serverless";

// Node 22+ and the Vercel runtime both ship a global WebSocket; the driver picks it
// up automatically. Local plain-TCP Postgres needs the handshake unencrypted.
if (process.env.NEON_LOCAL_WS === "1") {
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineConnect = false;
  if (process.env.NEON_WS_PROXY) {
    const proxy = process.env.NEON_WS_PROXY;
    neonConfig.wsProxy = () => proxy;
  }
}

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

/**
 * Run a parameterized query and return its rows.
 *
 *   const rows = await query<OutbreakRow>("SELECT * FROM outbreaks WHERE id = $1", [id]);
 */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query(text, params);
  return result.rows as T[];
}

/** Run `fn` inside a transaction, rolling back if it throws. */
export async function transaction<T>(
  fn: (run: <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(async (text, params = []) => {
      const r = await client.query(text, params);
      return r.rows as never[];
    });
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
