// Server: Mini App sahifasini beradi, WebSocket orqali o'yinni boshqaradi va Telegram botni ishlatadi.
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Bot, InlineKeyboard } from 'grammy';
import { Game, GameError, ROLES } from './game.js';
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

function createGame(chatId) {
  const game = new Game(chatId, {
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
  bot = new Bot(BOT_TOKEN);
  const isGroup = (ctx) => ['group', 'supergroup'].includes(ctx.chat?.type);

  bot.command('start', (ctx) => {
    if (ctx.chat.type !== 'private') return;
    return ctx.reply("Salom! Men Mafia botman 🎭\nMeni guruhga qo'shing va /newgame yozing.");
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
    createGame(ctx.chat.id);
    return ctx.reply(
      "🎭 Mafia o'yini ochildi!\nTugmani bosing, ilovada «Qo'shilish»ni tanlang. Birinchi qo'shilgan odam o'yinni boshlaydi.",
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

  bot.on('pre_checkout_query', (ctx) => (subs.validPayload(ctx.preCheckoutQuery.invoice_payload)
    ? ctx.answerPreCheckoutQuery(true)
    : ctx.answerPreCheckoutQuery(false, { error_message: "Noto'g'ri to'lov" })));

  bot.on('message:successful_payment', async (ctx) => {
    const p = ctx.message.successful_payment;
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
    const balances = await db.award(winners);
    for (const w of winners) w.stats = { ...w.stats, [w.role]: (w.stats?.[w.role] || 0) + 1 };
    broadcast(game);
    game.announce(`🪙 G'oliblar ${db.COIN_REWARD} YM coin oldi:\n${winners.map((w) => `${w.name} — jami ${balances.get(w.id)} YM`).join('\n')}`);
    for (const ws of game.clients) {
      if (balances.has(ws.user.id)) {
        db.getProfile(ws.user.id).then((pr) => send(ws, { type: 'profile', ...pr, shop: db.SHOP, gained: db.COIN_REWARD })).catch(() => {});
      }
    }
  } catch (e) {
    console.error('Coin berishda xato:', e.message);
  }
}

// Profilni (coin, buyumlar) shu foydalanuvchining barcha oynalariga yuboramiz
function pushProfile(game, uid, profile) {
  for (const ws of game.clients) if (ws.user.id === uid) send(ws, { type: 'profile', ...profile, shop: db.SHOP });
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
    { command: 'obuna', description: 'Guruh obunasi holati' },
    { command: 'paysupport', description: "To'lov bo'yicha yordam" },
  ];
  const priv = [
    { command: 'start', description: 'Bot haqida' },
    { command: 'balans', description: 'YM coin balansi va buyumlar' },
    { command: 'paysupport', description: "To'lov bo'yicha yordam" },
  ];
  // Adminlar uchun ro'yxat guruhdagi ro'yxat o'rniga chiqadi, shuning uchun hammasini o'z ichiga oladi
  const admins = [...group, { command: 'groupid', description: 'Guruh ID raqami (sozlash uchun)' }];
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
  }
}, 60 * 1000);

// ---------- HTTP + WebSocket ----------

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, games: games.size }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 512 * 1024 });

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
      db.getProfile(user.id).then((pr) => send(ws, { type: 'profile', ...pr, shop: db.SHOP })).catch(() => {});
    }
    return broadcast(game); // tomoshabinlar soni yangilansin
  }

  const { game, user } = ws;
  if (!game) throw new GameError("Avval avtorizatsiyadan o'ting");
  switch (msg.type) {
    case 'join': game.join(user); return loadProfile(game, user.id);
    case 'buy': return void buyItem(ws, String(msg.item || '')).catch(() => {});
    case 'leave': return game.leave(user.id);
    case 'addBot': return game.addBot(user.id);
    case 'start': return game.start(user.id);
    case 'voice': return relayVoice(ws, msg);
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
    const me = await bot.api.getMe();
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
