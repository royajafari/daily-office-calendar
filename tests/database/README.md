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
```

## اجرا

```sql
SET SERVEROUTPUT ON
EXEC ut.run('daily_office_test');
```

یا از طریق SQLcl:

```
sql /nolog
conn <user>/<password>@//localhost:1521/FREEPDB1
set serveroutput on
exec ut.run('daily_office_test');
```

## وضعیت

این تست‌ها هنوز روی یک نمونه‌ی زنده‌ی Oracle اجرا نشده‌اند — این کار در فاز ۷ (بعد از دریافت `docker/.env` و ZIP رسمی APEX از کاربر) انجام می‌شود. تا آن زمان، صحت نحوی/منطقی از طریق بازبینی کد تضمین می‌شود.
