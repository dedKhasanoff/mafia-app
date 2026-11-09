// Server: Mini App sahifasini beradi, WebSocket orqali o'yinni boshqaradi va Telegram botni ishlatadi.
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Bot, InlineKeyboard } from 'grammy';
import { Game, GameError, ROLES, OPTIONAL_ROLES, DUR } from './game.js';
import * as subs from './subs.js';
import * as db from './db.js';

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_SHORT_NAME = process.env.APP_SHORT_NAME || 'mafia';
// DEV_AUTH=1 faqat kompyuterda sinash uchun: Telegramsiz brauzerda kirishga ruxsat beradi.
// Railway'da HECH QACHON yoqmang.
const DEV_AUTH = process.env.DEV_AUTH === '1';

if (!BOT_TOKEN && !DEV_AUTH) {
  console.error('BOT_TOKEN o\'rnatilmagan.');
  process.exit(1);
}

const games = new Map(); // gameId (string) -> Game

// Guruh ID'si manfiy bo'ladi (-100...). startapp parametri uchun "m" bilan almashtiramiz.
const encodeId = (chatId) => String(chatId).replace('-', 'm');
const decodeId = (s) => String(s || '').replace(/^m/, '-');

// ---------- Telegram initData tekshiruvi ----------
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function verifyInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  if (Date.now() / 1000 - Number(params.get('auth_date')) > 86400) return null;
  try {
    return { user: JSON.parse(params.get('user')), startParam: params.get('start_param') };
  } catch {
    return null;
  }
}

// ---------- Bot ----------

let bot = null;
let botUsername = null;

function appLink(chatId) {
  return `https://t.me/${botUsername}/${APP_SHORT_NAME}?startapp=${encodeId(chatId)}`;
}

function openButton(chatId) {
  return new InlineKeyboard().url('🎭 O\'yinni ochish', appLink(chatId));
}

// Obuna to'lovi uchun havola (Telegram Stars, har oy avtomatik yangilanadi)
async function subscribeButton(chat) {
  const link = await bot.api.raw.createInvoiceLink({
    title: 'Mafia: guruh obunasi',
    description: `«${(chat.title || 'Guruh').slice(0, 60)}» guruhi uchun 30 kunlik obuna. Guruhdagi hamma bepul o'ynaydi. Obuna har oy avtomatik yangilanadi.`,
    payload: subs.payloadFor(chat.id),
    currency: 'XTR',
    prices: [{ label: '1 oy', amount: subs.SUB_PRICE }],
    subscription_period: subs.SUB_PERIOD,
  });
  return new InlineKeyboard().url(`⭐ Obuna bo'lish — ${subs.SUB_PRICE} Stars / oy`, link);
}

async function offerSubscription(ctx, intro) {
  const text = `${intro}\n\n⭐ Guruh obunasi: oyiga ${subs.SUB_PRICE} Telegram Stars. Bitta odam to'laydi, guruhdagi hamma bepul o'ynaydi.`;
  try {
    return await ctx.reply(text, { reply_markup: await subscribeButton(ctx.chat) });
  } catch (e) {
    console.error('createInvoiceLink:', e.description || e.message);
    return ctx.reply(`${text}\n\n⚠️ To'lov havolasini yaratib bo'lmadi, keyinroq urinib ko'ring.`);
  }
}

// ---------- Lichkaga xabarlar ----------
// Foydalanuvchi botga /start bosmagan bo'lsa, Telegram lichkaga yozishga ruxsat bermaydi. Bunday odamlarni eslab qolamiz.
const dmBlocked = new Set();
function dm(uid, text, extra = {}) {
  if (!bot || uid <= 0 || dmBlocked.has(uid)) return;
  bot.api.sendMessage(uid, text, extra).catch((e) => {
    if (e.error_code === 403 || e.error_code === 400) dmBlocked.add(uid);
    else console.error('dm:', e.description || e.message);
  });
}

// ---------- Guruh sozlamalari ----------
const settingsCache = new Map(); // chatId -> settings (baza bo'lmasa ham ishlaydi)
async function loadSettings(chatId) {
  const key = String(chatId);
  if (!settingsCache.has(key)) settingsCache.set(key, (await db.getSettings(chatId).catch(() => null)) || {});
  return settingsCache.get(key);
}

