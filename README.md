# 🎭 Mafia — Telegram Mini App

Node.js server (Express + WebSocket + grammY) va Telegram ichida ochiladigan o'yin oynasi.

```
server.js         bot, WebSocket, Telegram avtorizatsiyasi
game.js           o'yin qoidalari (rollar, tun, kun, ovoz)
subs.js           guruh obunasi (Telegram Stars)
db.js             YM coin balansi (Postgres)
public/roles/     rol rasmlari (<rol>.jpg)
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
4. O'yin boshlanganda rolingiz katta karta bo'lib chiqadi, keyin tepada doim ko'rinib turadi.

Buyruqlar: `/newgame`, `/stopgame` (o'yin egasi yoki admin), `/balans` (YM coin), `/obuna` (obuna holati yoki to'lov),
`/groupid` (guruh ID'si), `/paysupport` (to'lov bo'yicha yordam).
Bot ishga tushganda bu buyruqlarni Telegram'ga o'zi ro'yxatdan o'tkazadi, shuning uchun `/` yozilganda ro'yxat chiqadi.

**Vaqt:** tun 1 daqiqa, lekin hamma tungi rollar harakat qilib bo'lsa, darhol tugaydi.
Muhokama 30 soniya va ovoz berish 30 soniya: bular hamma ovoz berib bo'lsa ham vaqt tugaguncha davom etadi.

**Tanlov:** tunda rol harakati ham, kunduzgi ovoz ham bir marta qilinadi va o'zgartirib bo'lmaydi.
Kunduzi eng ko'p ovoz olgan odam dor oldiga chiqadi (teng bo'lsa, qur'a tashlanadi). Keyin 30 soniya
«Osilsinmi? Ha / Yo'q» ovozi bo'ladi: «Ha» ko'p bo'lsa osiladi, teng yoki «Yo'q» ko'p bo'lsa avf etiladi.
Bu ovoz yashirin: kim «Ha», kim «Yo'q» degani ko'rinmaydi, faqat natija soni e'lon qilinadi.
Dor oldidagi o'yinchi bu ovozda qatnashmaydi, lekin mikrofonda o'zini oqlashi mumkin. Hamma ovoz bersa, darhol tugaydi.

Kamikadze kunduzi osilsa bitta odamni tanlab olib ketadi; tunda otilsa, uni otganlardan birini o'zi bilan olib ketadi.
Tungi roli bor o'yinchi 2 tun ketma-ket harakat qilmasa, o'yindan chiqariladi (birinchi tundan keyin ogohlantiriladi, `IDLE_NIGHTS`).

**🎙 Mikrofon:** kunduzi (muhokama va ovoz berishda) tirik o'yinchilar pastdagi tugmani bosib turib
gapiradi (eng ko'pi 20 soniya). Qo'yib yuborilganda ovoz o'yindagi hammaga eshittiriladi. Tunda, o'lganlar
va tomoshabinlar gapira olmaydi, lekin eshitadi. Ovozlar serverda saqlanmaydi.

**🤖 Test botlari:** `TEST_BOTS=1` yoqilsa, o'yin egasi lobbida sun'iy o'yinchilar qo'sha oladi.
Ular tunda va ovoz berishda o'zi tasodifiy tanlaydi. Kam odam bilan sinash uchun.

## 🪙 YM coin

O'yin g'olib bilan tugaganda har bir g'olib 20 YM coin oladi (`COIN_REWARD`). Balans ilovaning tepasida
va botda `/balans` buyrug'i bilan ko'rinadi. Test botlari qatnashgan o'yinda coin berilmaydi.

**🏆 Rollar bo'yicha g'alabalar:** har bir g'alaba qaysi rolda bo'lgani saqlanadi. O'yinchi kartasida eng ko'p
yutgan roli ko'rinadi (masalan, "🏆 🤵🏻 Mafia 17×"), to'liq ro'yxat profilda va `/balans` da.

**🛒 Do'kon** (ilovada balans ustiga bosing). Buyumlar kerak bo'lganda o'zi ishlatiladi, har biri bir marta:

| Buyum | Narx | Nima qiladi |
|---|---|---|
| 🛡 Himoya | 100 YM | Tunda suiqasd qilinsa, omon qolasiz |
| 📄 Soxta hujjat | 150 YM | Komissar tekshirsa, tinch aholi tomonidagi tasodifiy rol ko'rinadi (faqat rolingiz tinch aholi tomonida bo'lmasa ishlatiladi) |
| 🎟 Osilishdan qutulish | 150 YM | Kunduzi osishga qaror qilinsa, omon qolasiz (Suidsidda ishlatilmaydi) |

O'yin davomida sotib olib bo'lmaydi: lobbida, o'yin tugagach yoki tomosha qilayotganda olinadi.

**🍀 Birinchi tun qoidasi:** o'yinchi ketma-ket 2 o'yinda birinchi tunda o'ldirilgan bo'lsa, uchinchi o'yinning
birinchi tunida otilsa ham omon qoladi. Test botlari bor o'yinlar hisobga olinmaydi.

Coin'lar saqlanishi uchun bepul Postgres kerak, masalan **Neon**:
1. neon.tech → **Sign up** → yangi loyiha yarating.
2. **Connection string** ni nusxalang (`postgresql://...` bilan boshlanadi).
3. Render → **Environment** → `DATABASE_URL` = shu satr → **Save Changes**.

