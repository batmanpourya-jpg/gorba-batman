const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const id = () => crypto.randomUUID();
const enc = new TextEncoder();
const toHex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2,"0")).join("");
async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name:"PBKDF2", salt:enc.encode(salt), iterations:120000, hash:"SHA-256" }, key, 256);
  return toHex(bits);
}
function cookie(req, name) {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
function keyFor(a,b){ return [a,b].sort().join("::"); }

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const session = cookie(req,"gb_session");
      if (!session) return new Response("Unauthorized",{status:401});
      const stub = env.MESSENGER.get(env.MESSENGER.idFromName("main"));
      return stub.fetch(new Request(new URL("/ws", url), { method:"GET", headers:{"X-Session":session,"Upgrade":req.headers.get("Upgrade")||"websocket"} }));
    }
    if (url.pathname.startsWith("/api/")) {
      const stub = env.MESSENGER.get(env.MESSENGER.idFromName("main"));
      return stub.fetch(new Request(url, { method:req.method, headers:req.headers, body:req.method === "GET" || req.method === "HEAD" ? undefined : req.body }));
    }
    return env.ASSETS.fetch(req);
  }
};

export class Messenger {
  constructor(ctx) {
    this.ctx = ctx;
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, avatar TEXT DEFAULT '', password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL);`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL);`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, chat_key TEXT NOT NULL, sender_id TEXT NOT NULL, receiver_id TEXT NOT NULL, text TEXT DEFAULT '', kind TEXT DEFAULT 'text', attachment_name TEXT DEFAULT '', attachment_url TEXT DEFAULT '', created_at INTEGER NOT NULL, seen INTEGER DEFAULT 0);`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages(chat_key, created_at);`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS conversations(chat_key TEXT PRIMARY KEY, a TEXT NOT NULL, b TEXT NOT NULL, updated_at INTEGER NOT NULL, last_text TEXT DEFAULT '', last_sender TEXT DEFAULT '');`);
  }
  userBySession(token){ return token ? this.sql.exec("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?", token).one() : null; }
  user(id){ return this.sql.exec("SELECT id,username,name,avatar,created_at FROM users WHERE id=?",id).one(); }
  broadcast(payload, excludeId=null){
    for(const ws of this.ctx.getWebSockets()){
      const a=ws.deserializeAttachment?.();
      if(!a || a.userId===excludeId) continue;
      try{ ws.send(JSON.stringify(payload)); }catch{}
    }
  }
  async fetch(req){
    const url=new URL(req.url);
    if(url.pathname==="/ws") return this.ws(req);
    const token=req.headers.get("X-Session") || cookie(req,"gb_session");
    const me=this.userBySession(token);
    if(url.pathname==="/api/register" && req.method==="POST") return this.register(req);
    if(url.pathname==="/api/login" && req.method==="POST") return this.login(req);
    if(url.pathname==="/api/logout" && req.method==="POST"){ if(token) this.sql.exec("DELETE FROM sessions WHERE token=?",token); return json({ok:true}); }
    if(url.pathname==="/api/me") return me ? json({ok:true,user:this.user(me.id)}) : json({ok:false},401);
    if(!me) return json({error:"unauthorized"},401);
    if(url.pathname==="/api/users"){
      const q=(url.searchParams.get("q")||"").trim();
      if(!q) return json({users:[]});
      return json({users:this.sql.exec("SELECT id,username,name,avatar FROM users WHERE id<>? AND (username LIKE ? OR name LIKE ?) ORDER BY name LIMIT 30",me.id,`%${q}%`,`%${q}%`).toArray()});
    }
    if(url.pathname==="/api/conversations") return this.conversations(me.id);
    if(url.pathname==="/api/history"){
      const peer=url.searchParams.get("peer"); if(!peer) return json({messages:[]});
      const k=keyFor(me.id,peer);
      return json({messages:this.sql.exec("SELECT * FROM messages WHERE chat_key=? ORDER BY created_at ASC LIMIT 500",k).toArray()});
    }
    if(url.pathname==="/api/send" && req.method==="POST") return this.send(req,me);
    if(url.pathname==="/api/seen" && req.method==="POST"){
      const body=await req.json(); const peer=body.peer; if(!peer) return json({ok:false},400);
      this.sql.exec("UPDATE messages SET seen=1 WHERE chat_key=? AND receiver_id=?",keyFor(me.id,peer),me.id);
      this.broadcast({type:"seen",peerId:me.id,chatKey:keyFor(me.id,peer)},me.id);
      return json({ok:true});
    }
    return json({error:"not found"},404);
  }
  async register(req){
    const b=await req.json(); const username=String(b.username||"").trim().toLowerCase(); const name=String(b.name||"").trim(); const password=String(b.password||"");
    if(!/^[a-z0-9_\.]{3,24}$/.test(username) || name.length<2 || password.length<6) return json({error:"نام کاربری یا اطلاعات ورود معتبر نیست"},400);
    if(this.sql.exec("SELECT id FROM users WHERE username=?",username).one()) return json({error:"این نام کاربری قبلاً گرفته شده"},409);
    const uid=id(), salt=id(); const ph=await hashPassword(password,salt); const now=Date.now();
    this.sql.exec("INSERT INTO users(id,username,name,password_hash,salt,created_at) VALUES(?,?,?,?,?,?)",uid,username,name,ph,salt,now);
    const token=id()+id(); this.sql.exec("INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)",token,uid,now);
    return new Response(JSON.stringify({ok:true,user:this.user(uid)}),{headers:{"content-type":"application/json","set-cookie":`gb_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`}});
  }
  async login(req){
    const b=await req.json(); const username=String(b.username||"").trim().toLowerCase(); const password=String(b.password||"");
    const u=this.sql.exec("SELECT * FROM users WHERE username=?",username).one(); if(!u) return json({error:"نام کاربری یا رمز عبور اشتباه است"},401);
    const ph=await hashPassword(password,u.salt); if(ph!==u.password_hash) return json({error:"نام کاربری یا رمز عبور اشتباه است"},401);
    const token=id()+id(); this.sql.exec("INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)",token,u.id,Date.now());
    return new Response(JSON.stringify({ok:true,user:this.user(u.id)}),{headers:{"content-type":"application/json","set-cookie":`gb_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`}});
  }
  conversations(uid){
    const rows=this.sql.exec(`SELECT c.*, CASE WHEN c.a=? THEN c.b ELSE c.a END peer_id FROM conversations c WHERE c.a=? OR c.b=? ORDER BY c.updated_at DESC`,uid,uid,uid).toArray();
    return json({conversations:rows.map(r=>({...r,peer:this.user(r.peer_id),unread:this.sql.exec("SELECT COUNT(*) n FROM messages WHERE chat_key=? AND receiver_id=? AND seen=0",r.chat_key,uid).one().n}))});
  }
  async send(req,me){
    const b=await req.json(); const peerId=String(b.peerId||""); const text=String(b.text||"");
    const peer=this.user(peerId); if(!peer || peer.id===me.id) return json({error:"مخاطب پیدا نشد"},400);
    if(!text.trim() && !b.attachmentUrl) return json({error:"پیام خالی است"},400);
    const now=Date.now(), k=keyFor(me.id,peerId), mid=id();
    this.sql.exec("INSERT INTO messages(id,chat_key,sender_id,receiver_id,text,kind,attachment_name,attachment_url,created_at,seen) VALUES(?,?,?,?,?,?,?,?,?,0)",mid,k,me.id,peerId,text,String(b.kind||"text"),String(b.attachmentName||""),String(b.attachmentUrl||""),now);
    this.sql.exec("INSERT INTO conversations(chat_key,a,b,updated_at,last_text,last_sender) VALUES(?,?,?,?,?,?) ON CONFLICT(chat_key) DO UPDATE SET updated_at=excluded.updated_at,last_text=excluded.last_text,last_sender=excluded.last_sender",k,me.id,peerId,now,text||"📎",me.id);
    const msg=this.sql.exec("SELECT * FROM messages WHERE id=?",mid).one();
    this.broadcast({type:"message",message:msg,peer:this.user(me.id)},me.id);
    this.broadcast({type:"conversation",conversation:{chat_key:k,peer_id:me.id,peer:this.user(me.id),updated_at:now,last_text:text||"📎",last_sender:me.id,unread:1}},me.id);
    return json({ok:true,message:msg});
  }
  ws(req){
    const token=req.headers.get("X-Session"); const me=this.userBySession(token); if(!me) return new Response("Unauthorized",{status:401});
    const pair=new WebSocketPair(); const client=pair[0], server=pair[1]; this.ctx.acceptWebSocket(server); server.serializeAttachment({userId:me.id});
    server.send(JSON.stringify({type:"ready",user:this.user(me.id)}));
    return new Response(null,{status:101,webSocket:client});
  }
  webSocketMessage(ws,message){
    // HTTP API is authoritative; websocket is push-only in this build.
  }
  webSocketClose(ws){ try{ws.close();}catch{} }
}

// Compatibility export for the Durable Object namespace that this Worker already had.
export { Messenger as ChatRoom };
