# راهنمای راه‌اندازی «من ربات نیستم» در صفحه‌ی لاگین APEX

این راهنما برای توسعه‌دهندگانی است که کپچای «من ربات نیستم» را روی صفحه‌ی لاگین یک اپلیکیشن Oracle APEX راه می‌اندازند.

> **محیط شما ORDS ندارد؟** (مثلاً APEX 18 روی WebTier با mod_plsql و Oracle 11g) از [راهنمای بدون ORDS](apex-captcha-setup-no-ords.md) استفاده کنید. کپچا کاملاً داخل شبکه‌ی سازمان کار می‌کند و **به اینترنت نیازی ندارد**. ویجت از خود APEX بارگذاری می‌شود و معماها در دیتابیس ساخته و بررسی می‌شوند.

## کپچا چطور کار می‌کند

```
مرورگر (صفحه‌ی لاگین)            ORDS                                دیتابیس
──────────────────────            ────                                ───────
تیک ─► POST /captcha/challenge ─► captcha_api.issue_challenge   ─► جدول captcha_challenges
       حل معما (~۰٫۵ ثانیه)
       POST /captcha/solve     ─► captcha_api.verify_solution   ─► توکن عبور (۱۰ دقیقه)
دکمه‌ی ورود ─────────────────────────────────────────────────────► validation:
                                                                   captcha_api.consume_pass
```

1. کاربر تیک می‌زند. ویجت از سرور یک معمای تصادفی می‌گیرد.
2. مرورگر معما را حل می‌کند (حدود نیم ثانیه) و جواب را می‌فرستد.
3. سرور جواب را بررسی می‌کند و یک **توکن عبور** می‌دهد که ۱۰ دقیقه اعتبار دارد و **فقط یک بار** قابل استفاده است.
4. کاربر دکمه‌ی ورود را می‌زند. یک validation در APEX توکن را مصرف می‌کند. اگر توکن نباشد، منقضی شده باشد یا قبلاً استفاده شده باشد، ورود رد می‌شود.

توکن حتی وقتی رمز عبور اشتباه باشد هم مصرف می‌شود. یعنی با هر بار حل کپچا فقط یک بار می‌شود رمز را امتحان کرد. این کار حدس زدن رمز با ربات را خیلی کُند می‌کند.

## فایل‌های لازم

همه در شاخه‌ی `feat/captcha` مخزن هستند:

| فایل | کاربرد |
|---|---|
| `db/packages/004_captcha_schema.sql` | جدول `captcha_challenges` |
| `db/packages/005_captcha_api.sql` | پکیج `captcha_api` |
| `db/packages/006_captcha_ords.sql` | endpointهای ORDS |
| `not-robot-captcha/widget/not-robot.js` | فایل ویجت |
| `apex/shared/login-captcha.js` | کد JavaScript صفحه‌ی لاگین |
| `apex/pages/page-9999-login.apexlang` | خلاصه‌ی تنظیمات صفحه‌ی 9999 |

---

## مرحله ۱: دسترسی به `DBMS_CRYPTO`

پکیج برای ساختن اعداد تصادفی امن و محاسبه‌ی هش SHA-256 به `DBMS_CRYPTO` نیاز دارد.

**اول بررسی کنید شاید از قبل دسترسی داشته باشید.** در **SQL Workshop › SQL Commands** اجرا کنید:

```sql
SELECT LOWER(RAWTOHEX(DBMS_CRYPTO.RANDOMBYTES(8))) AS test FROM dual;
```

- **یک رشته‌ی تصادفی برگشت** (مثل `9f3a01c2e47b8d55`): دسترسی دارید. به مرحله‌ی ۲ بروید.
- **خطای `ORA-00904` یا `PLS-00201`:** دسترسی ندارید. این دستور باید توسط DBA اجرا شود (دسترسی SYS لازم دارد):

  ```sql
  GRANT EXECUTE ON SYS.DBMS_CRYPTO TO <اسم schema>;
  ```

  متنی که می‌توانید برای DBA بفرستید:

  > کاربرد: کپچای صفحه‌ی لاگین اپلیکیشن APEX. فقط برای ساختن اعداد تصادفی امن و محاسبه‌ی هش SHA-256 استفاده می‌شود. هیچ داده‌ای را رمزنگاری یا رمزگشایی نمی‌کند.

