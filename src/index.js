import { DurableObject } from "cloudflare:workers";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });

const cleanId = (v) => String(v ?? "").trim().replace(/^@+/, "").toLowerCase();
const cleanName = (v) => String(v || "").trim().replace(/\s+/g, " ").slice(0, 40);
const cleanBio = (v) => String(v || "").trim().replace(/\s+/g, " ").slice(0, 80);
const cleanImage = (v, max = 700000) => {
  const s = String(v || "");
  if (!s) return "";
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(s)) return "";
  return s.length <= max ? s : null;
};
const now = () => Date.now();
const chatKey = (a,b) => {
  const x=cleanId(a), y=cleanId(b);
  return x < y ? `dm:${x}:${y}` : `dm:${y}:${x}`;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path.startsWith("/api/")) return await api(request, env, path);
      if (request.headers.get("Upgrade") === "websocket") {
        return await userInboxFetch(request, env);
      }
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error(e);
      return json({ ok:false, error:"SERVER_ERROR", message:e?.message || "Server error" }, 500);
    }
  }
};

async function api(request, env, path) {
  const method=request.method;
  if (method==="POST" && path==="/api/register") {
    const b=await request.json();
    const id=cleanId(b.id), name=cleanName(b.name);
    if (!/^[a-z0-9_]{3,24}$/.test(id)) return json({ok:false,error:"BAD_ID",message:"ID باید ۳ تا ۲۴ کاراکتر و فقط شامل حروف انگلیسی، عدد و _ باشد؛ مثل pourya_123."},400);
    if (name.length<2) return json({ok:false,error:"BAD_NAME",message:"نام نمایشی را وارد کن."},400);
    const stub=env.DIRECTORY.getByName("directory");
    const r=await stub.registerUser(id,name);
    if (!r.ok) return json(r,409);
    return json(r);
  }
  if (method==="POST" && path==="/api/login") {
    const b=await request.json(), id=cleanId(b.id);
    if (!id) return json({ok:false,error:"BAD_ID"},400);
    const stub=env.DIRECTORY.getByName("directory");
    const u=await stub.getUser(id);
    return u ? json({ok:true,user:u}) : json({ok:false,error:"NOT_FOUND",message:"این ID ثبت نشده است."},404);
  }
  if (method==="GET" && path==="/api/user") {
    const id=cleanId(new URL(request.url).searchParams.get("id"));
    const u=await env.DIRECTORY.getByName("directory").getUser(id);
    return u ? json({ok:true,user:u}) : json({ok:false,error:"NOT_FOUND"},404);
  }
  if (method==="GET" && path==="/api/search") {
    const q=cleanId(new URL(request.url).searchParams.get("q"));
    if (!q) return json({ok:true,users:[]});
    return json({ok:true,users:await env.DIRECTORY.getByName("directory").searchUsers(q)});
  }
  if (method==="POST" && path==="/api/profile") {
    const b=await request.json().catch(()=>({}));
    const id=cleanId(b?.id), name=cleanName(b?.name);
    if (!id) return json({ok:false,error:"BAD_ID",message:"شناسه حساب نامعتبر است."},400);
    if (name.length<2) return json({ok:false,error:"BAD_NAME",message:"نام نمایشی باید حداقل ۲ کاراکتر باشد."},400);
    const avatar = b?.avatar === undefined ? undefined : cleanImage(b.avatar);
    const cover = b?.cover === undefined ? undefined : cleanImage(b.cover, 700000);
    const bio = b?.bio === undefined ? undefined : cleanBio(b.bio);
    if (avatar === null || cover === null) return json({ok:false,error:"BAD_IMAGE",message:"عکس خیلی بزرگ یا نامعتبر است."},400);
    const r=await env.DIRECTORY.getByName("directory").updateProfile(id,name,bio,avatar,cover);
    return json(r,r.ok?200:404);
  }
  if (method==="GET" && path==="/api/chats") {
    const id=cleanId(new URL(request.url).searchParams.get("id"));
    if (!id) return json({ok:false},400);
    return json({ok:true,chats:await env.INBOX.getByName(id).listChats()});
  }
  if (method==="GET" && path==="/api/history") {
    const u=cleanId(new URL(request.url).searchParams.get("user"));
    const peer=cleanId(new URL(request.url).searchParams.get("peer"));
    if (!u || !peer) return json({ok:false},400);
    return json({ok:true,messages:await env.INBOX.getByName(u).history(chatKey(u,peer))});
  }
  if (method==="POST" && path==="/api/send") {
    const b=await request.json();
    const from=cleanId(b.from), to=cleanId(b.to), body=String(b.body||"").trim().slice(0,4000);
    if (!from || !to || !body) return json({ok:false,error:"BAD_MESSAGE"},400);
    const peer=await env.DIRECTORY.getByName("directory").getUser(to);
    if (!peer) return json({ok:false,error:"USER_NOT_FOUND",message:"این کاربر پیدا نشد."},404);
    const msg={id:crypto.randomUUID(),chatKey:chatKey(from,to),from,to,body,createdAt:now()};
    await env.INBOX.getByName(from).saveMessage({...msg,direction:"out"});
    await env.INBOX.getByName(to).saveMessage({...msg,direction:"in"});
    return json({ok:true,message:msg});
  }
  if (method==="POST" && path==="/api/read") {
    const b=await request.json(), user=cleanId(b.user), peer=cleanId(b.peer);
    return json(await env.INBOX.getByName(user).markRead(chatKey(user,peer)));
  }
  return json({ok:false,error:"NOT_FOUND"},404);
}

