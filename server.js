
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

// محدودیت فایل: ۱۰ مگابایت
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowed =
      file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('video/') ||
      file.mimetype.startsWith('audio/') ||
      file.mimetype === 'application/pdf';

    if (!allowed) {
      return cb(new Error('فرمت فایل مجاز نیست.'));
    }

    cb(null, true);
  }
});

const sendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    ok: false,
    message: 'تعداد ارسال‌ها زیاد است. کمی بعد تلاش کن.'
  }
});

// بررسی سلامت سرور
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'Nashenas Scroll Gap'
  });
});

// ثبت شروع درخواست
app.use('/send', (req, res, next) => {
  req.requestId = randomUUID().slice(0, 8);
  console.log(`[${req.requestId}] درخواست جدید دریافت شد`);
  next();
});

// ارسال پیام و فایل
app.post('/send', sendLimiter, (req, res) => {
  const id = req.requestId;

  console.log(`[${id}] شروع دریافت اطلاعات`);

  // دریافت فایل با مدیریت خطای مستقل
  upload.single('file')(req, res, async (uploadError) => {

    if (uploadError) {
      console.error(
        `[${id}] خطای دریافت فایل:`,
        uploadError.message
      );

      if (
        uploadError instanceof multer.MulterError &&
        uploadError.code === 'LIMIT_FILE_SIZE'
      ) {
        return res.status(413).json({
          ok: false,
          message: 'حجم فایل نباید بیشتر از ۱۰ مگابایت باشد.'
        });
      }

      return res.status(400).json({
        ok: false,
        message: uploadError.message || 'خطا در دریافت فایل.'
      });
    }

    console.log(`[${id}] دریافت اطلاعات تمام شد`);

    try {
      const admin = req.body?.admin;

      const message =
        typeof req.body?.message === 'string'
          ? req.body.message.trim()
          : '';

      const website = req.body?.website;

      if (website) {
        return res.json({
          ok: true,
          message: 'پیام دریافت شد.'
        });
      }

      if (!Object.prototype.hasOwnProperty.call(channels, admin)) {
        return res.status(400).json({
          ok: false,
          message: 'گیرنده انتخاب‌شده معتبر نیست.'
        });
      }

      if (!message && !req.file) {
        return res.status(400).json({
          ok: false,
          message: 'متن پیام یا فایل انتخاب کن.'
        });
      }

      if (message.length > 2000) {
        return res.status(400).json({
          ok: false,
          message: 'متن پیام بیشتر از ۲۰۰۰ نویسه است.'
        });
      }

      if (!TOKEN) {
        console.error(`[${id}] توکن ایتایار تنظیم نشده است`);

        return res.status(503).json({
          ok: false,
          message: 'اتصال ایتایار تنظیم نشده است.'
        });
      }

      if (req.file) {
        console.log(
          `[${id}] فایل دریافت شد: ${req.file.originalname}`
        );

        console.log(
          `[${id}] حجم فایل: ${req.file.size} bytes`
        );
      }

      const caption =
        `📩 پیام ناشناس جدید\n` +
        `👤 گیرنده: ${admin}\n\n` +
        `${message ? message + '\n\n' : ''}` +
        `#ناشناس_${admin}`;

      const method = req.file ? 'sendFile' : 'sendMessage';

      const url =
        `https://eitaayar.ir/api/${TOKEN}/${method}`;

      console.log(
        `[${id}] شروع ارتباط با ایتایار: ${method}`
      );

      let response;

      if (req.file) {
        const formData = new FormData();

        formData.append('chat_id', channels[admin]);
        formData.append('caption', caption);

        const blob = new Blob(
          [req.file.buffer],
          { type: req.file.mimetype }
        );

        formData.append(
          'file',
          blob,
          req.file.originalname || 'upload.bin'
        );

        response = await fetch(url, {
          method: 'POST',
          body: formData,
          signal: AbortSignal.timeout(30000)
        });

      } else {

        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            chat_id: channels[admin],
            text: caption
          }),
          signal: AbortSignal.timeout(30000)
        });
      }

      console.log(
        `[${id}] پاسخ HTTP: ${response.status}`
      );

      const raw = await response.text();

      let result;

      try {
        result = JSON.parse(raw);
      } catch {
        console.error(
          `[${id}] پاسخ غیر JSON ایتایار:`,
          raw.slice(0, 500)
        );

        return res.status(502).json({
          ok: false,
          message: 'پاسخ ایتایار قابل خواندن نیست.'
        });
      }

      console.log(
        `[${id}] نتیجه ایتایار:`,
        JSON.stringify(result).slice(0, 1000)
      );

      if (!response.ok || result.ok !== true) {
        return res.status(502).json({
          ok: false,
          message:
            'ایتایار ارسال را نپذیرفت. دسترسی ربات و مقصد را بررسی کن.'
        });
      }

      console.log(`[${id}] ارسال موفق بود`);

      return res.json({
        ok: true,
        message: req.file
          ? `فایل با موفقیت برای ${admin} ارسال شد ❤️`
          : `پیامت با موفقیت برای ${admin} ارسال شد ❤️`
      });

    } catch (error) {

      console.error(
        `[${id}] خطای سرور:`,
        error.name,
        error.message
      );

      const isTimeout =
        error.name === 'TimeoutError' ||
        error.name === 'AbortError';

      return res.status(isTimeout ? 504 : 500).json({
        ok: false,
        message: isTimeout
          ? 'ارتباط با ایتایار بیش از حد طول کشید.'
          : 'خطای داخلی سرور هنگام ارسال.'
      });
    }
  });
});

// خطاهای عمومی
app.use((err, req, res, next) => {
  console.error('خطای عمومی:', err.message);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    ok: false,
    message: 'خطای داخلی سرور.'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `Nashenas Scroll Gap running on ${PORT}`
  );
});
