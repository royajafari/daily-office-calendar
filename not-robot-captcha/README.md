# not-robot-captcha

یک چک‌باکس «من ربات نیستم» که روی سرور خودتان اجرا می‌شود و به هیچ فریم‌ورکی وابسته نیست. به هیچ سرویس خارجی (گوگل، کلادفلر) نیاز ندارد و هیچ پکیج npm هم لازم ندارد.

## چطور کار می‌کند

```
مرورگر (ویجت)                 سرویس کپچا                    بک‌اند شما (هر زبانی)
─────────────                 ───────────                   ─────────────────────
تیک ──► POST /challenge ──►  چالش امضاشده (HMAC)
        حل معما (~۰٫۵ ثانیه)
        POST /solve ─────►   بررسی → توکن عبور (۲ دقیقه، یک‌بارمصرف)
فرم با فیلد captcha-token ──────────────────────────────►  POST /siteverify {secret, token}
                                                   ◄──────  {"success": true}
```

> ⚠️ **تیک زدن به‌تنهایی هیچ امنیتی نمی‌سازد.** بک‌اند شما باید قبل از پذیرفتن فرم حتماً `/siteverify` را صدا بزند. اگر این کار را نکند، یک ربات می‌تواند مستقیم فرم را بفرستد و از کپچا رد شود.

**این کپچا جلوی چه چیزی را می‌گیرد:** اسکریپت‌هایی که بدون مرورگر فرم را پر می‌کنند، ارسال انبوه (هر ارسال هزینه‌ی محاسباتی دارد)، استفاده‌ی دوباره از توکن، جعل توکن، و کلیک‌های مصنوعی که با اسکریپت زده می‌شوند.

**جلوی چه چیزی را نمی‌گیرد:** رباتی که یک مرورگر واقعی را کنترل می‌کند. این کپچا مثل reCAPTCHA یا Turnstile موتور تحلیل رفتار ندارد. اگر به آن سطح از امنیت نیاز دارید، از همان سرویس‌ها استفاده کنید.

## اجرا

```bash
cd not-robot-captcha
npm start          # http://localhost:8787 (صفحه‌ی دمو)
npm test
```

| متغیر محیطی | توضیح |
|---|---|
| `CAPTCHA_SECRET` | کلید امضای توکن‌ها. در production الزامی است. روی همه‌ی نسخه‌های سرور باید یکی باشد |
| `SITEVERIFY_SECRET` | رمز مشترک بین این سرویس و بک‌اند شما. در production الزامی است |
| `PORT` | پیش‌فرض `8787` |
| `ALLOWED_ORIGINS` | دامنه‌هایی که اجازه دارند ویجت را روی صفحه‌شان بگذارند، با کاما جدا می‌شوند. مثال: `https://mysite.ir,https://admin.mysite.ir`. پیش‌فرض `*` است، یعنی همه |
| `CAPTCHA_BITS` | میزان سختی معما (پیش‌فرض `17`). هر واحد که اضافه شود، زمان حل دو برابر می‌شود |
| `DEMO` | با مقدار `off` صفحه‌ی دمو غیرفعال می‌شود |

## ۱) اضافه کردن به صفحه (هر تکنولوژی)

```html
<script src="https://captcha.mysite.ir/not-robot.js" defer></script>

<form method="post" action="/contact">
  ...
  <not-robot-captcha></not-robot-captcha>
  <button>ارسال</button>
</form>
```

ویجت یک فیلد مخفی به اسم `captcha-token` داخل فرم می‌سازد. پس فرم‌های معمولی HTML هم بدون هیچ کد JS اضافه کار می‌کنند.

| ویژگی (attribute) | پیش‌فرض |
|---|---|
| `server` | آدرسی که فایل اسکریپت از آن بارگذاری شده |
| `name` | `captcha-token`. با `name=""` هیچ input مخفی‌ای ساخته نمی‌شود |
| `lang` | `fa` (برای انگلیسی: `en`) |
| `guard` | فعال. با `guard="off"` بررسی قبل از ارسال خاموش می‌شود |

