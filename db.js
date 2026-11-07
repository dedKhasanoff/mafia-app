// YM coin balansi: Postgres (masalan, Neon). DATABASE_URL bo'lmasa, coin o'chiq.
import pg from 'pg';

export const COIN_REWARD = Number(process.env.COIN_REWARD || 20);

// Do'kon: kalit = bazadagi ustun nomi
export const SHOP = {
  shield: { name: '🛡 Himoya', price: 100, info: "Tunda sizga suiqasd qilinsa, omon qolasiz. Bir marta ishlaydi." },
  fake_doc: { name: '📄 Soxta hujjat', price: 150, info: "Komissar tekshirsa, sizni tinch aholi tomonidagi rol qilib ko'rsatadi. Bir marta ishlaydi." },
  escape: { name: '🎟 Osilishdan qutulish', price: 150, info: "Kunduzi osishga qaror qilinsa, omon qolasiz. Bir marta ishlaydi." },
};
const ITEMS = Object.keys(SHOP);
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
  await pool.query(`
    ALTER TABLE players
      ADD COLUMN IF NOT EXISTS shield INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS fake_doc INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS escape INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS first_night_streak INTEGER NOT NULL DEFAULT 0`);
}

const toProfile = (row) => ({
  coins: row?.coins ?? 0,
  items: Object.fromEntries(ITEMS.map((k) => [k, row?.[k] ?? 0])),
  streak: row?.first_night_streak ?? 0,
});

// Balans, buyumlar va 1-tun hisoblagichi
export async function getProfile(id) {
  if (!pool) return null;
  const { rows } = await pool.query('SELECT * FROM players WHERE id = $1', [id]);
  return toProfile(rows[0]);
}

export class ShopError extends Error {}

// Sotib olish: coin yetsa ayiramiz va buyumni qo'shamiz (bitta so'rovda, ikki marta bosilsa ham xavfsiz)
export async function buy(id, item) {
  if (!pool) throw new ShopError("Do'kon hali yoqilmagan");
  if (!ITEMS.includes(item)) throw new ShopError("Bunday buyum yo'q");
  const { price } = SHOP[item];
  const { rows } = await pool.query(
    `UPDATE players SET coins = coins - $2, ${item} = ${item} + 1, updated_at = now()
     WHERE id = $1 AND coins >= $2 RETURNING *`,
    [id, price],
  );
  if (!rows.length) throw new ShopError(`YM coin yetmaydi: ${price} YM kerak`);
  return toProfile(rows[0]);
}

export async function useItem(id, item) {
  if (!pool || !ITEMS.includes(item)) return null;
  const { rows } = await pool.query(
    `UPDATE players SET ${item} = GREATEST(${item} - 1, 0), updated_at = now() WHERE id = $1 RETURNING *`,
    [id],
  );
  return rows[0] ? toProfile(rows[0]) : null;
}

// 1-tundan keyin: o'ldirilganlarga +1, qolganlarga 0
export async function setStreaks(list) {
  if (!pool) return;
  for (const { id, name, killed } of list) {
    await pool.query(
      `INSERT INTO players (id, name, first_night_streak) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET first_night_streak = CASE WHEN $3 = 1 THEN players.first_night_streak + 1 ELSE 0 END, name = $2`,
      [id, name, killed ? 1 : 0],
    );
  }
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