function createGame(chatId, settings = {}) {
  const game = new Game(chatId, {
    settings,
    onNote: (uid, text) => dm(uid, text),
    onStart: (g) => {
      for (const p of g.players.values()) {
        const r = ROLES[p.role];
        dm(p.id, `🎭 O'yin boshlandi! Sizning rolingiz: ${r.emoji} ${r.name}\n\n${r.info}`, { reply_markup: openButton(g.chatId) });
      }
    },
    onNightStart: (g) => {
      for (const p of g.alive) {
        if (!['don', 'mafia', 'advokat', 'komissar', 'doktor', 'qoriqchi', 'mashuqa', 'daydi', 'jurnalist', 'qotil'].includes(p.role)) continue;
        dm(p.id, `🌙 ${g.round}-tun boshlandi. Ilovada harakatingizni qiling!`, { reply_markup: openButton(g.chatId) });
      }
    },
    announce: (text, withButton) => {
      if (!bot) return;
      bot.api.sendMessage(chatId, text, withButton ? { reply_markup: openButton(chatId) } : {})
        .catch((e) => console.error('sendMessage:', e.description || e.message));
    },
    onChange: () => broadcast(game),
    onEnd: (g) => rewardWinners(g),
    onItemUsed: (uid, item) => {
      db.useItem(uid, item)
        .then((profile) => profile && pushProfile(game, uid, profile))
        .catch((e) => console.error('useItem:', e.message));
    },
    onFirstNight: (g, deaths) => {
      if (!db.COINS_ENABLED) return;
      const players = [...g.players.values()];
      if (players.some((p) => p.bot)) return; // test o'yinlari hisobga olinmaydi
      db.setStreaks(players.map((p) => ({ id: p.id, name: p.name, killed: deaths.has(p.id) })))
        .catch((e) => console.error('setStreaks:', e.message));
    },
  });
  games.set(String(chatId), game);
  return game;
}

