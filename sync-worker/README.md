# sync-worker

سرویس Node.js مستقل (خارج از APEX) که `calendar_sync_queue` را از طریق ORDS poll می‌کند و رویدادها را روی Google Calendar رئیس ایجاد/به‌روزرسانی/حذف می‌کند.

## اجرا

```bash
npm install
cp .env.example .env   # سپس ORDS_BASE_URL و در صورت وجود Google credentials را پر کنید
npm run dev
```

## حالت‌ها

- **بدون Google credentials** (پیش‌فرض): `dry-run` — صف را poll می‌کند، قرارداد را اعتبارسنجی می‌کند، لاگ می‌زند، اما تماسی با Google نمی‌گیرد.
- **با `GOOGLE_CLIENT_EMAIL`/`GOOGLE_PRIVATE_KEY`/`GOOGLE_CALENDAR_ID`** (Gate G4 در [docs/architecture.md](../docs/architecture.md)): تماس واقعی با Google Calendar API با idempotency واقعی (جست‌وجوی رویداد موجود بر اساس `idempotencyKey` در `extendedProperties.private` پیش از insert).

## تست

```bash
npm test
```

تست‌ها (`test/contract.test.ts`, `test/config.test.ts`) بدون نیاز به Oracle یا Google واقعی اجرا می‌شوند: اعتبارسنجی schema قرارداد، پایداری `idempotencyKey` در retry، و منطق انتخاب dry-run/real mode را پوشش می‌دهند.
