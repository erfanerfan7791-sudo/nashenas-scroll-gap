
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const TOKEN = process.env.EITAAYAR_TOKEN;
const CHANNEL_ID = process.env.EITAAYAR_CHAT_ID || '11301199';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'messages.json');

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '12kb' }));

let messages = [];
const sessions = new Map();

async function saveMessages() {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  const temp = DATA_FILE + '.tmp';
  await fs.promises.writeFile(temp, JSON.stringify(messages, null, 2));
  await fs.promises.rename(temp, DATA_FILE);
}

async function loadMessages() {
  try {
    messages = JSON.parse(await fs.promises.readFile(DATA_FILE, 'utf8'));
    if (!Array.isArray(messages)) messages = [];
  } catch {
    messages = [];
    await saveMessages();
  }
}

function makeCode() {
  return crypto.randomBytes(9).toString('hex').toUpperCase();
}

function getSession(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/nsg_admin=([a-f0-9]+)/);
  if (!match) return null;

  const session = sessions.get(match[1]);
  if (!session || session.expires < Date.now()) {
    sessions.delete(match[1]);
    return null;
  }
  return match[1];
}

function requireAdmin(req, res, next) {
  if (!getSession(req)) {
    return res.status(401).json({ ok: false, message: 'ابتدا وارد پنل شوید.' });
  }
  next();
}

const sendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

app.get('/health', (req, res) => res.json({ ok: true }));

// صفحه اصلی سایت
app.get('/', (req, res) => {
  const first = path.join(__dirname, 'index(1).html');
  const second = path.join(__dirname, 'index.html');
  const file = fs.existsSync(first) ? first : second;
  res.sendFile(file);
});

// ارسال پیام ناشناس
app.post('/send', sendLimiter, async (req, res) => {
  try {
    const { admin, message, website } = req.body || {};

    if (website) return res.json({ ok: true, message: 'پیام دریافت شد.' });

    const allowedAdmins = [
      '  عرفان', 'سجاد', 'حاجی',' رقیه'
      'مارال', 'معین', 'علی', 'امیر', 'خلخالی'
    ];

    if (!allowedAdmins.includes(admin)) {
      return res.status(400).json({
        ok: false,
        message: 'ادمین انتخاب‌شده معتبر نیست.'
      });
    }

    if (
      typeof message !== 'string' ||
      message.trim().length < 2 ||
      message.trim().length > 2000
    ) {
      return res.status(400).json({
        ok: false,
        message: 'متن پیام باید بین ۲ تا ۲۰۰۰ کاراکتر باشد.'
      });
    }

    if (!TOKEN) {
      return res.status(503).json({
        ok: false,
        message: 'تنظیمات ارسال پیام کامل نیست.'
      });
    }

    const trackingCode = makeCode();
    const text =
      `📩 پیام ناشناس جدید\n` +
      `👤 برای: ${admin}\n\n` +
      `${message.trim()}\n\n` +
      `🔎 کد پیگیری: ${trackingCode}`;

    const apiResponse = await fetch(
      `https://eitaa.com/api/${TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          chat_id: CHANNEL_ID,
          text
        })
      }
    );

    const result = await apiResponse.json().catch(() => ({}));

    if (!apiResponse.ok || result.ok !== true) {
      console.error('Eitaa send failed:', result);
      return res.status(502).json({
        ok: false,
        message: 'ارسال پیام به کانال ناموفق بود.'
      });
    }

    messages.push({
      trackingCode,
      admin,
      message: message.trim(),
      createdAt: new Date().toISOString(),
      reply: '',
      repliedAt: null
    });

    await saveMessages();

    return res.json({
      ok: true,
      trackingCode,
      message: `پیامت با موفقیت ارسال شد ❤️ کد پیگیری تو: ${trackingCode}`
    });

  } catch (err) {
    console.error('Send error:', err);
    return res.status(500).json({
      ok: false,
      message: 'خطای سرور هنگام ارسال پیام.'
    });
  }
});

// صفحه پنل مدیریت
app.get('/admin', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>پنل مدیریت ناشناس اسکرول گپ</title>
<style>
body{background:#111;color:white;font-family:Tahoma,Arial;padding:20px}
main{max-width:700px;margin:auto}
.box{background:#202020;padding:18px;border-radius:14px;margin:15px 0}
input,textarea,button{box-sizing:border-box;width:100%;padding:13px;margin:7px 0;border-radius:8px;border:1px solid #555;background:#292929;color:white}
button{background:#d71936;border:0;font-weight:bold;cursor:pointer}
.small{color:#aaa;font-size:13px}
</style>
</head>
<body>
<main>
<h2>🔐 پنل مدیریت ناشناس اسکرول گپ</h2>
<div id="login" class="box">
<p>رمز مدیریت را وارد کن</p>
<input id="password" type="password" placeholder="رمز پنل">
<button onclick="login()">ورود</button>
</div>
<div id="dashboard" hidden>
<button onclick="loadMessages()">🔄 بروزرسانی پیام‌ها</button>
<div id="items"></div>
</div>
<p id="status" class="small"></p>
</main>
<script>
const statusBox=document.getElementById('status');

async function login(){
 const r=await fetch('/api/admin/login',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({password:document.getElementById('password').value})
 });
 const d=await r.json();
 statusBox.textContent=d.message||'';
 if(d.ok){
  document.getElementById('login').hidden=true;
  document.getElementById('dashboard').hidden=false;
  loadMessages();
 }
}

async function loadMessages(){
 const r=await fetch('/api/admin/messages');
 if(r.status===401){statusBox.textContent='دوباره وارد پنل شوید.';return;}
 const d=await r.json();
 const items=document.getElementById('items');
 items.replaceChildren();

 d.messages.forEach(m=>{
  const box=document.createElement('div');
  box.className='box';

  const title=document.createElement('h3');
  title.textContent='برای: '+m.admin;
  box.append(title);

  const message=document.createElement('p');
  message.textContent=m.message;
  box.append(message);

  const code=document.createElement('p');
  code.className='small';
  code.textContent='کد پیگیری: '+m.trackingCode;
  box.append(code);

  const date=document.createElement('p');
  date.className='small';
  date.textContent=new Date(m.createdAt).toLocaleString('fa-IR');
  box.append(date);

  if(m.reply){
   const reply=document.createElement('p');
   reply.textContent='پاسخ ثبت‌شده: '+m.reply;
   box.append(reply);
  }

  const area=document.createElement('textarea');
  area.placeholder='پاسخ خود را بنویسید...';
  area.value=m.reply||'';
  box.append(area);

  const button=document.createElement('button');
  button.textContent='ثبت پاسخ';
  button.onclick=()=>sendReply(m.trackingCode,area.value);
  box.append(button);

  items.append(box);
 });
}

async function sendReply(code,reply){
 if(!reply.trim()){statusBox.textContent='متن پاسخ خالی است.';return;}
 const r=await fetch('/api/admin/reply',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({trackingCode:code,reply})
 });
 const d=await r.json();
 statusBox.textContent=d.message||'';
 if(d.ok)loadMessages();
}
</script>
</body>
</html>`);
});

// ورود مدیر
app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({
      ok: false,
      message: 'رمز پنل در تنظیمات سرور تعریف نشده است.'
    });
  }

  const supplied = String(req.body?.password || '');
  const expected = Buffer.from(ADMIN_PASSWORD);
  const actual = Buffer.from(supplied);

  if (
    actual.length !== expected.length ||
    !crypto.timingSafeEqual(actual, expected)
  ) {
    return res.status(401).json({
      ok: false,
      message: 'رمز اشتباه است.'
    });
  }

  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expires: Date.now() + 8 * 60 * 60 * 1000 });

  res.setHeader(
    'Set-Cookie',
    `nsg_admin=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`
  );

  res.json({ ok: true, message: 'ورود موفق بود.' });
});

