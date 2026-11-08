// O'yin mantiqi: rollar, fazalar, ovozlar. Telegram yoki WebSocket haqida hech narsa bilmaydi.

export const MIN_PLAYERS = Number(process.env.MIN_PLAYERS || 4);
export const MAX_PLAYERS = 20;
const DUR = {
  night: Number(process.env.NIGHT_SEC || 60),
  day: Number(process.env.DAY_SEC || 30),
  vote: Number(process.env.VOTE_SEC || 30),
  kamikaze: Number(process.env.KAMIKAZE_SEC || 20),
  confirm: Number(process.env.CONFIRM_SEC || 30),
};
const LUCKY_CHANCE = 0.7;
// TEST_BOTS=1: o'yin egasi lobbida sun'iy o'yinchilar qo'sha oladi (sinash uchun)
export const TEST_BOTS = process.env.TEST_BOTS === '1';
const MAX_ROUNDS = 40;

// side: g'alaba uchun jamoa. Jurnalist ham shu bo'yicha solishtiradi.
export const ROLES = {
  don: { emoji: '🎩', name: 'Don', side: 'mafia',
    info: "Bu tunda kim o'lishini siz hal qilasiz." },
  mafia: { emoji: '🤵🏻', name: 'Mafia', side: 'mafia',
    info: "Donga bo'ysunasiz va sizga qarshilik qilganlarni o'ldirasiz. Don o'lsa, siz yangi Don bo'lishingiz mumkin. Advokat siz tomonda, uni otib bo'lmaydi." },
  advokat: { emoji: '👨🏼‍💼', name: 'Advokat', side: 'mafia',
    info: "Tunda kimni himoya qilishni tanlaysiz. Agar Mafiani tanlasangiz, Komissar uni 👨🏼 Tinch aholi deb ko'radi. Vazifangiz: Mafia g'alaba qozonsin." },
  qotil: { emoji: '🔪', name: 'Qotil', side: 'qotil',
    info: "Shahardagi hamma o'lishi kerak, sizdan tashqari albatta :) Yolg'iz o'ynaysiz, tunda xohlagan odamni o'ldira olasiz." },
  komissar: { emoji: '🕵️', name: 'Komissar', side: 'civil',
    info: "Har tunda jinoyatchilarni qidirasiz: yo tekshirasiz, yo otasiz. Tekshirgan rolingizni xohlasangiz ommaga e'lon qilasiz." },
  serjant: { emoji: '👮', name: 'Serjant', side: 'civil',
    info: "Komissarning yordamchisi. U sizni qilayotgan ishlaridan xabardor qilib turadi. Komissar o'lsa, uning o'rnini siz egallaysiz." },
  doktor: { emoji: '👨🏼‍⚕️', name: 'Doktor', side: 'civil',
    info: "Bu tun kimni qutqarishni siz hal qilasiz..." },
  qoriqchi: { emoji: '🛡', name: "Qo'riqchi", side: 'civil',
    info: "Tunda kimningdir oldiga borasiz. Uni Don yoki Qotil otgan bo'lsa, u siz tufayli omon qoladi, siz esa o'lasiz. Lekin baribir g'olibsiz." },
  mashuqa: { emoji: '💃🏼', name: "Ma'shuqa", side: 'civil',
    info: "Bu shafqatsiz dunyoda omon qolishingiz kerak. Mahoratingizni ishlatib, istalgan o'yinchini bir sutkaga zararsizlantiring :)" },
  daydi: { emoji: '🧙🏼‍♂️', name: 'Daydi', side: 'civil',
    info: "Istalgan o'yinchining uyiga shisha so'rab kirishingiz va qotillikka guvoh bo'lishingiz mumkin." },
  omadli: { emoji: '🤞', name: 'Omadli', side: 'civil',
    info: "Mafiani topib, shahar yig'ilishida osing. Omadingiz kelsa, sizga suiqasd qilinganda tirik qolasiz." },
  kamikadze: { emoji: '💣', name: 'Kamikadze', side: 'civil',
    info: "Kunduzi ham, tunda ham oddiy tinch aholisiz. Lekin sizni osishmoqchi bo'lsa, o'zingiz bilan qabrga bitta o'yinchini olib ketasiz." },
  jurnalist: { emoji: '📰', name: 'Jurnalist', side: 'civil',
    info: "Sensatsiyalar o'z-o'zidan yozilmaydi. Tunda ikki kishini tanlang: manbalaringiz ular bir tomondami yoki har xil tomondami, pichirlab aytadi. Ism va rollarni aytishmaydi." },
  mer: { emoji: '🏛', name: 'Mer', side: 'civil',
    info: "Ma'muriy resursga ega tinch aholi: kunduzgi ovoz berishda ovozingiz ikki hisoblanadi. Buni hech kim bilmaydi." },
  suidsid: { emoji: '🤦🏼‍♂️', name: 'Suidsid', side: 'suidsid',
    info: "Maqsadingiz: shahar sizni kunduzgi yig'ilishda ossin. Lekin buni so'ramang, iqroringizga hech kim ishonmaydi. O'zingizni shubhali tuting, lekin me'yorida, Mafia deb o'ylashsin." },
  civil: { emoji: '👨🏼', name: 'Tinch aholi', side: 'civil',
    info: "Vazifangiz: Mafiani topib, shahar yig'ilishida osish." },
};

// O'yinchi soni bo'yicha rollar: N kishi bo'lsa, ro'yxatning birinchi N tasi olinadi.
// 20 kishida: Don, 3 Mafia, Advokat, 2 Qotil, 2 Tinch aholi va qolgan har biridan bittadan.
const ROLE_ORDER = [
  'don', 'komissar', 'doktor', 'civil', 'mafia', 'mashuqa', 'qotil', 'advokat',
  'serjant', 'mafia', 'qoriqchi', 'omadli', 'suidsid', 'mafia', 'jurnalist',
  'daydi', 'kamikadze', 'qotil', 'mer', 'civil',
];

