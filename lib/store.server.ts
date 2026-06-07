import { promises as fs } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import type { OrderRow, ParserRule, StoredOrderRecord, StoredRuleRecord } from "./types";

interface LocalStore {
  rules: StoredRuleRecord[];
  orders: StoredOrderRecord[];
}

let pool: Pool | undefined;
let schemaReady = false;

function databaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
}

function localStorePath() {
  return path.join(process.cwd(), "data", "store.json");
}

function getPool() {
  if (!databaseUrl()) {
    return undefined;
  }
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl(),
      ssl: databaseUrl().includes("localhost") ? undefined : { rejectUnauthorized: false },
      max: 3
    });
  }
  return pool;
}

async function ensureSchema() {
  const pg = getPool();
  if (!pg || schemaReady) {
    return;
  }
  await pg.query(`
    create table if not exists parser_rules (
      id text primary key,
      rule jsonb not null,
      updated_at timestamptz not null default now()
    );
  `);
  await pg.query(`
    create table if not exists imported_orders (
      id text primary key,
      row_data jsonb not null,
      external_code text not null,
      recipient_name text,
      submitted_at timestamptz not null default now()
    );
  `);
  await pg.query(`
    create index if not exists imported_orders_search_idx
    on imported_orders (external_code, recipient_name, submitted_at desc);
  `);
  schemaReady = true;
}

async function readLocalStore(): Promise<LocalStore> {
  await fs.mkdir(path.dirname(localStorePath()), { recursive: true });
  try {
    const raw = await fs.readFile(localStorePath(), "utf8");
    return JSON.parse(raw) as LocalStore;
  } catch {
    return { rules: [], orders: [] };
  }
}

async function writeLocalStore(store: LocalStore) {
  await fs.mkdir(path.dirname(localStorePath()), { recursive: true });
  await fs.writeFile(localStorePath(), JSON.stringify(store, null, 2), "utf8");
}

export async function listRules() {
  const pg = getPool();
  if (pg) {
    await ensureSchema();
    const result = await pg.query<StoredRuleRecord>(
      "select id, rule, updated_at as \"updatedAt\" from parser_rules order by updated_at desc"
    );
    return result.rows.map((row) => row.rule);
  }
  const store = await readLocalStore();
  return store.rules
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((record) => record.rule);
}

export async function upsertRule(rule: ParserRule) {
  const updated = { ...rule, updatedAt: new Date().toISOString() };
  const pg = getPool();
  if (pg) {
    await ensureSchema();
    await pg.query(
      `
      insert into parser_rules (id, rule, updated_at)
      values ($1, $2, now())
      on conflict (id) do update set rule = excluded.rule, updated_at = now()
      `,
      [updated.id, updated]
    );
    return updated;
  }
  const store = await readLocalStore();
  const next = store.rules.filter((record) => record.id !== updated.id);
  next.push({ id: updated.id, rule: updated, updatedAt: updated.updatedAt });
  await writeLocalStore({ ...store, rules: next });
  return updated;
}

export async function deleteRule(id: string) {
  const pg = getPool();
  if (pg) {
    await ensureSchema();
    await pg.query("delete from parser_rules where id = $1", [id]);
    return;
  }
  const store = await readLocalStore();
  await writeLocalStore({ ...store, rules: store.rules.filter((record) => record.id !== id) });
}

export async function listOrders(query = "", page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;
  const pg = getPool();
  if (pg) {
    await ensureSchema();
    const like = `%${query}%`;
    const params = query ? [like, pageSize, offset] : [pageSize, offset];
    const where = query ? "where external_code ilike $1 or coalesce(recipient_name, '') ilike $1" : "";
    const result = await pg.query<{ row: OrderRow; total: string }>(
      `
      select row_data as row, count(*) over() as total
      from imported_orders
      ${where}
      order by submitted_at desc
      limit $${query ? 2 : 1}
      offset $${query ? 3 : 2}
      `,
      params
    );
    return {
      rows: result.rows.map((item) => item.row),
      total: Number(result.rows[0]?.total ?? 0)
    };
  }

  const store = await readLocalStore();
  const filtered = store.orders
    .map((record) => record.row)
    .filter((row) => {
      if (!query) return true;
      return `${row.externalCode} ${row.recipientName} ${row.storeName}`.toLowerCase().includes(query.toLowerCase());
    })
    .sort((a, b) => String(b.submittedAt ?? "").localeCompare(String(a.submittedAt ?? "")));

  return {
    rows: filtered.slice(offset, offset + pageSize),
    total: filtered.length
  };
}

export async function saveOrders(rows: OrderRow[]) {
  const submittedAt = new Date().toISOString();
  const prepared = rows.map((row) => ({
    ...row,
    submittedAt
  }));
  const pg = getPool();
  if (pg) {
    await ensureSchema();
    const client = await pg.connect();
    try {
      await client.query("begin");
      for (const row of prepared) {
        await client.query(
          `
          insert into imported_orders (id, row_data, external_code, recipient_name, submitted_at)
          values ($1, $2, $3, $4, $5)
          on conflict (id) do update
          set row_data = excluded.row_data,
              external_code = excluded.external_code,
              recipient_name = excluded.recipient_name,
              submitted_at = excluded.submitted_at
          `,
          [row.id, row, row.externalCode, row.recipientName, submittedAt]
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return prepared;
  }

  const store = await readLocalStore();
  const existing = new Map(store.orders.map((record) => [record.id, record]));
  prepared.forEach((row) => {
    existing.set(row.id, { id: row.id, row, submittedAt });
  });
  await writeLocalStore({ ...store, orders: Array.from(existing.values()) });
  return prepared;
}

export async function existingExternalCodes() {
  const pg = getPool();
  if (pg) {
    await ensureSchema();
    const result = await pg.query<{ external_code: string }>("select distinct external_code from imported_orders");
    return result.rows.map((row) => row.external_code);
  }
  const store = await readLocalStore();
  return Array.from(new Set(store.orders.map((record) => record.row.externalCode).filter(Boolean)));
}
