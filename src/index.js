import { DurableObject } from "cloudflare:workers";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const clean = v => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
const cleanMsg = v => String(v ?? "").replace(/\u0000/g, "").trim().slice(0, 4000);
const uid = () => crypto.randomUUID();
const pairKey = (a, b) => [String(a), String(b)].sort().join(":");
const isOnline = ts => Number(ts || 0) > Date.now() - 45000;

export class Directory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    // IMPORTANT: this runs before any request is processed. Older deployments
    // already have a users table, so CREATE TABLE IF NOT EXISTS alone is not
    // enough: we must upgrade the existing schema safely.
    ctx.blockConcurrencyWhile(async () => {
      this.migrate();
    });
  }

  migrate() {
    const sql = this.ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      avatar TEXT,
      cover TEXT,
      bio TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0,
      last_seen INTEGER NOT NULL DEFAULT 0
    );`);
    sql.exec(`CREATE TABLE IF NOT EXISTS conversations(
      pair_key TEXT PRIMARY KEY,
      user_a TEXT NOT NULL,
      user_b TEXT NOT NULL,
      last_message TEXT NOT NULL DEFAULT '',
      last_message_at INTEGER NOT NULL DEFAULT 0,
      unread_a INTEGER NOT NULL DEFAULT 0,
      unread_b INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );`);

    // Upgrade tables created by older Gorba Batman builds. Cloudflare
    // recommends doing schema initialization/migrations before requests.
    this.ensureColumn('users', 'avatar', 'TEXT');
    this.ensureColumn('users', 'cover', 'TEXT');
    this.ensureColumn('users', 'bio', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('users', 'created_at', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('users', 'last_seen', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('users', 'theme', "TEXT NOT NULL DEFAULT 'midnight'");
    this.ensureColumn('users', 'background', "TEXT NOT NULL DEFAULT 'default'");
    this.ensureColumn('users', 'background_image', 'TEXT');

    this.ensureColumn('conversations', 'last_message', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('conversations', 'last_message_at', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('conversations', 'unread_a', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('conversations', 'unread_b', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('conversations', 'updated_at', 'INTEGER NOT NULL DEFAULT 0');

    sql.exec(`CREATE INDEX IF NOT EXISTS idx_users_name ON users(name COLLATE NOCASE);`);
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_user_a ON conversations(user_a);`);
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_user_b ON conversations(user_b);`);
  }

  ensureColumn(table, column, definition) {
    const rows = this.ctx.storage.sql.exec(`PRAGMA table_info(${table})`).toArray();
    if (!rows.some(r => r.name === column)) {
      this.ctx.storage.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  user(id) {
    const rows = this.ctx.storage.sql.exec(
      "SELECT id,name,avatar,cover,bio,created_at,last_seen,theme,background,background_image FROM users WHERE id=? LIMIT 1", id
    ).toArray();
    return rows[0] || null;
  }

  byName(name) {
    const rows = this.ctx.storage.sql.exec(
      "SELECT id,name,avatar,cover,bio,created_at,last_seen,theme,background,background_image FROM users WHERE name=? LIMIT 1", name
    ).toArray();
    return rows[0] || null;
  }

  conversation(a, b) {
    const rows = this.ctx.storage.sql.exec(
      "SELECT * FROM conversations WHERE pair_key=? LIMIT 1", pairKey(a, b)
    ).toArray();
    return rows[0] || null;
  }

  decorate(user) {
    return user ? { ...user, online: isOnline(user.last_seen) } : null;
  }

  allPeople(me) {
    const rows = this.ctx.storage.sql.exec(
      "SELECT id,name,avatar,cover,bio,created_at,last_seen,theme,background,background_image FROM users WHERE id<>? ORDER BY created_at ASC, name COLLATE NOCASE ASC LIMIT 200", me
    ).toArray();
    return rows.map(u => this.decorate(u));
  }

  async fetch(req) {
    const url = new URL(req.url);
    try {
      if (req.method === "POST" && url.pathname === "/login") {
        const body = await req.json();
        const name = clean(body.name);
        if (!name) return json({ ok: false, error: "نام را وارد کنید" }, 400);

        let user = this.byName(name);
        if (!user) {
          const now = Date.now();
          const id = uid();
          this.ctx.storage.sql.exec(
            "INSERT INTO users(id,name,avatar,cover,bio,created_at,last_seen,theme,background,background_image) VALUES(?,?,?,?,?,?,?,?,?,?)",
            id, name, null, null, "", now, now, 'midnight', 'default', null
          );
          user = this.user(id);
        } else {
          this.ctx.storage.sql.exec("UPDATE users SET last_seen=? WHERE id=?", Date.now(), user.id);
          user = this.user(user.id);
        }
        return json({ ok: true, user: this.decorate(user) });
      }

      if (req.method === "POST" && url.pathname === "/presence") {
        const id = url.searchParams.get("id") || "";
        if (!this.user(id)) return json({ ok: false, error: "کاربر پیدا نشد" }, 404);
        this.ctx.storage.sql.exec("UPDATE users SET last_seen=? WHERE id=?", Date.now(), id);
        return json({ ok: true });
      }

      if (req.method === "GET" && url.pathname === "/user") {
        const user = this.user(url.searchParams.get("id") || "");
        return user ? json({ ok: true, user: this.decorate(user) }) : json({ ok: false, error: "کاربر پیدا نشد" }, 404);
      }

      if (req.method === "GET" && url.pathname === "/search") {
        const q = clean(url.searchParams.get("q"));
        if (!q) return json({ ok: true, users: [] });
        const like = q.replace(/[\\%_]/g, m => "\\" + m) + "%";
        const rows = this.ctx.storage.sql.exec(
          "SELECT id,name,avatar,cover,bio,created_at,last_seen,theme,background,background_image FROM users WHERE name LIKE ? ESCAPE '\\\\' ORDER BY name COLLATE NOCASE LIMIT 30",
          like
        ).toArray();
        return json({ ok: true, users: rows.map(u => this.decorate(u)) });
      }

      if (req.method === "POST" && url.pathname === "/profile") {
        const body = await req.json();
        const old = this.user(body.id);
        if (!old) return json({ ok: false, error: "حساب پیدا نشد" }, 404);
        const name = body.name === undefined ? old.name : clean(body.name);
        if (!name) return json({ ok: false, error: "نام نمی‌تواند خالی باشد" }, 400);
        const same = this.byName(name);
        if (same && same.id !== old.id) return json({ ok: false, error: "این نام قبلاً استفاده شده است" }, 409);
        this.ctx.storage.sql.exec(
          "UPDATE users SET name=?,avatar=?,cover=?,bio=?,theme=?,background=?,background_image=? WHERE id=?",
          name,
          body.avatar === undefined ? old.avatar : body.avatar,
          body.cover === undefined ? old.cover : body.cover,
          String(body.bio === undefined ? old.bio : body.bio).slice(0, 160),
          String(body.theme === undefined ? (old.theme || 'midnight') : body.theme).slice(0, 30),
          String(body.background === undefined ? (old.background || 'default') : body.background).slice(0, 40),
          body.background_image === undefined ? (old.background_image || null) : body.background_image,
          old.id
        );
        return json({ ok: true, user: this.decorate(this.user(old.id)) });
      }

      if (req.method === "GET" && url.pathname === "/conversations") {
        const me = url.searchParams.get("id") || "";
        if (!me || !this.user(me)) return json({ ok: false, error: "شناسه نامعتبر" }, 400);

        // For this private friends messenger, every registered person is immediately
        // visible in the chat list. No second search is required after they join.
        const people = this.allPeople(me);
        const convRows = this.ctx.storage.sql.exec(
          "SELECT * FROM conversations WHERE user_a=? OR user_b=?", me, me
        ).toArray();
        const convMap = new Map(convRows.map(c => {
          const other = c.user_a === me ? c.user_b : c.user_a;
          return [other, c];
        }));

        const conversations = people.map(user => {
          const c = convMap.get(user.id);
          return {
            pair_key: c?.pair_key || pairKey(me, user.id),
            user,
            last_message: c?.last_message || "",
            last_message_at: c?.last_message_at || 0,
            unread: c ? (c.user_a === me ? c.unread_a : c.unread_b) : 0,
            started: Boolean(c)
          };
        });

        conversations.sort((a, b) => {
          if (a.last_message_at !== b.last_message_at) return b.last_message_at - a.last_message_at;
          return a.user.name.localeCompare(b.user.name, "fa");
        });
        return json({ ok: true, conversations });
      }

      if (req.method === "POST" && url.pathname === "/conversation") {
        const body = await req.json();
        const me = String(body.me || ""), other = String(body.other || "");
        if (!me || !other || me === other) return json({ ok: false, error: "گفتگوی نامعتبر" }, 400);
        if (!this.user(me) || !this.user(other)) return json({ ok: false, error: "کاربر پیدا نشد" }, 404);
        const existing = this.conversation(me, other);
        if (!existing) {
          const now = Date.now();
          this.ctx.storage.sql.exec(
            "INSERT INTO conversations(pair_key,user_a,user_b,last_message,last_message_at,unread_a,unread_b,updated_at) VALUES(?,?,?,?,?,?,?,?)",
            pairKey(me, other), me, other, "", 0, 0, 0, now
          );
        }
        return json({ ok: true });
      }

      if (req.method === "POST" && url.pathname === "/message-event") {
        const body = await req.json();
        const sender = String(body.sender_id || ""), receiver = String(body.receiver_id || "");
        const text = cleanMsg(body.text), now = Number(body.created_at) || Date.now();
        if (!sender || !receiver || !text) return json({ ok: false, error: "پیام نامعتبر" }, 400);

        const old = this.conversation(sender, receiver);
        if (!old) {
          this.ctx.storage.sql.exec(
            "INSERT INTO conversations(pair_key,user_a,user_b,last_message,last_message_at,unread_a,unread_b,updated_at) VALUES(?,?,?,?,?,?,?,?)",
            pairKey(sender, receiver), sender, receiver, text, now, 0, 1, now
          );
        } else {
          const unreadColumn = old.user_a === receiver ? "unread_a" : "unread_b";
          this.ctx.storage.sql.exec(
            `UPDATE conversations SET last_message=?,last_message_at=?,updated_at=?,${unreadColumn}=${unreadColumn}+1 WHERE pair_key=?`,
            text, now, now, old.pair_key
          );
        }
        return json({ ok: true });
      }

      if (req.method === "POST" && url.pathname === "/read") {
        const body = await req.json();
        const me = String(body.me || ""), other = String(body.other || "");
        const c = this.conversation(me, other);
        if (!c) return json({ ok: true });
        const column = c.user_a === me ? "unread_a" : "unread_b";
        this.ctx.storage.sql.exec(`UPDATE conversations SET ${column}=0 WHERE pair_key=?`, c.pair_key);
        return json({ ok: true });
      }

      return json({ ok: false, error: "not found" }, 404);
    } catch (error) {
      return json({ ok: false, error: error?.message || "خطای سرور" }, 500);
    }
  }
}

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS messages(
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      receiver_id TEXT NOT NULL,
      text TEXT NOT NULL,
      media_id TEXT,
      media_type TEXT,
      media_name TEXT,
      created_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0
    );`);
    ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id,receiver_id,created_at);");
    for (const [c,d] of [['media_id','TEXT'],['media_type','TEXT'],['media_name','TEXT']]) {
      const cols = ctx.storage.sql.exec('PRAGMA table_info(messages)').toArray();
      if (!cols.some(r=>r.name===c)) ctx.storage.sql.exec(`ALTER TABLE messages ADD COLUMN ${c} ${d}`);
    }
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS media_chunks(
      media_id TEXT NOT NULL,
      part INTEGER NOT NULL,
      mime TEXT NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY(media_id,part)
    );`);
  }

  socketsFor(a, b) {
    const p = pairKey(a, b);
    return this.ctx.getWebSockets().filter(ws => ws.deserializeAttachment()?.pair === p);
  }

  async fetch(req) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/ws") {
        if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
        const a = url.searchParams.get("a") || "", b = url.searchParams.get("b") || "";
        if (!a || !b || a === b) return new Response("Bad chat", { status: 400 });
        const [client, server] = Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ pair: pairKey(a, b), user: a });
        return new Response(null, { status: 101, webSocket: client });
      }

      if (req.method === "GET" && url.pathname === "/history") {
        const a = url.searchParams.get("a") || "", b = url.searchParams.get("b") || "";
        if (!a || !b || a === b) return json({ ok: false, error: "چت نامعتبر" }, 400);
        const rows = this.ctx.storage.sql.exec(
          "SELECT id,sender_id,receiver_id,text,media_id,media_type,media_name,created_at,deleted FROM messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY created_at ASC,id ASC LIMIT 500",
          a, b, b, a
        ).toArray();
        return json({ ok: true, messages: rows });
      }

      if (req.method === "POST" && url.pathname === "/send") {
        const body = await req.json();
        const sender = String(body.sender_id || ""), receiver = String(body.receiver_id || ""), text = cleanMsg(body.text);
        if (!sender || !receiver || sender === receiver || !text) return json({ ok: false, error: "پیام نامعتبر است" }, 400);
        const id = uid(), now = Date.now();
        this.ctx.storage.sql.exec(
          "INSERT INTO messages(id,sender_id,receiver_id,text,media_id,media_type,media_name,created_at,deleted) VALUES(?,?,?,?,?,?,?,?,0)",
          id, sender, receiver, text, null, null, null, now
        );
        const message = { id, sender_id: sender, receiver_id: receiver, text, media_id:null, media_type:null, media_name:null, created_at: now, deleted: 0 };
        await this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName("main")).fetch(
          new Request("https://internal/message-event", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(message)
          })
        );
        for (const ws of this.socketsFor(sender, receiver)) {
          try { ws.send(JSON.stringify({ type: "message", message })); } catch {}
        }
        return json({ ok: true, message });
      }

      if (req.method === "POST" && url.pathname === "/upload") {
        const form = await req.formData();
        const sender = String(form.get('sender_id') || ''), receiver = String(form.get('receiver_id') || '');
        const file = form.get('file');
        if (!sender || !receiver || sender === receiver || !(file instanceof File)) return json({ ok:false, error:'فایل یا گیرنده نامعتبر است' },400);
        if (!/^image\/(jpeg|png|webp|gif)|^video\/(mp4|webm|quicktime)$/.test(file.type)) return json({ok:false,error:'فقط عکس و فیلم پشتیبانی می‌شود'},400);
        const max = 20 * 1024 * 1024;
        if (file.size > max) return json({ok:false,error:'حجم فایل باید حداکثر ۲۰ مگابایت باشد'},413);
        const mediaId = uid();
        const buf = new Uint8Array(await file.arrayBuffer());
        const chunk = 1400000;
        for (let part=0; part<buf.byteLength; part+=chunk) {
          const piece = buf.slice(part, Math.min(part+chunk, buf.byteLength));
          this.ctx.storage.sql.exec('INSERT INTO media_chunks(media_id,part,mime,data) VALUES(?,?,?,?)', mediaId, Math.floor(part/chunk), file.type, piece);
        }
        const id = uid(), now = Date.now();
        this.ctx.storage.sql.exec('INSERT INTO messages(id,sender_id,receiver_id,text,media_id,media_type,media_name,created_at,deleted) VALUES(?,?,?,?,?,?,?,?,0)', id,sender,receiver,'',mediaId,file.type,String(file.name||'file').slice(0,120),now);
        const message={id,sender_id:sender,receiver_id:receiver,text:'',media_id:mediaId,media_type:file.type,media_name:String(file.name||'file').slice(0,120),created_at:now,deleted:0};
        await this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('main')).fetch(new Request('https://internal/message-event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...message,text:file.type.startsWith('image/')?'📷 عکس':'🎬 فیلم'})}));
        for (const ws of this.socketsFor(sender,receiver)) { try { ws.send(JSON.stringify({type:'message',message})); } catch {} }
        return json({ok:true,message});
      }

      if (req.method === 'GET' && url.pathname === '/media') {
        const mediaId = url.searchParams.get('id') || '';
        if (!mediaId) return new Response('Not found',{status:404});
        const rows = this.ctx.storage.sql.exec('SELECT part,mime,data FROM media_chunks WHERE media_id=? ORDER BY part ASC',mediaId).toArray();
        if (!rows.length) return new Response('Not found',{status:404});
        const total = rows.reduce((n,r)=>n+r.data.byteLength,0);
        const out = new Uint8Array(total); let off=0;
        for (const r of rows) { const b = new Uint8Array(r.data); out.set(b,off); off+=b.length; }
        return new Response(out,{headers:{'content-type':rows[0].mime,'cache-control':'public,max-age=31536000,immutable'}});
      }

      if (req.method === "POST" && url.pathname === "/delete") {
        const body = await req.json();
        const id = String(body.id || ""), requester = String(body.requester || "");
        const rows = this.ctx.storage.sql.exec(
          "SELECT id,sender_id,receiver_id FROM messages WHERE id=? LIMIT 1", id
        ).toArray();
        const message = rows[0];
        if (!message) return json({ ok: false, error: "پیام پیدا نشد" }, 404);
        if (message.sender_id !== requester) return json({ ok: false, error: "فقط فرستنده می‌تواند پیام را حذف کند" }, 403);
        this.ctx.storage.sql.exec("UPDATE messages SET text='',deleted=1 WHERE id=?", id);
        for (const ws of this.socketsFor(message.sender_id, message.receiver_id)) {
          try { ws.send(JSON.stringify({ type: "deleted", id })); } catch {}
        }
        return json({ ok: true });
      }

      return json({ ok: false, error: "not found" }, 404);
    } catch (error) {
      return json({ ok: false, error: error?.message || "خطای چت" }, 500);
    }
  }

  // Hibernation-compatible handlers. Clients only send data through /api/send,
  // but these methods make the WebSocket server safe for Cloudflare hibernation.
  webSocketMessage() {}
  webSocketClose() {}
  webSocketError() {}
}

export class UserInbox extends DurableObject {}
export class ChatRoomV2 extends ChatRoom {}
export class Messenger extends UserInbox {}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const directory = () => env.DIRECTORY.get(env.DIRECTORY.idFromName("main"));
    try {
      if (url.pathname.startsWith("/api/")) {
        const map = {
          "/api/login": "/login",
          "/api/search": "/search",
          "/api/user": "/user",
          "/api/profile": "/profile",
          "/api/presence": "/presence",
          "/api/conversations": "/conversations",
          "/api/conversation": "/conversation",
          "/api/read": "/read"
        };
        if (map[url.pathname]) {
          return directory().fetch(new Request(new URL(map[url.pathname] + url.search, "https://internal"), req));
        }

        if (url.pathname === "/api/history") {
          const a = url.searchParams.get("a") || "", b = url.searchParams.get("b") || "";
          if (!a || !b) return json({ ok: false, error: "چت نامعتبر" }, 400);
          const chat = env.CHAT.get(env.CHAT.idFromName(pairKey(a, b)));
          return chat.fetch(new Request("https://internal/history" + url.search));
        }

        if (url.pathname === "/api/send") {
          const body = await req.clone().json();
          const a = String(body.sender_id || ""), b = String(body.receiver_id || "");
          const chat = env.CHAT.get(env.CHAT.idFromName(pairKey(a, b)));
          return chat.fetch(new Request("https://internal/send", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
          }));
        }

        if (url.pathname === "/api/upload") {
          const body = await req.formData();
          const a = String(body.get('sender_id') || ''), b = String(body.get('receiver_id') || '');
          const chat = env.CHAT.get(env.CHAT.idFromName(pairKey(a,b)));
          return chat.fetch(new Request('https://internal/upload',{method:'POST',body}));
        }

        if (url.pathname === "/api/media") {
          const a = url.searchParams.get('a') || '', b = url.searchParams.get('b') || '';
          const chat = env.CHAT.get(env.CHAT.idFromName(pairKey(a,b)));
          return chat.fetch(new Request('https://internal/media' + url.search));
        }

        if (url.pathname === "/api/delete") {
          const body = await req.clone().json();
          const a = String(body.sender_id || body.requester || ""), b = String(body.receiver_id || "");
          const chatId = body.chat_id || (a && b ? pairKey(a, b) : "");
          if (!chatId) return json({ ok: false, error: "شناسه چت نامعتبر" }, 400);
          const chat = env.CHAT.get(env.CHAT.idFromName(chatId));
          return chat.fetch(new Request("https://internal/delete", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
          }));
        }

        if (url.pathname === "/api/ws") {
          const a = url.searchParams.get("a") || "", b = url.searchParams.get("b") || "";
          if (!a || !b) return new Response("Bad chat", { status: 400 });
          const chat = env.CHAT.get(env.CHAT.idFromName(pairKey(a, b)));
          return chat.fetch(new Request("https://internal/ws?a=" + encodeURIComponent(a) + "&b=" + encodeURIComponent(b), req));
        }

        return json({ ok: false, error: "API not found" }, 404);
      }
      return env.ASSETS.fetch(req);
    } catch (error) {
      return json({ ok: false, error: error?.message || "خطای داخلی" }, 500);
    }
  }
};
