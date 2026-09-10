# vercel-demo

دموی عمومی Next.js برای «دفتر کار روزانه» — مشاهده‌ی زمان‌های در دسترس (busy/free) و ثبت درخواست وقت.

## حالت‌ها

- **بدون `ORACLE_API_BASE_URL`** (پیش‌فرض): داده‌ی نمایشی (`lib/demo-data.ts`) و ذخیره‌ی درخواست‌ها در حافظه — امن برای انتشار عمومی بدون هیچ backend واقعی.
- **با `ORACLE_API_BASE_URL`**: از endpointهای عمومی محدود ORDS می‌خواند/می‌نویسد (`GET /availability`, `POST /requests` — تعریف‌شده در `db/packages/003_ords_modules.sql`). هیچ credential دیتابیسی هرگز در این پروژه یا در مرورگر قرار نمی‌گیرد.

## توسعه

```bash
npm install
npm run dev
```

## تست

```bash
npm test
```

`test/validate.test.ts` منطق اعتبارسنجی فرم را می‌آزماید (همان قواعدی که `daily_office_api.submit_request` در دیتابیس اعمال می‌کند — DO-AC-05)؛ `test/demo-data.test.ts` رفتار ذخیره‌ساز نمایشی را می‌آزماید.

## Build

```bash
npm run build
```

## Deploy روی Vercel

نیازمند `vercel login` تعاملی (Gate G6 در [docs/architecture.md](../docs/architecture.md)):

```bash
npx vercel link
npx vercel env add ORACLE_API_BASE_URL   # اختیاری — در صورت وجود ORDS عمومی
npx vercel deploy --prod
```
