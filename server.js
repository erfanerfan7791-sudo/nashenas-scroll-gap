const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { randomUUID } = require('node:crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.EITAAYAR_TOKEN;

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(__dirname));

const channels = {
  'عرفان': '11301199',
  'سجاد': '11302032',
  'حاجی': '11302034',
  'رقیه': '11302055',
  'مارال': '11302061',
  'معین': '11302053',
  'علی': '11302066',
  'امیر': '11302063',
  'خلخالی': '11302069'
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed =
      file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('video/') ||
      file.mimetype.startsWith('audio/') ||
      file.mimetype === 'application/pdf';

    if (!allowed) return cb(new Error('فقط عکس، ویدیو، صوت و PDF مجاز است.'));
    cb(null, true);
  }
});

const sendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, message: 'تعداد ارسال‌ها زیاد است. چند دقیقه بعد دوباره تلاش کن.' }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// این میان‌افزار قبل از Multer است تا شروع هر درخواست در لاگ ثبت شود.
app.use('/send', (req, _res, next) => {
  req.requestId = randomUUID().slice(0, 8);
  console.log(`[${req.requestId}] درخواست جدید دریافت شد`);
  next();
});

app.post('/send', sendLimiter, upload.single('file'), async (req, res) => {
  const id = req.requestId || 'no-id';

  try {
    const admin = req.body?.admin;
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const website = req.body?.website;

    if (req.file) {
      console.log(`[${id}] فایل دریافت شد: ${req.file.mimetype}, ${req.file.size} bytes`);
    } else {
      console.log(`[${id}] درخواست بدون فایل دریافت شد`);
    }

    // فیلد تله ضدربات؛ پر بودن آن یعنی درخواست رباتی است.
    if (website) return res.json({ ok: true, message: 'پیام دریافت شد.' });

    if (!Object.prototype.hasOwnProperty.call(channels, admin)) {
      return res.status(400).json({ ok: false, message: 'گیرنده انتخاب‌شده معتبر نیست.' });
    }

    if (message.length > 2000) {
      return res.status(400).json({ ok: false, message: 'متن پیام نباید بیشتر از ۲۰۰۰ نویسه باشد.' });
    }

    if (!message && !req.file) {
      return res.status(400).json({ ok: false, message: 'متن پیام یا یک فایل انتخاب کن.' });
    }

    if (!TOKEN) {
      console.error(`[${id}] متغیر EITAAYAR_TOKEN در Render تنظیم نشده است.`);
      return res.status(503).json({ ok: false, message: 'اتصال ایتایار روی سرور تنظیم نشده است.' });
    }

    const caption =
      `📩 پیام ناشناس جدید\n` +
      `👤 گیرنده: ${admin}\n\n` +
      `${message ? message + '\n\n' : ''}` +
      `#ناشناس-${admin}`;

    const url = `https://eitaayar.ir/api/${TOKEN}/${req.file ? 'sendFile' : 'sendMessage'}`;
    let apiResponse;

    console.log(`[${id}] شروع ارسال به ایتایار؛ نوع: ${req.file ? 'file' : 'text'}`);

    if (req.file) {
      const form = new FormData();
      form.append('chat_id', channels[admin]);
      form.append('caption', caption);
      const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
      form.append('file', blob, req.file.originalname || 'upload.bin');

      apiResponse = await fetch(url, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(60000)
      });
    } else {
      apiResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ chat_id: channels[admin], text: caption }),
        signal: AbortSignal.timeout(60000)
      });
    }

    const raw = await apiResponse.text();
    let result;
    try { result = JSON.parse(raw); }
    catch { result = { ok: false, description: raw.slice(0, 500) }; }

    console.log(`[${id}] پاسخ HTTP ایتایار: ${apiResponse.status}`);
    console.log(`[${id}] نتیجه ایتایار: ${JSON.stringify(result).slice(0, 1200)}`);

    if (!apiResponse.ok || result.ok !== true) {
      return res.status(502).json({
        ok: false,
        message: 'ایتایار فایل یا پیام را نپذیرفت. دسترسی ربات به گیرنده و تنظیمات ایتایار را بررسی کن.'
      });
    }

    console.log(`[${id}] ارسال موفق بود`);
    return res.json({
      ok: true,
      message: req.file
        ? `فایل و پیام با موفقیت برای ${admin} ارسال شدند ❤️`
        : `پیامت با موفقیت برای ${admin} ارسال شد ❤️`
    });
  } catch (err) {
    console.error(`[${id}] خطای ارسال: ${err.name || 'Error'} - ${err.message}`);
    const timeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    return res.status(timeout ? 504 : 500).json({
      ok: false,
      message: timeout ? 'پاسخ ایتایار در زمان مناسب نرسید. کمی بعد دوباره تلاش کن.' : 'خطای موقت سرور هنگام ارسال. لاگ Render را بررسی کن.'
    });
  }
});

// خطاهای Multer، از جمله حجم فایل، اینجا مدیریت می‌شوند.
app.use((err, _req, res, _next) => {
  console.error(`خطای دریافت فایل: ${err.message}`);
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, message: 'حجم فایل نباید بیشتر از ۱۰ مگابایت باشد.' });
  }
  return res.status(400).json({ ok: false, message: err.message || 'فایل قابل قبول نیست.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Nashenas Scroll Gap running on ${PORT}`);
});