if (BOT_TOKEN) {
  // TELEGRAM_API_ROOT: boshqa Bot API serveri (masalan, o'z Bot API serveringiz yoki sinov uchun). Odatda kerak emas.
  bot = new Bot(BOT_TOKEN, process.env.TELEGRAM_API_ROOT ? { client: { apiRoot: process.env.TELEGRAM_API_ROOT } } : {});
  const isGroup = (ctx) => ['group', 'supergroup'].includes(ctx.chat?.type);

  bot.command('start', (ctx) => {
    if (ctx.chat.type !== 'private') return;
    dmBlocked.delete(ctx.from.id); // endi lichkaga yozish mumkin
    return ctx.reply("Salom! Men Mafia botman 🎭\nMeni guruhga qo'shing va /newgame yozing.\n\n"
      + "🔔 Endi rolingiz, tungi eslatmalar va shaxsiy xabarlar shu yerga keladi.\n🎁 Kunlik bonus: /bonus");
  });

  // Kunlik bonus
  bot.command('bonus', async (ctx) => {
    if (!db.COINS_ENABLED) return ctx.reply('YM coin hali yoqilmagan.');
    const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ').slice(0, 40);
    const coins = await db.claimBonus(ctx.from.id, name).catch(() => undefined);
    if (coins === undefined) return ctx.reply("Bonusni berib bo'lmadi, keyinroq urinib ko'ring.");
    if (coins === null) return ctx.reply('🎁 Bugungi bonusni olgansiz. Ertaga yana keling!');
    pushProfileEverywhere(ctx.from.id);
    return ctx.reply(`🎁 ${ctx.from.first_name}, +${db.DAILY_BONUS} YM coin! Balans: ${coins} YM`);
  });

  // Reyting
  bot.command('top', async (ctx) => {
    if (!db.COINS_ENABLED) return ctx.reply('Reyting uchun baza ulanmagan.');
    const inGroup = isGroup(ctx);
    const rows = await db.top(inGroup ? ctx.chat.id : null).catch(() => null);
    if (!rows) return ctx.reply("Reytingni o'qib bo'lmadi, keyinroq urinib ko'ring.");
    if (!rows.length) return ctx.reply("Hali g'oliblar yo'q. Birinchi bo'ling! /newgame");
    const medal = (i) => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
    const lines = rows.map((r, i) => `${medal(i)} ${r.name} — ${r.wins} g'alaba`);
    return ctx.reply(`🏆 ${inGroup ? 'Guruh reytingi' : 'Umumiy reyting'}:\n\n${lines.join('\n')}`);
  });

  // Guruh sozlamalari: vaqtlar va rollar (faqat adminlar)
  const isAdmin = async (ctx, chatId) => {
    const m = await ctx.api.getChatMember(chatId, ctx.from.id).catch(() => null);
    return m && ['creator', 'administrator'].includes(m.status);
  };
  bot.command(['sozlamalar', 'settings'], async (ctx) => {
    if (!isGroup(ctx)) return ctx.reply('Sozlamalar guruh uchun. Bu buyruqni guruhda yozing.');
    if (!(await isAdmin(ctx, ctx.chat.id))) return ctx.reply('Sozlamalarni faqat guruh adminlari o\'zgartira oladi.');
    const st = await loadSettings(ctx.chat.id);
    return ctx.reply(settingsText(), { reply_markup: settingsKeyboard(st) });
  });
  bot.callbackQuery(/^st:(\w+)(?::(\w+))?$/, async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId || !(await isAdmin(ctx, chatId))) return ctx.answerCallbackQuery({ text: 'Faqat adminlar uchun', show_alert: true });
    const [, key, val] = ctx.match;
    if (key === 'close') {
      await ctx.answerCallbackQuery({ text: 'Saqlandi' });
      return ctx.deleteMessage().catch(() => {});
    }
    const st = { ...(await loadSettings(chatId)) };
    if (key === 'role' && OPTIONAL_ROLES.includes(val)) {
      const off = new Set(st.off || []);
      if (off.has(val)) off.delete(val); else off.add(val);
      st.off = [...off];
    } else if (TIME_STEPS[key]) {
      const steps = TIME_STEPS[key];
      const cur = st[key] || DUR[key];
      st[key] = steps[(steps.indexOf(cur) + 1) % steps.length] ?? steps[0];
    } else return ctx.answerCallbackQuery();
    settingsCache.set(String(chatId), st);
    await db.saveSettings(chatId, st).catch((e) => console.error('saveSettings:', e.message));
    await ctx.answerCallbackQuery();
    return ctx.editMessageReplyMarkup({ reply_markup: settingsKeyboard(st) }).catch(() => {});
  });

  bot.command('newgame', async (ctx) => {
    if (!isGroup(ctx)) return ctx.reply("O'yin faqat guruhda ochiladi.");
    const existing = games.get(String(ctx.chat.id));
    if (existing && existing.phase !== 'end') {
      return ctx.reply("O'yin allaqachon ochiq. Qo'shilish uchun tugmani bosing:", { reply_markup: openButton(ctx.chat.id) });
    }
    if (!subs.isActive(ctx.chat.id)) {
      return offerSubscription(ctx, "🔒 Bu guruhda o'yin ochish uchun obuna kerak.");
    }
    if (existing) closeGame(existing);
    createGame(ctx.chat.id, await loadSettings(ctx.chat.id));
    return ctx.reply(
      "🎭 Mafia o'yini ochildi!\nTugmani bosing, ilovada «Qo'shilish»ni tanlang. Birinchi qo'shilgan odam o'yinni boshlaydi.\n\n"
      + `🔔 Rolingiz va tungi eslatmalar lichkaga kelishi uchun @${botUsername} ga bir marta /start bosing.`,
      { reply_markup: openButton(ctx.chat.id) },
    );
  });

  bot.command('stopgame', async (ctx) => {
    const game = games.get(String(ctx.chat.id));
    if (!game) return ctx.reply("Hozir o'yin yo'q.");
    let allowed = ctx.from.id === game.hostId;
    if (!allowed) {
      const m = await ctx.getChatMember(ctx.from.id).catch(() => null);
      allowed = m && ['creator', 'administrator'].includes(m.status);
    }
    if (!allowed) return ctx.reply("Faqat o'yin egasi yoki admin to'xtata oladi.");
    game.stop();
    closeGame(game);
    return ctx.reply("⛔ O'yin to'xtatildi.");
  });

  bot.command('obuna', async (ctx) => {
    if (!isGroup(ctx)) return ctx.reply("Obuna guruh uchun olinadi. Bu buyruqni guruhda yozing.");
    if (subs.isFree(ctx.chat.id)) return ctx.reply("✅ Bu guruhda o'yin bepul.");
    const until = subs.expiresAt(ctx.chat.id);
    if (subs.isActive(ctx.chat.id)) {
      return ctx.reply(`✅ Guruh obunasi faol: ${subs.formatDate(until)} gacha.\nObuna har oy avtomatik yangilanadi.`);
    }
    return offerSubscription(ctx, until ? `⌛ Obuna ${subs.formatDate(until)} da tugagan.` : "Bu guruhda obuna yo'q.");
  });

  bot.command(['balans', 'balance'], async (ctx) => {
    if (!db.COINS_ENABLED) return ctx.reply('YM coin hali yoqilmagan.');
    const pr = await db.getProfile(ctx.from.id).catch(() => null);
    if (!pr) return ctx.reply("Balansni o'qib bo'lmadi, keyinroq urinib ko'ring.");
    const items = Object.entries(db.SHOP).map(([k, it]) => `${it.name}: ${pr.items[k]} ta`).join('\n');
    const roleName = (r) => (ROLES[r] ? `${ROLES[r].emoji} ${ROLES[r].name}` : r);
    const wins = Object.entries(pr.stats).sort((a, b) => b[1] - a[1]).map(([r, w]) => `${roleName(r)}: ${w}×`).join('\n') || "Hali g'alaba yo'q";
    return ctx.reply(`🪙 ${ctx.from.first_name}, balansingiz: ${pr.coins} YM coin\n\n🏆 G'alabalar:\n${wins}\n\n${items}\n\nDo'kon ilova ichida: 🛒 tugmasi.`);
  });

  bot.command('groupid', (ctx) => ctx.reply(`Guruh ID: ${ctx.chat.id}`));

  // Telegram talabi: to'lov bo'yicha yordam buyrug'i
  bot.command('paysupport', (ctx) => ctx.reply(
    process.env.SUPPORT_TEXT || "To'lov bo'yicha savollar uchun bot egasiga yozing. Obunani Telegram sozlamalarida (Settings → My Stars) bekor qilish mumkin.",
  ));

  bot.on('pre_checkout_query', (ctx) => {
    const q = ctx.preCheckoutQuery;
    const pack = coinPack(q.invoice_payload);
    const ok = subs.validPayload(q.invoice_payload) || (pack && db.COINS_ENABLED && q.total_amount === pack.stars);
    return ok ? ctx.answerPreCheckoutQuery(true) : ctx.answerPreCheckoutQuery(false, { error_message: "Noto'g'ri to'lov" });
  });

  bot.on('message:successful_payment', async (ctx) => {
    const p = ctx.message.successful_payment;
    const pack = coinPack(p.invoice_payload);
    if (pack) {
      // YM coin sotib olish
      const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ').slice(0, 40);
      try {
        const coins = await db.addPurchasedCoins(p.telegram_payment_charge_id, ctx.from.id, name, p.total_amount, pack.coins);
        if (coins == null) return; // bu to'lov allaqachon hisoblangan
        console.log(`Coin xaridi: ${ctx.from.id}, ${p.total_amount} Stars -> ${pack.coins} YM`);
        pushProfileEverywhere(ctx.from.id);
        return ctx.reply(`✅ Rahmat! +${pack.coins} YM coin. Balans: ${coins} YM`).catch(() => {});
      } catch (e) {
        console.error('Coin xaridida xato:', e.message);
        return ctx.reply("⚠️ To'lov qabul qilindi, lekin coin qo'shishda xato bo'ldi. /paysupport orqali yozing.").catch(() => {});
      }
    }
    const expires = p.subscription_expiration_date || Math.floor(Date.now() / 1000) + subs.SUB_PERIOD;
    const chatId = subs.record(p.invoice_payload, expires);
    if (!chatId) return;
    const until = subs.formatDate(expires * 1000);
    const renewal = p.is_recurring && !p.is_first_recurring;
    const who = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
    console.log(`To'lov: guruh ${chatId}, ${p.total_amount} Stars, ${until} gacha${renewal ? ' (yangilanish)' : ''}`);
    await ctx.reply(`✅ Rahmat! Guruh obunasi ${until} gacha ${renewal ? 'uzaytirildi' : 'faollashtirildi'}.`).catch(() => {});
    if (String(ctx.chat.id) !== chatId) {
      const text = renewal
        ? `🔄 Guruh obunasi ${until} gacha uzaytirildi.`
        : `⭐ ${who} guruh obunasini faollashtirdi (${until} gacha). Endi /newgame bilan o'yin ochish mumkin!`;
      bot.api.sendMessage(chatId, text).catch((e) => console.error('sendMessage:', e.description || e.message));
    }
  });

  // Guruhda tartib: tunda o'yinchilar yozgan va o'lgan o'yinchilar yozgan xabarlar o'chiriladi
  bot.on('message', async (ctx) => {
    if (!isGroup(ctx) || !ctx.from) return;
    const game = games.get(String(ctx.chat.id));
    if (!game || ['lobby', 'end'].includes(game.phase)) return;
    const p = game.players.get(ctx.from.id);
    if (!p) return; // o'yinda qatnashmayotganlarga tegmaymiz
    if (ctx.message.text?.startsWith('/')) return;
    if (p.alive && game.phase !== 'night') return;
    await ctx.deleteMessage().catch((e) => {
      if (game.warnedDelete) return;
      game.warnedDelete = true;
      console.error('deleteMessage:', e.description || e.message);
      game.announce("⚠️ Tunda va o'lganlar yozgan xabarlarni o'chirishim uchun meni guruhda admin qiling (xabarlarni o'chirish huquqi bilan).");
    });
  });

  bot.catch((err) => console.error('Bot xatosi:', err.error?.message || err.message));
}

