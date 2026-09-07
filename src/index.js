import { DurableObject } from "cloudflare:workers";

function normalizeName(name){return String(name||"").trim().slice(0,40)}
function lowerName(name){return normalizeName(name).toLocaleLowerCase("fa-IR")}
function pairRoomName(a,b){return [normalizeName(a),normalizeName(b)].filter(Boolean).sort((x,y)=>lowerName(x).localeCompare(lowerName(y),"fa")).join("::")}
function json(data,status=200,extra={}){return Response.json(data,{status,headers:{"Cache-Control":"no-store",...extra}})}
function cookie(name,value,maxAge=2592000){return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`}
function getCookie(request,name){const raw=request.headers.get("Cookie")||"";const p=raw.split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="));return p?decodeURIComponent(p.slice(name.length+1)):""}

export class ChatRoom extends DurableObject{
  async fetch(request){
    const url=new URL(request.url);

    if(url.pathname==="/api/register"&&request.method==="POST"){
      try{const body=await request.json();const name=normalizeName(body.name);if(!name)return json({ok:false,error:"نام وارد نشده"},400);
        const key="user:"+lowerName(name);const existing=await this.ctx.storage.get(key);
        if(!existing)await this.ctx.storage.put(key,{name,createdAt:Date.now()});
        return json({ok:true,name});
      }catch{return json({ok:false,error:"درخواست نامعتبر است"},400)}
    }

    if(url.pathname==="/api/search"&&request.method==="GET"){
      const q=lowerName(url.searchParams.get("q")||"");if(!q)return json({ok:true,users:[]});
      const entries=await this.ctx.storage.list({prefix:"user:"});const users=[];
      for(const value of entries.values())if(value?.name&&lowerName(value.name).includes(q))users.push(value.name);
      users.sort((a,b)=>a.localeCompare(b,"fa"));return json({ok:true,users:users.slice(0,20)});
    }

    if(url.pathname==="/api/google-login"&&request.method==="POST"){
      try{
        const body=await request.json();const credential=String(body.credential||"");
        if(!credential||!this.env.GOOGLE_CLIENT_ID)return json({ok:false,error:"Google login تنظیم نشده است"},503);
        const tr=await fetch("https://oauth2.googleapis.com/tokeninfo?id_token="+encodeURIComponent(credential));
        if(!tr.ok)return json({ok:false,error:"اعتبار Google معتبر نیست"},401);
        const token=await tr.json();
        if(token.aud!==this.env.GOOGLE_CLIENT_ID||!token.sub)return json({ok:false,error:"Google account قابل تأیید نیست"},401);
        const name=normalizeName(token.name||token.email?.split("@")[0]||"کاربر");
        const userId="google:"+token.sub,sessionId=crypto.randomUUID();
        const user={id:userId,name,email:token.email||"",picture:token.picture||"",updatedAt:Date.now()};
        await this.ctx.storage.put(userId,user);
        await this.ctx.storage.put("session:"+sessionId,{userId,createdAt:Date.now()},{expirationTtl:2592000});
        return json({ok:true,user},200,{"Set-Cookie":cookie("gb_session",sessionId)});
      }catch(e){console.error(e);return json({ok:false,error:"ورود با Google انجام نشد"},500)}
    }

    if(url.pathname==="/api/me"&&request.method==="GET"){
      const s=getCookie(request,"gb_session");if(!s)return json({ok:false},401);
      const session=await this.ctx.storage.get("session:"+s);if(!session?.userId)return json({ok:false},401);
      const user=await this.ctx.storage.get(session.userId);if(!user)return json({ok:false},401);
      return json({ok:true,user});
    }

    if(url.pathname==="/api/profile"&&request.method==="POST"){
      const s=getCookie(request,"gb_session");const session=s?await this.ctx.storage.get("session:"+s):null;
      if(!session?.userId)return json({ok:false,error:"وارد نشده‌اید"},401);
      try{
        const body=await request.json(),user=await this.ctx.storage.get(session.userId);
        if(!user)return json({ok:false,error:"کاربر پیدا نشد"},404);
        const name=normalizeName(body.name||user.name);if(!name)return json({ok:false,error:"نام نامعتبر است"},400);
        const updated={...user,name,picture:String(body.picture||user.picture||"").slice(0,10000000),updatedAt:Date.now()};
        await this.ctx.storage.put(session.userId,updated);return json({ok:true,user:updated});
      }catch{return json({ok:false,error:"اطلاعات پروفایل نامعتبر است"},400)}
    }

    if(url.pathname!=="/ws")return new Response("Not found",{status:404});
    if(request.headers.get("Upgrade")?.toLowerCase()!=="websocket")return new Response("WebSocket required",{status:426});
    const me=normalizeName(url.searchParams.get("me")),peer=normalizeName(url.searchParams.get("peer"));
    if(!me||!peer||lowerName(me)===lowerName(peer))return new Response("Two different users are required",{status:400});
    const pair=new WebSocketPair(),[client,server]=Object.values(pair);
    this.ctx.acceptWebSocket(server);server.serializeAttachment({me,peer});
    return new Response(null,{status:101,webSocket:client});
  }

  async webSocketMessage(ws,message){
    let data;try{data=typeof message==="string"?JSON.parse(message):null}catch{return}
    if(!data||data.type!=="message")return;
    const session=ws.deserializeAttachment()||{},text=String(data.text||"").trim().slice(0,2000);if(!text)return;
    const payload=JSON.stringify({type:"message",id:crypto.randomUUID(),name:normalizeName(session.me),text,createdAt:Date.now()});
    for(const client of this.ctx.getWebSockets())if(client.readyState===WebSocket.OPEN)try{client.send(payload)}catch{}
  }
  async webSocketClose(ws,code,reason){try{ws.close(code,reason)}catch{}}
  async webSocketError(ws,error){console.error("WebSocket error",error)}
}

export default {async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==="/api/config")return json({ok:true,clientId:env.GOOGLE_CLIENT_ID||""});
  if(["/api/register","/api/search","/api/google-login","/api/me","/api/profile"].includes(url.pathname)){
    return env.CHAT.get(env.CHAT.idFromName("users")).fetch(request);
  }
  if(url.pathname==="/api/media"&&request.method==="POST"){
    if(!env.MEDIA)return json({ok:false,error:"R2 تنظیم نشده است"},503);
    if(!getCookie(request,"gb_session"))return json({ok:false,error:"ابتدا با Google وارد شوید"},401);
    const type=request.headers.get("Content-Type")||"application/octet-stream",len=Number(request.headers.get("Content-Length")||0);
    if(len>50*1024*1024)return json({ok:false,error:"حجم فایل بیشتر از 50MB است"},413);
    const id=crypto.randomUUID(),ext=type.includes("video")?"mp4":type.includes("png")?"png":type.includes("webp")?"webp":"jpg",key=`media/${id}.${ext}`;
    await env.MEDIA.put(key,request.body,{httpMetadata:{contentType:type}});return json({ok:true,key});
  }
  if(url.pathname==="/media"){
    if(!env.MEDIA)return new Response("R2 not configured",{status:503});const key=url.searchParams.get("key");if(!key)return new Response("Missing key",{status:400});
    const obj=await env.MEDIA.get(key);if(!obj)return new Response("Not found",{status:404});const headers=new Headers();obj.writeHttpMetadata(headers);headers.set("etag",obj.httpEtag);return new Response(obj.body,{headers});
  }
  if(url.pathname==="/ws"){
    const me=normalizeName(url.searchParams.get("me")),peer=normalizeName(url.searchParams.get("peer"));if(!me||!peer)return new Response("Missing users",{status:400});
    return env.CHAT.get(env.CHAT.idFromName(pairRoomName(me,peer))).fetch(request);
  }
  return env.ASSETS.fetch(request);
}};