async function userInboxFetch(request,env){
  const u=cleanId(new URL(request.url).searchParams.get("user"));
  if(!u) return new Response("missing user",{status:400});
  return env.INBOX.getByName(u).fetch(request);
}

export class Directory extends DurableObject {
  constructor(ctx,env){
    super(ctx,env); this.sql=ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT, bio TEXT NOT NULL DEFAULT '', cover TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    )`);
    try { this.sql.exec(`ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''`); } catch {}
    try { this.sql.exec(`ALTER TABLE users ADD COLUMN cover TEXT NOT NULL DEFAULT ''`); } catch {}
  }
  async registerUser(id,name){
    const exists=this.sql.exec(`SELECT id FROM users WHERE id=?1`,id).one();
    if(exists) return {ok:false,error:"ID_TAKEN",message:"این ID قبلاً استفاده شده است."};
    this.sql.exec(`INSERT INTO users(id,name,avatar,created_at) VALUES(?1,?2,'',?3)`,id,name,now());
    return {ok:true,user:{id,name,avatar:"",bio:"",cover:""}};
  }
  async getUser(id){ return this.sql.exec(`SELECT id,name,avatar,bio,cover FROM users WHERE id=?1`,cleanId(id)).one() || null; }
  async searchUsers(q){
    const like=`%${cleanId(q)}%`;
    return this.sql.exec(`SELECT id,name,avatar,bio,cover FROM users WHERE id LIKE ?1 OR name LIKE ?1 ORDER BY id LIMIT 30`,like).toArray();
  }
  async updateProfile(id,name,bio,avatar,cover){
    const u=await this.getUser(id); if(!u) return {ok:false,error:"NOT_FOUND"};
    if(name.length<2) return {ok:false,error:"BAD_NAME",message:"نام نمایشی باید حداقل ۲ کاراکتر باشد."};
    const nextBio = bio === undefined ? (u.bio || "") : bio;
    const nextAvatar = avatar === undefined ? (u.avatar || "") : avatar;
    const nextCover = cover === undefined ? (u.cover || "") : cover;
    this.sql.exec(`UPDATE users SET name=?1,bio=?2,avatar=?3,cover=?4 WHERE id=?5`,name,nextBio,nextAvatar,nextCover,cleanId(id));
    const updated=await this.getUser(id);
    if(!updated) return {ok:false,error:"NOT_FOUND",message:"حساب پیدا نشد."};
    return {ok:true,user:updated};
  }
}

export class UserInbox extends DurableObject {
  constructor(ctx,env){
    super(ctx,env); this.env=env; this.sql=ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS messages(
      id TEXT PRIMARY KEY, chat_key TEXT NOT NULL, sender TEXT NOT NULL, recipient TEXT,
      body TEXT NOT NULL, created_at INTEGER NOT NULL, direction TEXT NOT NULL, read_at INTEGER
    )`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_chat_time ON messages(chat_key,created_at)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS chat_meta(
      chat_key TEXT PRIMARY KEY, peer_id TEXT NOT NULL, peer_name TEXT NOT NULL DEFAULT '', peer_avatar TEXT NOT NULL DEFAULT '', unread INTEGER NOT NULL DEFAULT 0,
      last_body TEXT NOT NULL, last_time INTEGER NOT NULL
    )`);
    try { this.sql.exec(`ALTER TABLE chat_meta ADD COLUMN peer_name TEXT NOT NULL DEFAULT ''`); } catch {}
    try { this.sql.exec(`ALTER TABLE chat_meta ADD COLUMN peer_avatar TEXT NOT NULL DEFAULT ''`); } catch {}
  }
  async fetch(request){
    if(request.headers.get("Upgrade")!=="websocket") return new Response("websocket required",{status:426});
    const pair=new WebSocketPair(), [client,server]=Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const u=new URL(request.url), user=cleanId(u.searchParams.get("user"));
    server.serializeAttachment({user});
    const chats=await this.listChats();
    server.send(JSON.stringify({type:"snapshot",chats}));
    return new Response(null,{status:101,webSocket:client});
  }
  async webSocketMessage(ws,message){
    // Client-to-server realtime control messages are intentionally minimal.
    try {
      const m=JSON.parse(message);
      if(m.type==="ping") ws.send(JSON.stringify({type:"pong"}));
    } catch {}
  }
  async webSocketClose(){}
  async webSocketError(){}
  async saveMessage(m){
    this.sql.exec(`INSERT OR REPLACE INTO messages
      (id,chat_key,sender,recipient,body,created_at,direction,read_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`,
      m.id,m.chatKey,m.from,m.to,m.body,m.createdAt,m.direction,m.direction==="out"?m.createdAt:null);
    const peer=m.direction==="out"?m.to:m.from;
    const peerInfo=await this.env.DIRECTORY.getByName("directory").getUser(peer);
    const old=this.sql.exec(`SELECT unread FROM chat_meta WHERE chat_key=?1`,m.chatKey).one();
    const unread=m.direction==="in" ? ((old?.unread||0)+1) : (old?.unread||0);
    this.sql.exec(`INSERT OR REPLACE INTO chat_meta(chat_key,peer_id,peer_name,peer_avatar,unread,last_body,last_time)
      VALUES(?1,?2,?3,?4,?5,?6,?7)`,m.chatKey,peer,peerInfo?.name||peer,peerInfo?.avatar||"",unread,m.body,m.createdAt);
    if(m.direction==="in"){
      for(const ws of this.ctx.getWebSockets()){
        try { ws.send(JSON.stringify({type:"message",message:m,chat:{chatKey:m.chatKey,peerId:peer,unread,lastBody:m.body,lastTime:m.createdAt}})); } catch {}
      }
    }
  }
  async listChats(){
    return this.sql.exec(`SELECT chat_key AS chatKey,peer_id AS peerId,peer_name AS peerName,peer_avatar AS peerAvatar,unread,last_body AS lastBody,last_time AS lastTime
      FROM chat_meta ORDER BY last_time DESC`).toArray();
  }
  async history(key){
    return this.sql.exec(`SELECT id,chat_key AS chatKey,sender AS from,recipient AS to,body,created_at AS createdAt
      FROM messages WHERE chat_key=?1 ORDER BY created_at ASC LIMIT 500`,key).toArray();
  }
  async markRead(key){
    this.sql.exec(`UPDATE chat_meta SET unread=0 WHERE chat_key=?1`,key);
    this.sql.exec(`UPDATE messages SET read_at=?1 WHERE chat_key=?2 AND direction='in' AND read_at IS NULL`,now(),key);
    return {ok:true};
  }
}


// Compatibility exports for Durable Object namespaces already provisioned
// on the existing gorba-batman Worker. These keep old namespaces declared
// during the rebuild while all new app traffic uses Directory/UserInbox.
export class ChatRoom extends UserInbox {}
export class ChatRoomV2 extends UserInbox {}
export class Messenger extends UserInbox {}
