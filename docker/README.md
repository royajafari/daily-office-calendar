# اجرای محلی با Docker

## ۱. ساخت `docker/.env`

```bash
cp docker/.env.example docker/.env
```

سپس مقادیر را با یک رمز **قوی و ساخته‌شده توسط خودتان** پر کنید — این رمزها را من یا هیچ سرویس دیگری برایتان نمی‌سازد و در Git هم قرار نمی‌گیرد (`docker/.env` در `.gitignore` ریشه است).

**قوانین رمز Oracle (`ORACLE_PASSWORD`, `APP_USER_PASSWORD`, `ORDS_PUBLIC_USER_PASSWORD`):** حداقل ۸ کاراکتر، شامل حداقل یک حرف بزرگ، یک حرف کوچک و یک رقم؛ از نویسه‌های `'`، `"` و `@` در رمز SYS خودداری کنید.

**`ORDS_SYS_PASSWORD` باید دقیقاً با `ORACLE_PASSWORD` یکسان باشد** (هر دو رمز واقعی SYS‌اند؛ SYS فقط یک رمز دارد). اگر متفاوت باشند، کانتینر ORDS تا ابد «Database not ready» تکرار می‌کند و هیچ خطای واضحی نشان نمی‌دهد — این مورد را عملاً تجربه کردیم.

**قوانین رمز APEX Admin (`APEX_ADMIN_PASSWORD`, `APEX_REST_PASSWORD`):** حداقل ۸ کاراکتر، حداقل یک حرف بزرگ، یک حرف کوچک، یک رقم، **و حداقل یک نویسه‌ی خاص از مجموعه‌ی دقیق APEX** (`!"`'#$%&()[]{},.*+-/|\:;?_~` — مثلاً `!`, `#`, `(`, `)` امن‌اند؛ **`^` و `@` در این مجموعه نیستند و رد می‌شوند**)؛ نباید شامل نام کاربری (`ADMIN`) باشد. این قانون سخت‌گیرتر از رمز Oracle معمولی است — تجربه شد که بدون نویسه‌ی خاص معتبر، `apxchpwd.sql` با `ORA-20001: Invalid password` رد می‌شود.

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

کانتینر ORDS خودش schema‌ی اپلیکیشن را REST-enable نمی‌کند. یک بار، بعد از بالا آمدن ORDS، این دستور را اجرا کنید (با کاربر `APP_USER`). نتیجه‌اش آدرس‌هایی به شکل `/ords/daily_office/...` است:

```sql
BEGIN
  ords.enable_schema(p_enabled => TRUE, p_url_mapping_type => 'BASE_PATH',
                     p_url_mapping_pattern => 'daily_office', p_auto_rest_auth => TRUE);
  COMMIT;
END;
/
```

سپس endpointهای REST پروژه را نصب کنید:

```bash
docker compose --profile migrate run --rm liquibase \
  --changelog-file=db/changelog/2026-09-10-02-ords-rest.yaml update
docker compose --profile migrate run --rm liquibase \
  --changelog-file=db/changelog/2026-09-10-03-apex-error-handler.yaml update
```

### فایل‌های استاتیک APEX (`/i/...`)

بدون این مرحله، صفحه‌ی ورود APEX باز می‌شود ولی کاملاً بدون استایل است (کنسول مرورگر پر از 404 برای `/i/app_ui/css/...`) — ORDS این فایل‌ها را از خود دیتابیس نمی‌گیرد، باید جداگانه از ZIP استخراج و به ORDS معرفی شوند:

```bash
# یک‌بار: پوشه‌ی images را کامل از ZIP رسمی استخراج کنید (فیلتر کردن مستقیم
# با unzip زیرپوشه‌ها مثل app_ui را از قلم می‌اندازد — کل آرشیو را باز کنید)
unzip -q docker/apex-dist/apex_26.1_en.zip -d /tmp/apex-full-extract
mkdir -p docker/apex-images
cp -r /tmp/apex-full-extract/apex/images/. docker/apex-images/

docker compose --profile ords up -d   # با volume جدید دوباره می‌سازد
docker exec daily-office-calendar-ords-1 \
  ords --config /etc/ords/config config set standalone.static.path /opt/oracle/apex-images
docker compose --profile ords restart ords
```

## ۷. اجرای تست‌ها

راهنمای کامل: [tests/database/README.md](../tests/database/README.md)
