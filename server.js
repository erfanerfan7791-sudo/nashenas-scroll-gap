
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { randomUUID } = require('crypto');

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
      return callback(
        new Error('فقط عکس، ویدیو، صوت و PDF مجاز است.')
      );
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

// ثبت شروع درخواست
app.use('/send', (req, _res, next) => {
  req.requestId = randomUUID().slice(0, 8);
  console.log(`[${req.requestId}] درخواست جدید دریافت شد`);
  next();
});

app.post(
  '/send',
  sendLimiter,
  upload.single('file'),
  async (req, res) => {
    const id = req.requestId;

    try {
      const admin = req.body.admin;

      const message =
        typeof req.body.message === 'string'
          ? req.body.message.trim()
          : '';

      if (req.body.website) {
        return res.json({
          ok: true,
          message: 'پیام دریافت شد.'
        });
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
        console.error(`[${id}] توکن ایتایار تنظیم نشده است`);

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
        console.log(
          `[${id}] فایل دریافت شد: ${req.file.mimetype} - ${req.file.size} bytes`
        );

        const formData = new FormData();

        formData.append('chat_id', chatId);
        formData.append('caption', caption);

        formData.append(
          'file',
          new Blob([req.file.buffer], {
            type: req.file.mimetype
          }),
          req.file.originalname
        );

        console.log(`[${id}] شروع ارسال فایل به ایتایار`);

        apiResponse = await fetch(
          `https://eitaayar.ir/api/${TOKEN}/sendFile`,
          {
            method: 'POST',
            body: formData,
            signal: AbortSignal.timeout(70000)
          }
        );

      } else {
        console.log(`[${id}] شروع ارسال پیام متنی`);

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
            }),
            signal: AbortSignal.timeout(70000)
          }
        );
      }

      console.log(
        `[${id}] پاسخ HTTP ایتایار: ${apiResponse.status}`
      );

      const rawResponse = await apiResponse.text();

      let result;

      try {
        result = JSON.parse(rawResponse);
      } catch {
        result = null;
      }

      console.log(
        `[${id}] پاسخ ایتایار:`,
        rawResponse.slice(0, 1000)
      );

      if (!apiResponse.ok || !result || result.ok !== true) {
        console.error(`[${id}] ارسال توسط ایتایار تأیید نشد`);

        return res.status(502).json({
          ok: false,
          message: 'ایتا ارسال را تأیید نکرد. Logs را بررسی کن.'
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
      console.error(
        `[${id}] خطای ارسال:`,
        err.name,
        err.message
      );

      if (
        err.name === 'TimeoutError' ||
        err.name === 'AbortError'
      ) {
        return res.status(504).json({
          ok: false,
          message: 'پاسخ ایتایار بیش از حد طول کشید. دوباره تلاش کن.'
        });
      }

      return res.status(500).json({
        ok: false,
        message: 'خطای موقت سرور. Logs را بررسی کن.'
      });
    }
  }
);

// مدیریت خطاهای فایل
app.use((err, req, res, _next) => {
  console.error(
    `[${req.requestId || 'unknown'}] خطای دریافت فایل:`,
    err.message
  );

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        ok: false,
        message: 'حجم فایل نباید بیشتر از ۱۰ مگابایت باشد.'
      });
    }

    return res.status(400).json({
      ok: false,
      message: 'مشکلی در دریافت فایل پیش آمد.'
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