const MAFIA_TEAM = new Set(['don', 'mafia', 'advokat']);
const SHOOTERS = new Set(['don', 'mafia']);
const NIGHT_ROLES = new Set(['don', 'mafia', 'advokat', 'komissar', 'doktor', 'qoriqchi', 'mashuqa', 'daydi', 'jurnalist', 'qotil']);
const KOM_TEAM = new Set(['komissar', 'serjant']);
// Soxta hujjat Komissarga shu rollardan birini ko'rsatadi
const FAKE_ROLES = ['civil', 'doktor', 'qoriqchi', 'mashuqa', 'daydi', 'omadli', 'jurnalist', 'mer', 'serjant'];
// Ketma-ket shuncha o'yinda 1-tunda o'ldirilgan o'yinchi navbatdagi 1-tunda omon qoladi
const FIRST_NIGHT_STREAK = 2;
// Tungi roli bor o'yinchi shuncha tun ketma-ket harakat qilmasa, o'yindan chiqariladi
const IDLE_NIGHTS = Number(process.env.IDLE_NIGHTS || 2);
// Kim o'ldirgani (hujum turi bo'yicha)
const KILLER = { mafia: '🤵🏻 Mafia', qotil: '🔪 Qotil', komissar: '🕵️ Komissar', kamikadze: '💣 Kamikadze' };
const killers = (kinds) => [...new Set(kinds)].map((k) => KILLER[k]).join(' va ');
const label = (r) => `${ROLES[r].emoji} ${ROLES[r].name}`;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class GameError extends Error {}

export class Game {
  constructor(chatId, { announce = () => {}, onChange = () => {}, onEnd = () => {}, onItemUsed = () => {}, onFirstNight = () => {} } = {}) {
    this.chatId = chatId;
    this.announce = announce;   // guruhga xabar: (text, withButton) => void
    this.onChange = onChange;   // holat o'zgarganda chaqiriladi
    this.onEnd = onEnd;         // o'yin g'olib bilan tugaganda (mukofot uchun)
    this.onItemUsed = onItemUsed;     // do'kon buyumi ishlatilganda: (uid, item)
    this.onFirstNight = onFirstNight; // 1-tun tugaganda: (game, deaths)
    this.players = new Map();   // id -> {id, name, photo, alive, role}
    this.hostId = null;
    this.phase = 'lobby';       // lobby | night | day | vote | kamikaze | end
    this.round = 0;
    this.deadline = null;
    this.timer = null;
    this.actions = new Map();   // tunda: uid -> {targets: [id], mode}
    this.votes = new Map();     // kunduzi: uid -> id
    this.accusedId = null;      // dor oldidagi o'yinchi
    this.confirmVotes = new Map(); // "Osilsinmi?": uid -> true (ha) | false (yo'q)
    this.checks = [];           // komissar tekshiruvlari: {round, target, role, revealed}
    this.notes = new Map();     // shaxsiy xabarlar: uid -> [{round, text}]
    this.dayBlocked = null;     // Ma'shuqa band qilgan odam (shu kuni ovoz bermaydi)
    this.kamikazeId = null;
    this.suidsidWon = new Set();
    this.winner = null;         // civil | mafia | qotil | draw
    this.winners = new Set();
    this.log = [];
    this.pending = [];          // hali ko'rsatilmagan voqealar
    this.events = [];           // joriy faza animatsiyasidagi voqealar
    this.eventsId = 0;
    this.phaseTotal = 0;
    this.clients = new Set();   // ulangan WebSocket'lar (server to'ldiradi)
    this.botSeq = 0;
  }

  get alive() { return [...this.players.values()].filter((p) => p.alive); }
  aliveWith(role) { return this.alive.filter((p) => p.role === role); }

  // isEvent: keyingi faza animatsiyasida ko'rsatiladigan voqea
  addLog(text, isEvent = true) {
    this.log.push({ t: Date.now(), text });
    if (this.log.length > 80) this.log.shift();
    if (isEvent) this.pending.push(text);
  }

  // Yangi faza boshlanganda: oldingi fazada nima bo'lganini animatsiya uchun saqlaymiz
  beginPhase(phase) {
    this.phase = phase;
    this.events = this.pending;
    this.pending = [];
    this.eventsId++;
  }

  // Buyumdan bittasini ishlatamiz (bazadan ham ayiriladi)
  useItem(p, item) {
    if (!p.items?.[item]) return false;
    p.items[item]--;
    this.onItemUsed(p.id, item);
    return true;
  }

  note(uid, text) {
    if (!this.notes.has(uid)) this.notes.set(uid, []);
    this.notes.get(uid).push({ round: this.round, text });
  }

  schedule(sec, fn) {
    clearTimeout(this.timer);
    this.deadline = Date.now() + sec * 1000;
    this.phaseTotal = sec * 1000;
    this.timer = setTimeout(fn, sec * 1000);
  }

  // ---------- Lobby ----------

  join(user) {
    if (this.phase !== 'lobby') throw new GameError("O'yin allaqachon boshlangan");
    if (this.players.has(user.id)) return;
    if (this.players.size >= MAX_PLAYERS) throw new GameError(`Joy qolmadi (eng ko'pi ${MAX_PLAYERS})`);
    this.players.set(user.id, {
      id: user.id, name: user.name, photo: user.photo || null, alive: true, role: null,
      items: { shield: 0, fake_doc: 0, escape: 0 }, // do'kondan olingan buyumlar (server to'ldiradi)
      streak: 0, // ketma-ket o'yinlarda 1-tunda o'ldirilganlar soni (server to'ldiradi)
    });
    if (!this.hostId) this.hostId = user.id;
    this.addLog(`${user.name} qo'shildi`);
    this.onChange();
  }

