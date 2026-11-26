
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { randomUUID } = require('node:crypto');
const axios = require('axios');
const FormData = require('form-data');
const path = require('node:path');

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
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      /^image\//,
      /^video\//,
      /^audio\//,
      /^text\//,
      /^application\/pdf$/,
      /^application\/zip$/,
      /^application\/x-zip-compressed$/,
      /^application\/msword$/,
      /^application\/vnd\./,
      /^application\/octet-stream$/
    ];

    const allowed = allowedTypes.some(type =>
      type.test(file.mimetype)
    );

    if (!allowed) {
      return cb(new Error('نوع این فایل مجاز نیست.'));
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
    message: 'تعداد ارسال‌ها زیاد است. کمی بعد دوباره تلاش کن.'
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/send', (req, _res, next) => {
  req.requestId = randomUUID().slice(0, 8);
  console.log(`[${req.requestId}] درخواست جدید`);
  next();
});

function getFileLength(form) {
  return new Promise((resolve, reject) => {
    form.getLength((error, length) => {
      if (error) reject(error);
      else resolve(length);
    });
  });
}

app.post('/send', sendLimiter, (req, res) => {
  const id = req.requestId;

  upload.single('file')(req, res, async (uploadError) => {
    if (uploadError) {
      console.error(`[${id}] خطای آپلود:`, uploadError.message);

      if (uploadError.code === 'LIMIT_FILE_SIZE') {
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

    try {
      const admin = req.body?.admin;
      const message = typeof req.body?.message === 'string'
        ? req.body.message.trim()
        : '';

      if (req.body?.website) {
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

      if (message.length > 2000) {
        return res.status(400).json({
          ok: false,
          message: 'متن پیام نباید بیشتر از ۲۰۰۰ نویسه باشد.'
        });
      }

      if (!message && !req.file) {
        return res.status(400).json({
          ok: false,
          message: 'متن پیام یا فایل انتخاب کن.'
        });
      }

      if (!TOKEN) {
        console.error(`[${id}] توکن ایتایار تنظیم نشده است`);

        return res.status(503).json({
          ok: false,
          message: 'توکن ایتایار روی سرور تنظیم نشده است.'
        });
      }

      // قالب پیام ناشناس
      const caption =
        `ناشناس جدید\n` +
        `#ناشناس_${admin}\n\n` +
        `${message || ''}`;

      const baseUrl = `https://eitaayar.ir/api/${TOKEN}`;

      let response;

      if (req.file) {
        const safeName = path.basename(
          req.file.originalname || 'file.bin'
        ).replace(/[\r\n"]/g, '_');

        console.log(
          `[${id}] فایل دریافت شد: ${safeName}, ` +
          `${req.file.mimetype}, ${req.file.size} bytes`
        );

        const form = new FormData();

        form.append('chat_id', channels[admin]);
        form.append('caption', caption);

        form.append('file', req.file.buffer, {
          filename: safeName,
          contentType: req.file.mimetype,
          knownLength: req.file.size
        });

        const contentLength = await getFileLength(form);

        console.log(`[${id}] شروع ارسال فایل به ایتایار`);

        response = await axios.post(
          `${baseUrl}/sendFile`,
          form,
          {
            headers: {
              ...form.getHeaders(),
              'Content-Length': contentLength
            },
            timeout: 90000,
            maxBodyLength: 15 * 1024 * 1024,
            maxContentLength: 15 * 1024 * 1024,
            maxRedirects: 5,
            validateStatus: () => true
          }
        );

      } else {
        console.log(`[${id}] ارسال پیام متنی`);

        const params = new URLSearchParams();
        params.append('chat_id', channels[admin]);
        params.append('text', caption);

        response = await axios.post(
          `${baseUrl}/sendMessage`,
          params.toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 60000,
            validateStatus: () => true
          }
        );
      }

      console.log(`[${id}] HTTP: ${response.status}`);

      console.log(
        `[${id}] پاسخ ایتایار:`,
        JSON.stringify(response.data).slice(0, 2000)
      );

      if (
        response.status < 200 ||
        response.status >= 300 ||
        response.data?.ok !== true
      ) {
        return res.status(502).json({
          ok: false,
          message: 'ایتایار ارسال را نپذیرفت. لاگ Render را بررسی کن.'
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
        `[${id}] خطای ارسال:`,
        error.code || error.name,
        error.message
      );

      if (error.response) {
        console.error(
          `[${id}] پاسخ خطا:`,
          error.response.status,
          error.response.data
        );
      }

      const timeout =
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT';

      return res.status(timeout ? 504 : 502).json({
        ok: false,
        message: timeout
          ? 'زمان انتظار ارسال تمام شد.'
          : 'خطا در ارتباط با ایتایار. لاگ Render را بررسی کن.'
      });
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Nashenas Scroll Gap running on ${PORT}`);
});