// G'oliblarga YM coin. Test botlari bor o'yinda mukofot berilmaydi (aks holda coin yig'ib olish oson).
async function rewardWinners(game) {
  if (!db.COINS_ENABLED || !game.winners.size) return;
  const players = [...game.players.values()];
  if (players.some((p) => p.bot)) {
    game.announce("🤖 O'yinda test botlari bor edi, shuning uchun YM coin berilmadi.");
    return;
  }
  const winners = players.filter((p) => game.winners.has(p.id));
  try {
    const balances = await db.award(winners, db.COIN_REWARD, game.chatId);
    for (const w of winners) w.stats = { ...w.stats, [w.role]: (w.stats?.[w.role] || 0) + 1 };
    broadcast(game);
    game.announce(`🪙 G'oliblar ${db.COIN_REWARD} YM coin oldi:\n${winners.map((w) => `${w.name} — jami ${balances.get(w.id)} YM`).join('\n')}`);
    for (const ws of game.clients) {
      if (balances.has(ws.user.id)) {
        db.getProfile(ws.user.id).then((pr) => send(ws, { ...profileMsg(pr), gained: db.COIN_REWARD })).catch(() => {});
      }
    }
  } catch (e) {
    console.error('Coin berishda xato:', e.message);
  }
}

// Coin paketi to'lovi: payload "coins:<paket raqami>"
function coinPack(payload) {
  const m = /^coins:(\d+)$/.exec(payload || '');
  return m ? db.COIN_PACKS.find((p) => p.id === Number(m[1])) || null : null;
}

