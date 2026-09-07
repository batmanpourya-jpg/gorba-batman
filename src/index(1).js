import { DurableObject } from "cloudflare:workers";

const MAX_NAME = 40;
const MAX_TEXT = 2000;

function cleanName(v) { return String(v || "").trim().slice(0, MAX_NAME); }
function lower(v) { return cleanName(v).toLocaleLowerCase("fa-IR"); }
function roomKey(a, b) {
  return [cleanName(a), cleanName(b)].sort((x, y) => lower(x).localeCompare(lower(y), "fa")).join("::");
}
function out(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
function previewText(text, mediaType, fileName) {
  if (text) return String(text).slice(0, 80);
  if ((mediaType || "").startsWith("image/")) return "📷 عکس";
  if ((mediaType || "").startsWith("video/")) return "🎥 ویدیو";
  return fileName ? `📎 ${String(fileName).slice(0, 60)}` : "📎 فایل";
}

// Kept exported because the older deployed migration depends on this class name.
export class ChatRoom extends DurableObject {}

export class ChatRoomV2 extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        name TEXT PRIMARY KEY,
        name_lc TEXT NOT NULL,
        avatar_url TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS users_name_lc ON users(name_lc);

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        sender TEXT NOT NULL,
        text TEXT,
        media_url TEXT,
        media_type TEXT,
        file_name TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_created_at ON messages(created_at);

      CREATE TABLE IF NOT EXISTS conversations (
        peer TEXT PRIMARY KEY,
        last_sender TEXT NOT NULL,
        last_text TEXT,
        last_media_type TEXT,
        last_file_name TEXT,
        last_at INTEGER NOT NULL,
        unread INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS conversations_last_at ON conversations(last_at DESC);
    `);
  }

  async fetch(request) {
    const url = new URL(request.url);

    // ---------- Global user directory ----------
    if (url.pathname === "/api/register" && request.method === "POST") {
      try {
        const body = await request.json();
        const name = cleanName(body.name);
        if (!name) return out({ ok: false, error: "نام وارد نشده" }, 400);
        const now = Date.now();
        this.sql.exec(
          `INSERT INTO users(name,name_lc,created_at,updated_at)
           VALUES(?,?,?,?)
           ON CONFLICT(name) DO UPDATE SET updated_at=excluded.updated_at`,
          name, lower(name), now, now
        );
        return out({ ok: true, name });
      } catch {
        return out({ ok: false, error: "درخواست نامعتبر است" }, 400);
      }
    }

    if (url.pathname === "/api/search" && request.method === "GET") {
      const q = lower(url.searchParams.get("q") || "");
      if (!q) return out({ ok: true, users: [] });
      const rows = this.sql.exec(
        `SELECT name, avatar_url FROM users WHERE name_lc LIKE ? ORDER BY name_lc LIMIT 20`,
        `%${q}%`
      ).toArray();
      return out({ ok: true, users: rows });
    }

    if (url.pathname === "/api/profile" && request.method === "GET") {
      const name = cleanName(url.searchParams.get("name"));
      const row = this.sql.exec(`SELECT name,avatar_url FROM users WHERE name=?`, name).toArray()[0];
      return out({ ok: true, user: row || { name, avatar_url: null } });
    }

    if (url.pathname === "/api/profile" && request.method === "POST") {
      try {
        const body = await request.json();
        const name = cleanName(body.name);
        const avatarUrl = String(body.avatarUrl || "").slice(0, 2000);
        if (!name) return out({ ok: false, error: "نام وارد نشده" }, 400);
        const now = Date.now();
        this.sql.exec(
          `INSERT INTO users(name,name_lc,avatar_url,created_at,updated_at)
           VALUES(?,?,?,?,?)
           ON CONFLICT(name) DO UPDATE SET avatar_url=excluded.avatar_url,updated_at=excluded.updated_at`,
          name, lower(name), avatarUrl || null, now, now
        );
        return out({ ok: true, name, avatarUrl: avatarUrl || null });
      } catch {
        return out({ ok: false, error: "درخواست نامعتبر است" }, 400);
      }
    }

    // ---------- Internal inbox push (called by another Durable Object) ----------
    // This avoids relying on Durable Object RPC availability and works across
    // deployments while keeping the actual inbox state inside the user's DO.
    if (url.pathname === "/internal/inbox-push" && request.method === "POST") {
      try {
        const note = await request.json();
        const owner = cleanName(note?.owner);
        const peer = cleanName(note?.peer);
        const sender = cleanName(note?.sender);
        if (!owner || !peer || !sender) return out({ ok: false }, 400);

        const text = String(note?.text || "").slice(0, MAX_TEXT) || null;
        const mediaType = String(note?.mediaType || "").slice(0, 100) || null;
        const fileName = String(note?.fileName || "").slice(0, 180) || null;
        const lastAt = Number(note?.createdAt) || Date.now();

        let unread = 0;
        if (lower(owner) !== lower(sender)) {
          unread = 1;
          for (const ws of this.ctx.getWebSockets()) {
            const state = ws.deserializeAttachment() || {};
            if (lower(state.me) === lower(owner) && lower(state.activePeer) === lower(sender)) {
              unread = 0;
              break;
            }
          }
        }

        const existing = this.sql.exec(
          `SELECT unread FROM conversations WHERE peer=?`, peer
        ).toArray()[0];
        const nextUnread = lower(owner) === lower(sender)
          ? 0
          : (unread === 0 ? 0 : Number(existing?.unread || 0) + 1);

        this.sql.exec(
          `INSERT INTO conversations(peer,last_sender,last_text,last_media_type,last_file_name,last_at,unread)
           VALUES(?,?,?,?,?,?,?)
           ON CONFLICT(peer) DO UPDATE SET
             last_sender=excluded.last_sender,
             last_text=excluded.last_text,
             last_media_type=excluded.last_media_type,
             last_file_name=excluded.last_file_name,
             last_at=excluded.last_at,
             unread=excluded.unread`,
          peer, sender, text, mediaType, fileName, lastAt, nextUnread
        );

        this.broadcastInbox();
        return out({ ok: true });
      } catch (e) {
        console.error("internal inbox push failed", e);
        return out({ ok: false }, 400);
      }
    }

    // ---------- Per-user inbox ----------
    if (url.pathname === "/api/conversations" && request.method === "GET") {
      const rows = this.sql.exec(
        `SELECT c.peer,
                u.avatar_url AS avatar_url,
                c.last_sender,
                c.last_text,
                c.last_media_type,
                c.last_file_name,
                c.last_at,
                c.unread
         FROM conversations c
         LEFT JOIN users u ON u.name=c.peer
         ORDER BY c.last_at DESC LIMIT 100`
      ).toArray();
      return out({ ok: true, conversations: rows });
    }

    // ---------- Send message without requiring the other person to be online ----------
    if (url.pathname === "/api/send" && request.method === "POST") {
      try {
        const body = await request.json();
        const sender = cleanName(body.sender);
        const peer = cleanName(body.peer);
        if (!sender || !peer || lower(sender) === lower(peer)) {
          return out({ ok: false, error: "کاربر یا گیرنده نامعتبر است" }, 400);
        }

        const text = String(body.text || "").trim().slice(0, MAX_TEXT);
        const mediaUrl = String(body.mediaUrl || "").slice(0, 4000);
        const mediaType = String(body.mediaType || "").slice(0, 100);
        const fileName = String(body.fileName || "").slice(0, 180);
        if (!text && !mediaUrl) return out({ ok: false, error: "پیام خالی است" }, 400);

        const row = {
          id: crypto.randomUUID(),
          sender,
          text: text || null,
          media_url: mediaUrl || null,
          media_type: mediaType || null,
          file_name: fileName || null,
          created_at: Date.now()
        };

        this.sql.exec(
          `INSERT INTO messages(id,sender,text,media_url,media_type,file_name,created_at)
           VALUES(?,?,?,?,?,?,?)`,
          row.id, row.sender, row.text, row.media_url, row.media_type, row.file_name, row.created_at
        );

        const payload = JSON.stringify({ type: "message", ...row });
        for (const client of this.ctx.getWebSockets()) {
          if (client.readyState === WebSocket.OPEN) {
            try { client.send(payload); } catch {}
          }
        }

        // The receiver does NOT need to be online. The inbox entry is persisted
        // in the receiver's own Durable Object and will appear next time they open the app.
        try {
          const note = { text: row.text, mediaType: row.media_type, fileName: row.file_name, createdAt: row.created_at };
          const senderHub = this.env.CHAT.get(this.env.CHAT.idFromName(`user:${lower(sender)}`));
          const peerHub = this.env.CHAT.get(this.env.CHAT.idFromName(`user:${lower(peer)}`));
          const makeReq = (owner, conversationPeer) => new Request("https://internal/inbox-push", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...note, owner, peer: conversationPeer, sender })
          });
          await Promise.all([
            senderHub.fetch(makeReq(sender, peer)),
            peerHub.fetch(makeReq(peer, sender))
          ]);
        } catch (e) {
          console.error("Inbox update failed", e);
        }

        return out({ ok: true, message: row });
      } catch (e) {
        console.error("send failed", e);
        return out({ ok: false, error: "ارسال پیام ناموفق بود" }, 400);
      }
    }

    // ---------- Private chat history ----------
    if (url.pathname === "/api/history" && request.method === "GET") {
      const rows = this.sql.exec(
        `SELECT id,sender,text,media_url,media_type,file_name,created_at
         FROM messages ORDER BY created_at DESC LIMIT 100`
      ).toArray().reverse();
      return out({ ok: true, messages: rows });
    }

    // ---------- User inbox realtime socket ----------
    if (url.pathname === "/inboxws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
        return new Response("WebSocket required", { status: 426 });

      const me = cleanName(url.searchParams.get("me"));
      if (!me) return new Response("Missing user", { status: 400 });

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ me, activePeer: "" });

      const rows = this.sql.exec(
        `SELECT c.peer,
                u.avatar_url AS avatar_url,
                c.last_sender,
                c.last_text,
                c.last_media_type,
                c.last_file_name,
                c.last_at,
                c.unread
         FROM conversations c
         LEFT JOIN users u ON u.name=c.peer
         ORDER BY c.last_at DESC LIMIT 100`
      ).toArray();
      if (server.readyState === WebSocket.OPEN) {
        server.send(JSON.stringify({ type: "inbox", conversations: rows }));
      }
      return new Response(null, { status: 101, webSocket: client });
    }

    // Tell this user's inbox which chat is currently open.
    if (url.pathname === "/inbox-active" && request.method === "POST") {
      try {
        const body = await request.json();
        const me = cleanName(body.me);
        const peer = cleanName(body.peer);
        if (!me) return out({ ok: false }, 400);
        for (const ws of this.ctx.getWebSockets()) {
          const state = ws.deserializeAttachment() || {};
          if (lower(state.me) === lower(me)) {
            ws.serializeAttachment({ me, activePeer: peer });
          }
        }
        if (peer) {
          this.sql.exec(`UPDATE conversations SET unread=0 WHERE peer=?`, peer);
          this.broadcastInbox();
        }
        return out({ ok: true });
      } catch {
        return out({ ok: false }, 400);
      }
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
        return new Response("WebSocket required", { status: 426 });

      const me = cleanName(url.searchParams.get("me"));
      const peer = cleanName(url.searchParams.get("peer"));
      if (!me || !peer || lower(me) === lower(peer))
        return new Response("Two different users are required", { status: 400 });

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ me, peer });

      const history = this.sql.exec(
        `SELECT id,sender,text,media_url,media_type,file_name,created_at
         FROM messages ORDER BY created_at DESC LIMIT 100`
      ).toArray().reverse();

      for (const m of history) {
        if (server.readyState === WebSocket.OPEN) server.send(JSON.stringify({ type: "message", ...m }));
      }
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404 });
  }

  broadcastInbox() {
    const rows = this.sql.exec(
      `SELECT c.peer,
              u.avatar_url AS avatar_url,
              c.last_sender,
              c.last_text,
              c.last_media_type,
              c.last_file_name,
              c.last_at,
              c.unread
       FROM conversations c
       LEFT JOIN users u ON u.name=c.peer
       ORDER BY c.last_at DESC LIMIT 100`
    ).toArray();
    const payload = JSON.stringify({ type: "inbox", conversations: rows });
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(payload); } catch {}
      }
    }
  }

  async webSocketMessage(ws, message) {
    let data;
    try { data = typeof message === "string" ? JSON.parse(message) : null; } catch { return; }

    // Inbox socket uses this message to update which chat is open.
    if (data?.type === "active") {
      const state = ws.deserializeAttachment() || {};
      if (state.me) ws.serializeAttachment({ me: state.me, activePeer: cleanName(data.peer) });
      return;
    }

    if (!data || !["message", "media"].includes(data.type)) return;

    const session = ws.deserializeAttachment() || {};
    const sender = cleanName(session.me);
    const peer = cleanName(session.peer);
    if (!sender || !peer) return;

    const text = String(data.text || "").trim().slice(0, MAX_TEXT);
    const mediaUrl = String(data.mediaUrl || "").slice(0, 4000);
    const mediaType = String(data.mediaType || "").slice(0, 100);
    const fileName = String(data.fileName || "").slice(0, 180);
    if (!text && !mediaUrl) return;

    const row = {
      id: crypto.randomUUID(),
      sender,
      text: text || null,
      media_url: mediaUrl || null,
      media_type: mediaType || null,
      file_name: fileName || null,
      created_at: Date.now()
    };

    this.sql.exec(
      `INSERT INTO messages(id,sender,text,media_url,media_type,file_name,created_at)
       VALUES(?,?,?,?,?,?,?)`,
      row.id, row.sender, row.text, row.media_url, row.media_type, row.file_name, row.created_at
    );

    const payload = JSON.stringify({ type: "message", ...row });
    for (const client of this.ctx.getWebSockets()) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(payload); } catch {}
      }
    }

    // Update BOTH users' Rubika-style conversation lists immediately.
    // We call the user's Durable Object through fetch rather than relying on
    // RPC, so the notification path remains reliable after code deployments.
    try {
      const note = {
        text: row.text,
        mediaType: row.media_type,
        fileName: row.file_name,
        createdAt: row.created_at
      };
      const senderHub = this.env.CHAT.get(this.env.CHAT.idFromName(`user:${lower(sender)}`));
      const peerHub = this.env.CHAT.get(this.env.CHAT.idFromName(`user:${lower(peer)}`));
      const makeReq = (owner, conversationPeer) => new Request(
        "https://internal/inbox-push",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...note, owner, peer: conversationPeer, sender })
        }
      );
      await Promise.all([
        senderHub.fetch(makeReq(sender, peer)),
        peerHub.fetch(makeReq(peer, sender))
      ]);
    } catch (e) {
      console.error("Inbox update failed", e);
    }
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch {}
  }
  async webSocketError(ws, error) { console.error("WebSocket error", error); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/") || url.pathname === "/ws" || url.pathname === "/inboxws" || url.pathname === "/inbox-active") {
      const me = cleanName(url.searchParams.get("me"));
      const peer = cleanName(url.searchParams.get("peer"));

      let room = "users";
      if (url.pathname === "/ws") {
        if (!me || !peer) return new Response("Missing users", { status: 400 });
        room = roomKey(me, peer);
      } else if (url.pathname === "/inboxws" || url.pathname === "/inbox-active" || url.pathname === "/api/conversations") {
        if (!me) return new Response("Missing user", { status: 400 });
        room = `user:${lower(me)}`;
      }

      return env.CHAT.get(env.CHAT.idFromName(room)).fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};
