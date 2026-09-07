# گوربا بتمن — نسخه نهایی رفع خطای Cloudflare

این نسخه مشکل `New version of script does not export class ChatRoom` را رفع می‌کند.

## تغییر اصلی
Cloudflare Worker قبلی از `migrations` قدیمی استفاده می‌کرد. این نسخه به روش جدید declarative `exports` منتقل شده و هر دو کلاس موجود را اعلام می‌کند:
- `ChatRoom` — namespace قبلی SQLite، برای اینکه Cloudflare وابستگی موجود را بشناسد.
- `ChatRoomV2` — namespace جدید SQLite که binding فعلی `CHAT` به آن وصل است.

در نتیجه دیگر نباید خطای «کلاس ChatRoom در نسخه جدید export نشده» رخ بدهد.

## مهم
این نسخه را به صورت **Commit جدید** در GitHub قرار بده. روی Retry نسخه قرمز قبلی نزن.

## امکانات فعلی
- WebSocket با Durable Object Hibernation
- چت خصوصی بین دو کاربر
- ذخیره پیام‌های متنی در SQLite
- جست‌وجوی کاربران
- پروفایل و عکس پروفایل در UI
- favicon گربه
- انتخاب عکس/ویدیو در UI

## محدودیت فعلی
عکس/ویدیو در این نسخه هنوز در Object Storage دائمی مثل Supabase Storage ذخیره نمی‌شود؛ بنابراین برای ارسال رسانه بین دستگاه‌ها باید مرحله Storage بعدی را اضافه کنیم.

ورود واقعی Google نیز بعد از ساخت Google OAuth Client ID اضافه می‌شود.

## Deploy
`npx wrangler deploy`


### ارسال آفلاین/غیرهم‌زمان
ارسال پیام از مسیر HTTP انجام می‌شود و برای ارسال، آنلاین بودن گیرنده یا باز بودن چت او لازم نیست. WebSocket فقط برای دریافت زنده و همگام‌سازی رابط کاربری استفاده می‌شود.


## Fix: offline-safe private chats
Messages are stored in the pair-specific Durable Object. `/api/send` and `/api/history` now use the same pair room as `/ws`, so sending does not require the recipient or WebSocket to be online, and chat history is scoped to the selected pair. The inbox remains stored in per-user Durable Objects.
