# Gorba Batman — rebuild

A clean rebuild of the web messenger core for Cloudflare Workers.

## Features
- ID-only registration/login (no phone, no password)
- Unique user IDs
- Persistent user directory in SQLite Durable Object
- Persistent per-user message inbox
- Private 1-to-1 chats
- Offline message delivery: messages are saved even if the recipient is not online
- Automatic chat list
- Realtime incoming messages with WebSocket Hibernation
- Search users
- Profile display-name editing
- Dark/light theme
- Cat favicon from the supplied image

## Deploy
1. Replace the GitHub repository contents with this folder.
2. Commit a new change.
3. Cloudflare Workers Builds will deploy it.

This rebuild intentionally uses NEW Durable Object class names (`Directory` and `UserInbox`) and the modern `exports` configuration. It does not depend on the old ChatRoom/ChatRoomV2 namespaces.

## Important
ID-only login is intentionally simple for a private friends-only test. Anyone who knows an ID can sign in as that ID. Do not use it for sensitive/private accounts.
