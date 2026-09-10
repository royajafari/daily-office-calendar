# اجرای محلی با Docker

## ۱. ساخت `docker/.env`

```bash
cp docker/.env.example docker/.env
```

سپس مقادیر را با یک رمز **قوی و ساخته‌شده توسط خودتان** پر کنید — این رمزها را من یا هیچ سرویس دیگری برایتان نمی‌سازد و در Git هم قرار نمی‌گیرد (`docker/.env` در `.gitignore` ریشه است).

**قوانین رمز Oracle (`ORACLE_PASSWORD`, `APP_USER_PASSWORD`, `ORDS_SYS_PASSWORD`):** حداقل ۸ کاراکتر، شامل حداقل یک حرف بزرگ، یک حرف کوچک و یک رقم؛ از نویسه‌های `'`، `"` و `@` در رمز SYS خودداری کنید.

**قوانین رمز APEX Admin (`APEX_ADMIN_PASSWORD`, `APEX_REST_PASSWORD`):** حداقل ۸ کاراکتر، حداقل یک حرف بزرگ، یک حرف کوچک، یک رقم؛ نباید شامل نام کاربری (`ADMIN`) باشد.

برای ساخت یک رمز تصادفی مطابق این قوانین می‌توانید مثلاً از دستور زیر کمک بگیرید و در صورت نیاز یک حرف بزرگ/رقم دستی اضافه کنید:

```bash
openssl rand -base64 12
```

اگر ترجیح می‌دهید خودم مقادیر واقعی را در `docker/.env` بنویسم، کافی است در همین گفت‌وگو رمزهای انتخابی‌تان را به من بدهید — فقط روی همین ماشین محلی نوشته می‌شود و به Git/GitHub ارسال نمی‌شود.

## ۲. دانلود ZIP رسمی Oracle APEX 26.1

از https://www.oracle.com/tools/downloads/apex-downloads/ دانلود کنید (نیازمند پذیرش لایسنس Oracle)، سپس:

```
docker/apex-dist/apex_26.1_en.zip
```

## ۳. Oracle JDBC driver (برای Liquibase)

فایل `ojdbc11.jar` را در `docker/drivers/` قرار دهید. تلاش می‌شود از Maven Central دریافت شود؛ در صورت محدودیت، از https://www.oracle.com/database/technologies/appdev/jdbc-downloads.html دانلود کنید.

## ۴. بالا آوردن دیتابیس

```bash
docker compose up -d oracle
docker compose logs -f oracle   # صبر کنید تا healthy شود
```

اولین اجرا (با volume خالی) اسکریپت `docker/db/setup/10-apex-26.1.sh` را خودکار اجرا می‌کند — اگر ZIP و رمزهای APEX در `.env` باشند، APEX 26.1 هم نصب می‌شود؛ در غیر این صورت فقط دیتابیس بالا می‌آید و پیام راهنما در لاگ چاپ می‌شود.

## ۵. اعمال schema (Liquibase)

```bash
docker compose --profile migrate run --rm liquibase
```

## ۶. ORDS

نیازمند لاگین به Oracle Container Registry (یک‌بار، با پذیرش لایسنس ORDS در https://container-registry.oracle.com):

```bash
docker login container-registry.oracle.com
docker compose --profile ords up -d
```

سپس، برای فعال‌سازی endpointهای REST پروژه (بعد از این‌که ORDS بالا آمد و schema را REST-enable کرد):

```bash
docker compose --profile migrate run --rm liquibase \
  --changelog-file=db/changelog/2026-09-10-02-ords-rest.yaml update
docker compose --profile migrate run --rm liquibase \
  --changelog-file=db/changelog/2026-09-10-03-apex-error-handler.yaml update
```

## ۷. اجرای تست‌ها

راهنمای کامل: [tests/database/README.md](../tests/database/README.md)