async function coinInvoice(ws, packId) {
  const pack = db.COIN_PACKS.find((p) => p.id === Number(packId));
  if (!pack || !bot || !db.COINS_ENABLED) return send(ws, { type: 'error', message: "Coin sotib olish hozir mavjud emas" });
  try {
    const url = await bot.api.raw.createInvoiceLink({
      title: `${pack.coins} YM coin`,
      description: `Mafia o'yini uchun ${pack.coins} YM coin. Do'kondagi buyumlarga sarflash mumkin.`,
      payload: `coins:${pack.id}`,
      currency: 'XTR',
      prices: [{ label: `${pack.coins} YM`, amount: pack.stars }],
    });
    send(ws, { type: 'invoice', url });
  } catch (e) {
    console.error('coin invoice:', e.description || e.message);
    send(ws, { type: 'error', message: "To'lov havolasini yaratib bo'lmadi" });
  }
}

// Sozlamalar menyusi
const TIME_STEPS = {
  night: [30, 45, 60, 90, 120],
  day: [15, 30, 45, 60, 90, 120],
  vote: [15, 20, 30, 45, 60],
  confirm: [15, 20, 30, 45, 60],
};
const TIME_LABEL = { night: '🌙 Tun', day: '🗣 Muhokama', vote: '🗳 Ovoz', confirm: '⚖️ Dor oldida' };
function settingsText() {
  return "⚙️ Guruh sozlamalari\n\nVaqtni o'zgartirish uchun tugmani bosing (har bosishda keyingi qiymat).\n"
    + "Rollar: ✅ yoqilgan, ❌ o'chirilgan (o'rniga Tinch aholi beriladi).\n\nO'zgarishlar keyingi /newgame dan ishlaydi.";
}
function settingsKeyboard(st) {
  const kb = new InlineKeyboard();
  for (const k of Object.keys(TIME_STEPS)) kb.text(`${TIME_LABEL[k]}: ${st[k] || DUR[k]}s`, `st:${k}`).row();
  const off = new Set(st.off || []);
  OPTIONAL_ROLES.forEach((r, i) => {
    kb.text(`${off.has(r) ? '❌' : '✅'} ${ROLES[r].emoji} ${ROLES[r].name}`, `st:role:${r}`);
    if (i % 2 === 1) kb.row();
  });
  return kb.row().text('✔️ Tayyor', 'st:close');
}

