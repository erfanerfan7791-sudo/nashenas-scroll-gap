
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, callback) => {
    const allowed =
      file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('video/') ||
      file.mimetype.startsWith('audio/') ||
      file.mimetype === 'application/pdf';

    if (!allowed) {
      return callback(new Error('فقط عکس، ویدیو، صوت و PDF مجاز است.'));
    }

    callback(null, true);
  }
});

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

app.post('/send', sendLimiter, upload.single('file'), async (req, res) => {
  try {
    const admin = req.body.admin;
    const message = typeof req.body.message === 'string'
      ? req.body.message.trim()
      : '';
    const website = req.body.website;

    if (website) {
      return res.json({ ok: true, message: 'پیام دریافت شد.' });
    }

    if (!Object.prototype.hasOwnProperty.call(channels, admin)) {
      return res.status(400).json({
        ok: false,
        message: 'ادمین انتخاب‌شده معتبر نیست.'
      });
    }

    if (message.length > 2000) {
      return res.status(400).json({
        ok: false,
        message: 'متن پیام نباید بیشتر از ۲۰۰۰ نویسه باشد.'
      });
    }

    if (!message && !req.file) {
      return res.status(400).json({
        ok: false,
        message: 'متن پیام یا یک فایل انتخاب کن.'
      });
    }

    if (!TOKEN) {
      return res.status(503).json({
        ok: false,
        message: 'اتصال ایتایار تنظیم نشده است.'
      });
    }

    const caption =
      `📩 پیام ناشناس جدید\n` +
      `👤 گیرنده: ${admin}\n\n` +
      `${message ? message + '\n\n' : ''}` +
      `#ناشناس_${admin}`;

    const chatId = channels[admin];
    let apiResponse;

    if (req.file) {
      const formData = new FormData();

      formData.append('chat_id', chatId);
      formData.append('caption', caption);
      formData.append(
        'file',
        new Blob([req.file.buffer], { type: req.file.mimetype }),
        req.file.originalname
      );

      apiResponse = await fetch(
        `https://eitaayar.ir/api/${TOKEN}/sendFile`,
        {
          method: 'POST',
          body: formData
        }
      );
    } else {
      apiResponse = await fetch(
        `https://eitaayar.ir/api/${TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            chat_id: chatId,
            text: caption
          })
        }
      );
    }

    const result = await apiResponse.json().catch(() => ({}));

    if (!apiResponse.ok || result.ok !== true) {
      console.error('EitaaYar send failed:', result);

      return res.status(502).json({
        ok: false,
        message: 'ارسال انجام نشد. دسترسی ربات و تنظیمات ایتا را بررسی کن.'
      });
    }

    return res.json({
      ok: true,
      message: req.file
        ? `فایل و پیام با موفقیت برای ${admin} ارسال شدند ❤️`
        : `پیامت با موفقیت برای ${admin} ارسال شد ❤️`
    });

  } catch (err) {
    console.error('Send error:', err.message);

    return res.status(500).json({
      ok: false,
      message: 'خطای موقت سرور. دوباره تلاش کن.'
    });
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      ok: false,
      message: 'حجم فایل نباید بیشتر از ۱۰ مگابایت باشد.'
    });
  }

  return res.status(400).json({
    ok: false,
    message: err.message || 'فایل قابل قبول نیست.'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Nashenas Scroll Gap running on ${PORT}`);
});