  // Sinov boti: id manfiy, tunda va ovozda o'zi tasodifiy tanlaydi
  addBot(id) {
    if (!TEST_BOTS) throw new GameError("Test botlari o'chirilgan");
    if (id !== this.hostId) throw new GameError("Faqat o'yin egasi bot qo'sha oladi");
    this.botSeq++;
    this.join({ id: -this.botSeq, name: `🤖 Bot ${this.botSeq}` });
    this.players.get(-this.botSeq).bot = true;
  }

  // Botlar biroz "o'ylab" turib harakat qiladi
  botsPlay() {
    const phase = this.phase;
    const round = this.round;
    const later = (fn) => setTimeout(() => {
      if (this.phase !== phase || this.round !== round) return;
      try { fn(); } catch { /* bot noto'g'ri tanlasa, shunchaki o'tkazib yuboramiz */ }
    }, 2000 + Math.random() * 6000);
    const bots = this.alive.filter((p) => p.bot);
    for (const b of bots) {
      const others = () => this.alive.filter((p) => p.id !== b.id);
      if (phase === 'night' && NIGHT_ROLES.has(b.role)) {
        later(() => {
          let pool = others();
          if (SHOOTERS.has(b.role)) pool = pool.filter((p) => !MAFIA_TEAM.has(p.role));
          if (!pool.length) return;
          const n = b.role === 'jurnalist' ? 2 : 1;
          const targets = [...pool].sort(() => Math.random() - 0.5).slice(0, n).map((p) => p.id);
          if (targets.length === n) this.act(b.id, targets, Math.random() < 0.5 ? 'check' : 'shoot');
        });
      }
      if (phase === 'confirm' && b.id !== this.dayBlocked && b.id !== this.accusedId) {
        later(() => this.castConfirm(b.id, Math.random() < 0.6));
      }
      if (phase === 'vote' && b.id !== this.dayBlocked) {
        later(() => this.castVote(b.id, pick(others()).id));
      }
      if (phase === 'kamikaze' && b.id === this.kamikazeId) {
        later(() => this.kamikazeTake(b.id, pick(others()).id));
      }
    }
  }

  leave(id) {
    if (this.phase !== 'lobby' || !this.players.has(id)) return;
    const p = this.players.get(id);
    this.players.delete(id);
    if (this.hostId === id) this.hostId = this.players.keys().next().value ?? null;
    this.addLog(`${p.name} chiqib ketdi`);
    this.onChange();
  }

  start(id) {
    if (this.phase !== 'lobby') throw new GameError("O'yin allaqachon boshlangan");
    if (id !== this.hostId) throw new GameError("Faqat o'yin egasi boshlay oladi");
    if (this.players.size < MIN_PLAYERS) throw new GameError(`Kamida ${MIN_PLAYERS} o'yinchi kerak`);
    this.assignRoles();
    const counts = {};
    for (const p of this.players.values()) counts[p.role] = (counts[p.role] || 0) + 1;
    const summary = Object.entries(counts).map(([r, k]) => `${label(r)}${k > 1 ? ` × ${k}` : ''}`).join('\n');
    this.pending = [];
    this.addLog("🎲 O'yin boshlandi! Rollar tarqatildi");
    this.announce(`🎲 O'yin boshlandi! ${this.players.size} o'yinchi, rollar:\n${summary}`, true);
    this.startNight();
  }

  assignRoles() {
    const ids = [...this.players.keys()];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const roles = ROLE_ORDER.slice(0, ids.length);
    ids.forEach((id, i) => { this.players.get(id).role = roles[i]; });
  }

  // ---------- Tun ----------

  startNight() {
    this.round++;
    this.beginPhase('night');
    this.actions.clear();
    this.dayBlocked = null;
    this.addLog(`🌙 ${this.round}-tun boshlandi`, false);
    this.announce(`🌙 ${this.round}-tun. Shahar uxlaydi...`);
    this.schedule(DUR.night, () => this.resolveNight());
    this.botsPlay();
    this.onChange();
  }

  act(id, targets, mode) {
    if (this.phase !== 'night') throw new GameError("Hozir tun emas");
    const p = this.players.get(id);
    if (!p || !p.alive || !NIGHT_ROLES.has(p.role)) throw new GameError("Sizda tungi harakat yo'q");
    if (this.actions.has(id)) throw new GameError("Tanlov qilingan, uni o'zgartirib bo'lmaydi");
    const need = p.role === 'jurnalist' ? 2 : 1;
    targets = [...new Set((targets || []).map(Number))];
    if (targets.length !== need) throw new GameError(need === 2 ? 'Ikki kishini tanlang' : 'Bitta odamni tanlang');
    for (const tid of targets) {
      const t = this.players.get(tid);
      if (!t || !t.alive) throw new GameError("Bu o'yinchi tirik emas");
      if (t.id === id && p.role !== 'doktor') throw new GameError("O'zingizni tanlay olmaysiz");
      if (SHOOTERS.has(p.role) && MAFIA_TEAM.has(t.role)) throw new GameError("O'z jamoangizni ota olmaysiz");
    }
    if (p.role === 'komissar') mode = mode === 'shoot' ? 'shoot' : 'check';
    else mode = null;
    this.actions.set(id, { targets, mode });
    // Hamma tungi rollar harakat qilib bo'lsa, tun vaqtni kutmasdan tugaydi
    if (this.alive.filter((x) => NIGHT_ROLES.has(x.role)).every((x) => this.actions.has(x.id))) return this.resolveNight();
    this.onChange();
  }

