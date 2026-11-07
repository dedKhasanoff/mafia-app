// Server: Mini App sahifasini beradi, WebSocket orqali o'yinni boshqaradi va Telegram botni ishlatadi.
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Bot, InlineKeyboard } from 'grammy';
import { Game, GameError } from './game.js';

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

function createGame(chatId) {
  const game = new Game(chatId, {
    announce: (text, withButton) => {
      if (!bot) return;
      bot.api.sendMessage(chatId, text, withButton ? { reply_markup: openButton(chatId) } : {})
        .catch((e) => console.error('sendMessage:', e.description || e.message));
    },
    onChange: () => broadcast(game),
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

  bot.catch((err) => console.error('Bot xatosi:', err.error?.message || err.message));
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
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

const send = (ws, msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };

function broadcast(game) {
  for (const ws of game.clients) send(ws, game.viewFor(ws.user.id));
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
    return broadcast(game); // tomoshabinlar soni yangilansin
  }

  const { game, user } = ws;
  if (!game) throw new GameError("Avval avtorizatsiyadan o'ting");
  switch (msg.type) {
    case 'join': return game.join(user);
    case 'leave': return game.leave(user.id);
    case 'start': return game.start(user.id);
    case 'skipDay': return game.skipDay(user.id);
    case 'act': {
      const targets = Array.isArray(msg.targets) ? msg.targets.slice(0, 2) : [msg.target];
      return game.act(user.id, targets, msg.mode);
    }
    case 'vote': return game.castVote(user.id, msg.target === 'skip' ? 'skip' : Number(msg.target));
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

server.listen(PORT, async () => {
  console.log(`Server ${PORT}-portda ishlayapti${DEV_AUTH ? ' (DEV_AUTH yoqilgan!)' : ''}`);
  if (bot) {
    const me = await bot.api.getMe();
    botUsername = me.username;
    bot.start({ onStart: () => console.log(`Bot @${botUsername} ishga tushdi`) });
  }
});
