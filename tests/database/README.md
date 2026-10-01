# تست‌های utPLSQL

این تست‌ها منطق `daily_office_api` (تداخل زمانی، درخواست‌ها، availability، صف sync) را مستقیماً روی دیتابیس اجرا می‌کنند و نیازمند یک Oracle در دسترس با schema اعمال‌شده هستند (نتیجه‌ی `docker compose --profile migrate up`، فاز ۷ پروژه).

## نصب utPLSQL (یک‌بار، داخل schema هدف)

```sql
-- به‌عنوان کاربر ادمین/DBA:
@utPLSQL/source/install_headless.sql <target_schema>
```

مرجع رسمی: https://github.com/utPLSQL/utPLSQL/releases (نسخه‌ی سازگار با Oracle 23c Free).

## کامپایل تست‌ها

```sql
@tests/database/daily_office_test.pks
@tests/database/daily_office_test.pkb
@tests/database/captcha_test.pks
@tests/database/captcha_test.pkb
```

## اجرا

```sql
SET SERVEROUTPUT ON
EXEC ut.run('daily_office_test');
EXEC ut.run('captcha_test');
```

یا از طریق SQLcl:

```
sql /nolog
conn <user>/<password>@//localhost:1521/FREEPDB1
set serveroutput on
exec ut.run('daily_office_test');
```

## وضعیت

`captcha_test` (۱۳ تست) در تاریخ ۲۰۲۶-۱۰-۰۱ روی Oracle 23ai Free با utPLSQL v3.2.3 اجرا شد و همه‌ی تست‌ها پاس شدند. همین تست‌ها روی Oracle 11g XE (11.2.0.2) هم پاس شدند. utPLSQL v3.2 روی 11g نصب نمی‌شود (از `NONEDITIONABLE` که مخصوص 12c است استفاده می‌کند)، پس آنجا با یک جایگزین کوچک و موقت برای `ut.expect` اجرا شدند. این تست‌ها commit می‌کنند (`--%rollback(manual)`)، چون `captcha_api` از تراکنش مستقل استفاده می‌کند. هر ردیفی که تست‌ها بسازند، بعد از هر تست پاک می‌شود.

این تست‌ها هنوز روی یک نمونه‌ی زنده‌ی Oracle اجرا نشده‌اند — این کار در فاز ۷ (بعد از دریافت `docker/.env` و ZIP رسمی APEX از کاربر) انجام می‌شود. تا آن زمان، صحت نحوی/منطقی از طریق بازبینی کد تضمین می‌شود.