`DATABASE_URL` bo'lmasa, o'yin coin'siz ishlayveradi.

## ⭐ Guruh obunasi

`/newgame` faqat obunasi faol guruhda ishlaydi. Obuna bo'lmasa, bot «⭐ Obuna bo'lish» tugmasini yuboradi:
guruhdagi istalgan odam Telegram Stars bilan to'laydi (standart: oyiga 500 Stars), shundan keyin guruhdagi
hamma bepul o'ynaydi. Obuna har oy avtomatik yangilanadi va Telegram sozlamalarida bekor qilinadi.

Ma'lumotlar bazasi kerak emas: server qayta ishga tushganda to'lovlar Telegram'dan qayta o'qiladi.
Tushgan Stars'ni @BotFather → botingiz → **Balance** bo'limida ko'rasiz.

O'z guruhingizni bepul qilish: guruhda `/groupid` yozing va chiqqan raqamni `FREE_GROUPS` ga qo'shing.

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
| `DAY_SEC` | 30 | Muhokama |
| `VOTE_SEC` | 30 | Ovoz berish |
| `CONFIRM_SEC` | 30 | «Osilsinmi?» ovozi |
| `KAMIKAZE_SEC` | 20 | Kamikadze tanlash vaqti |
| `MIN_PLAYERS` | 4 | Eng kam o'yinchi |
| `SUB_PRICE` | 500 | Obuna narxi (Stars, oyiga) |
| `FREE_GROUPS` | — | Bepul guruhlar ID'si, vergul bilan: `-100123,-100456` |
| `SUBSCRIPTION` | — | `0` bo'lsa obuna o'chadi, hamma bepul o'ynaydi |
| `SUPPORT_TEXT` | — | `/paysupport` javobi (masalan, `Savollar: @username`) |
| `DATABASE_URL` | — | Postgres manzili (YM coin uchun), masalan Neon'dan |
| `COIN_REWARD` | 20 | Har bir g'olibga beriladigan YM coin |
| `IDLE_NIGHTS` | 2 | Shuncha tun harakat qilmagan o'yinchi chiqariladi |
| `TEST_BOTS` | — | `1` bo'lsa, lobbida 🤖 test botlarini qo'shish mumkin |

## Kompyuterda sinash (Telegramsiz)

```
npm install
npm run dev
```
Brauzerda bir nechta oyna oching:
`http://localhost:3000/?dev=1&uid=1&name=Ali`, `...&uid=2&name=Vali` va hokazo.

⚠️ `DEV_AUTH=1` Telegram tekshiruvini o'chiradi, uni Railway'da **yoqmang**.

## Eslatma

O'yinlar server xotirasida saqlanadi: server qayta ishga tushsa, ketayotgan o'yin yo'qoladi va `/newgame` qaytadan yoziladi.