// دریافت پیام‌ها در پنل
app.get('/api/admin/messages', requireAdmin, (req, res) => {
  res.json({
    ok: true,
    messages: [...messages].reverse()
  });
});

// ثبت پاسخ مدیر
app.post('/api/admin/reply', requireAdmin, async (req, res) => {
  try {
    const { trackingCode, reply } = req.body || {};

    if (
      typeof trackingCode !== 'string' ||
      typeof reply !== 'string' ||
      reply.trim().length < 1 ||
      reply.trim().length > 2000
    ) {
      return res.status(400).json({
        ok: false,
        message: 'کد پیگیری یا متن پاسخ معتبر نیست.'
      });
    }

    const item = messages.find(
      m => m.trackingCode === trackingCode.toUpperCase()
    );

    if (!item) {
      return res.status(404).json({
        ok: false,
        message: 'پیام پیدا نشد.'
      });
    }

    item.reply = reply.trim();
    item.repliedAt = new Date().toISOString();

    await saveMessages();

    res.json({ ok: true, message: 'پاسخ با موفقیت ثبت شد ❤️' });
  } catch (err) {
    console.error('Reply error:', err);
    res.status(500).json({
      ok: false,
      message: 'ذخیره پاسخ ناموفق بود.'
    });
  }
});

// صفحه پیگیری پاسخ
app.get('/track', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>پیگیری پیام - ناشناس اسکرول گپ</title>
<style>
body{background:#111;color:white;font-family:Tahoma;padding:20px}
main{max-width:500px;margin:50px auto;background:#202020;padding:20px;border-radius:14px}
input,button{box-sizing:border-box;width:100%;padding:14px;margin:8px 0;border-radius:8px;border:1px solid #555;background:#292929;color:white}
button{background:#d71936;border:0}
#result{white-space:pre-wrap;line-height:2}
</style>
</head>
<body>
<main>
<h2>🔎 پیگیری پیام ناشناس</h2>
<p>کد پیگیری که هنگام ارسال پیام دریافت کردی وارد کن.</p>
<input id="code" placeholder="کد پیگیری">
<button onclick="check()">مشاهده پاسخ</button>
<div id="result"></div>
</main>
<script>
async function check(){
 const code=document.getElementById('code').value.trim();
 const result=document.getElementById('result');
 result.textContent='در حال بررسی...';
 try{
  const r=await fetch('/api/track/'+encodeURIComponent(code));
  const d=await r.json();
  result.textContent=d.message||'';
 }catch(e){
  result.textContent='خطا در ارتباط با سرور.';
 }
}
</script>
</body>
</html>`);
});

// بررسی کد پیگیری
app.get('/api/track/:code', (req, res) => {
  const code = String(req.params.code || '').toUpperCase();

  if (!/^[A-F0-9]{18}$/.test(code)) {
    return res.status(400).json({
      ok: false,
      message: 'کد پیگیری معتبر نیست.'
    });
  }

  const item = messages.find(m => m.trackingCode === code);

  if (!item) {
    return res.status(404).json({
      ok: false,
      message: 'پیامی با این کد پیدا نشد.'
    });
  }

  if (!item.reply) {
    return res.json({
      ok: true,
      message: 'پیامت ثبت شده، اما هنوز پاسخی برای آن ارسال نشده است.'
    });
  }

  res.json({
    ok: true,
    message: 'پاسخ ادمین:\n\n' + item.reply
  });
});

loadMessages().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('Nashenas Scroll Gap running on port ' + PORT);
  });
}).catch(err => {
  console.error('Database loading failed:', err);
  process.exit(1);
});
