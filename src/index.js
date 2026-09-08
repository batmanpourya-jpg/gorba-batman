import { DurableObject } from "cloudflare:workers";

const j=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const clean=v=>String(v??"").trim().replace(/\s+/g," ").slice(0,40);
const uid=()=>crypto.randomUUID();

export class Directory extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      avatar TEXT,cover TEXT,bio TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL
    );`);
  }
  getByName(name){
    const rows=this.ctx.storage.sql.exec(
      "SELECT id,name,avatar,cover,bio,created_at FROM users WHERE name=? LIMIT 1",name
    ).toArray();
    return rows.length ? rows[0] : null;
  }
  getById(id){
    const rows=this.ctx.storage.sql.exec(
      "SELECT id,name,avatar,cover,bio,created_at FROM users WHERE id=? LIMIT 1",id
    ).toArray();
    return rows.length ? rows[0] : null;
  }
  login(name){
    const n=clean(name);
    if(!n) throw new Error("نام را وارد کنید");
    // Never use .one() here: a new name legitimately returns zero rows.
    const old=this.getByName(n);
    if(old) return old;
    const id=uid(), now=Date.now();
    this.ctx.storage.sql.exec(
      "INSERT INTO users(id,name,avatar,cover,bio,created_at) VALUES(?,?,?,?,?,?)",
      id,n,null,null,"",now
    );
    return this.getById(id);
  }
  update(body){
    const old=this.getById(body.id);
    if(!old) return null;
    const name=body.name===undefined?old.name:clean(body.name);
    if(!name) throw new Error("نام نمی‌تواند خالی باشد");
    const same=this.getByName(name);
    if(same && same.id!==old.id) throw new Error("این نام قبلاً استفاده شده است");
    this.ctx.storage.sql.exec(
      "UPDATE users SET name=?,avatar=?,cover=?,bio=? WHERE id=?",
      name,
      body.avatar===undefined?old.avatar:body.avatar,
      body.cover===undefined?old.cover:body.cover,
      body.bio===undefined?old.bio:String(body.bio).slice(0,160),
      old.id
    );
    return this.getById(old.id);
  }
}

export class UserInbox extends DurableObject {}
export class ChatRoom extends UserInbox {}
export class ChatRoomV2 extends UserInbox {}
export class Messenger extends UserInbox {}

export default {
  async fetch(req,env){
    const u=new URL(req.url);
    try{
      if(u.pathname==="/api/login" && req.method==="POST"){
        const {name}=await req.json();
        const stub=env.DIRECTORY.get(env.DIRECTORY.idFromName("main"));
        const user=await stub.login(name);
        return user?j({ok:true,user}):j({ok:false,error:"حساب ساخته نشد"},500);
      }
      if(u.pathname==="/api/me"){
        const id=u.searchParams.get("id");
        if(!id)return j({ok:false,error:"شناسه نامعتبر"},400);
        const stub=env.DIRECTORY.get(env.DIRECTORY.idFromName("main"));
        const user=await stub.getById(id);
        return user?j({ok:true,user}):j({ok:false,error:"حساب پیدا نشد"},404);
      }
      if(u.pathname==="/api/profile" && req.method==="POST"){
        const body=await req.json();
        const stub=env.DIRECTORY.get(env.DIRECTORY.idFromName("main"));
        const user=await stub.update(body);
        return user?j({ok:true,user}):j({ok:false,error:"حساب پیدا نشد"},404);
      }
      return new Response("Gorba Batman");
    }catch(e){return j({ok:false,error:e?.message||"خطای داخلی"},500)}
  }
};