import { DurableObject } from "cloudflare:workers";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

const cleanName = (v) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
const cleanBio = (v) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
const cleanId = (v) => String(v ?? "").trim().toLowerCase().replace(/^@/, "");
const now = () => Date.now();
const makeId = () => `u_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
const chatKey = (a, b) => {
  const x = cleanId(a), y = cleanId(b);
  return x < y ? `dm:${x}:${y}` : `dm:${y}:${x}`;
};
const imageData = (v, max = 650000) => {
  if (v === undefined) return undefined;
  const s = String(v || "");
  if (!s) return "";
  if (!/^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(s)) return null;
  return s.length <= max ? s : null;
};
const messageText = (v) => String(v ?? "").trim().slice(0, 4000);

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return await api(request, env, url);
      if (request.headers.get("Upgrade") === "websocket") return await inboxSocket(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("WORKER_ERROR", error);
      return json({ ok: false, error: "SERVER_ERROR", message: error?.message || "خطای سرور" }, 500);
    }
  }
};

async function api(request, env, url) {
  const { pathname } = url;
  const method = request.method;
  const directory = env.DIRECTORY.getByName("directory");

  if (method === "POST" && pathname === "/api/enter") {
    const body = await request.json().catch(() => ({}));
    const name = cleanName(body.name);
    if (name.length < 2) return json({ ok: false, error: "BAD_NAME", message: "نامت را وارد کن." }, 400);
    const result = await directory.enterByName(name);
    return json(result, result.ok ? 200 : 400);
  }

  // Compatibility endpoint: old clients can still enter using their old ID.
  if (method === "POST" && pathname === "/api/login") {
    const body = await request.json().catch(() => ({}));
    const id = cleanId(body.id);
    if (!id) return json({ ok: false, error: "BAD_ID", message: "شناسه نامعتبر است." }, 400);
    const user = await directory.getUser(id);
    return user ? json({ ok: true, user }) : json({ ok: false, error: "NOT_FOUND", message: "حساب پیدا نشد." }, 404);
  }

  if (method === "GET" && pathname === "/api/user") {
    const id = cleanId(url.searchParams.get("id"));
    const user = await directory.getUser(id);
    return user ? json({ ok: true, user }) : json({ ok: false, error: "NOT_FOUND", message: "کاربر پیدا نشد." }, 404);
  }

  if (method === "GET" && pathname === "/api/search") {
    const q = cleanName(url.searchParams.get("q"));
    if (!q) return json({ ok: true, users: [] });
    return json({ ok: true, users: await directory.searchUsers(q) });
  }

  if (method === "POST" && pathname === "/api/profile") {
    const body = await request.json().catch(() => ({}));
    const id = cleanId(body.id);
    const name = cleanName(body.name);
    if (!id || name.length < 2) return json({ ok: false, error: "BAD_PROFILE", message: "نام نمایشی معتبر نیست." }, 400);
    const avatar = imageData(body.avatar);
    const cover = imageData(body.cover, 700000);
    if (avatar === null || cover === null) return json({ ok: false, error: "BAD_IMAGE", message: "عکس خیلی بزرگ یا نامعتبر است." }, 400);
    const bio = body.bio === undefined ? undefined : cleanBio(body.bio);
    const result = await directory.updateProfile(id, name, bio, avatar, cover);
    return json(result, result.ok ? 200 : 400);
  }

  if (method === "GET" && pathname === "/api/chats") {
    const id = cleanId(url.searchParams.get("id"));
    if (!id) return json({ ok: false, error: "BAD_USER" }, 400);
    return json({ ok: true, chats: await env.INBOX.getByName(id).listChats() });
  }

  if (method === "GET" && pathname === "/api/history") {
    const user = cleanId(url.searchParams.get("user"));
    const peer = cleanId(url.searchParams.get("peer"));
    if (!user || !peer) return json({ ok: false, error: "BAD_CHAT" }, 400);
    return json({ ok: true, messages: await env.INBOX.getByName(user).history(chatKey(user, peer)) });
  }

  if (method === "POST" && pathname === "/api/send") {
    const body = await request.json().catch(() => ({}));
    const from = cleanId(body.from), to = cleanId(body.to), text = messageText(body.body);
    if (!from || !to || (!text && !body.media)) return json({ ok: false, error: "BAD_MESSAGE", message: "پیام خالی است." }, 400);
    const [sender, recipient] = await Promise.all([directory.getUser(from), directory.getUser(to)]);
    if (!sender || !recipient) return json({ ok: false, error: "USER_NOT_FOUND", message: "کاربر پیدا نشد." }, 404);
    const media = body.media === undefined ? "" : imageData(body.media, 520000);
    if (media === null) return json({ ok: false, error: "BAD_MEDIA", message: "عکس خیلی بزرگ است." }, 400);
    const msg = {
      id: crypto.randomUUID(), chatKey: chatKey(from, to), from, to,
      body: text, media: media || "", kind: media ? "image" : "text", createdAt: now()
    };
    await Promise.all([
      env.INBOX.getByName(from).saveMessage({ ...msg, direction: "out" }),
      env.INBOX.getByName(to).saveMessage({ ...msg, direction: "in" })
    ]);
    return json({ ok: true, message: msg });
  }

  if (method === "POST" && pathname === "/api/read") {
    const body = await request.json().catch(() => ({}));
    const user = cleanId(body.user), peer = cleanId(body.peer);
    if (!user || !peer) return json({ ok: false }, 400);
    return json(await env.INBOX.getByName(user).markRead(chatKey(user, peer)));
  }

  return json({ ok: false, error: "NOT_FOUND" }, 404);
}

async function inboxSocket(request, env) {
  const user = cleanId(new URL(request.url).searchParams.get("user"));
  if (!user) return new Response("missing user", { status: 400 });
  return env.INBOX.getByName(user).fetch(request);
}

export class Directory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE,
      avatar TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      cover TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`);
    // Migrate the previous schema without breaking existing data.
    try { this.sql.exec(`ALTER TABLE users ADD COLUMN name_key TEXT NOT NULL DEFAULT ''`); } catch {}
    try { this.sql.exec(`ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''`); } catch {}
    try { this.sql.exec(`ALTER TABLE users ADD COLUMN cover TEXT NOT NULL DEFAULT ''`); } catch {}
    try {
      const rows = this.sql.exec(`SELECT id,name FROM users WHERE name_key=''`).toArray();
      for (const row of rows) this.sql.exec(`UPDATE users SET name_key=?1 WHERE id=?2`, normalizeName(row.name), row.id);
    } catch {}
    try { this.sql.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_name_key ON users(name_key)`); } catch {}
  }

  async enterByName(name) {
    const key = normalizeName(name);
    let user = this.sql.exec(`SELECT id,name,avatar,bio,cover FROM users WHERE name_key=?1`, key).one();
    if (user) return { ok: true, user, existing: true };
    const id = makeId();
    try {
      this.sql.exec(`INSERT INTO users(id,name,name_key,avatar,bio,cover,created_at) VALUES(?1,?2,?3,'','','',?4)`, id, name, key, now());
    } catch (error) {
      const again = this.sql.exec(`SELECT id,name,avatar,bio,cover FROM users WHERE name_key=?1`, key).one();
      if (again) return { ok: true, user: again, existing: true };
      throw error;
    }
    user = await this.getUser(id);
    return { ok: true, user, existing: false };
  }

  async getUser(id) {
    return this.sql.exec(`SELECT id,name,avatar,bio,cover FROM users WHERE id=?1`, cleanId(id)).one() || null;
  }

  async searchUsers(q) {
    const like = `%${q.trim()}%`;
    return this.sql.exec(`SELECT id,name,avatar,bio,cover FROM users WHERE name LIKE ?1 ORDER BY name LIMIT 40`, like).toArray();
  }

  async updateProfile(id, name, bio, avatar, cover) {
    const user = await this.getUser(id);
    if (!user) return { ok: false, error: "NOT_FOUND", message: "حساب پیدا نشد." };
    const key = normalizeName(name);
    const other = this.sql.exec(`SELECT id FROM users WHERE name_key=?1 AND id<>?2`, key, cleanId(id)).one();
    if (other) return { ok: false, error: "NAME_TAKEN", message: "این نام نمایشی قبلاً استفاده شده است." };
    const nextBio = bio === undefined ? user.bio : bio;
    const nextAvatar = avatar === undefined ? user.avatar : avatar;
    const nextCover = cover === undefined ? user.cover : cover;
    this.sql.exec(`UPDATE users SET name=?1,name_key=?2,bio=?3,avatar=?4,cover=?5 WHERE id=?6`, name, key, nextBio, nextAvatar, nextCover, cleanId(id));
    return { ok: true, user: await this.getUser(id) };
  }
}

function normalizeName(name) {
  return cleanName(name).toLocaleLowerCase("fa-IR");
}

export class UserInbox extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS messages(
      id TEXT PRIMARY KEY,
      chat_key TEXT NOT NULL,
      sender TEXT NOT NULL,
      recipient TEXT NOT NULL,
      body TEXT NOT NULL,
      media TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'text',
      created_at INTEGER NOT NULL,
      direction TEXT NOT NULL,
      read_at INTEGER
    )`);
    try { this.sql.exec(`ALTER TABLE messages ADD COLUMN media TEXT NOT NULL DEFAULT ''`); } catch {}
    try { this.sql.exec(`ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'`); } catch {}
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages(chat_key,created_at)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS chat_meta(
      chat_key TEXT PRIMARY KEY,
      peer_id TEXT NOT NULL,
      peer_name TEXT NOT NULL DEFAULT '',
      peer_avatar TEXT NOT NULL DEFAULT '',
      unread INTEGER NOT NULL DEFAULT 0,
      last_body TEXT NOT NULL,
      last_media TEXT NOT NULL DEFAULT '',
      last_time INTEGER NOT NULL
    )`);
    try { this.sql.exec(`ALTER TABLE chat_meta ADD COLUMN peer_name TEXT NOT NULL DEFAULT ''`); } catch {}
    try { this.sql.exec(`ALTER TABLE chat_meta ADD COLUMN peer_avatar TEXT NOT NULL DEFAULT ''`); } catch {}
    try { this.sql.exec(`ALTER TABLE chat_meta ADD COLUMN last_media TEXT NOT NULL DEFAULT ''`); } catch {}
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket required", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const user = cleanId(new URL(request.url).searchParams.get("user"));
    server.serializeAttachment({ user });
    server.send(JSON.stringify({ type: "snapshot", chats: await this.listChats() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    try { if (JSON.parse(message)?.type === "ping") ws.send(JSON.stringify({ type: "pong" })); } catch {}
  }
  async webSocketClose() {}
  async webSocketError() {}

  async saveMessage(message) {
    this.sql.exec(`INSERT OR REPLACE INTO messages(id,chat_key,sender,recipient,body,media,kind,created_at,direction,read_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
      message.id, message.chatKey, message.from, message.to, message.body || "", message.media || "", message.kind || "text",
      message.createdAt, message.direction, message.direction === "out" ? message.createdAt : null);
    const peer = message.direction === "out" ? message.to : message.from;
    const peerInfo = await this.env.DIRECTORY.getByName("directory").getUser(peer);
    const old = this.sql.exec(`SELECT unread FROM chat_meta WHERE chat_key=?1`, message.chatKey).one();
    const unread = message.direction === "in" ? ((old?.unread || 0) + 1) : (old?.unread || 0);
    this.sql.exec(`INSERT OR REPLACE INTO chat_meta(chat_key,peer_id,peer_name,peer_avatar,unread,last_body,last_media,last_time)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`, message.chatKey, peer, peerInfo?.name || "کاربر", peerInfo?.avatar || "", unread,
      message.body || (message.media ? "📷 عکس" : ""), message.media || "", message.createdAt);
    if (message.direction === "in") {
      const packet = JSON.stringify({
        type: "message",
        message,
        chat: { chatKey: message.chatKey, peerId: peer, peerName: peerInfo?.name || "کاربر", peerAvatar: peerInfo?.avatar || "", unread, lastBody: message.body || (message.media ? "📷 عکس" : ""), lastTime: message.createdAt }
      });
      for (const ws of this.ctx.getWebSockets()) { try { ws.send(packet); } catch {} }
    }
  }

  async listChats() {
    return this.sql.exec(`SELECT chat_key AS chatKey,peer_id AS peerId,peer_name AS peerName,peer_avatar AS peerAvatar,
      unread,last_body AS lastBody,last_media AS lastMedia,last_time AS lastTime FROM chat_meta ORDER BY last_time DESC`).toArray();
  }

  async history(key) {
    return this.sql.exec(`SELECT id,chat_key AS chatKey,sender AS from,recipient AS to,body,media,kind,created_at AS createdAt
      FROM messages WHERE chat_key=?1 ORDER BY created_at ASC LIMIT 1000`, key).toArray();
  }

  async markRead(key) {
    this.sql.exec(`UPDATE chat_meta SET unread=0 WHERE chat_key=?1`, key);
    this.sql.exec(`UPDATE messages SET read_at=?1 WHERE chat_key=?2 AND direction='in' AND read_at IS NULL`, now(), key);
    return { ok: true };
  }
}

// Existing provisioned namespaces are kept declared so Cloudflare can reconcile them.
export class ChatRoom extends UserInbox {}
export class ChatRoomV2 extends UserInbox {}
export class Messenger extends UserInbox {}