رویدادها: `captcha-verified` (توکن در `event.detail.token`)، `captcha-expired` و `captcha-error`. متد `reset()` ویجت را به حالت اول برمی‌گرداند. property `token` توکن فعلی را می‌دهد و `valid` می‌گوید آن توکن هنوز معتبر است یا نه. متد `requireValid()` اگر توکن معتبر نباشد، همان کار بررسی قبل از ارسال را انجام می‌دهد (پیام، پاک کردن تیک، فوکوس) و `false` برمی‌گرداند.

### بررسی قبل از ارسال

وقتی فرم ارسال می‌شود، ویجت اول خودش بررسی می‌کند. اگر کاربر تیک نزده باشد یا توکن منقضی شده باشد:
- ارسال فرم متوقف می‌شود و اطلاعاتی که کاربر وارد کرده از بین نمی‌رود.
- تیک برداشته می‌شود و پیام «تأیید منقضی شد. دوباره تیک بزنید.» نشان داده می‌شود.
- صفحه تا ویجت اسکرول می‌کند.

ویجت زمان انقضا را **همان لحظه‌ی ارسال** با ساعت چک می‌کند و به تایمر تکیه نمی‌کند. دلیلش این است که مرورگرها تایمرِ تب‌های پس‌زمینه را دیرتر اجرا می‌کنند، و ممکن است کادر بعد از چند دقیقه هنوز سبز مانده باشد.

این بررسی با رویداد `submit` کار می‌کند و قبل از handlerهای خود صفحه (از جمله handlerهای React و Vue) اجرا می‌شود. دو استثنا دارد:
- `form.submit()` این رویداد را نمی‌فرستد، پس بررسی اجرا نمی‌شود.
- اگر فرم را بدون رویداد submit می‌فرستید (مثلاً با `onClick` روی یک دکمه‌ی معمولی)، خودتان قبل از ارسال `element.valid` را چک کنید.

در صفحه‌های تک‌صفحه‌ای (SPA)، بعد از هر ارسال موفق `reset()` را صدا بزنید. هر توکن یک‌بارمصرف است و ارسال بعدی به توکن تازه نیاز دارد.

**React / Next / Vue:** همان تگ `<not-robot-captcha>` را در کامپوننت بنویسید. اگر فرم را با `fetch` می‌فرستید، با یک `ref` و `addEventListener("captcha-verified", ...)` توکن را بگیرید، یا موقع ارسال فرم آن را از `element.token` بخوانید (بعد از اینکه با `element.valid` مطمئن شدید هنوز معتبر است).

## ۲) بررسی در بک‌اند (قبل از پذیرفتن فرم)

**PHP**
```php
$r = file_get_contents('https://captcha.mysite.ir/siteverify', false, stream_context_create(['http' => [
  'method' => 'POST',
  'header' => 'Content-Type: application/x-www-form-urlencoded',
  'content' => http_build_query(['secret' => getenv('SITEVERIFY_SECRET'), 'token' => $_POST['captcha-token'] ?? '']),
  'ignore_errors' => true,
]]));
if (!(json_decode($r, true)['success'] ?? false)) { http_response_code(403); exit('captcha failed'); }
```

**Python**
```python
import os, requests
ok = requests.post("https://captcha.mysite.ir/siteverify",
    json={"secret": os.environ["SITEVERIFY_SECRET"], "token": request.form.get("captcha-token", "")},
    timeout=5).json().get("success") is True
```

**Node / Next.js (Route Handler)**
```js
const { success } = await fetch("https://captcha.mysite.ir/siteverify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ secret: process.env.SITEVERIFY_SECRET, token: body.captchaToken }),
}).then((r) => r.json());
if (success !== true) return Response.json({ error: "captcha" }, { status: 403 });
```

اگر بک‌اند شما خودش با Node نوشته شده، می‌توانید سرویس جداگانه راه نیندازید و `server/core.js` را مستقیم import کنید. این فایل تابع `createCaptcha({ secret })` را دارد که `issueChallenge`، `verifySolution` و `consumePass` را برمی‌گرداند.

