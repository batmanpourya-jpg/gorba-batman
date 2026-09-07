# گوربا بتمن — نسخه بعدی

این نسخه شامل:
- رفع باگ WebSocket چت خصوصی با Durable Object Hibernation
- انتخاب عکس پروفایل از گالری
- ارسال عکس و ویدیو با Cloudflare R2، تا 50MB
- ورود با Google Identity Services
- ذخیره حساب Google و پروفایل روی Durable Object
- favicon با عکس گوربا

## قبل از Deploy
1. در Cloudflare R2 یک bucket با نام `gorba-batman-media` بساز.
2. در `wrangler.jsonc` مقدار `GOOGLE_CLIENT_ID` را با Client ID واقعی Google عوض کن.
3. دامنه Worker را در Authorized JavaScript origins در Google Cloud اضافه کن.
4. سپس `npx wrangler deploy`.

Client Secret را در GitHub یا فرانت‌اند قرار نده.

### نکته
عکس پروفایل در این نسخه فوراً در مرورگر نمایش داده و برای حساب Google در صورت وجود session در Durable Object نیز ذخیره می‌شود. برای ذخیره دائمی عکس پروفایل روی همه دستگاه‌ها، مرحله بعدی بهتر است آن را به R2 منتقل کند.