  resolveNight() {
    if (this.phase !== 'night') return;
    clearTimeout(this.timer);
    const P = (id) => this.players.get(id);
    const one = (role) => this.aliveWith(role)[0];

    // 1. Ma'shuqa: tanlagan odamining tungi harakati bekor, ertasi kuni ovoz bermaydi
    const mashuqa = one('mashuqa');
    const blocked = mashuqa && this.actions.has(mashuqa.id) ? this.actions.get(mashuqa.id).targets[0] : null;
    const valid = (p) => p && p.alive && this.actions.has(p.id) && p.id !== blocked;
    const tgt = (p) => (valid(p) ? this.actions.get(p.id).targets[0] : null);

    // 2. Himoyalar
    const disguised = tgt(one('advokat'));
    const doctorSave = tgt(one('doktor'));
    const guard = one('qoriqchi');
    const guarded = tgt(guard);

    // 3. Otishlar
    const attacks = []; // {target, by: [uid], kind}
    const shooters = this.alive.filter((p) => SHOOTERS.has(p.role) && valid(p));
    const don = shooters.find((p) => p.role === 'don');
    let mafiaTarget = don ? tgt(don) : null;
    if (mafiaTarget == null) {
      // Don tanlamadi: eng ko'p ovoz olgan odam, teng bo'lsa hech kim
      const tally = new Map();
      for (const s of shooters) tally.set(tgt(s), (tally.get(tgt(s)) || 0) + 1);
      if (tally.size) {
        const top = Math.max(...tally.values());
        const leaders = [...tally].filter(([, k]) => k === top);
        if (leaders.length === 1) mafiaTarget = leaders[0][0];
      }
    }
    if (mafiaTarget != null) {
      attacks.push({ target: mafiaTarget, kind: 'mafia', by: shooters.filter((s) => tgt(s) === mafiaTarget).map((s) => s.id) });
    }
    for (const q of this.aliveWith('qotil')) {
      if (tgt(q) != null) attacks.push({ target: tgt(q), kind: 'qotil', by: [q.id] });
    }
    const kom = one('komissar');
    const komAction = valid(kom) ? this.actions.get(kom.id) : null;
    if (komAction?.mode === 'shoot') attacks.push({ target: komAction.targets[0], kind: 'komissar', by: [kom.id] });

    // 4. Kim o'ladi
    const deaths = new Map(); // uid -> 'killed' | 'guard'
    const killedBy = new Map(); // uid -> hujum turlari ('mafia' | 'qotil' | 'komissar')
    const killedAttacks = new Map(); // uid -> uni o'ldirgan hujumlar
    const blastBy = new Map(); // Kamikadze olib ketgan odam -> Kamikadze
    const savedNote = new Set(); // qutqarilganlar (tashrif xabari takrorlanmasin)
    let survivedAttack = false;
    const byTarget = new Map();
    for (const a of attacks) {
      if (!byTarget.has(a.target)) byTarget.set(a.target, []);
      byTarget.get(a.target).push(a);
    }
    for (const [tid, list] of byTarget) {
      const t = P(tid);
      let rest = list;
      if (doctorSave === tid) {
        rest = [];
        this.note(tid, `🔫 Bu tun sizga ${killers(list.map((a) => a.kind))} suiqasd qildi, lekin 👨🏼‍⚕️ Doktor sizni qutqardi!`);
        savedNote.add(tid);
      }
      if (rest.length && guarded === tid && rest.some((a) => a.kind !== 'komissar')) {
        const absorbed = rest.filter((a) => a.kind !== 'komissar').map((a) => a.kind);
        rest = rest.filter((a) => a.kind === 'komissar');
        deaths.set(guard.id, 'guard');
        killedBy.set(guard.id, absorbed);
        this.note(tid, `🔫 Bu tun sizga ${killers(absorbed)} suiqasd qildi, lekin 🛡 Qo'riqchi o'q yo'liga turib sizni qutqardi!`);
        savedNote.add(tid);
      }
      if (rest.length && this.round === 1 && t.streak >= FIRST_NIGHT_STREAK) {
        rest = [];
        t.streak = 0;
        this.note(t.id, `🍀 Siz ${FIRST_NIGHT_STREAK + 1} o'yin ketma-ket birinchi tunda otildingiz. Bu safar shahar sizni asrab qoldi!`);
      }
      if (rest.length && t.role === 'omadli' && Math.random() < LUCKY_CHANCE) {
        rest = [];
        this.note(t.id, '🤞 Bu tun sizga suiqasd qilishdi, lekin omadingiz keldi!');
      }
      if (rest.length && this.useItem(t, 'shield')) {
        rest = [];
        this.note(t.id, `🛡 Bu tun sizga suiqasd qilishdi, lekin Himoya sizni qutqardi! (qoldi: ${t.items.shield})`);
      }
      if (rest.length) {
        if (!deaths.has(tid)) deaths.set(tid, 'killed');
        killedBy.set(tid, rest.map((a) => a.kind));
        killedAttacks.set(tid, rest);
      }
      else survivedAttack = true;
    }

    // Tunda otilgan Kamikadze uni otganlardan birini o'zi bilan olib ketadi
    for (const [tid, why] of [...deaths]) {
      if (why !== 'killed' || P(tid).role !== 'kamikadze') continue;
      const shooters = [...new Set(killedAttacks.get(tid).flatMap((a) => a.by))].filter((id) => !deaths.has(id));
      if (!shooters.length) continue;
      const victim = pick(shooters);
      deaths.set(victim, 'blast');
      killedBy.set(victim, ['kamikadze']);
      blastBy.set(victim, tid);
    }

    // 5. Ma'lumot oluvchilar
    if (komAction) {
      const t = P(komAction.targets[0]);
      if (komAction.mode === 'check') {
        let shown = disguised === t.id && SHOOTERS.has(t.role) ? 'civil' : t.role;
        // Soxta hujjat: rol tinch aholi tomonida bo'lmasa ishlatiladi (Suidsidga kerak emas, u shubhali ko'rinishni xohlaydi)
        if (!['civil', 'suidsid'].includes(ROLES[shown].side) && this.useItem(t, 'fake_doc')) {
          shown = pick(FAKE_ROLES);
          this.note(t.id, `📄 Komissar sizni tekshirdi, lekin Soxta hujjat sizni ${label(shown)} qilib ko'rsatdi.`);
        } else {
          this.note(t.id, '🕵️ Bu tun Komissar sizni tekshirdi.');
        }
        this.checks.push({ round: this.round, target: t.id, role: shown, revealed: false });
        for (const s of this.aliveWith('serjant')) this.note(s.id, `🕵️ Komissar ${t.name}ni tekshirdi: ${label(shown)}`);
      } else {
        for (const s of this.aliveWith('serjant')) this.note(s.id, `🕵️ Komissar ${t.name}ni otdi`);
      }
    }
    const jur = one('jurnalist');
    if (valid(jur)) {
      const [a, b] = this.actions.get(jur.id).targets.map(P);
      const side = (p) => (ROLES[p.role].side === 'qotil' ? `qotil:${p.id}` : ROLES[p.role].side);
      this.note(jur.id, `📰 ${a.name} va ${b.name} — ${side(a) === side(b) ? 'bir tomonda 🤝' : 'har xil tomonda ⚔️'}`);
    }
    const daydi = one('daydi');
    if (valid(daydi)) {
      const t = P(tgt(daydi));
      const seen = [...new Set((byTarget.get(t.id) || []).flatMap((a) => a.by))].map((id) => P(id).name);
      this.note(daydi.id, seen.length
        ? `🧙🏼‍♂️ ${t.name}ning uyida guvoh bo'ldingiz: unga ${seen.join(', ')} suiqasd qildi!`
        : `🧙🏼‍♂️ ${t.name}ning uyida tinch edi, hech kim kelmadi.`);
    }
    // Tashrif xabarlari: kim sizning oldingizga kelgani
    const doc = one('doktor');
    if (doctorSave != null && doctorSave !== doc?.id && !savedNote.has(doctorSave)) {
      this.note(doctorSave, '👨🏼‍⚕️ Bu tun Doktor sizni tekshirib, davoladi.');
    }
    if (guarded != null && !savedNote.has(guarded)) this.note(guarded, "🛡 Bu tun Qo'riqchi sizni qo'riqladi.");
    if (disguised != null) this.note(disguised, '👨🏼‍💼 Bu tun Advokat sizni himoya qildi.');
    if (valid(daydi)) this.note(tgt(daydi), "🧙🏼‍♂️ Bu tun Daydi uyingizga shisha so'rab kirdi.");
    if (valid(jur)) for (const id of this.actions.get(jur.id).targets) this.note(id, '📰 Bu tun Jurnalist siz haqingizda surishtirdi.');

    if (blocked && P(blocked).alive) {
      this.note(blocked, "💃🏼 Bu tun Ma'shuqa sizni band qildi: tungi harakatingiz bekor bo'ldi va bugun ovoz bera olmaysiz.");
    }

    // 6. O'limlarni qo'llash
    const lines = [];
    for (const [uid, why] of deaths) {
      const p = P(uid);
      p.alive = false;
      const by = killers(killedBy.get(uid) || []);
      if (why === 'blast') {
        lines.push(`💣 ${P(blastBy.get(uid)).name} Kamikadze edi: portlab, o'zi bilan uni otgan ${p.name}ni olib ketdi. ${p.name} ${label(p.role)} edi.`);
        this.note(uid, "💣 Siz Kamikadzeni otdingiz — u portlab, sizni o'zi bilan olib ketdi.");
        continue;
      }
      if (why === 'guard') lines.push(`🛡 ${p.name} kimnidir himoya qilib, ${by} o'qini o'ziga oldi va halok bo'ldi. U ${label(p.role)} edi.`);
      else lines.push(`💀 ${p.name}ni ${by} o'ldirdi. U ${label(p.role)} edi.`);
      this.note(uid, why === 'guard' ? `💀 Siz himoya qilgan odamni qutqarib, ${by} qo'lida halok bo'ldingiz.` : `💀 Sizni ${by} o'ldirdi.`);
    }
    // Faol bo'lmaganlar: tungi roli bor, lekin harakat qilmagan tirik o'yinchilar
    for (const p of this.alive.filter((x) => NIGHT_ROLES.has(x.role))) {
      if (this.actions.has(p.id)) { p.idle = 0; continue; }
      p.idle = (p.idle || 0) + 1;
      if (p.idle >= IDLE_NIGHTS) {
        p.alive = false;
        lines.push(`🚪 ${p.name} ${IDLE_NIGHTS} tun ketma-ket harakat qilmagani uchun o'yindan chiqarildi. U ${label(p.role)} edi.`);
        this.note(p.id, `🚪 Siz ${IDLE_NIGHTS} tun ketma-ket harakat qilmadingiz va o'yindan chiqarildingiz.`);
      } else {
        this.note(p.id, `⚠️ Bu tun harakat qilmadingiz. Yana ${IDLE_NIGHTS - p.idle} tun harakat qilmasangiz, o'yindan chiqarilasiz.`);
      }
    }
    if (!lines.length) lines.push(survivedAttack ? "Bu tun suiqasd bo'ldi, lekin hamma omon qoldi!" : "Tun tinch o'tdi.");
    for (const l of lines) this.addLog(l);
    this.announce(`☀️ Tong otdi.\n${lines.join('\n')}`);

    this.dayBlocked = blocked && P(blocked).alive ? blocked : null;
    if (this.round === 1) this.onFirstNight(this, deaths);
    this.promote();
    if (this.checkWin()) return;
    this.startDay();
  }

