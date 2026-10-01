# راهنمای کپچای صفحه‌ی لاگین APEX بدون ORDS (APEX 18، Oracle 11g، WebTier)

این راهنما برای محیطی است که در آن APEX **بدون ORDS و بدون WebLogic** اجرا می‌شود، مثلاً APEX 18 روی Oracle HTTP Server (WebTier) با mod_plsql و دیتابیس Oracle 11g. اگر محیط شما ORDS دارد، از [راهنمای اصلی](apex-captcha-setup.md) استفاده کنید.

## فرق این حالت با حالت ORDS

| | با ORDS | بدون ORDS (این راهنما) |
|---|---|---|
| ارتباط ویجت با سرور | دو endpoint در ORDS | دو **Ajax Callback** روی خود صفحه‌ی لاگین |
| فایل `006_captcha_ords.sql` و ثبت schema در ORDS | لازم است | **لازم نیست** |
| ویژگی `server` در ویجت | آدرس ORDS | **ندارد** |
| کد JavaScript صفحه | `login-captcha.js` | `login-captcha-ajax.js` |
| آدرس فایل‌های استاتیک | `#APP_FILES#` (APEX 20 به بعد) | `#APP_IMAGES#` (APEX 18) |

بقیه یکسان است: همان جدول، همان پکیج `captcha_api` و همان validation. پکیج خودش نسخه‌ی دیتابیس را تشخیص می‌دهد. روی 11g، که `DBMS_CRYPTO` در آن SHA-256 ندارد، از پیاده‌سازی SHA-256 با PL/SQL خالص استفاده می‌کند، و روی 12c و بالاتر از `DBMS_CRYPTO`.

## پیش‌نیازها

- **APEX 18 یا بالاتر** (برای `apex.server.process` و رویداد `apexbeforepagesubmit`)
- **Oracle 11g یا بالاتر**
- **مرورگرهای جدید** (Chrome، Edge، Firefox). Internet Explorer از Web Component پشتیبانی نمی‌کند و ویجت در آن نمایش داده نمی‌شود.
- به اینترنت نیازی نیست.

## فایل‌های لازم

| فایل | کاربرد |
|---|---|
| `db/packages/004_captcha_schema.sql` | جدول `captcha_challenges` |
| `db/packages/005_captcha_api.sql` | پکیج `captcha_api` |
| `not-robot-captcha/widget/not-robot.js` | فایل ویجت |
| `apex/shared/login-captcha-ajax.js` | کد JavaScript صفحه‌ی لاگین |
| `apex/pages/page-9999-login-no-ords.apexlang` | خلاصه‌ی تنظیمات صفحه‌ی 9999 |

---

## مرحله ۱: دسترسی به `DBMS_CRYPTO`

پکیج برای ساختن اعداد تصادفی امن به `DBMS_CRYPTO.RANDOMBYTES` نیاز دارد. این تابع در 11g هم هست. در **SQL Workshop › SQL Commands** بررسی کنید:

```sql
SELECT LOWER(RAWTOHEX(DBMS_CRYPTO.RANDOMBYTES(8))) AS test FROM dual;
```

- **یک رشته‌ی تصادفی برگشت:** دسترسی دارید.
- **خطای `ORA-00904` یا `PLS-00201`:** DBA باید این دستور را اجرا کند (دسترسی SYS لازم دارد):

  ```sql
  GRANT EXECUTE ON SYS.DBMS_CRYPTO TO <اسم schema>;
  ```

  > کاربرد: کپچای صفحه‌ی لاگین اپلیکیشن APEX. فقط برای ساختن اعداد تصادفی امن استفاده می‌شود. هیچ داده‌ای را رمزنگاری یا رمزگشایی نمی‌کند.

## مرحله ۲: نصب جدول و پکیج

در **SQL Workshop › SQL Scripts** (یا SQL*Plus / SQL Developer)، با کاربر schema‌ی اپلیکیشن، این دو فایل را به ترتیب اجرا کنید:

1. `004_captcha_schema.sql`
2. `005_captcha_api.sql`

**بررسی (حتماً انجام دهید):**

```sql
SELECT object_name, object_type, status
FROM   user_objects
WHERE  object_name LIKE 'CAPTCHA%';
```

هر سه ردیف باید `VALID` باشند. اگر پکیج `INVALID` بود، اول مرحله‌ی ۱ را بررسی کنید. بعد از دادن مجوز، دوباره کامپایلش کنید:

```sql
ALTER PACKAGE captcha_api COMPILE BODY;
```

**تست SHA-256 روی دیتابیس شما** (باید دقیقاً همین رشته برگردد):

```sql
SELECT captcha_api.sha256_plsql_hex('abc') FROM dual;
-- ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
```

## مرحله ۳: آپلود فایل ویجت

**Shared Components › Static Application Files › Create File** ← فایل `not-robot-captcha/widget/not-robot.js` را آپلود کنید.

در APEX 18 آدرس این فایل در صفحه‌ها **`#APP_IMAGES#not-robot.js`** است. اگر در صفحه‌ی Static Application Files ستون Reference آدرس دیگری نشان داد، همان را استفاده کنید.

## مرحله ۴: تنظیم صفحه‌ی لاگین در Page Designer

این مرحله فرض می‌کند صفحه‌ی لاگین شماره‌ی 9999 است. اگر شماره‌ی دیگری دارد، اسم آیتم را هم در کد PL/SQL (۴-ه) و هم در خطوط اول `login-captcha-ajax.js` عوض کنید.

### ۴-الف) بارگذاری ویجت

