// Guruh obunasi: Telegram Stars orqali oylik to'lov.
// Ma'lumotlar bazasi kerak emas: server ishga tushganda to'lovlar Telegram'dan qayta o'qiladi.

export const SUB_PRICE = Number(process.env.SUB_PRICE || 500); // Stars, oyiga
export const SUB_PERIOD = 30 * 24 * 3600; // Telegram faqat 30 kunlik obunani qo'llaydi
// SUBSCRIPTION=0 bo'lsa obuna o'chiriladi va hamma bepul o'ynaydi
export const SUBS_ENABLED = process.env.SUBSCRIPTION !== '0';
// Bepul guruhlar (masalan, o'zingizning sinov guruhingiz): FREE_GROUPS=-100123,-100456
const FREE_GROUPS = new Set((process.env.FREE_GROUPS || '').split(',').map((s) => s.trim()).filter(Boolean));

const expiry = new Map(); // chatId (string) -> obuna tugash vaqti (ms)

export const payloadFor = (chatId) => `grp:${chatId}`;

function parsePayload(payload) {
  const m = /^grp:(-?\d+)$/.exec(payload || '');
  return m ? m[1] : null;
}

export function isFree(chatId) {
  return !SUBS_ENABLED || FREE_GROUPS.has(String(chatId));
}

export function isActive(chatId) {
  return isFree(chatId) || (expiry.get(String(chatId)) || 0) > Date.now();
}

export function expiresAt(chatId) {
  return expiry.get(String(chatId)) || null;
}

// To'lov kelganda: guruh obunasini uzaytiramiz. Qaytaradi: guruh ID yoki null.
export function record(payload, expiresSec) {
  const chatId = parsePayload(payload);
  if (!chatId) return null;
  const until = expiresSec * 1000;
  if (until > (expiry.get(chatId) || 0)) expiry.set(chatId, until);
  return chatId;
}

export function validPayload(payload) {
  return parsePayload(payload) != null;
}

// Server qayta ishga tushganda barcha Stars to'lovlarini o'qib, obunalarni tiklaymiz.
export async function loadFromTelegram(api) {
  const txs = [];
  for (let offset = 0; ; offset += 100) {
    const res = await api.raw.getStarTransactions({ offset, limit: 100 });
    txs.push(...res.transactions);
    if (res.transactions.length < 100) break;
  }
  // Qaytarilgan (refund) to'lovlar asl to'lov bilan bir xil ID'ga ega
  const refunded = new Set(txs.filter((t) => t.receiver?.type === 'user').map((t) => t.id));
  let n = 0;
  for (const t of txs) {
    const src = t.source;
    if (src?.type !== 'user' || !src.subscription_period || refunded.has(t.id)) continue;
    if (record(src.invoice_payload, t.date + src.subscription_period)) n++;
  }
  return n;
}

// Toshkent vaqti bilan sana: 07.12.2026
export function formatDate(ms) {
  const d = new Date(ms + 5 * 3600 * 1000);
  const two = (x) => String(x).padStart(2, '0');
  return `${two(d.getUTCDate())}.${two(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}