> در محیط Docker همین پروژه، اسکریپت `docker/db/setup/20-captcha-grants.sh` این مجوز را هنگام راه‌اندازی دیتابیس خودکار می‌دهد.

## مرحله ۲: نصب جدول و پکیج

این مرحله و مراحل بعدی **به SYS نیاز ندارند** و با کاربر schema‌ی اپلیکیشن انجام می‌شوند.

**بدون Docker:** در **SQL Workshop › SQL Scripts** (یا SQL Developer) این دو فایل را به ترتیب اجرا کنید:
1. `004_captcha_schema.sql`
2. `005_captcha_api.sql`

**با Docker و Liquibase:**
```bash
docker compose --profile migrate run --rm liquibase
```

**بررسی (حتماً انجام دهید):**
```sql
SELECT object_name, object_type, status
FROM   user_objects
WHERE  object_name LIKE 'CAPTCHA%';
```

هر سه ردیف (`CAPTCHA_API` با نوع PACKAGE و PACKAGE BODY، و `CAPTCHA_CHALLENGES`) باید `VALID` باشند. پکیجی که INVALID کامپایل شود هیچ خطایی نشان نمی‌دهد، حتی Liquibase هم «موفق» گزارش می‌کند. اگر INVALID بود، احتمالاً مرحله‌ی ۱ انجام نشده است. بعد از دادن مجوز، دوباره کامپایلش کنید:

```sql
ALTER PACKAGE captcha_api COMPILE BODY;
```

## مرحله ۳: نصب endpointهای ORDS

دستورهای ORDS داخل خود دیتابیس اجرا می‌شوند و به Docker ربطی ندارند. اگر APEX شما از طریق ORDS باز می‌شود، این دستورها را دارید.

### ۳-۱) بررسی ثبت schema در ORDS

```sql
SELECT pattern, status FROM user_ords_schemas;
```

- **یک ردیف برگشت** (مثلاً `pattern = daily_office`): schema ثبت شده است. **آن را دوباره ثبت نکنید.** اگر با اسم مستعار دیگری ثبتش کنید، آدرس endpointهای قبلی عوض می‌شود، مثلاً آدرسی که `sync-worker` و `vercel-demo` استفاده می‌کنند. به ۳-۳ بروید.
- **چیزی برنگشت:** ۳-۲ را انجام دهید.

### ۳-۲) ثبت schema (فقط اگر ثبت نشده بود)

هر schema اجازه دارد خودش را ثبت کند. یکی از دو راه:

**راه الف، با منوی APEX:** **SQL Workshop › RESTful Services** ← **Register Schema with ORDS**. اسم مستعار (Schema Alias) را `daily_office` بگذارید.

**راه ب، با دستور:** در **SQL Workshop › SQL Commands**:

```sql
BEGIN
  ords.enable_schema(p_enabled => TRUE, p_url_mapping_type => 'BASE_PATH',
                     p_url_mapping_pattern => 'daily_office', p_auto_rest_auth => TRUE);
  COMMIT;
END;
```

### ۳-۳) نصب endpointهای کپچا

محتوای کامل `006_captcha_ords.sql` را در **SQL Workshop › SQL Commands** بچسبانید و **Run** را بزنید.

> این فایل یک بلوک PL/SQL است که با `END;` تمام می‌شود و `/` ندارد. در SQL Commands مشکلی نیست. در **SQL Developer** با «Run Script» (F5)، یک خط جدا با `/` به انتهایش اضافه کنید. `/` در خود فایل نیست، چون Liquibase کل فایل را یک‌جا اجرا می‌کند و `/` آنجا خطا می‌دهد.

