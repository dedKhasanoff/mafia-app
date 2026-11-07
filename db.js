// YM coin balansi: Postgres (masalan, Neon). DATABASE_URL bo'lmasa, coin o'chiq.
import pg from 'pg';

export const COIN_REWARD = Number(process.env.COIN_REWARD || 20);
const DB_URL = process.env.DATABASE_URL;
export const COINS_ENABLED = !!DB_URL;

const pool = DB_URL
  ? new pg.Pool({ connectionString: DB_URL, max: 3, ssl: !/localhost|127\.0\.0\.1/.test(DB_URL) })
  : null;
pool?.on('error', (e) => console.error('Postgres:', e.message));

export async function init() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id BIGINT PRIMARY KEY,
      name TEXT NOT NULL,
      coins INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

export async function getCoins(id) {
  if (!pool) return null;
  const { rows } = await pool.query('SELECT coins FROM players WHERE id = $1', [id]);
  return rows[0]?.coins ?? 0;
}

// G'oliblarga mukofot. Qaytaradi: Map(id -> yangi balans)
export async function award(winners, amount = COIN_REWARD) {
  const result = new Map();
  if (!pool || !winners.length) return result;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const w of winners) {
      const { rows } = await client.query(
        `INSERT INTO players (id, name, coins, wins) VALUES ($1, $2, $3, 1)
         ON CONFLICT (id) DO UPDATE SET coins = players.coins + $3, wins = players.wins + 1, name = $2, updated_at = now()
         RETURNING coins`,
        [w.id, w.name, amount],
      );
      result.set(w.id, rows[0].coins);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return result;
}