  // Komissar o'lsa Serjant, Don o'lsa Mafialardan biri o'rniga o'tadi
  promote() {
    if (!this.aliveWith('komissar').length) {
      const s = this.aliveWith('serjant')[0];
      if (s) {
        s.role = 'komissar';
        this.note(s.id, "🕵️ Komissar halok bo'ldi. Endi siz Komissarsiz!");
      }
    }
    if (!this.aliveWith('don').length) {
      const candidates = this.aliveWith('mafia');
      if (candidates.length) {
        const d = pick(candidates);
        d.role = 'don';
        for (const p of this.alive.filter((x) => MAFIA_TEAM.has(x.role))) {
          this.note(p.id, d.id === p.id ? '🎩 Don halok bo\'ldi. Endi siz yangi Donsiz!' : `🎩 Yangi Don: ${d.name}`);
        }
      }
    }
  }

  // ---------- Kun va ovoz ----------

  startDay() {
    this.beginPhase('day');
    this.addLog('🗣 Muhokama vaqti', false);
    this.schedule(DUR.day, () => this.startVote());
    this.onChange();
  }

  startVote() {
    if (this.phase !== 'day') return;
    this.beginPhase('vote');
    this.votes.clear();
    this.addLog('🗳 Ovoz berish boshlandi', false);
    this.announce('🗳 Ovoz berish boshlandi! Ilovada kimni osishni tanlang.', true);
    this.schedule(DUR.vote, () => this.resolveVote());
    this.botsPlay();
    this.onChange();
  }