با Docker و Liquibase:
```bash
docker compose --profile migrate run --rm liquibase \
  --changelog-file=db/changelog/2026-09-30-02-captcha-ords.yaml update
```

### ۳-۴) پیدا کردن آدرس و تست

آدرس endpointها از این بخش‌ها ساخته می‌شود:

```
/ords/<اسم مستعار>/captcha
```

- `/ords`: بخش اول آدرس APEX شما. مثلاً اگر آدرس اپلیکیشن `https://server/ords/r/...` است، این بخش `/ords` است.
- `<اسم مستعار>`: همان `pattern` در ۳-۱.

تست از کامپیوتری که به سرور دسترسی دارد:

```bash
curl -X POST -H "Content-Type: application/json" -d "{}" https://<سرور>/ords/daily_office/captcha/challenge
```

جواب درست یک JSON است که `token`، `salt`، `bits` و `wait` دارد. همین آدرس، **بدون** `/challenge`، را در مرحله‌ی ۵-ج لازم دارید.

## مرحله ۴: آپلود فایل ویجت

در App Builder، داخل اپلیکیشن:

**Shared Components › Static Application Files › Create File** ← فایل `not-robot-captcha/widget/not-robot.js` را آپلود کنید.

## مرحله ۵: تنظیم صفحه‌ی لاگین در Page Designer

این مرحله فرض می‌کند صفحه‌ی لاگین شماره‌ی 9999 است. اگر شماره‌ی دیگری دارد، اسم آیتم را هم در کد PL/SQL (۵-د) و هم در خطوط اول `login-captcha.js` عوض کنید.

### ۵-الف) بارگذاری ویجت

روی خود صفحه کلیک کنید و در بخش **JavaScript**:
- **File URLs:** `#APP_FILES#not-robot.js`
- **Execute when Page Loads:** کل محتوای `apex/shared/login-captcha.js` را بچسبانید.

### ۵-ب) آیتم مخفی

یک آیتم جدید در ریجن Login:
- **Name:** `P9999_CAPTCHA_TOKEN`
- **Type:** Hidden
- **Value Protected:** **خاموش** ⚠️

اگر Value Protected روشن بماند، ورود با خطای Session State Protection رد می‌شود، چون مقدار این آیتم در مرورگر تنظیم می‌شود.

### ۵-ج) کادر کپچا

یک ریجن جدید:
- **Type:** Static Content
- **Parent Region:** ریجن Login
- **Template:** Blank with Attributes
- **Source › HTML Code:**
  ```html
  <not-robot-captcha server="/ords/daily_office/captcha" name="" guard="off"></not-robot-captcha>
  ```

| ویژگی | معنی |
|---|---|
| `server` | آدرس مرحله‌ی ۳-۴ |
| `name=""` | ویجت input مخفی خودش را نمی‌سازد، چون APEX فقط آیتم‌های خودش را می‌فرستد و توکن در `P9999_CAPTCHA_TOKEN` می‌رود |
| `guard="off"` | بررسی قبل از ارسال را `login-captcha.js` انجام می‌دهد، چون APEX فرم را با کد خودش ارسال می‌کند |

کادر باید بعد از فیلد رمز عبور و بالای دکمه‌ی ورود باشد، تا کاربر تیک را آخر از همه بزند. جای دقیق به template بستگی دارد. اگر دکمه بالای کادر افتاد، ترتیب ریجن (Sequence) یا جای دکمه را عوض کنید و یک بار با چشم بررسی کنید.

### ۵-د) بررسی سمت سرور

این مهم‌ترین بخش امنیت است. تیک در مرورگر به‌تنهایی چیزی را ثابت نمی‌کند.

**Processing › Validations › Create**:
- **Name:** `Captcha`
- **Type:** Function Body (returning Error Text)
- **PL/SQL:**
  ```sql
  RETURN captcha_api.error_message(captcha_api.consume_pass(:P9999_CAPTCHA_TOKEN));
  ```
