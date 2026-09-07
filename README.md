# گوربا بتمن v2

این نسخه:
- WebSocket چت را با Durable Object Hibernation استفاده می‌کند.
- پیام‌های متنی را در SQLite Durable Object ذخیره می‌کند.
- تاریخچه پیام‌ها بعد از refresh/redeploy باقی می‌ماند.
- عکس پروفایل را از گالری انتخاب می‌کند.
- favicon از عکس ارسالی کاربر ساخته شده است.
- UI انتخاب عکس/ویدیو برای چت دارد.

## نکته مهم درباره فایل‌های رسانه‌ای
برای ذخیره دائمی و دسترسی از چند دستگاه، فایل‌های عکس/ویدیو باید در یک Object Storage مثل Supabase Storage یا Cloudflare R2 قرار بگیرند. این نسخه عمداً بدون R2 قابل deploy است تا خطای Bucket قبلی تکرار نشود. بخش media در UI آماده است، اما URL موقت مرورگر بین دستگاه‌ها دائمی نیست.

برای Supabase:
1. یک پروژه بساز.
2. در Storage دو bucket بساز: `avatars` و `media`.
3. Policyهای مناسب برای upload/read را تنظیم کن.
4. URL و anon key را در فرانت قرار نده مگر اینکه policyها امن و محدود باشند؛ برای production بهتر است آپلود از Worker با احراز هویت انجام شود.

## Google
ورود واقعی Google نیازمند OAuth Client ID و تنظیم Authorized JavaScript origins است و باید جداگانه به Worker اضافه شود.

## Deploy
Deploy command:
`npx wrangler deploy`

Cloudflare برای Durable Object جدید، SQLite را توصیه می‌کند.