روی خود صفحه کلیک کنید و در بخش **JavaScript**:
- **File URLs:** `#APP_IMAGES#not-robot.js`
- **Execute when Page Loads:** کل محتوای `apex/shared/login-captcha-ajax.js` را بچسبانید.

### ۴-ب) آیتم مخفی

یک آیتم جدید در ریجن Login:
- **Name:** `P9999_CAPTCHA_TOKEN`
- **Type:** Hidden
- **Value Protected:** **No** ⚠️ (اگر Yes بماند، ورود با خطای Session State Protection رد می‌شود)

### ۴-ج) کادر کپچا

یک ریجن جدید:
- **Type:** Static Content
- **Parent Region:** ریجن Login
- **Template:** Blank with Attributes
- **Source › Text (HTML):**
  ```html
  <not-robot-captcha name="" guard="off"></not-robot-captcha>
  ```

در این حالت ویژگی `server` لازم نیست، چون `login-captcha-ajax.js` ارتباط را از طریق Ajax Callbackها برقرار می‌کند. کادر را بعد از فیلد رمز عبور و بالای دکمه‌ی ورود قرار دهید و یک بار با چشم بررسی کنید.

### ۴-د) دو Ajax Callback

در **Processing**، دو process جدید بسازید که **Point** آن‌ها **Ajax Callback** باشد. **اسم‌ها باید دقیقاً همین باشند**، چون JavaScript با همین اسم‌ها صدایشان می‌زند:

**`CAPTCHA_CHALLENGE`** — Type: PL/SQL Code:
```sql
captcha_api.ajax_response(
  p_action    => 'challenge',
  p_client_ip => owa_util.get_cgi_env('REMOTE_ADDR'));
```

**`CAPTCHA_SOLVE`** — Type: PL/SQL Code:
```sql
captcha_api.ajax_response(
  p_action => 'solve',
  p_x01    => apex_application.g_x01,
  p_x02    => apex_application.g_x02);
```

### ۴-ه) بررسی سمت سرور

این مهم‌ترین بخش امنیت است. **Processing › Validations › Create**:
- **Name:** `Captcha`
- **Type:** PL/SQL Function Body (returning Error Text)
- **PL/SQL:**
  ```sql
  RETURN captcha_api.error_message(captcha_api.consume_pass(:P9999_CAPTCHA_TOKEN));
  ```
- **When Button Pressed:** `LOGIN`
- **Sequence:** کمتر از همه‌ی validationهای دیگر
- **Error Display Location:** Inline in Notification

## مرحله ۵: تست

| تست | نتیجه‌ی درست |
|---|---|
| بدون تیک، دکمه‌ی ورود | پیام «لطفاً ابتدا تیک...» و چیزی ارسال نمی‌شود |
| تیک | کادر بعد از حدود یک ثانیه **سبز** می‌شود |
| تیک ← نام کاربری و رمز ← ورود | ورود موفق |
| تیک با رمز اشتباه | خطای رمز اشتباه. برای امتحان بعدی باید دوباره تیک زد |
| تیک، بیشتر از ۱۰ دقیقه صبر، بعد ورود | کادر **نارنجی** می‌شود با پیام «منقضی شد». نام کاربری و رمز می‌مانند |

## رفع اشکال

در مرورگر `F12` را بزنید و تب‌های **Console** و **Network** را نگاه کنید. در APEX 18 درخواست‌های Ajax Callback در Network با اسم `wwv_flow.ajax` دیده می‌شوند.

| علامت | دلیل احتمالی |
|---|---|
| کادر تیک دیده نمی‌شود | آدرس فایل در ۴-الف اشتباه است یا فایل آپلود نشده (Console خطا نشان می‌دهد). یا مرورگر Internet Explorer است |
| بعد از تیک، کادر نارنجی با «تأیید ناموفق بود» | اسم Ajax Callbackها با `CAPTCHA_CHALLENGE` و `CAPTCHA_SOLVE` یکی نیست، یا پکیج INVALID است. در Network، جواب `wwv_flow.ajax` را ببینید |
| «ارتباط با سرور برقرار نشد» | درخواست Ajax به سرور نرسید یا خطای HTTP گرفت (مثلاً session منقضی شده). صفحه را دوباره بارگذاری کنید |
| «درخواست‌ها زیاد است» | سقف درخواست‌ها پر شده (بخش تنظیمات راهنمای اصلی) |
| موقع ورود خطای Session State Protection | **Value Protected** آیتم مخفی هنوز Yes است |
| همیشه «لطفاً تیک را بزنید»، حتی بعد از تیک | کد JS مرحله‌ی ۴-الف چسبانده نشده، یا اسم آیتم با کد نمی‌خواند |

## IP کاربران در WebTier

با mod_plsql، خود Oracle HTTP Server درخواست را دریافت و اجرا می‌کند و `REMOTE_ADDR` معمولاً IP واقعی کاربر است. پس سقف «۳۰ معما در دقیقه برای هر IP» درست کار می‌کند. اگر یک load balancer یا proxy دیگر **جلوی** WebTier باشد، همه‌ی کاربران با IP آن دیده می‌شوند. برای بررسی و راه‌حل، بخش «نکته‌ی reverse proxy» در [راهنمای اصلی](apex-captcha-setup.md) را ببینید.

## تنظیمات

عددهای قابل تنظیم (مدت اعتبار ۱۰ دقیقه، سختی معما، سقف درخواست‌ها) همان ثابت‌های پکیج هستند و در بخش «تنظیمات» [راهنمای اصلی](apex-captcha-setup.md) توضیح داده شده‌اند.
