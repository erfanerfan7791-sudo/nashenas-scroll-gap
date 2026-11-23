
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { randomUUID } = require('node:crypto');
const axios = require('axios');
const FormData = require('form-data');

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
    const allowed =
      file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('video/') ||
      file.mimetype.startsWith('audio/') ||
      file.mimetype === 'application/pdf';

    if (!allowed) {
      return cb(new Error('فقط عکس، ویدیو، صوت و PDF مجاز است.'));
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
  console.log(`[${req.requestId}] درخواست جدید دریافت شد`);
  next();
});

app.post('/send', sendLimiter, (req, res) => {
  const id = req.requestId;

  upload.single('file')(req, res, async (uploadError) => {
    if (uploadError) {
      console.error(`[${id}] خطای دریافت فایل:`, uploadError.message);

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

    try {
      console.log(`[${id}] اطلاعات فرم دریافت شد`);

      const admin = req.body?.admin;
      const message = typeof req.body?.message === 'string'
        ? req.body.message.trim()
        : '';

      if (req.body?.website) {
        return res.json({ ok: true, message: 'پیام دریافت شد.' });
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
          message: 'متن پیام نباید بیشتر از ۲۰۰۰ نویسه باشد.'
        });
      }

      if (!TOKEN) {
        console.error(`[${id}] EITAAYAR_TOKEN تنظیم نشده است`);

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

      const method = req.file ? 'sendFile' : 'sendMessage';
      const url = `https://eitaayar.ir/api/${TOKEN}/${method}`;

      console.log(`[${id}] شروع ارسال با Axios: ${method}`);

      let response;

      if (req.file) {
        console.log(
          `[${id}] فایل: ${req.file.originalname} - ${req.file.size} bytes`
        );

        const form = new FormData();

        form.append('chat_id', channels[admin]);
        form.append('caption', caption);

        form.append(
          'file',
          req.file.buffer,
          {
            filename: req.file.originalname || 'upload.bin',
            contentType: req.file.mimetype,
            knownLength: req.file.size
          }
        );

        response = await axios.post(url, form, {
          headers: form.getHeaders(),
          timeout: 30000,
          maxBodyLength: 12 * 1024 * 1024,
          maxContentLength: 12 * 1024 * 1024,
          validateStatus: () => true
        });

      } else {
        const params = new URLSearchParams();
        params.append('chat_id', channels[admin]);
        params.append('text', caption);

        response = await axios.post(url, params.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 30000,
          validateStatus: () => true
        });
      }

      console.log(`[${id}] پاسخ HTTP ایتایار: ${response.status}`);
      console.log(
        `[${id}] پاسخ API:`,
        JSON.stringify(response.data).slice(0, 1200)
      );

      if (
        response.status < 200 ||
        response.status >= 300 ||
        response.data?.ok !== true
      ) {
        return res.status(502).json({
          ok: false,
          message: 'ایتایار ارسال را نپذیرفت. پاسخ API در Logs ثبت شده است.'
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
        `[${id}] خطای Axios:`,
        error.code || error.name,
        error.message
      );

      if (error.response) {
        console.error(
          `[${id}] پاسخ خطای ایتایار:`,
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
          ? 'زمان پاسخ ایتایار تمام شد.'
          : 'ارتباط با ایتایار برقرار نشد. لاگ سرور را بررسی کن.'
      });
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Nashenas Scroll Gap running on ${PORT}`);
});
