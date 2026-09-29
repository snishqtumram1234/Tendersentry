// Post-migration setup for a Supabase project (run after `prisma migrate deploy`):
//  1. sets the ts_app runtime role password from TS_APP_DB_PASSWORD
//  2. verifies the Data API lock-down (ADR-003): RLS on every public table, and anon/authenticated
//     cannot read or write any app table
//  3. verifies ts_app can connect through DATABASE_URL (the pooler) and cannot mutate audit_events
// Never prints secrets.
import pg from "pg";

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.includes("<")) throw new Error(`${name} is not set (or still has a <placeholder>) in .env`);
  return v;
}

const directUrl = required("DIRECT_URL");
const databaseUrl = required("DATABASE_URL");
const appPw = required("TS_APP_DB_PASSWORD");

// node-postgres (unlike libpq/Prisma) treats sslmode=require as "verify the full chain", which
// can false-positive on networks that intercept TLS. Strip it from the URL and set the encrypt-only
// behaviour explicitly instead, matching what Prisma already did successfully in `pnpm db:migrate`.
function stripSslMode(url: string): string {
  return url.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, "");
}
const ssl = { rejectUnauthorized: false };
const failures: string[] = [];

async function asOwner() {
  const c = new pg.Client({ connectionString: stripSslMode(directUrl), ssl });
  await c.connect();
  try {
    // 1. role password (identifier and literal are escaped by Postgres formatting)
    const { rows } = await c.query("SELECT format('ALTER ROLE ts_app WITH PASSWORD %L', $1::text) AS sql", [appPw]);
    await c.query(rows[0].sql);
    console.log("✓ ts_app password set");

    // 2a. every public table locked down
    const unlocked = await c.query("SELECT * FROM ts_private.unlocked_tables()");
    if (unlocked.rowCount) failures.push(`unlocked tables: ${unlocked.rows.map((r) => `${r.table_name}(${r.problem})`).join(", ")}`);
    else console.log("✓ RLS enabled on every public table; nothing granted to anon/authenticated");

    // 2b. anon / authenticated really cannot read or write
    const tables = (await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")).rows.map((r) => r.tablename as string);
    for (const role of ["anon", "authenticated"]) {
      const exists = (await c.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role])).rowCount;
      if (!exists) { failures.push(`role ${role} not found — is this a Supabase database?`); continue; }
      let readable = 0;
      for (const t of tables) {
        await c.query("BEGIN");
        try {
          await c.query(`SET LOCAL ROLE ${role}`);
          const r = await c.query(`SELECT count(*)::int AS n FROM public."${t}"`);
          readable++;
          failures.push(`${role} can read ${t} (${r.rows[0].n} rows visible)`);
        } catch {
          /* permission denied is the expected outcome */
        } finally {
          await c.query("ROLLBACK");
        }
      }
      if (!readable) console.log(`✓ ${role} cannot read any of ${tables.length} app tables`);
    }
  } finally {
    await c.end();
  }
}

async function asApp() {
  const c = new pg.Client({
    connectionString: stripSslMode(databaseUrl.replace(/[?&]pgbouncer=true/, "").replace(/[?&]connection_limit=\d+/, "")),
    ssl,
  });
  await c.connect();
  try {
    const who = await c.query("SELECT current_user AS u");
    console.log(`✓ runtime connection works via DATABASE_URL as ${who.rows[0].u}`);
    await c.query("BEGIN");
    try {
      await c.query("UPDATE public.audit_events SET reason = reason WHERE false");
      failures.push("ts_app can UPDATE audit_events");
    } catch {
      console.log("✓ ts_app cannot UPDATE audit_events");
    } finally {
      await c.query("ROLLBACK");
    }
  } finally {
    await c.end();
  }
}

await asOwner();
await asApp();
if (failures.length) {
  console.error("✗ Lock-down check failed:\n  - " + failures.join("\n  - "));
  process.exit(1);
}
console.log("All database setup checks passed.");
