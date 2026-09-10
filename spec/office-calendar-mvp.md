# DO-01 — Daily Office Calendar MVP

## Outcome

رئیس اداره (نقش `OFFICE_HEAD`) یک محل واحد برای مدیریت قرارها، جلسات، مأموریت‌ها و سایر رویدادهای کاری‌اش دارد. سایر کاربران سازمان (`STAFF`) نمی‌توانند رویدادها را ببینند یا ویرایش کنند؛ فقط بازه‌های زمانی busy/free را مشاهده می‌کنند و می‌توانند درخواست وقت ثبت کنند که باید توسط رئیس یا نماینده‌اش تأیید یا رد شود. رویدادهای تأییدشده باید به‌صورت خودکار (و idempotent) با تقویم Google رئیس هم‌گام شوند.

## نقش‌ها و مجوزها

| عملیات | OFFICE_HEAD | STAFF |
|---|---|---|
| مشاهده‌ی جزئیات کامل رویداد (عنوان، مکان، توضیحات) | ✅ | ❌ |
| مشاهده‌ی بازه‌های busy/free (بدون عنوان) | ✅ | ✅ |
| ایجاد/ویرایش/حذف رویداد مستقیم | ✅ | ❌ |
| ثبت درخواست وقت | ✅ (اختیاری) | ✅ |
| تأیید/رد درخواست | ✅ | ❌ |
| مشاهده‌ی وضعیت صف همگام‌سازی Google Calendar | ✅ | ❌ |

## دامنه (Scope) و پیش‌فرض‌ها

- فقط یک نقش `OFFICE_HEAD` در این MVP (تک‌کاربره از نظر مالکیت تقویم).
- انواع رویداد: `MEETING`, `MISSION`, `APPOINTMENT`, `OTHER`.
- همه‌ی زمان‌ها `TIMESTAMP WITH TIME ZONE` (چند دفتر/منطقه‌ی زمانی را پشتیبانی می‌کند، حتی اگر MVP فقط یک منطقه‌ی زمانی استفاده کند).
- همگام‌سازی Google Calendar از سمت سرور انجام می‌شود (worker مستقل)؛ هیچ OAuth secret در session state اپلیکیشن APEX، مرورگر یا Git ذخیره نمی‌شود.
- درخواست‌های تأییدشده دقیقاً یک رویداد پیوندی (`office_events.id`) ایجاد می‌کنند؛ رد یا لغو، رویدادی نمی‌سازد.

## خارج از دامنه (Non-goals)

- چند رئیس/چند تقویم هم‌زمان.
- همگام‌سازی دوطرفه (تغییرات دستی در Google Calendar به Oracle برنمی‌گردد در این نسخه).
- اعلان real-time (push notification) به کارکنان؛ فقط polling/رفرش صفحه.

## معیارهای پذیرش

| کد | معیار | نحوه‌ی اعتبارسنجی |
|---|---|---|
| DO-AC-01 | ایجاد یا تأیید رویداد که با یک رویداد موجود تداخل زمانی دارد، رد می‌شود (خطای `ORA-20002`). | تست utPLSQL `rejects_conflict` |
| DO-AC-02 | کاربر STAFF فقط بازه‌های busy/free را می‌بیند؛ عنوان/توضیحات رویداد برایش قابل مشاهده نیست. | تست utPLSQL `availability_hides_title` + بازبینی صفحه‌ی Availability |
| DO-AC-03 | ثبت درخواست توسط STAFF وضعیت اولیه‌ی `PENDING` می‌گیرد و رویدادی بلافاصله ساخته نمی‌شود. | تست utPLSQL `creates_pending_request` |
| DO-AC-04 | تأیید یک درخواست دقیقاً یک رویداد پیوندی می‌سازد و آن را در صف همگام‌سازی قرار می‌دهد؛ رد درخواست رویدادی نمی‌سازد. | تست utPLSQL `approval_creates_event` |
| DO-AC-05 | خطاهای اعتبارسنجی (بازه‌ی نامعتبر، فیلد اجباری خالی) پیام مشخص و کد خطای قابل تشخیص برمی‌گردانند، نه یک exception خام. | تست utPLSQL `rejects_invalid_range` + بازبینی دستی صفحه‌ی Request |
| DO-AC-06 | Retry صف همگام‌سازی Google Calendar idempotent است: پردازش دوباره‌ی یک ردیف با همان `idempotency_key` رویداد تکراری در Google نمی‌سازد. | تست utPLSQL `sync_retry_is_idempotent` + تست واحد worker روی schema قرارداد |
| DO-AC-07 | رئیس اداره می‌تواند وضعیت صف همگام‌سازی (`PENDING`/`PROCESSING`/`DONE`/`FAILED`) را برای هر رویداد ببیند. | بازبینی صفحه‌ی Sync Monitoring |

## ماتریس تروسیبیلیتی

| معیار | صفحه‌ی APEX | Changeset Liquibase | تست |
|---|---|---|---|
| DO-AC-01 | `apex/pages/page-010-calendar.apexlang` | `2026-09-10-01-daily-office.yaml` (`office_events`, تریگر تداخل) | `tests/database/daily_office_test.pkb::rejects_conflict` |
| DO-AC-02 | `apex/pages/page-020-availability.apexlang` | همان (`daily_office_api.get_availability`) | `tests/database/daily_office_test.pkb::availability_hides_title` |
| DO-AC-03 | `apex/pages/page-030-request.apexlang` | همان (`office_requests`) | `tests/database/daily_office_test.pkb::creates_pending_request` |
| DO-AC-04 | `apex/pages/page-040-review.apexlang` | همان (`daily_office_api.review_request`) | `tests/database/daily_office_test.pkb::approval_creates_event` |
| DO-AC-05 | `apex/pages/page-030-request.apexlang` | همان (validation triggers) | `tests/database/daily_office_test.pkb::rejects_invalid_range` |
| DO-AC-06 | `apex/pages/page-050-sync-monitoring.apexlang` | همان (`calendar_sync_queue`) | `tests/database/daily_office_test.pkb::sync_retry_is_idempotent`, `sync-worker/test/contract.test.ts` |
| DO-AC-07 | `apex/pages/page-050-sync-monitoring.apexlang` | همان (`calendar_sync_queue`) | بازبینی دستی — `tests/acceptance/mvp.md` |

## چک‌لیست پذیرش دستی

فایل کامل: [tests/acceptance/mvp.md](../tests/acceptance/mvp.md)