  castVote(id, target) {
    if (this.phase !== 'vote') throw new GameError('Hozir ovoz berish vaqti emas');
    const p = this.players.get(id);
    if (!p || !p.alive) throw new GameError("Faqat tirik o'yinchilar ovoz beradi");
    if (id === this.dayBlocked) throw new GameError("💃🏼 Ma'shuqa sizni band qilgan, bugun ovoz bera olmaysiz");
    if (this.votes.has(id)) throw new GameError("Ovoz berilgan, uni o'zgartirib bo'lmaydi");
    const t = this.players.get(target);
    if (!t || !t.alive) throw new GameError("Bu o'yinchi tirik emas");
    if (t.id === id) throw new GameError("O'zingizga ovoz bera olmaysiz");
    // Ovoz berish ham hamma ovoz bersa ham vaqt tugaguncha davom etadi
    this.votes.set(id, target);
    this.onChange();
  }

  resolveVote() {
    if (this.phase !== 'vote') return;
    clearTimeout(this.timer);
    const tally = new Map();
    for (const [uid, t] of this.votes) {
      const weight = this.players.get(uid).role === 'mer' ? 2 : 1;
      tally.set(t, (tally.get(t) || 0) + weight);
    }
    // Ochiq ovozlar: kim kimga ovoz bergani guruhga ham yuboriladi
    if (this.votes.size) {
      const lines = [...this.votes].map(([uid, t]) =>
        `${this.players.get(uid).name} → ${this.players.get(t).name}`);
      this.announce(`🗳 Ovozlar:\n${lines.join('\n')}`);
    }
    // Eng ko'p ovoz olgan osiladi; teng bo'lsa, ular orasidan qur'a tashlanadi
    let lynched = null;
    if (tally.size) {
      const top = Math.max(...tally.values());
      const leaders = [...tally].filter(([, k]) => k === top).map(([t]) => t);
      lynched = this.players.get(pick(leaders));
      if (leaders.length > 1) {
        const msg = `🎲 Ovozlar teng bo'ldi (${leaders.map((id) => this.players.get(id).name).join(', ')}). Qur'a ${lynched.name}ga tushdi.`;
        this.addLog(msg);
        this.announce(msg);
      }
    }

    if (!lynched) {
      const msg = '⚖️ Hech kim ovoz bermadi — hech kim osilmadi.';
      this.addLog(msg);
      this.announce(msg);
      if (this.checkWin()) return;
      return this.startNight();
    }
    // Eng ko'p ovoz olgan dor oldiga chiqadi, shahar "Osilsinmi?" deb ovoz beradi
    this.accusedId = lynched.id;
    this.confirmVotes.clear();
    const msg = `⚖️ ${lynched.name} dor oldiga chiqdi! Osilsinmi? Ilovada «Ha» yoki «Yo'q» ni tanlang.`;
    this.addLog(msg);
    this.beginPhase('confirm');
    this.announce(msg, true);
    this.schedule(DUR.confirm, () => this.resolveConfirm());
    this.botsPlay();
    this.onChange();
  }

  get confirmVoters() {
    return this.alive.filter((p) => p.id !== this.accusedId && p.id !== this.dayBlocked);
  }

  castConfirm(id, yes) {
    if (this.phase !== 'confirm') throw new GameError('Hozir bu ovoz vaqti emas');
    if (!this.confirmVoters.some((p) => p.id === id)) throw new GameError('Siz bu ovozda qatnasha olmaysiz');
    if (this.confirmVotes.has(id)) throw new GameError("Ovoz berilgan, uni o'zgartirib bo'lmaydi");
    this.confirmVotes.set(id, !!yes);
    if (this.confirmVoters.every((p) => this.confirmVotes.has(p.id))) return this.resolveConfirm();
    this.onChange();
  }