// Foydalanuvchi qaysi o'yinda bo'lmasin, uning oynalariga yangi profilni yuboramiz
function pushProfileEverywhere(uid) {
  if (!db.COINS_ENABLED) return;
  db.getProfile(uid).then((pr) => {
    for (const g of games.values()) pushProfile(g, uid, pr);
  }).catch(() => {});
}

// Profilni (coin, buyumlar) shu foydalanuvchining barcha oynalariga yuboramiz
function pushProfile(game, uid, profile) {
  for (const ws of game.clients) if (ws.user.id === uid) send(ws, profileMsg(profile));
}

// O'yinga qo'shilganda buyumlar va 1-tun hisoblagichini bazadan olamiz
function loadProfile(game, uid) {
  if (!db.COINS_ENABLED) return;
  db.getProfile(uid).then((pr) => {
    const p = game.players.get(uid);
    if (!p) return;
    p.stats = pr.stats; // kartada eng ko'p yutgan roli ko'rinadi
    if (game.phase === 'lobby') { p.items = { ...pr.items }; p.streak = pr.streak; }
    broadcast(game);
  }).catch((e) => console.error('getProfile:', e.message));
}

async function claimBonusWs(ws) {
  if (!db.COINS_ENABLED) return;
  try {
    const coins = await db.claimBonus(ws.user.id, ws.user.name);
    if (coins == null) return send(ws, { type: 'error', message: '🎁 Bugungi bonusni olgansiz. Ertaga yana keling!' });
    pushProfileEverywhere(ws.user.id);
    send(ws, { type: 'bought', item: `🎁 +${db.DAILY_BONUS} YM bonus` });
  } catch (e) {
    console.error('bonus:', e.message);
    send(ws, { type: 'error', message: "Bonusni berib bo'lmadi" });
  }
}

// O'yinga faqat shu guruh a'zolari qo'shila oladi (havolani bilgan begonalar emas)
async function joinGame(ws) {
  const { game, user } = ws;
  const chatId = Number(game.chatId);
  if (bot && Number.isFinite(chatId) && !game.players.has(user.id)) {
    const m = await bot.api.getChatMember(chatId, user.id).catch(() => null);
    const member = m && (['creator', 'administrator', 'member'].includes(m.status) || (m.status === 'restricted' && m.is_member));
    if (!member) throw new GameError("O'yinga qo'shilish uchun avval guruhga a'zo bo'ling");
  }
  game.join(user);
  loadProfile(game, user.id);
}

// Do'kon: faqat o'yin davom etmayotganda (lobbida, o'yin tugagach yoki tomosha qilayotganda)
async function buyItem(ws, item) {
  const { game, user } = ws;
  const p = game.players.get(user.id);
  if (p?.alive && !['lobby', 'end'].includes(game.phase)) {
    return send(ws, { type: 'error', message: "O'yin davomida sotib olib bo'lmaydi. O'yin tugagach yoki lobbida oling." });
  }
  try {
    const pr = await db.buy(user.id, item);
    if (p && game.phase === 'lobby') p.items = { ...pr.items };
    pushProfile(game, user.id, pr);
    send(ws, { type: 'bought', item: db.SHOP[item].name });
  } catch (e) {
    if (e instanceof db.ShopError) return send(ws, { type: 'error', message: e.message });
    console.error('buy:', e.message);
    send(ws, { type: 'error', message: "Sotib olib bo'lmadi, keyinroq urinib ko'ring" });
  }
}

