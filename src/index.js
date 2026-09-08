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
      "SELECT id,name,avatar,cover,bio,created_at,last_seen FROM users WHERE id=? LIMIT 1", id
    ).toArray();
    return rows[0] || null;
  }

  byName(name) {
    const rows = this.ctx.storage.sql.exec(
      "SELECT id,name,avatar,cover,bio,created_at,last_seen FROM users WHERE name=? LIMIT 1", name
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
      "SELECT id,name,avatar,cover,bio,created_at,last_seen FROM users WHERE id<>? ORDER BY created_at ASC, name COLLATE NOCASE ASC LIMIT 200", me
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
            "INSERT INTO users(id,name,avatar,cover,bio,created_at,last_seen) VALUES(?,?,?,?,?,?,?)",
            id, name, null, null, "", now, now
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
          "SELECT id,name,avatar,cover,bio,created_at,last_seen FROM users WHERE name LIKE ? ESCAPE '\\\\' ORDER BY name COLLATE NOCASE LIMIT 30",
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
          "UPDATE users SET name=?,avatar=?,cover=?,bio=? WHERE id=?",
          name,
          body.avatar === undefined ? old.avatar : body.avatar,
          body.cover === undefined ? old.cover : body.cover,
          String(body.bio === undefined ? old.bio : body.bio).slice(0, 160),
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
    ctx.blockConcurrencyWhile(async () => {
      const sql = this.ctx.storage.sql;
      sql.exec(`CREATE TABLE IF NOT EXISTS messages(
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        receiver_id TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        reply_to_id TEXT,
        edited INTEGER NOT NULL DEFAULT 0,
        edited_at INTEGER,
        read_at INTEGER,
        pinned INTEGER NOT NULL DEFAULT 0
      );`);
      const cols = sql.exec('PRAGMA table_info(messages)').toArray();
      const add = (c,d) => { if (!cols.some(r => r.name === c)) sql.exec(`ALTER TABLE messages ADD COLUMN ${c} ${d}`); };
      add('reply_to_id','TEXT'); add('edited','INTEGER NOT NULL DEFAULT 0'); add('edited_at','INTEGER'); add('read_at','INTEGER'); add('pinned','INTEGER NOT NULL DEFAULT 0');
      sql.exec("CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id,receiver_id,created_at);");
      sql.exec("CREATE INDEX IF NOT EXISTS idx_messages_reply ON messages(reply_to_id);");
    });
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
        const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit") || 4)));
        const before = Number(url.searchParams.get("before") || 0);
        if (!a || !b || a === b) return json({ ok: false, error: "چت نامعتبر" }, 400);
        let rows;
        if (before > 0) {
          rows = this.ctx.storage.sql.exec(
            "SELECT id,sender_id,receiver_id,text,created_at,deleted,reply_to_id,edited,edited_at,read_at,pinned FROM messages WHERE ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)) AND created_at < ? ORDER BY created_at DESC,id DESC LIMIT ?",
            a, b, b, a, before, limit
          ).toArray().reverse();
        } else {
          rows = this.ctx.storage.sql.exec(
            "SELECT id,sender_id,receiver_id,text,created_at,deleted,reply_to_id,edited,edited_at,read_at,pinned FROM messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY created_at DESC,id DESC LIMIT ?",
            a, b, b, a, limit
          ).toArray().reverse();
        }
        return json({ ok: true, messages: rows, has_more: rows.length === limit });
      }

      if (req.method === "POST" && url.pathname === "/send") {
        const body = await req.json();
        const sender = String(body.sender_id || ""), receiver = String(body.receiver_id || ""), text = cleanMsg(body.text);
        const reply_to_id = body.reply_to_id ? String(body.reply_to_id) : null;
        if (!sender || !receiver || sender === receiver || !text) return json({ ok: false, error: "پیام نامعتبر است" }, 400);
        const id = uid(), now = Date.now();
        this.ctx.storage.sql.exec(
          "INSERT INTO messages(id,sender_id,receiver_id,text,created_at,deleted,reply_to_id,edited,edited_at,read_at,pinned) VALUES(?,?,?,?,?,0,?,0,NULL,NULL,0)",
          id, sender, receiver, text, now, reply_to_id
        );
        const message = { id, sender_id: sender, receiver_id: receiver, text, created_at: now, deleted: 0, reply_to_id, edited: 0, edited_at: null, read_at: null, pinned: 0 };
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

      if (req.method === "POST" && url.pathname === "/read-message") {
        const body = await req.json();
        const id = String(body.id || ""), requester = String(body.requester || "");
        const rows = this.ctx.storage.sql.exec("SELECT * FROM messages WHERE id=? LIMIT 1", id).toArray();
        const m = rows[0];
        if (!m) return json({ ok:false, error:"پیام پیدا نشد" },404);
        if (m.receiver_id !== requester) return json({ok:false,error:"دسترسی ندارید"},403);
        const at=Date.now(); this.ctx.storage.sql.exec("UPDATE messages SET read_at=? WHERE id=?",at,id);
        const out={...m,read_at:at};
        for(const ws of this.socketsFor(m.sender_id,m.receiver_id)){try{ws.send(JSON.stringify({type:'read',message:out}));}catch{}}
        return json({ok:true,message:out});
      }

      if (req.method === "POST" && url.pathname === "/edit") {
        const body=await req.json(); const id=String(body.id||''), requester=String(body.requester||''), text=cleanMsg(body.text);
        if(!id||!text) return json({ok:false,error:'متن نامعتبر است'},400);
        const rows=this.ctx.storage.sql.exec("SELECT * FROM messages WHERE id=? LIMIT 1",id).toArray(); const m=rows[0];
        if(!m) return json({ok:false,error:'پیام پیدا نشد'},404); if(m.sender_id!==requester) return json({ok:false,error:'فقط فرستنده می‌تواند ویرایش کند'},403); if(m.deleted) return json({ok:false,error:'پیام حذف شده است'},400);
        const at=Date.now(); this.ctx.storage.sql.exec("UPDATE messages SET text=?,edited=1,edited_at=? WHERE id=?",text,at,id);
        const out={...m,text,edited:1,edited_at:at}; for(const ws of this.socketsFor(m.sender_id,m.receiver_id)){try{ws.send(JSON.stringify({type:'edited',message:out}));}catch{}}
        return json({ok:true,message:out});
      }

      if (req.method === "POST" && url.pathname === "/pin") {
        const body=await req.json(); const id=String(body.id||''), requester=String(body.requester||''), pinned=!!body.pinned;
        const rows=this.ctx.storage.sql.exec("SELECT * FROM messages WHERE id=? LIMIT 1",id).toArray(); const m=rows[0];
        if(!m) return json({ok:false,error:'پیام پیدا نشد'},404); if(m.sender_id!==requester && m.receiver_id!==requester) return json({ok:false,error:'دسترسی ندارید'},403);
        this.ctx.storage.sql.exec("UPDATE messages SET pinned=? WHERE id=?",pinned?1:0,id); const out={...m,pinned:pinned?1:0};
        for(const ws of this.socketsFor(m.sender_id,m.receiver_id)){try{ws.send(JSON.stringify({type:'pinned',message:out}));}catch{}}
        return json({ok:true,message:out,pinned:pinned?1:0});
      }

      if (req.method === "GET" && url.pathname === "/search-messages") {
        const a=String(url.searchParams.get('a')||''), b=String(url.searchParams.get('b')||''), q=String(url.searchParams.get('q')||'').trim();
        if(!a||!b||!q) return json({ok:true,messages:[]}); const like='%'+q.replace(/[\%_]/g,m=>'\\'+m)+'%';
        const rows=this.ctx.storage.sql.exec("SELECT id,sender_id,receiver_id,text,created_at,deleted,reply_to_id,edited,edited_at,read_at,pinned FROM messages WHERE ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)) AND text LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 50",a,b,b,a,like).toArray();
        return json({ok:true,messages:rows});
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

  // Hibernation-compatible real-time events (typing indicator).
  webSocketMessage(ws, message) {
    try {
      const data = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
      if (data.type !== 'typing') return;
      const att = ws.deserializeAttachment() || {};
      for (const peer of this.socketsForPair(att.pair)) {
        if (peer === ws) continue;
        try { peer.send(JSON.stringify({ type: 'typing', show: !!data.show })); } catch {}
      }
    } catch {}
  }
  socketsForPair(pair) { return this.ctx.getWebSockets().filter(x => x.deserializeAttachment()?.pair === pair); }
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

        if (["/api/read-message","/api/edit","/api/pin","/api/delete"].includes(url.pathname)) {
          const body = await req.clone().json();
          const a = String(body.sender_id || body.requester || body.me || ""), b = String(body.receiver_id || body.other || "");
          const chatId = body.chat_id || (a && b ? pairKey(a,b) : "");
          if (!chatId) return json({ok:false,error:"شناسه چت نامعتبر"},400);
          const chat = env.CHAT.get(env.CHAT.idFromName(chatId));
          const target = url.pathname.replace('/api','');
          return chat.fetch(new Request("https://internal"+target,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}));
        }

        if (url.pathname === "/api/search-messages") {
          const a=url.searchParams.get('a')||'', b=url.searchParams.get('b')||'';
          if(!a||!b) return json({ok:false,error:'چت نامعتبر'},400);
          const chat=env.CHAT.get(env.CHAT.idFromName(pairKey(a,b)));
          return chat.fetch(new Request("https://internal/search-messages"+url.search));
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