  resolveConfirm() {
    if (this.phase !== 'confirm') return;
    clearTimeout(this.timer);
    const lynched = this.players.get(this.accusedId);
    this.accusedId = null;
    let yes = 0;
    let no = 0;
    for (const [uid, v] of this.confirmVotes) {
      const weight = this.players.get(uid).role === 'mer' ? 2 : 1;
      if (v) yes += weight; else no += weight;
    }
    // Yashirin ovoz: kim nima degani aytilmaydi, faqat natija
    this.announce(`⚖️ ${lynched.name} osilsinmi?\n👍 Ha: ${yes} · 👎 Yo'q: ${no}`);
    if (yes <= no) {
      const msg = `🕊 Shahar ${lynched.name}ni avf etdi — u osilmadi (Ha: ${yes}, Yo'q: ${no}).`;
      this.addLog(msg);
      this.announce(msg);
      if (this.checkWin()) return;
      return this.startNight();
    }
    this.hang(lynched);
  }

  // Osish: buyum, Kamikadze va Suidsid holatlari bilan
  hang(lynched) {
    if (lynched.role !== 'suidsid' && this.useItem(lynched, 'escape')) {
      const msg = `⚖️ Shahar ${lynched.name}ni osishga qaror qildi... lekin u 🎟 Osilishdan qutulishni ishlatdi va omon qoldi!`;
      this.addLog(msg);
      this.announce(msg);
    } else if (lynched.role === 'kamikadze') {
      this.kamikazeId = lynched.id;
      const msg = `⚖️ Shahar ${lynched.name}ni osishga qaror qildi... lekin u 💣 Kamikadze! U o'zi bilan kimnidir olib ketadi.`;
      this.addLog(msg);
      this.beginPhase('kamikaze');
      this.announce(msg, true);
      this.schedule(DUR.kamikaze, () => this.resolveKamikaze(null));
      this.botsPlay();
      return this.onChange();
    } else {
      lynched.alive = false;
      if (lynched.role === 'suidsid') {
        this.suidsidWon.add(lynched.id);
        const msg = `⚖️ ${lynched.name} osildi. U ${label('suidsid')} edi va maqsadiga erishdi — g'alaba qozondi! 🏆`;
        this.addLog(msg);
        this.announce(msg);
      } else {
        const msg = `⚖️ ${lynched.name} osildi. U ${label(lynched.role)} edi.`;
        this.addLog(msg);
        this.announce(msg);
      }
      this.promote();
    }
    if (this.checkWin()) return;
    this.startNight();
  }

  kamikazeTake(id, targetId) {
    if (this.phase !== 'kamikaze' || id !== this.kamikazeId) throw new GameError('Hozir sizning navbatingiz emas');
    const t = this.players.get(targetId);
    if (!t || !t.alive || t.id === id) throw new GameError("Boshqa tirik o'yinchini tanlang");
    this.resolveKamikaze(t.id);
  }

  resolveKamikaze(targetId) {
    if (this.phase !== 'kamikaze') return;
    clearTimeout(this.timer);
    const k = this.players.get(this.kamikazeId);
    k.alive = false;
    this.kamikazeId = null;
    const t = targetId != null ? this.players.get(targetId) : null;
    let msg = `💣 ${k.name} portladi!`;
    if (t?.alive) {
      t.alive = false;
      msg += ` U o'zi bilan ${t.name}ni olib ketdi. ${t.name} ${label(t.role)} edi.`;
      if (t.role === 'suidsid') msg += ' (Suidsid osilmadi — g\'alaba yo\'q.)';
    } else {
      msg += ' Lekin hech kimni tanlashga ulgurmadi.';
    }
    this.addLog(msg);
    this.announce(msg);
    this.promote();
    if (this.checkWin()) return;
    this.startNight();
  }

  // ---------- Yakun ----------

  checkWin() {
    const alive = this.alive;
    const mk = alive.filter((p) => SHOOTERS.has(p.role)).length;
    const ms = alive.filter((p) => MAFIA_TEAM.has(p.role)).length;
    const k = alive.filter((p) => p.role === 'qotil').length;
    let w = null;
    if (!alive.length) w = 'draw';
    else if (mk === 0 && k === 0) w = 'civil';
    else if (k === 0 && ms >= alive.length - ms) w = 'mafia';
    else if (mk === 0 && k >= alive.length - k) w = 'qotil';
    else if (this.round >= MAX_ROUNDS) w = 'draw';
    if (!w) return false;
    this.end(w);
    return true;
  }

  end(winner) {
    clearTimeout(this.timer);
    this.beginPhase('end');
    this.winner = winner;
    this.deadline = null;
    for (const p of this.players.values()) {
      const side = ROLES[p.role].side;
      if (winner === 'civil' && side === 'civil' && p.role !== 'kamikadze') this.winners.add(p.id);
      if (winner === 'mafia' && side === 'mafia') this.winners.add(p.id);
      if (winner === 'qotil' && p.role === 'qotil' && p.alive) this.winners.add(p.id);
    }
    for (const id of this.suidsidWon) this.winners.add(id);
    this.onEnd(this);

    const titles = {
      civil: "🎉 Tinch aholi g'alaba qozondi!",
      mafia: "🎩 Mafia g'alaba qozondi!",
      qotil: "🔪 Qotil g'alaba qozondi!",
      draw: "🤝 Durang — shaharda g'olib yo'q.",
    };
    const rows = [...this.players.values()].map((p) => {
      let mark = this.winners.has(p.id) ? ' 🏆' : '';
      if (this.isHero(p)) mark += ' 🎖 Qahramon';
      return `${p.name} — ${label(p.role)}${p.alive ? '' : ' 💀'}${mark}`;
    }).join('\n');
    this.addLog(titles[winner], false);
    this.announce(`${titles[winner]}\n\nRollar:\n${rows}\n\nYangi o'yin: /newgame`);
    this.onChange();
  }