- **Server-side Condition › When Button Pressed:** `LOGIN`
- **Sequence:** کمتر از همه‌ی validationهای دیگر، تا اول اجرا شود
- **Error Display Location:** Inline in Notification

## مرحله ۶: تست

| تست | نتیجه‌ی درست |
|---|---|
| بدون تیک، دکمه‌ی ورود | پیام «لطفاً ابتدا تیک...» و چیزی ارسال نمی‌شود |
| تیک ← نام کاربری و رمز ← ورود | ورود موفق |
| تیک با رمز اشتباه | خطای رمز اشتباه. برای امتحان بعدی **باید دوباره تیک زد** |
| تیک، بیشتر از ۱۰ دقیقه صبر، بعد ورود | تیک پاک می‌شود، پیام «منقضی شد»، نام کاربری و رمز می‌مانند |

## رفع اشکال

در مرورگر `F12` را بزنید و تب‌های **Console** و **Network** را نگاه کنید:

| علامت | دلیل احتمالی |
|---|---|
| کادر تیک دیده نمی‌شود | آدرس فایل در ۵-الف اشتباه است یا فایل آپلود نشده (Console خطا نشان می‌دهد) |
| بلافاصله بعد از تیک: «تأیید ناموفق بود» | آدرس `server` اشتباه است (در Network، درخواست `challenge` جواب `404` می‌گیرد) |
| «ارتباط با سرور برقرار نشد» | مرورگر به سرور APEX/ORDS دسترسی ندارد (ربطی به اینترنت ندارد) |
| «درخواست‌ها زیاد است» | سقف درخواست‌ها پر شده (بخش تنظیمات را ببینید) |
| موقع ورود خطای Session State Protection | **Value Protected** آیتم مخفی هنوز روشن است |
| همیشه «لطفاً تیک را بزنید»، حتی بعد از تیک | کد JS مرحله‌ی ۵-الف چسبانده نشده، یا اسم آیتم با کد نمی‌خواند |
| پکیج `INVALID` است | مجوز `DBMS_CRYPTO` داده نشده (مرحله‌ی ۱) |

## تنظیمات

این عددها ثابت‌های ابتدای پکیج `captcha_api` در `005_captcha_api.sql` هستند. بعد از تغییر، پکیج را دوباره اجرا کنید.

| ثابت | مقدار فعلی | معنی |
|---|---|---|
| `c_pass_ttl_ms` | ۱۰ دقیقه | فاصله‌ی مجاز بین تیک زدن و زدن دکمه‌ی ورود |
| `c_bits` | ۱۷ | سختی معما. هر واحد اضافه، زمان حل را **دو برابر** می‌کند، هم برای ربات و هم برای کاربر |
| `c_max_per_ip_per_minute` | ۳۰ | حداکثر معما برای هر IP در دقیقه |
| `c_max_stored` | ۱۰۰٬۰۰۰ | حداکثر ردیف کل جدول (هر ردیف یک ساعت می‌ماند) |

**نکته‌ی reverse proxy:** IP کاربر از `REMOTE_ADDR` خوانده می‌شود. اگر جلوی ORDS یک proxy (مثل nginx) باشد، همه‌ی کاربران با IP همان proxy دیده می‌شوند و سقف ۳۰ تایی برای همه با هم حساب می‌شود. در آن حالت یا `c_max_per_ip_per_minute` را بالاتر ببرید، یا محدودیت را در خود proxy تنظیم کنید.

## محدودیت‌ها

- **کاربران بدون JavaScript** (یا با مرورگرهای خیلی قدیمی مثل Internet Explorer) ویجت را نمی‌بینند و نمی‌توانند وارد شوند. خود APEX هم بدون JavaScript تقریباً کار نمی‌کند، پس در عمل مشکلی ایجاد نمی‌کند.
- این کپچا اسپم و حمله‌ی انبوه را گران و کُند می‌کند، ولی رباتی که یک مرورگر واقعی را کنترل کند می‌تواند از آن رد شود. موتور تحلیل رفتار مثل reCAPTCHA ندارد.
