# دفتر کار روزانه (Daily Office Calendar)

اپلیکیشن Oracle APEX 26.1 برای مدیریت قرارها، جلسات، مأموریت‌ها و رویدادهای رئیس اداره، با همگام‌سازی Google Calendar و یک دموی عمومی روی Vercel برای نمایش availability و ثبت درخواست.

## نقش‌ها
- **OFFICE_HEAD** (رئیس اداره): CRUD کامل روی رویدادها (`office_events`)، تأیید/رد درخواست‌های کارکنان.
- **STAFF** (سایر کاربران): فقط بازه‌های busy/free را می‌بینند (بدون عنوان محرمانه) و درخواست ثبت می‌کنند (`office_requests`).

## نقشه‌ی مخزن
| مسیر | محتوا |
|---|---|
| [spec/office-calendar-mvp.md](spec/office-calendar-mvp.md) | مشخصات، معیارهای پذیرش، ماتریس تروسیبیلیتی |
| [docs/architecture.md](docs/architecture.md) | معماری سیستم و gateهای credential |
| [db/changelog/](db/changelog/) | Liquibase migrations |
| [db/packages/](db/packages/) | DDL و پکیج‌های PL/SQL |
| [apex/](apex/) | تعریف اپلیکیشن و صفحات APEX (لایه‌ی طراحی + export واقعی) |
| [contracts/google-calendar-upsert.json](contracts/google-calendar-upsert.json) | قرارداد JSON Schema برای صف همگام‌سازی Google Calendar |
| [sync-worker/](sync-worker/) | Worker خارج از APEX برای پردازش صف و تماس با Google Calendar API |
| [tests/](tests/) | تست‌های utPLSQL، تست‌های worker، چک‌لیست پذیرش |
| [vercel-demo/](vercel-demo/) | دموی Next.js برای مشاهده‌ی availability و ثبت درخواست |
| [docker-compose.yml](docker-compose.yml), [docker/](docker/) | Oracle Free + Liquibase + ORDS برای اجرای محلی |

## پیش‌نیازهای اجرای محلی (گیت‌شده — هیچ‌کدام در Git نیست)
1. `docker/.env` واقعی از روی [docker/.env.example](docker/.env.example)
2. ZIP رسمی Oracle APEX 26.1 در `docker/apex-dist/apex_26.1_en.zip` (دانلود از Oracle، پذیرش لایسنس)
3. Oracle JDBC driver در `docker/drivers/`
4. برای همگام‌سازی واقعی Google Calendar: OAuth client / service-account در env سرویس `sync-worker` (بدون آن، worker در حالت dry-run کار می‌کند)

جزئیات کامل در [docs/architecture.md](docs/architecture.md#gate‌های-credential).

## توسعه
گردش‌کار Spec-Driven: Spec → Architecture → Data Model → Contracts → APEX design → Tests → Demo، با ماتریس تروسیبیلیتی در `spec/office-calendar-mvp.md`.
