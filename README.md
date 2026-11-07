# 🎭 Mafia — Telegram Mini App

Node.js server (Express + WebSocket + grammY) va Telegram ichida ochiladigan o'yin oynasi.

```
server.js         bot, WebSocket, Telegram avtorizatsiyasi
game.js           o'yin qoidalari (rollar, tun, kun, ovoz)
public/index.html Mini App oynasi
```

## 1. Botni tayyorlash (@BotFather)

1. `/newbot` → nom bering → **tokenni** saqlab qo'ying.
2. `/setprivacy` → botingiz → **Disable**.

## 2. Railway'ga joylash

1. Loyihani GitHub'ga yuklang (yangi repo).
2. railway.app → **New Project → Deploy from GitHub repo** → shu repo.
3. **Variables** bo'limiga qo'shing:
   - `BOT_TOKEN` = BotFather bergan token
   - `APP_SHORT_NAME` = `mafia` (3-qadamda shu nomni ishlatasiz)
4. **Settings → Networking → Generate Domain**. Masalan, `mafia-production.up.railway.app` chiqadi.
5. `https://<domen>/health` ochilib `{"ok":true}` ko'rinsa, server ishlayapti.

## 3. Mini App'ni ulash (@BotFather)

1. `/newapp` → botingizni tanlang.
2. Nom, tavsif, rasm (640×360) so'raydi, istalganini bering.
3. **URL**: `https://<railway-domen>/`
4. **Short name**: `mafia` (Railway'dagi `APP_SHORT_NAME` bilan bir xil bo'lsin).

## 4. O'ynash

1. Botni guruhga qo'shing va `/newgame` yozing.
2. «🎭 O'yinni ochish» tugmasini bosing → ilovada **Qo'shilish**.
3. Birinchi qo'shilgan odam (👑) **O'yinni boshlash**ni bosadi (kamida 4 kishi).
4. Rol kartangizni bosib, rolingizni yashirincha ko'ring.

Buyruqlar: `/newgame`, `/stopgame` (o'yin egasi yoki admin).

## Rollar

O'yin 4–20 kishi bilan o'ynaladi. Rollar o'yinchi soniga qarab shu tartibda qo'shiladi
(masalan, 7 kishi bo'lsa, birinchi 7 tasi olinadi):

1 Don · 2 Komissar · 3 Doktor · 4 Tinch aholi · 5 Mafia · 6 Ma'shuqa · 7 Qotil · 8 Advokat ·
9 Serjant · 10 Mafia · 11 Qo'riqchi · 12 Omadli · 13 Suidsid · 14 Mafia · 15 Jurnalist ·
16 Daydi · 17 Kamikadze · 18 Qotil · 19 Mer · 20 Tinch aholi

Tartibni `game.js` ichidagi `ROLE_ORDER` ro'yxatidan o'zgartirish mumkin.

**Tun tartibi:** Ma'shuqa band qiladi → Advokat niqoblaydi → Doktor va Qo'riqchi himoya qiladi →
Don/Mafia, Qotillar va Komissar otadi → Omadli 70% omon qoladi → Komissar, Jurnalist, Daydi natija oladi.

**G'alaba:**
- Tinch aholi: Mafia (Don + Mafia) va Qotillar o'lsa. Qo'riqchi o'lgan bo'lsa ham yutadi, Kamikadze esa yutmaydi, faqat 🎖 Qahramon bo'ladi.
- Mafia: Qotil qolmagan va Mafia jamoasi (Advokat bilan) qolganlarga teng yoki ko'p bo'lsa.
- Qotil: Mafia qolmagan va Qotillar qolganlarga teng yoki ko'p bo'lsa. Tirik qolgan har bir Qotil yutadi.
- Suidsid: kunduzi osilsa yutadi, o'yin esa davom etadi.

## Sozlamalar (Railway Variables, ixtiyoriy)

| O'zgaruvchi | Standart | Nima qiladi |
|---|---|---|
| `NIGHT_SEC` | 60 | Tun davomiyligi |
| `DAY_SEC` | 60 | Muhokama |
| `VOTE_SEC` | 40 | Ovoz berish |
| `KAMIKAZE_SEC` | 20 | Kamikadze tanlash vaqti |
| `MIN_PLAYERS` | 4 | Eng kam o'yinchi |

## Kompyuterda sinash (Telegramsiz)

```
npm install
npm run dev
```
Brauzerda bir nechta oyna oching:
`http://localhost:3000/?dev=1&uid=1&name=Ali`, `...&uid=2&name=Vali` va hokazo.

⚠️ `DEV_AUTH=1` Telegram tekshiruvini o'chiradi, uni Railway'da **yoqmang**.

## Eslatma

O'yinlar server xotirasida saqlanadi: Railway qayta ishga tushsa, ketayotgan o'yin yo'qoladi va `/newgame` qaytadan yoziladi.
