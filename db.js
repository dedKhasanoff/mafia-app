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

// Kunlik bonus (YM)
export const DAILY_BONUS = Number(process.env.DAILY_BONUS || 10);
// YM coin paketlari Telegram Stars'ga: COIN_PACKS="50:100,100:250,250:700" (stars:coin)
export const COIN_PACKS = (process.env.COIN_PACKS || '50:100,100:250,250:700').split(',')
  .map((x) => x.split(':').map(Number))
  .filter(([stars, coins]) => stars > 0 && coins > 0)
  .map(([stars, coins], i) => ({ id: i, stars, coins }));
// Kunlik bonus sanasi Toshkent vaqti bilan
const TODAY = "(now() AT TIME ZONE 'Asia/Tashkent')::date";
const BONUS_TAKEN = `(last_bonus IS NOT DISTINCT FROM ${TODAY}) AS bonus_taken`;
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
  await pool.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS last_bonus DATE');
  // Guruh bo'yicha g'alabalar (/top uchun)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_wins (
      chat_id BIGINT NOT NULL,
      player_id BIGINT NOT NULL,
      name TEXT NOT NULL,
      wins INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (chat_id, player_id)
    )`);
  // Stars to'lovlari: bir to'lov ikki marta hisoblanmasligi uchun
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      charge_id TEXT PRIMARY KEY,
      player_id BIGINT NOT NULL,
      stars INTEGER NOT NULL,
      coins INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // Guruh sozlamalari (/sozlamalar)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_settings (
      chat_id BIGINT PRIMARY KEY,
      settings JSONB NOT NULL DEFAULT '{}'
    )`);
  // Har bir rolda nechta g'alaba
  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_wins (
      player_id BIGINT NOT NULL,
      role TEXT NOT NULL,
      wins INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (player_id, role)
    )`);
}

const toProfile = (row, stats = {}) => ({
  stats, // { rol: g'alabalar soni }
  coins: row?.coins ?? 0,
  bonusTaken: !!row?.bonus_taken, // bugungi bonus olinganmi
  items: Object.fromEntries(ITEMS.map((k) => [k, row?.[k] ?? 0])),
  streak: row?.first_night_streak ?? 0,
});

// Balans, buyumlar va 1-tun hisoblagichi
export async function getProfile(id) {
  if (!pool) return null;
  const [{ rows }, wins] = await Promise.all([
    pool.query(`SELECT *, ${BONUS_TAKEN} FROM players WHERE id = $1`, [id]),
    pool.query('SELECT role, wins FROM role_wins WHERE player_id = $1', [id]),
  ]);
  return toProfile(rows[0], Object.fromEntries(wins.rows.map((r) => [r.role, r.wins])));
}

export class ShopError extends Error {}

// Sotib olish: coin yetsa ayiramiz va buyumni qo'shamiz (bitta so'rovda, ikki marta bosilsa ham xavfsiz)
export async function buy(id, item) {
  if (!pool) throw new ShopError("Do'kon hali yoqilmagan");
  if (!ITEMS.includes(item)) throw new ShopError("Bunday buyum yo'q");
  const { price } = SHOP[item];
  const { rows } = await pool.query(
    `UPDATE players SET coins = coins - $2, ${item} = ${item} + 1, updated_at = now()
     WHERE id = $1 AND coins >= $2 RETURNING *, ${BONUS_TAKEN}`,
    [id, price],
  );
  if (!rows.length) throw new ShopError(`YM coin yetmaydi: ${price} YM kerak`);
  return toProfile(rows[0]);
}

export async function useItem(id, item) {
  if (!pool || !ITEMS.includes(item)) return null;
  const { rows } = await pool.query(
    `UPDATE players SET ${item} = GREATEST(${item} - 1, 0), updated_at = now() WHERE id = $1 RETURNING *, ${BONUS_TAKEN}`,
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
export async function award(winners, amount = COIN_REWARD, chatId = null) {
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
      if (chatId != null && /^-?\d+$/.test(String(chatId))) {
        await client.query(
          `INSERT INTO group_wins (chat_id, player_id, name, wins) VALUES ($1, $2, $3, 1)
           ON CONFLICT (chat_id, player_id) DO UPDATE SET wins = group_wins.wins + 1, name = $3`,
          [chatId, w.id, w.name],
        );
      }
      if (w.role) {
        await client.query(
          `INSERT INTO role_wins (player_id, role, wins) VALUES ($1, $2, 1)
           ON CONFLICT (player_id, role) DO UPDATE SET wins = role_wins.wins + 1`,
          [w.id, w.role],
        );
      }
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

// Kunlik bonus: kuniga bir marta. Qaytaradi: yangi balans yoki null (bugun olingan)
export async function claimBonus(id, name) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `INSERT INTO players (id, name, coins, last_bonus) VALUES ($1, $2, $3, ${TODAY})
     ON CONFLICT (id) DO UPDATE SET coins = players.coins + $3, last_bonus = ${TODAY}, name = $2, updated_at = now()
     WHERE players.last_bonus IS DISTINCT FROM ${TODAY}
     RETURNING coins`,
    [id, name, DAILY_BONUS],
  );
  return rows[0]?.coins ?? null;
}

// Stars bilan coin sotib olish. Bir xil to'lov (charge_id) qayta kelsa, ikkinchi marta qo'shilmaydi.
// Qaytaradi: yangi balans yoki null (allaqachon hisoblangan)
export async function addPurchasedCoins(chargeId, id, name, stars, coins) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      'INSERT INTO payments (charge_id, player_id, stars, coins) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING charge_id',
      [chargeId, id, stars, coins],
    );
    if (!ins.rows.length) { await client.query('ROLLBACK'); return null; }
    const { rows } = await client.query(
      `INSERT INTO players (id, name, coins) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET coins = players.coins + $3, name = $2, updated_at = now() RETURNING coins`,
      [id, name, coins],
    );
    await client.query('COMMIT');
    return rows[0].coins;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Reyting: guruhda yoki (chatId bo'lmasa) umumiy
export async function top(chatId = null, limit = 10) {
  if (!pool) return [];
  const { rows } = chatId != null
    ? await pool.query('SELECT name, wins FROM group_wins WHERE chat_id = $1 AND wins > 0 ORDER BY wins DESC, name LIMIT $2', [chatId, limit])
    : await pool.query('SELECT name, wins, coins FROM players WHERE wins > 0 ORDER BY wins DESC, coins DESC LIMIT $1', [limit]);
  return rows;
}

export async function getSettings(chatId) {
  if (!pool) return null;
  const { rows } = await pool.query('SELECT settings FROM group_settings WHERE chat_id = $1', [chatId]);
  return rows[0]?.settings || null;
}

export async function saveSettings(chatId, settings) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO group_settings (chat_id, settings) VALUES ($1, $2)
     ON CONFLICT (chat_id) DO UPDATE SET settings = $2`,
    [chatId, JSON.stringify(settings)],
  );
}