  // Kunduzi (muhokama va ovoz berishda) faqat tirik o'yinchilar mikrofonda gapira oladi
  canSpeak(uid) {
    const p = this.players.get(uid);
    return !!p?.alive && ['day', 'vote', 'confirm'].includes(this.phase);
  }

  isHero(p) { return p.role === 'kamikadze' && !p.alive; }

  stop() {
    clearTimeout(this.timer);
    this.beginPhase('end');
    this.winner = null;
    this.deadline = null;
    this.addLog("⛔ O'yin to'xtatildi");
    this.onChange();
  }

  // Komissar tekshirgan rolni guruhga e'lon qiladi
  reveal(id, index) {
    const p = this.players.get(id);
    if (!p || !p.alive || p.role !== 'komissar') throw new GameError("Faqat tirik Komissar e'lon qila oladi");
    if (this.phase === 'lobby' || this.phase === 'end') throw new GameError("Hozir e'lon qilib bo'lmaydi");
    const c = this.checks[Number(index)];
    if (!c) throw new GameError('Tekshiruv topilmadi');
    if (c.revealed) throw new GameError("Bu allaqachon e'lon qilingan");
    c.revealed = true;
    const t = this.players.get(c.target);
    const msg = `📢 Komissar e'lon qiladi: ${t.name} — ${label(c.role)}!`;
    this.addLog(msg);
    this.announce(msg);
    this.onChange();
  }

  // ---------- Har bir o'yinchi uchun ko'rinish ----------

  viewFor(uid) {
    const me = this.players.get(uid);
    const myRole = me?.role ?? null;
    const ended = this.phase === 'end';
    const knows = (p) => ended || !p.alive || p.id === uid
      || (MAFIA_TEAM.has(myRole) && MAFIA_TEAM.has(p.role))
      || (KOM_TEAM.has(myRole) && KOM_TEAM.has(p.role));

    const voteCount = new Map();
    const votersOf = new Map(); // nishon -> unga ovoz berganlar
    if (this.phase === 'vote') {
      for (const [from, t] of this.votes) {
        voteCount.set(t, (voteCount.get(t) || 0) + 1);
        if (!votersOf.has(t)) votersOf.set(t, []);
        votersOf.get(t).push(from);
      }
    }

    let canAct = false;
    if (me?.alive) {
      if (this.phase === 'night') canAct = NIGHT_ROLES.has(myRole);
      if (this.phase === 'vote') canAct = uid !== this.dayBlocked;
      if (this.phase === 'confirm') canAct = uid !== this.dayBlocked && uid !== this.accusedId;
    }
    if (this.phase === 'kamikaze') canAct = uid === this.kamikazeId;

    let choice = null;
    if (this.phase === 'night' && this.actions.has(uid)) choice = this.actions.get(uid);
    if (this.phase === 'confirm' && this.confirmVotes.has(uid)) choice = { yes: this.confirmVotes.get(uid), targets: [] };
    if (this.phase === 'vote' && this.votes.has(uid)) {
      const v = this.votes.get(uid);
      choice = { targets: [v] };
    }

    return {
      type: 'state',
      phase: this.phase,
      round: this.round,
      remaining: this.deadline ? Math.max(0, this.deadline - Date.now()) : null,
      duration: this.deadline ? this.phaseTotal : null,
      events: this.events,
      eventsId: this.eventsId,
      spectators: new Set([...this.clients].map((ws) => ws.user?.id).filter((x) => x != null && !this.players.has(x))).size,
      hostId: this.hostId,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      testBots: TEST_BOTS,
      winner: this.winner,
      kamikazeId: this.kamikazeId,
      accusedId: this.phase === 'confirm' ? this.accusedId : null,
      // Yashirin ovoz: faqat nechta odam ovoz bergani, kim nima degani yuborilmaydi
      confirm: this.phase === 'confirm' ? { voted: this.confirmVotes.size, total: this.confirmVoters.length } : null,
      roles: ROLES,
      me: {
        id: uid,
        joined: !!me,
        alive: me?.alive ?? false,
        role: myRole,
        blocked: uid === this.dayBlocked && ['day', 'vote', 'confirm'].includes(this.phase),
        choice,
        canAct,
        canSpeak: this.canSpeak(uid),
      },
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        photo: p.photo,
        alive: p.alive,
        role: knows(p) ? p.role : null,
        votes: voteCount.get(p.id) || 0,
        voters: votersOf.get(p.id) || [],
        hasVoted: (this.phase === 'vote' && this.votes.has(p.id)) || (this.phase === 'confirm' && this.confirmVotes.has(p.id)),
        winner: ended && this.winners.has(p.id),
        hero: ended && this.isHero(p),
      })),
      teamPicks: MAFIA_TEAM.has(myRole) && this.phase === 'night'
        ? [...this.actions].filter(([u]) => u !== uid && SHOOTERS.has(this.players.get(u).role))
          .map(([from, a]) => ({ from, target: a.targets[0], don: this.players.get(from).role === 'don' }))
        : [],
      checks: KOM_TEAM.has(myRole) ? this.checks : [],
      canReveal: myRole === 'komissar' && !!me?.alive && !ended && this.phase !== 'lobby',
      notes: (this.notes.get(uid) || []).slice(-20),
      log: this.log.slice(-25),
    };
  }
}