`/siteverify` این پاسخ‌ها را برمی‌گرداند: `{"success": true}` یا `{"success": false, "error": "..."}`. کدهای خطا این‌ها هستند: `invalid-token`، `token-expired`، `token-reused` و `invalid-secret` (این آخری با کد HTTP ۴۰۱ می‌آید).

## استفاده در Oracle APEX (بدون Node.js)

در APEX، سرور کپچا با PL/SQL و ORDS پیاده شده است و به این سرویس Node نیازی نیست:

| بخش | فایل |
|---|---|
| جدول و پکیج `captcha_api` | [db/packages/004_captcha_schema.sql](../db/packages/004_captcha_schema.sql) و [005_captcha_api.sql](../db/packages/005_captcha_api.sql) |
| endpointهای `challenge` و `solve` | [db/packages/006_captcha_ords.sql](../db/packages/006_captcha_ords.sql) |
| مجوز `DBMS_CRYPTO` | [docker/db/setup/20-captcha-grants.sh](../docker/db/setup/20-captcha-grants.sh) |
| صفحه‌ی لاگین (9999) | [apex/pages/page-9999-login.apexlang](../apex/pages/page-9999-login.apexlang) و [apex/shared/login-captcha.js](../apex/shared/login-captcha.js) |
| تست‌ها | [tests/database/captcha_test.pks](../tests/database/captcha_test.pks) و `.pkb` |

ترتیب نصب:
1. DBA این دستور را اجرا می‌کند: `GRANT EXECUTE ON SYS.DBMS_CRYPTO TO daily_office;` (در Docker، اسکریپت بالا این کار را خودکار انجام می‌دهد).
2. `liquibase update` (changelog اصلی).
3. `liquibase --changelog-file=db/changelog/2026-09-30-02-captcha-ords.yaml update`.
4. تنظیمات صفحه‌ی 9999 طبق فایل `page-9999-login.apexlang`.

فرق نسخه‌ی APEX با نسخه‌ی Node:
- توکن‌ها در جدول ذخیره می‌شوند، پس محدودیت چندنسخه‌ای بخش بعد در APEX وجود ندارد.
- توکن عبور در APEX **۱۰ دقیقه** اعتبار دارد (در نسخه‌ی Node، ۲ دقیقه)، چون اپلیکیشن فقط داخل شبکه‌ی سازمان در دسترس است. این عدد ثابت `c_pass_ttl_ms` در پکیج `captcha_api` است.
- توکن حتی وقتی رمز عبور اشتباه باشد هم مصرف می‌شود. پس با هر بار حل کپچا فقط یک بار می‌شود رمز را امتحان کرد.
- endpoint عمومی `challenge` دو سقف دارد تا کسی نتواند جدول را پر کند: هر IP حداکثر ۳۰ چالش در دقیقه، و کل جدول حداکثر ۱۰۰ هزار ردیف. وقتی سقف پر شود، پاسخ `429` با `{"error":"rate-limited"}` برمی‌گردد و ویجت پیام «درخواست‌ها زیاد است» را نشان می‌دهد. این عددها ثابت‌های اول پکیج `captcha_api` هستند.
- **نکته‌ی reverse proxy:** IP از `REMOTE_ADDR` خوانده می‌شود. اگر جلوی ORDS یک proxy (مثل nginx) باشد، همه‌ی کاربران با IP همان proxy دیده می‌شوند و سقف ۳۰ تایی برای همه با هم حساب می‌شود. در آن حالت یا سقف را بالاتر ببرید، یا محدودیت را در خود proxy تنظیم کنید.

## محدودیت‌ها

- سرور توکن‌های مصرف‌شده را در حافظه‌ی خودش نگه می‌دارد. اگر چند نسخه از سرور هم‌زمان اجرا شود، هر توکن ممکن است یک بار روی هر نسخه قبول شود. پس یا فقط یک نسخه اجرا کنید، یا در `core.js` حافظه‌ی داخلی (`Map`) را با یک حافظه‌ی مشترک مثل Redis عوض کنید.
- برای استفاده روی Vercel یا سرورهای serverless دیگر، به حافظه‌ی مشترک (مورد بالا) نیاز دارید.
