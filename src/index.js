import { DurableObject } from "cloudflare:workers";

const MAX_NAME = 40;
const MAX_TEXT = 2000;

function cleanName(v) { return String(v || "").trim().slice(0, MAX_NAME); }
function lower(v) { return cleanName(v).toLocaleLowerCase("fa-IR"); }
function roomKey(a,b) {
  return [cleanName(a), cleanName(b)].sort((x,y)=>lower(x).localeCompare(lower(y),"fa")).join("::");
}
function out(data, status=200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" }});
}

export class ChatRoomV2 extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
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
    `);
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/register" && request.method === "POST") {
      try {
        const body = await request.json();
        const name = cleanName(body.name);
        if (!name) return out({ok:false,error:"نام وارد نشده"},400);
        const now = Date.now();
        this.sql.exec(
          `INSERT INTO users(name,name_lc,created_at,updated_at)
           VALUES(?,?,?,?)
           ON CONFLICT(name) DO UPDATE SET updated_at=excluded.updated_at`,
          name, lower(name), now, now
        );
        return out({ok:true,name});
      } catch(e) { return out({ok:false,error:"درخواست نامعتبر است"},400); }
    }

    if (url.pathname === "/api/search" && request.method === "GET") {
      const q = lower(url.searchParams.get("q") || "");
      if (!q) return out({ok:true,users:[]});
      const rows = this.sql.exec(
        `SELECT name, avatar_url FROM users WHERE name_lc LIKE ? ORDER BY name_lc LIMIT 20`,
        `%${q}%`
      ).toArray();
      return out({ok:true,users:rows});
    }

    if (url.pathname === "/api/profile" && request.method === "GET") {
      const name = cleanName(url.searchParams.get("name"));
      const row = this.sql.exec(`SELECT name,avatar_url FROM users WHERE name=?`, name).toArray()[0];
      return out({ok:true,user:row || {name,avatar_url:null}});
    }

    if (url.pathname === "/api/profile" && request.method === "POST") {
      try {
        const body = await request.json();
        const name = cleanName(body.name);
        const avatarUrl = String(body.avatarUrl || "").slice(0, 2000);
        if (!name) return out({ok:false,error:"نام وارد نشده"},400);
        const now = Date.now();
        this.sql.exec(
          `INSERT INTO users(name,name_lc,avatar_url,created_at,updated_at)
           VALUES(?,?,?,?,?)
           ON CONFLICT(name) DO UPDATE SET avatar_url=excluded.avatar_url,updated_at=excluded.updated_at`,
          name, lower(name), avatarUrl || null, now, now
        );
        return out({ok:true,name,avatarUrl:avatarUrl||null});
      } catch { return out({ok:false,error:"درخواست نامعتبر است"},400); }
    }

    if (url.pathname === "/api/history" && request.method === "GET") {
      const rows = this.sql.exec(
        `SELECT id,sender,text,media_url,media_type,file_name,created_at
         FROM messages ORDER BY created_at DESC LIMIT 100`
      ).toArray().reverse();
      return out({ok:true,messages:rows});
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
        return new Response("WebSocket required",{status:426});

      const me = cleanName(url.searchParams.get("me"));
      const peer = cleanName(url.searchParams.get("peer"));
      if (!me || !peer || lower(me)===lower(peer))
        return new Response("Two different users are required",{status:400});

      const pair = new WebSocketPair();
      const [client,server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({me,peer});

      const history = this.sql.exec(
        `SELECT id,sender,text,media_url,media_type,file_name,created_at
         FROM messages ORDER BY created_at DESC LIMIT 100`
      ).toArray().reverse();

      for (const m of history) {
        if (server.readyState === WebSocket.OPEN) server.send(JSON.stringify({type:"message",...m}));
      }
      return new Response(null,{status:101,webSocket:client});
    }
    return new Response("Not found",{status:404});
  }

  async webSocketMessage(ws, message) {
    let data;
    try { data = typeof message==="string" ? JSON.parse(message) : null; } catch { return; }
    if (!data || !["message","media"].includes(data.type)) return;

    const session = ws.deserializeAttachment() || {};
    const sender = cleanName(session.me);
    if (!sender) return;

    const text = String(data.text||"").trim().slice(0,MAX_TEXT);
    const mediaUrl = String(data.mediaUrl||"").slice(0,4000);
    const mediaType = String(data.mediaType||"").slice(0,100);
    const fileName = String(data.fileName||"").slice(0,180);
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
      row.id,row.sender,row.text,row.media_url,row.media_type,row.file_name,row.created_at
    );

    const payload = JSON.stringify({type:"message",...row});
    for (const client of this.ctx.getWebSockets()) {
      if (client.readyState===WebSocket.OPEN) {
        try { client.send(payload); } catch {}
      }
    }
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch {}
  }
  async webSocketError(ws, error) { console.error("WebSocket error",error); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") || url.pathname==="/ws") {
      const me = cleanName(url.searchParams.get("me"));
      const peer = cleanName(url.searchParams.get("peer"));
      let room = "users";
      if (url.pathname==="/ws") {
        if (!me || !peer) return new Response("Missing users",{status:400});
        room = roomKey(me,peer);
      }
      return env.CHAT.get(env.CHAT.idFromName(room)).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};