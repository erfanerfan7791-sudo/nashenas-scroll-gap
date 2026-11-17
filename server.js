const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.EITAAYAR_TOKEN;
const CHANNEL_ID = process.env.EITAAYAR_CHAT_ID || '11301199';

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '12kb' }));
app.use(express.static(__dirname));

const sendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, message: 'تعداد ارسال‌ها زیاد است. چند دقیقه بعد دوباره تلاش کن.' }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/send', sendLimiter, async (req, res) => {
  try {
    const { admin, message, website } = req.body || {};
    // Honeypot: bots often fill this hidden field. Do not forward it.
    if (website) return res.json({ ok: true, message: 'پیام دریافت شد.' });

    const allowedAdmins = ['عرفان', 'سجاد', 'حاجی', 'ریحانه', 'مارال', 'معین', 'علی', 'امیر', 'خلخالی'];
    if (!allowedAdmins.includes(admin)) {
      return res.status(400).json({ ok: false, message: 'ادمین انتخاب‌شده معتبر نیست.' });
    }
    if (typeof message !== 'string' || message.trim().length < 2 || message.trim().length > 2000) {
      return res.status(400).json({ ok: false, message: 'پیام باید بین ۲ تا ۲۰۰۰ نویسه باشد.' });
    }
    if (!TOKEN) {
      return res.status(503).json({ ok: false, message: 'اتصال ایتا هنوز توسط مدیر سایت تنظیم نشده است.' });
    }

    const text = `📩 پیام ناشناس جدید\n👤 گیرنده: ${admin}\n\n${message.trim()}\n\n— ناشناس اسکرول گپ`;
    const apiResponse = await fetch(`https://eitaayar.ir/api/${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ chat_id: CHANNEL_ID, text })
    });
    const result = await apiResponse.json().catch(() => ({}));
    if (!apiResponse.ok || result.ok !== true) {
      console.error('EitaaYar send failed:', result);
      return res.status(502).json({ ok: false, message: 'ارسال به کانال انجام نشد. مدیر سایت باید اتصال ایتا را بررسی کند.' });
    }
    return res.json({ ok: true, message: 'پیامت با موفقیت به کانال ارسال شد ❤️' });
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ ok: false, message: 'خطای موقت سرور. دوباره تلاش کن.' });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Nashenas Scroll Gap running on ${PORT}`));