// Telegram'da "/" yozilganda chiqadigan buyruqlar ro'yxati
async function setCommandMenu() {
  const group = [
    { command: 'newgame', description: "Yangi o'yin ochish" },
    { command: 'stopgame', description: "O'yinni to'xtatish (o'yin egasi yoki admin)" },
    { command: 'balans', description: 'YM coin balansi va buyumlar' },
    { command: 'top', description: 'Guruh reytingi' },
    { command: 'bonus', description: 'Kunlik bonus' },
    { command: 'obuna', description: 'Guruh obunasi holati' },
    { command: 'paysupport', description: "To'lov bo'yicha yordam" },
  ];
  const priv = [
    { command: 'start', description: 'Bot haqida va eslatmalarni yoqish' },
    { command: 'balans', description: 'YM coin balansi va buyumlar' },
    { command: 'bonus', description: 'Kunlik bonus' },
    { command: 'top', description: 'Umumiy reyting' },
    { command: 'paysupport', description: "To'lov bo'yicha yordam" },
  ];
  // Adminlar uchun ro'yxat guruhdagi ro'yxat o'rniga chiqadi, shuning uchun hammasini o'z ichiga oladi
  const admins = [...group, { command: 'sozlamalar', description: "Vaqtlar va rollarni sozlash" }, { command: 'groupid', description: 'Guruh ID raqami (sozlash uchun)' }];
  await bot.api.setMyCommands(group, { scope: { type: 'all_group_chats' } });
  await bot.api.setMyCommands(admins, { scope: { type: 'all_chat_administrators' } });
  await bot.api.setMyCommands(priv, { scope: { type: 'all_private_chats' } });
  console.log("Buyruqlar ro'yxati o'rnatildi");
}

function closeGame(game) {
  clearTimeout(game.timer);
  if (games.get(String(game.chatId)) === game) games.delete(String(game.chatId));
  for (const ws of game.clients) ws.close(4000, 'game closed');
}

// Tugagan o'yinlarni 30 daqiqadan keyin tozalaymiz
setInterval(() => {
  for (const game of games.values()) {
    if (game.phase === 'end' && Date.now() - (game.log.at(-1)?.t || 0) > 30 * 60 * 1000) closeGame(game);
    // 2 soat ichida boshlanmagan lobbi yopiladi
    if (game.phase === 'lobby' && Date.now() - game.createdAt > 2 * 60 * 60 * 1000) {
      game.announce("⌛ O'yin 2 soat ichida boshlanmadi va yopildi. Yangi o'yin: /newgame");
      closeGame(game);
    }
  }
}, 60 * 1000);

// ---------- HTTP + WebSocket ----------

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, games: games.size }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 512 * 1024 });

const profileMsg = (pr) => ({
  type: 'profile', ...pr, shop: db.SHOP, packs: bot ? db.COIN_PACKS : [], bonus: db.DAILY_BONUS,
});
const send = (ws, msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };

function broadcast(game) {
  for (const ws of game.clients) send(ws, game.viewFor(ws.user.id));
}

