const $=id=>document.getElementById(id);
let me=null;
try {
  const saved=JSON.parse(localStorage.getItem("gb_me")||"null");
  if(saved && typeof saved === "object" && typeof saved.id === "string" && saved.id.trim()) me=saved;
  else localStorage.removeItem("gb_me");
} catch { localStorage.removeItem("gb_me"); }
let current=null, ws=null, chats=[];
const api=async(path,opt={})=>{
  const r=await fetch(path,{headers:{"content-type":"application/json"},...opt});
  const d=await r.json().catch(()=>({ok:false,message:"پاسخ نامعتبر"}));
  if(!r.ok) throw Object.assign(new Error(d.message||"خطا"),{data:d});
  return d;
};
function toast(t){$("toast").textContent=t; $("toast").className="show";setTimeout(()=>$("toast").className="",2600)}
function showLogin(){$("loginBox").hidden=false;$("registerBox").hidden=true}
function showRegister(){$("loginBox").hidden=true;$("registerBox").hidden=false}
async function register(){
  const name=$("regName").value.trim(), id=$("regId").value.trim();
  try{const d=await api("/api/register",{method:"POST",body:JSON.stringify({name,id})});me=d.user;saveMe();startApp()}
  catch(e){toast(e.message)}
}
async function login(){
  const id=$("loginId").value.trim();
  try{const d=await api("/api/login",{method:"POST",body:JSON.stringify({id})});me=d.user;saveMe();startApp()}
  catch(e){toast(e.message)}
}
function saveMe(){
  if(me && me.id) localStorage.setItem("gb_me",JSON.stringify(me));
  else localStorage.removeItem("gb_me");
}
async function startApp(){
  if(!me || !me.id){
    me=null; localStorage.removeItem("gb_me");
    showLogin(); return;
  }
  $("auth").hidden=true;$("app").hidden=false;
  $("meName").textContent=me.name;$("meId").textContent="@"+me.id;$("meAvatar").textContent=initial(me.name);
  await loadChats();connectRealtime();
}
function initial(s){return (s||"?").trim().charAt(0).toUpperCase()}
async function loadChats(){
  try{chats=(await api("/api/chats?id="+encodeURIComponent(me.id))).chats||[];renderChats()}catch(e){toast(e.message)}
}
function renderChats(){
  const box=$("chatList");box.innerHTML="";
  if(!chats.length){box.innerHTML='<div class="empty">هنوز گفتگویی نداری.<br>از بالا یک دوست را جستجو کن.</div>';return}
  for(const c of chats){
    const row=document.createElement("div");row.className="chat-row";
    row.innerHTML=`<div class="avatar">${initial(c.peerId)}</div><div class="info"><b>@${esc(c.peerId)}</b><div class="last">${esc(c.lastBody)}</div></div>${c.unread?`<span class="badge">${c.unread}</span>`:""}`;
    row.onclick=()=>openChatById(c.peerId);box.appendChild(row)
  }
}
async function searchUsers(){
  const q=$("search").value.trim(), box=$("searchResults");
  if(!q){box.innerHTML="";return}
  try{
    const d=await api("/api/search?q="+encodeURIComponent(q));
    box.innerHTML=d.users.filter(u=>u.id!==me.id).map(u=>`<div class="result" data-id="${esc(u.id)}"><div class="avatar">${initial(u.name)}</div><div><b>${esc(u.name)}</b><span>@${esc(u.id)}</span></div></div>`).join("");
    box.querySelectorAll(".result").forEach(x=>x.onclick=()=>openChatById(x.dataset.id));
  }catch(e){toast(e.message)}
}
async function openChatById(id){
  id=id.replace(/^@/,"");
  const u=(await api("/api/user?id="+encodeURIComponent(id))).user;
  current=u;
  $("emptyChat").hidden=true;$("chatView").hidden=false;
  $("peerName").textContent=u.name;$("peerId").textContent="@"+u.id;$("peerAvatar").textContent=initial(u.name);
  $("searchResults").innerHTML="";$("search").value="";
  try{
    const d=await api(`/api/history?user=${encodeURIComponent(me.id)}&peer=${encodeURIComponent(u.id)}`);
    renderMessages(d.messages||[]);
    await api("/api/read",{method:"POST",body:JSON.stringify({user:me.id,peer:u.id})});
    const c=chats.find(x=>x.peerId===u.id);if(c)c.unread=0;renderChats();
  }catch(e){toast(e.message)}
}
function closeChat(){current=null;$("chatView").hidden=true;$("emptyChat").hidden=false}
function renderMessages(list){
  const box=$("messages");box.innerHTML="";
  for(const m of list)addMessage(m,false);
  box.scrollTop=box.scrollHeight;
}
function addMessage(m,scroll=true){
  const box=$("messages"), mine=m.from===me.id;
  const el=document.createElement("div");el.className="bubble "+(mine?"out":"in");
  const t=new Date(m.createdAt).toLocaleTimeString("fa-IR",{hour:"2-digit",minute:"2-digit"});
  el.innerHTML=`<div>${esc(m.body).replace(/\n/g,"<br>")}</div><div class="time">${t}</div>`;
  box.appendChild(el);if(scroll)box.scrollTop=box.scrollHeight;
}
async function sendMessage(ev){
  ev.preventDefault();if(!current)return;
  const input=$("message"), body=input.value.trim();if(!body)return;
  input.value="";
  try{
    const d=await api("/api/send",{method:"POST",body:JSON.stringify({from:me.id,to:current.id,body})});
    addMessage(d.message);
    upsertChat({peerId:current.id,lastBody:body,lastTime:d.message.createdAt,unread:0});
  }catch(e){input.value=body;toast(e.message)}
}
function upsertChat(c){
  const i=chats.findIndex(x=>x.peerId===c.peerId);
  if(i>=0)chats[i]={...chats[i],...c};else chats.unshift({chatKey:"",...c});
  chats.sort((a,b)=>b.lastTime-a.lastTime);renderChats();
}
function connectRealtime(){
  if(ws){try{ws.close()}catch{}}
  const proto=location.protocol==="https:"?"wss":"ws";
  ws=new WebSocket(`${proto}://${location.host}/ws?user=${encodeURIComponent(me.id)}`);
  ws.onmessage=ev=>{
    try{
      const d=JSON.parse(ev.data);
      if(d.type==="snapshot"){chats=d.chats||[];renderChats()}
      if(d.type==="message"){
        const m=d.message;
        upsertChat(d.chat);
        if(current && m.from===current.id){addMessage(m);api("/api/read",{method:"POST",body:JSON.stringify({user:me.id,peer:m.from})}).catch(()=>{})}
        else toast(`پیام جدید از @${m.from}`);
      }
    }catch{}
  };
  ws.onclose=()=>setTimeout(()=>{if(me)connectRealtime()},2500);
}
function toggleTheme(){document.body.classList.toggle("dark");localStorage.setItem("gb_theme",document.body.classList.contains("dark")?"dark":"light")}
function openProfile(){
  if(!me || !me.id){ logout(); return; }
  $("profileModal").hidden=false;$("profileName").textContent=me.name;$("profileId").textContent=me.id;$("profileAvatar").textContent=initial(me.name);$("editName").value=me.name
}
function closeProfile(){$("profileModal").hidden=true}
async function saveProfile(){
  const name=$("editName").value.trim();
  if(!me || !me.id){ logout(); return; }
  if(name.length<2){ toast("نام نمایشی باید حداقل ۲ کاراکتر باشد."); return; }
  try{
    const d=await api("/api/profile",{method:"POST",body:JSON.stringify({id:me.id,name})});
    if(!d || !d.user || !d.user.id){ throw new Error("اطلاعات پروفایل از سرور کامل دریافت نشد."); }
    me={...me,...d.user};
    saveMe();
    $("meName").textContent=me.name;
    $("meId").textContent="@"+me.id;
    $("meAvatar").textContent=initial(me.name);
    closeProfile();
    toast("پروفایل ذخیره شد");
  }catch(e){toast(e.message||"ذخیره پروفایل انجام نشد")}
}
function logout(){localStorage.removeItem("gb_me");location.reload()}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");$("chatList").hidden=b.dataset.tab!=="chats";$("groupList").hidden=b.dataset.tab!=="groups"});
if(localStorage.getItem("gb_theme")==="dark")document.body.classList.add("dark");
if(me)startApp();
