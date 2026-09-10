# معماری — دفتر کار روزانه

## دیاگرام مؤلفه‌ها

```
                         ┌─────────────────────────────┐
   کاربر STAFF/عمومی ───▶│  Vercel: Next.js demo        │
                         │  (availability, request form)│
                         └───────────────┬──────────────┘
                                         │ HTTPS (فقط endpointهای
                                         │ محدود ORDS: GET availability,
                                         │ POST request)
                                         ▼
                         ┌─────────────────────────────┐
   کاربر OFFICE_HEAD ───▶│  Oracle APEX 26.1 (App Builder│
   (مرورگر، auth کامل)   │  یا اپ نهایی، روی ORDS)       │
                         └───────────────┬──────────────┘
                                         │ PL/SQL calls
                                         ▼
                         ┌─────────────────────────────┐
                         │  Oracle DB (FREEPDB1)         │
                         │  schema: DAILY_OFFICE         │
                         │  - office_events               │
                         │  - office_requests              │
                         │  - calendar_sync_queue           │
                         │  - app_user_roles                 │
                         │  - pkg daily_office_api             │
                         └───────────────┬──────────────┘
                                         │ FOR UPDATE SKIP LOCKED
                                         │ (از طریق ORDS REST، نه اتصال مستقیم)
                                         ▼
                         ┌─────────────────────────────┐
                         │  sync-worker (Node.js، خارج    │
                         │  از APEX، مستقل deploy می‌شود)  │
                         │  - poll صف                      │
                         │  - اعتبارسنجی قرارداد JSON Schema │
                         │  - upsert/delete در Google Calendar│
                         └───────────────┬──────────────┘
                                         │ OAuth 2.0 (service account
                                         │ یا refresh token — از env)
                                         ▼
                              Google Calendar API
```

## چرا Vercel + Oracle APEX جدا هستند

Oracle APEX روی Vercel اجرا نمی‌شود (APEX نیازمند دیتابیس Oracle + ORDS است). معماری این پروژه:

- **Backend حقیقت (source of truth):** Oracle DB + APEX 26.1 + ORDS — یا self-hosted (Docker محلی طبق `docker-compose.yml`) یا روی زیرساخت Oracle (Autonomous DB / OCI) در آینده.
- **Frontend/Demo عمومی:** یک اپ Next.js مستقل در `vercel-demo/` که:
  - به‌صورت پیش‌فرض با داده‌ی mock کار می‌کند (بدون نیاز به backend واقعی — برای دموی عمومی امن).
  - اگر متغیر محیطی `ORACLE_API_BASE_URL` تنظیم شود، به endpointهای عمومیِ محدود ORDS وصل می‌شود (فقط GET availability و POST request — هرگز CRUD رئیس، هرگز credential دیتابیس در frontend).
- این دو هرگز credential مشترک ندارند؛ ارتباط فقط از طریق REST عمومی محدود (ORDS) با نرخ محدود (rate limit) در آینده.

## صف همگام‌سازی Google Calendar

- تأیید یک رویداد (مستقیم توسط رئیس یا از طریق تأیید درخواست) یک ردیف در `calendar_sync_queue` با `operation IN ('UPSERT','DELETE')` و `idempotency_key` منحصربه‌فرد ایجاد می‌کند.
- `sync-worker` (خارج از APEX، سرویس Node.js مستقل) هر چند ثانیه صف را poll می‌کند، ردیف‌های `PENDING` را با قفل ردیفی (`FOR UPDATE SKIP LOCKED` سمت DB، از طریق ORDS) می‌گیرد، طبق قرارداد [contracts/google-calendar-upsert.json](../contracts/google-calendar-upsert.json) با Google Calendar API تماس می‌گیرد، و وضعیت را `DONE`/`FAILED` می‌کند (با retry/backoff).
- **بدون OAuth credential واقعی (Google Cloud OAuth client یا service account)، worker در حالت `dry-run` اجرا می‌شود** — قرارداد را اعتبارسنجی می‌کند و لاگ می‌زند، اما تماسی با Google نمی‌گیرد. این حالت هم قابل تست واحد است.

## Gateهای Credential (جزئیات کامل)

| Gate | چه چیزی لازم است | کجا قرار می‌گیرد | چرا من نمی‌توانم جایگزینش کنم |
|---|---|---|---|
| G1 | رمزهای واقعی Oracle/APEX | `docker/.env` (از روی `docker/.env.example`) | رمز باید توسط مالک سیستم انتخاب و محرمانه نگه داشته شود |
| G2 | ZIP رسمی Oracle APEX 26.1 | `docker/apex-dist/apex_26.1_en.zip` | Oracle توزیع مستقیم/خودکار این فایل را از طریق ابزار شخص ثالث مجاز نمی‌داند؛ نیازمند پذیرش لایسنس در سایت Oracle |
| G3 | Oracle JDBC driver | `docker/drivers/` | تلاش برای دریافت از Maven Central می‌شود؛ در صورت محدودیت شبکه/لایسنس از کاربر گرفته می‌شود |
| G4 | Google OAuth client / service-account | متغیر محیطی سرویس `sync-worker` (هرگز در Git) | نیازمند ساخت پروژه در Google Cloud Console توسط مالک تقویم |
| G5 | مجوز ساخت/push به مخزن GitHub | تعامل `gh` CLI | عملیات قابل‌مشاهده برای دیگران — نیازمند تأیید صریح هر بار |
| G6 | Login تعاملی Vercel CLI | ترمینال کاربر | OAuth تعاملی مرورگر، قابل انجام توسط عامل نیست |

## توالی تحویل

1. Spec + Architecture (این فاز) — تأیید مدل داده و معیارهای پذیرش.
2. Liquibase + PL/SQL — schema و منطق تداخل/درخواست/صف.
3. تست‌های utPLSQL روی منطق بالا.
4. تعریف APEX (لایه‌ی طراحی اکنون، لایه‌ی واقعی پس از بالا آمدن APEX زنده).
5. قرارداد + sync-worker (قابل تست بدون Google واقعی).
6. دموی Vercel (قابل build/اجرا بدون backend واقعی).
7. بالا آوردن واقعی Docker/Oracle/APEX/ORDS (گیت G1/G2/G3) و اجرای واقعی تست‌ها.
8. Commit/push به GitHub (گیت G5).
9. آماده‌سازی/اجرای deploy روی Vercel (گیت G6).