// Bosib gapirish: yozilgan ovozni o'yindagi hammaga yuboramiz (xotirada saqlanmaydi)
const VOICE_MIME = /^audio\/(webm|ogg|mp4|aac|mpeg)(;\s*codecs=[\w.,"\s-]+)?$/;
const VOICE_MAX = 400 * 1024; // base64 uzunligi, ~20 soniyalik yozuv
function relayVoice(ws, msg) {
  const { game, user } = ws;
  if (!game.canSpeak(user.id)) throw new GameError('Hozir gapira olmaysiz');
  const mime = String(msg.mime || '');
  const data = String(msg.data || '');
  if (!VOICE_MIME.test(mime) || !data || data.length > VOICE_MAX || !/^[A-Za-z0-9+/=]+$/.test(data)) {
    throw new GameError("Ovozli xabar noto'g'ri");
  }
  const now = Date.now();
  if (now - (ws.lastVoice || 0) < 1500) throw new GameError('Biroz kuting');
  ws.lastVoice = now;
  const out = JSON.stringify({ type: 'voice', from: user.id, name: user.name, mime, data });
  for (const c of game.clients) if (c !== ws && c.readyState === c.OPEN) c.send(out);
}

function handle(ws, msg) {
  if (msg.type === 'auth') {
    let user;
    let gameId;
    if (DEV_AUTH && msg.dev) {
      user = { id: Number(msg.dev.id), name: String(msg.dev.name || 'Test').slice(0, 40) };
      gameId = String(msg.dev.game || 'dev');
      if (!games.has(gameId)) createGame(gameId);
    } else {
      const data = verifyInitData(msg.initData);
      if (!data?.user) return send(ws, { type: 'error', code: 'auth', message: "Ilovani Telegram ichida oching." });
      const u = data.user;
      user = {
        id: u.id,
        name: [u.first_name, u.last_name].filter(Boolean).join(' ').slice(0, 40) || 'O\'yinchi',
        photo: u.photo_url || null,
      };
      gameId = decodeId(data.startParam);
    }
    const game = games.get(gameId);
    if (!game) {
      return send(ws, { type: 'error', code: 'nogame', message: "O'yin topilmadi. Guruhda /newgame yozing." });
    }
    ws.game?.clients.delete(ws);
    ws.user = user;
    ws.game = game;
    game.clients.add(ws);
    if (db.COINS_ENABLED) {
      db.getProfile(user.id).then((pr) => send(ws, profileMsg(pr))).catch(() => {});
    }
    return broadcast(game); // tomoshabinlar soni yangilansin
  }

  const { game, user } = ws;
  if (!game) throw new GameError("Avval avtorizatsiyadan o'ting");
  switch (msg.type) {
    case 'join': return void joinGame(ws).catch((e) => {
      if (!(e instanceof GameError)) console.error('join:', e.message);
      send(ws, { type: 'error', message: e instanceof GameError ? e.message : "Qo'shilib bo'lmadi, qayta urinib ko'ring" });
    });
    case 'buy': return void buyItem(ws, String(msg.item || '')).catch(() => {});
    case 'leave': return game.leave(user.id);
    case 'addBot': return game.addBot(user.id);
    case 'start': return game.start(user.id);
    case 'voice': return relayVoice(ws, msg);
    case 'mchat': return game.mafiaSay(user.id, msg.text);
    case 'lastwords': return game.sayLastWords(user.id, msg.text);
    case 'buyCoins': return void coinInvoice(ws, msg.pack);
    case 'bonus': return void claimBonusWs(ws);
    case 'act': {
      const targets = Array.isArray(msg.targets) ? msg.targets.slice(0, 2) : [msg.target];
      return game.act(user.id, targets, msg.mode);
    }
    case 'vote': return game.castVote(user.id, Number(msg.target));
    case 'confirm': return game.castConfirm(user.id, msg.yes === true);
    case 'kamikaze': return game.kamikazeTake(user.id, Number(msg.target));
    case 'reveal': return game.reveal(user.id, msg.index);
    default: return undefined;
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    // Bir ulanishdan soniyasiga 20 tadan ortiq xabar kelsa, ortiqchasi tashlab yuboriladi
    const now = Date.now();
    if (now - (ws.rateStart || 0) > 1000) { ws.rateStart = now; ws.rateCount = 0; }
    if (++ws.rateCount > 20) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try {
      handle(ws, msg);
    } catch (e) {
      if (!(e instanceof GameError)) console.error(e);
      send(ws, { type: 'error', message: e instanceof GameError ? e.message : 'Serverda xatolik' });
    }
  });
  ws.on('close', () => {
    if (!ws.game) return;
    ws.game.clients.delete(ws);
    broadcast(ws.game);
  });
});

// Railway proxy ulanishni uzib qo'ymasligi uchun ping
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000);

if (db.COINS_ENABLED) {
  db.init().then(() => console.log('YM coin: baza ulandi')).catch((e) => console.error('Baza xatosi:', e.message));
}

server.listen(PORT, async () => {
  console.log(`Server ${PORT}-portda ishlayapti${DEV_AUTH ? ' (DEV_AUTH yoqilgan!)' : ''}`);
  if (bot) {
    let me;
    try {
      me = await bot.api.getMe();
    } catch (e) {
      console.error('Telegram bilan ulanib bo\'lmadi (BOT_TOKEN to\'g\'rimi?):', e.description || e.message);
      process.exit(1); // Render serverni qayta ishga tushiradi
    }
    botUsername = me.username;
    setCommandMenu().catch((e) => console.error('setMyCommands:', e.description || e.message));
    if (subs.SUBS_ENABLED) {
      subs.loadFromTelegram(bot.api)
        .then((n) => console.log(`Obunalar tiklandi: ${n} ta to'lov`))
        .catch((e) => console.error('getStarTransactions:', e.description || e.message));
    }
    bot.start({ onStart: () => console.log(`Bot @${botUsername} ishga tushdi`) });
  }
});

// Render yangi versiyani joylaganda serverni SIGTERM bilan to'xtatadi: o'yinchilarni ogohlantiramiz
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: server to'xtatilmoqda`);
  const running = [...games.values()].filter((g) => !['lobby', 'end'].includes(g.phase));
  await Promise.all(running.map((g) => bot?.api.sendMessage(g.chatId, "⚠️ Bot yangilanmoqda, bu o'yin to'xtatildi. Bir daqiqadan keyin /newgame bilan qayta boshlang.")
    .catch(() => {})));
  await bot?.stop().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
