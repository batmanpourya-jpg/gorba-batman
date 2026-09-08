# گوربا بتمن — Update 2 Full

این نسخه بر پایه نسخه ورود سالم گوربا بتمن ساخته شده است.

## امکانات Update 2
- ورود با نام نمایشی، بدون شماره تلفن و بدون Google
- پیام متنی
- پاسخ، ویرایش، حذف برای همه، سنجاق، تیک خوانده‌شدن و typing
- تاریخچه پیام به صورت صفحه‌های ۴تایی؛ آخرین پیام‌ها ابتدا می‌آیند و با اسکرول به بالا ۴ پیام قدیمی‌تر بارگذاری می‌شود
- cursor pagination با `(created_at,id)` برای جلوگیری از جاافتادن پیام‌های هم‌زمان
- عکس با پیش‌نمایش قبل از ارسال
- ویدیو با پیش‌نمایش قبل از ارسال
- فایل و PDF
- پیام صوتی با ضبط مستقیم از مرورگر
- گالری رسانه‌های هر چت
- محدودیت فایل ۲۰ مگابایت
- نمایش درصد پیشرفت آپلود
- ذخیره رسانه در SQLite-backed Durable Object به صورت chunkهای ۱ مگابایتی
- جلوگیری از خطای `$.children is not a function...` با استفاده از `Array.from(...)`

## استقرار
فایل‌های پروژه را در Cloudflare Worker قبلی جایگزین کن و deploy کن.


## Update 4
- Chat history behaves like a normal messenger: recent messages open at the bottom; scrolling upward loads older messages in batches, with scroll position preserved. No four-message UI limit.
- Dark/light mode, selectable primary color, chat-only background presets/image, and account-persisted appearance settings.
- Login flow is preserved from the known-good name-only version.
