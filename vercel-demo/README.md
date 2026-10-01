# vercel-demo

دموی عمومی Next.js برای «دفتر کار روزانه» — مشاهده‌ی زمان‌های در دسترس (busy/free) و ثبت درخواست وقت.

## حالت‌ها

- **بدون `ORACLE_API_BASE_URL`** (پیش‌فرض): داده‌ی نمایشی (`lib/demo-data.ts`) و ذخیره‌ی درخواست‌ها در حافظه — امن برای انتشار عمومی بدون هیچ backend واقعی.
- **با `ORACLE_API_BASE_URL`**: از endpointهای عمومی محدود ORDS می‌خواند/می‌نویسد (`GET /availability`, `POST /requests` — تعریف‌شده در `db/packages/003_ords_modules.sql`). هیچ credential دیتابیسی هرگز در این پروژه یا در مرورگر قرار نمی‌گیرد.

## «من ربات نیستم» در فرم ثبت درخواست

فرم `/request` ویجت [not-robot-captcha](../not-robot-captcha/) را دارد. `POST /api/appointments` اول فیلدها را بررسی می‌کند و بعد توکن کپچا را. بدون توکن معتبر و یک‌بارمصرف، درخواست با `403` رد می‌شود.

- `public/not-robot.js` یک کپی دقیق از `not-robot-captcha/widget/not-robot.js` است. اگر فایل اصلی را تغییر دادید، کپی را هم به‌روز کنید. تست `test/captcha.test.ts` اختلاف این دو را می‌گیرد.
- منطق سرور در `lib/captcha.ts` است و از مسیرهای `app/api/captcha/challenge` و `app/api/captcha/solve` استفاده می‌شود.
- **در Vercel متغیر `CAPTCHA_SECRET` الزامی است** (بخش Deploy را ببینید).
- **محدودیت:** با `ORACLE_API_BASE_URL`، این کپچا فقط مسیر Vercel را محافظت می‌کند. endpoint عمومی `POST /requests` در ORDS خودش کپچا ندارد و مستقیم قابل صدا زدن است.

## توسعه

```bash
npm install
npm run dev
```

## تست

```bash
npm test
```

`test/captcha.test.ts` پروتکل کپچا را با حل‌کننده‌ی خود ویجت می‌آزماید. `test/validate.test.ts` منطق اعتبارسنجی فرم را می‌آزماید (همان قواعدی که `daily_office_api.submit_request` در دیتابیس اعمال می‌کند — DO-AC-05)؛ `test/demo-data.test.ts` رفتار ذخیره‌ساز نمایشی را می‌آزماید.

## Build

```bash
npm run build
```

## Deploy روی Vercel

نیازمند `vercel login` تعاملی (Gate G6 در [docs/architecture.md](../docs/architecture.md)):

```bash
npx vercel link
npx vercel env add CAPTCHA_SECRET        # الزامی — کلید کپچای فرم ثبت درخواست
npx vercel env add ORACLE_API_BASE_URL   # اختیاری — در صورت وجود ORDS عمومی
npx vercel deploy --prod
```
