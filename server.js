
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.EITAAYAR_TOKEN;

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '12kb' }));
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

const sendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    ok: false,
    message: 'تعداد ارسال‌ها زیاد است. چند دقیقه بعد دوباره تلاش کن.'
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/send', sendLimiter, async (req, res) => {
  try {
    const { admin, message, website } = req.body || {};

    if (website) {
      return res.json({ ok: true, message: 'پیام دریافت شد.' });
    }

    if (!Object.prototype.hasOwnProperty.call(channels, admin)) {
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
        message: 'پیام باید بین ۲ تا ۲۰۰۰ نویسه باشد.'
      });
    }

    if (!TOKEN) {
      return res.status(503).json({
        ok: false,
        message: 'اتصال ایتا تنظیم نشده است.'
      });
    }

    const text =
  `📩 پیام ناشناس جدید\n` +
  `👤 گیرنده: ${admin}\n\n` +
  `${message.trim()}\n\n` +
  `#ناشناس_${admin}`;

    const apiResponse = await fetch(
      `https://eitaayar.ir/api/${TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          chat_id: channels[admin],
          text
        })
      }
    );

    const result = await apiResponse.json().catch(() => ({}));

    if (!apiResponse.ok || result.ok !== true) {
      console.error('EitaaYar send failed:', result);

      return res.status(502).json({
        ok: false,
        message: 'ارسال پیام انجام نشد. دسترسی ربات به کانال را بررسی کن.'
      });
    }

    return res.json({
      ok: true,
      message: `پیامت با موفقیت برای ${admin} ارسال شد ❤️`
    });

  } catch (err) {
    console.error('Send error:', err.message);

    return res.status(500).json({
      ok: false,
      message: 'خطای موقت سرور. دوباره تلاش کن.'
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Nashenas Scroll Gap running on ${PORT}`);
});
