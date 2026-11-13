// Shaxsiy geroy: daraja, kuch va himoya qoidalari. Baza yoki Telegram haqida hech narsa bilmaydi.

// Daraja chegaralari (ball): 1-daraja 0 dan, 2-daraja 1100 dan va hokazo
export const LEVELS = [0, 1100, 3000, 6000, 10000, 15000, 21000, 28000, 36000, 45000];
export const POINTS_PLAY = 50;   // har bir o'yin uchun
export const POINTS_WIN = 100;   // g'alaba uchun qo'shimcha
export const DEFENSE_DAYS = 7;   // himoya shuncha kun amal qiladi
export const CHARGE_PACK = 3;    // bir zaryadlashda qo'shiladigan o'q
export const POINTS_PER_YM = 1;    // do'konda sarflangan har 1 YM uchun
export const POINTS_PER_STAR = 10; // Stars bilan coin sotib olganda har 1⭐ uchun

// Do'kon narxlari (YM coin)
export const HERO_SHOP = {
  points: { name: '➕ 1000 ball', price: 1000 },
  defense: { name: '🛡 Himoyani yangilash', price: 300 },
  charge: { name: `🩸 Qurolni zaryadlash (+${CHARGE_PACK})`, price: 400 },
  rename: { name: "🖋 Nomni o'zgartirish", price: 2000 },
};

export function levelOf(points) {
  let lvl = 1;
  for (let i = 0; i < LEVELS.length; i++) if (points >= LEVELS[i]) lvl = i + 1;
  return lvl;
}
export const powerRange = (lvl) => [40 + (lvl - 1) * 10, 46 + (lvl - 1) * 10];
export const maxDefense = (lvl) => 30 + (lvl - 1) * 20;
export const nextLevelAt = (lvl) => LEVELS[lvl] ?? null; // keyingi daraja uchun kerakli ball (yoki null — eng yuqori)
export const rollPower = ([min, max]) => min + Math.floor(Math.random() * (max - min + 1));

// Ism: 2–20 belgi, harf/raqam/probel/_-.
export function cleanName(name) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  return /^[\p{L}\p{N} _.-]{2,20}$/u.test(n) ? n : null;
}

// Bazadagi qatordan o'yin va ilova uchun ko'rinish
export function heroView(row) {
  if (!row) return null;
  const level = levelOf(row.points);
  const active = row.defense > 0 && row.defense_until && new Date(row.defense_until) > new Date();
  return {
    name: row.name,
    level,
    points: row.points,
    power: powerRange(level),
    defense: active ? row.defense : 0,
    maxDefense: maxDefense(level),
    defenseUntil: active ? new Date(row.defense_until).getTime() : null,
    charges: row.charges,
    nextLevel: nextLevelAt(level),
  };
}
