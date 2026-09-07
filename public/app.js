const $=id=>document.getElementById(id);
let me=null,current=null,ws=null,chats=[];

function readMe(){
  try{
    const saved=JSON.parse(localStorage.getItem("gb_me")||"null");
    if(saved && typeof saved === "object" && typeof saved.id === "string" && saved.id.trim()) return {...saved,id:saved.id.trim().toLowerCase()};
  }catch{}
  localStorage.removeItem("gb_me"); return null;
}
me=readMe();
const api=async(path,opt={})=>{const r=await fetch(path,{cache:"no-store",headers:{"content-type":"application/json",...(opt.headers||{})},...opt});const d=await r.json().catch(()=>({ok:false,message:"پاسخ نامعتبر از سرور"}));if(!r.ok)throw Object.assign(new Error(d.message||"خطا"),{data:d,status:r.status});return d};
function toast(t){const el=$("toast");if(!el)return;el.textContent=t;el.className="show";setTimeout(()=>el.className="",2600)}
function showLogin(){$("auth").hidden=false;$('loginBox').hidden=false;$('registerBox').hidden=true;$('app').hidden=true}
function showRegister(){$('loginBox').hidden=true;$('registerBox').hidden=false}
function saveMe(){if(me&&typeof me.id==="string"&&me.id.trim())localStorage.setItem("gb_me",JSON.stringify(me));else localStorage.removeItem("gb_me")}
function meId(){return me&&typeof me.id==="string"?me.id.trim().toLowerCase():""}
function initial(s){return String(s||"?").trim().charAt(0).toUpperCase()||"?"}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function avatarHtml(u,cls="avatar"){const src=u?.avatar||"";return src?`<img class="${cls} avatar-img" src="${esc(src)}" alt="">`:`<div class="${cls}">${initial(u?.name||u?.id)}</div>`}

async function enterByName(){const name=$("loginName")?.value.trim();if(!name){toast("اسمت رو وارد کن.");return}if(name.length<2){toast("نام نمایشی باید حداقل ۲ کاراکتر باشد.");return}try{const d=await api("/api/enter",{method:"POST",body:JSON.stringify({name})});if(!d?.user?.id)throw new Error("ورود انجام نشد.");me=d.user;saveMe();await startApp()}catch(e){toast(e.message||"خطا در ورود")}}
async function register(){return enterByName()}
async function login(){return enterByName()}

async function startApp(){const id=meId();if(!id){me=null;saveMe();showLogin();return}try{const d=await api("/api/user?id="+encodeURIComponent(id));if(!d?.user?.id)throw new Error("حساب پیدا نشد.");me=d.user;saveMe()}catch(e){me=null;saveMe();showLogin();toast("اطلاعات حساب پیدا نشد؛ دوباره وارد شو.");return}$('auth').hidden=true;$('app').hidden=false;renderMe();await loadChats();connectRealtime()}
function renderMe(){if(!me)return;$('meName').textContent=me.name||me.id;$('meId').textContent="";setAvatar($('meAvatar'),me);setAvatar($('profileAvatar'),me);$('settingsName').textContent=me.name||me.id;if($('settingsId'))$('settingsId').textContent="";const cover=$('settingsCover');if(cover)cover.style.backgroundImage=me.cover?`url("${me.cover}")`:"";if($('settingsNameInput'))$('settingsNameInput').value=me.name||"";if($('settingsBioInput'))$('settingsBioInput').value=me.bio||""}
function setAvatar(el,u){if(!el)return;if(u?.avatar){el.innerHTML=`<img class="avatar-img" src="${esc(u.avatar)}" alt="">`}else el.textContent=initial(u?.name||u?.id)}
async function loadChats(){const id=meId();if(!id)return;try{chats=(await api("/api/chats?id="+encodeURIComponent(id))).chats||[];renderChats()}catch(e){toast(e.message)}}
async function renderPeerAvatar(el,u){setAvatar(el,u)}
function renderChats(){const box=$("chatList");box.innerHTML="";if(!chats.length){box.innerHTML='<div class="empty">هنوز گفتگویی نداری.<br>از بالا یک دوست را جستجو کن.</div>';return}for(const c of chats){if(!c?.peerId)continue;const row=document.createElement("div");row.className="chat-row";row.innerHTML=`${avatarHtml({name:c.peerName||c.peerId,id:c.peerId,avatar:c.peerAvatar||""},"avatar")}<div class="info"><b>${esc(c.peerName||("@"+c.peerId))}</b><div class="last">${esc(c.lastBody)}</div></div>${c.unread?`<span class="badge">${c.unread}</span>`:""}`;row.onclick=()=>openChatById(c.peerId);box.appendChild(row)}}
async function searchUsers(){const q=$("search").value.trim(),box=$("searchResults");if(!q){box.innerHTML="";return}const id=meId();if(!id){showLogin();return}try{const d=await api("/api/search?q="+encodeURIComponent(q));const users=Array.isArray(d.users)?d.users:[];box.innerHTML=users.filter(u=>u?.id&&u.id!==id).map(u=>`<div class="result" data-id="${esc(u.id)}">${avatarHtml(u,"avatar")}<div><b>${esc(u.name||u.id)}</b><span>گفتگوی خصوصی</span></div></div>`).join("");box.querySelectorAll(".result").forEach(x=>x.onclick=()=>openChatById(x.dataset.id))}catch(e){toast(e.message)}}
async function openChatById(id){id=String(id||"").replace(/^@/,"").trim().toLowerCase();if(!id)return;try{const d=await api("/api/user?id="+encodeURIComponent(id));const u=d?.user;if(!u?.id)throw new Error("کاربر پیدا نشد.");current=u;$('emptyChat').hidden=true;$('chatView').hidden=false;$('peerName').textContent=u.name||u.id;if($('peerId'))$('peerId').textContent="";setAvatar($('peerAvatar'),u);$('searchResults').innerHTML="";$('search').value="";const mine=meId();const h=await api(`/api/history?user=${encodeURIComponent(mine)}&peer=${encodeURIComponent(u.id)}`);renderMessages(h.messages||[]);await api("/api/read",{method:"POST",body:JSON.stringify({user:mine,peer:u.id})});const c=chats.find(x=>x.peerId===u.id);if(c)c.unread=0;renderChats()}catch(e){toast(e.message||"باز کردن گفتگو ناموفق بود")}}
function closeChat(){current=null;$('chatView').hidden=true;$('emptyChat').hidden=false}
function renderMessages(list){const box=$('messages');box.innerHTML="";for(const m of list)addMessage(m,false);box.scrollTop=box.scrollHeight}
function addMessage(m,scroll=true){if(!m)return;const box=$('messages'),mine=m.from===meId(),el=document.createElement("div");el.className="bubble "+(mine?"out":"in");const t=new Date(m.createdAt||Date.now()).toLocaleTimeString("fa-IR",{hour:"2-digit",minute:"2-digit"});el.innerHTML=`<div>${esc(m.body).replace(/\n/g,"<br>")}</div><div class="time">${t}</div>`;box.appendChild(el);if(scroll)box.scrollTop=box.scrollHeight}
async function sendMessage(ev){ev.preventDefault();if(!current)return;const from=meId();if(!from){showLogin();return}const input=$('message'),body=input.value.trim();if(!body)return;input.value="";try{const d=await api("/api/send",{method:"POST",body:JSON.stringify({from,to:current.id,body})});addMessage(d.message);upsertChat({peerId:current.id,lastBody:body,lastTime:d.message.createdAt,unread:0})}catch(e){input.value=body;toast(e.message)}}
function upsertChat(c){if(!c?.peerId)return;const i=chats.findIndex(x=>x.peerId===c.peerId);if(i>=0)chats[i]={...chats[i],...c};else chats.unshift({chatKey:"",...c});chats.sort((a,b)=>(b.lastTime||0)-(a.lastTime||0));renderChats()}
function connectRealtime(){const id=meId();if(!id)return;if(ws){try{ws.close()}catch{}}const proto=location.protocol==="https:"?"wss":"ws";ws=new WebSocket(`${proto}://${location.host}/ws?user=${encodeURIComponent(id)}`);ws.onmessage=ev=>{try{const d=JSON.parse(ev.data);if(d.type==="snapshot"){chats=d.chats||[];renderChats()}if(d.type==="message"){const m=d.message;upsertChat(d.chat);if(current&&m?.from===current.id){addMessage(m);api("/api/read",{method:"POST",body:JSON.stringify({user:id,peer:m.from})}).catch(()=>{})}else if(m?.from)toast(`پیام جدید از @${m.from}`)}}catch{}};ws.onclose=()=>setTimeout(()=>{if(meId())connectRealtime()},2500)}
function toggleTheme(){document.body.classList.toggle('light');const mode=document.body.classList.contains('light')?'light':'dark';localStorage.setItem('gb_theme',mode);if($('themeValue'))$('themeValue').textContent=mode==='dark'?'تیره':'روشن'}
function focusSearch(){document.getElementById('search')?.focus()}
function openSettings(){const id=meId();if(!id){showLogin();return}renderMe();$('settingsPanel').hidden=false;document.body.classList.add("settings-open")}
function closeSettings(){$('settingsPanel').hidden=true;document.body.classList.remove("settings-open")}
function openProfile(){openSettings();setTimeout(()=>document.getElementById("settingsNameInput")?.focus(),50)}
function closeProfile(){closeSettings()}
async function fileToDataURL(file,maxW,maxH,maxBytes=420000){if(!file||!file.type.startsWith("image/"))throw new Error("لطفاً یک عکس انتخاب کن.");const bitmap=await createImageBitmap(file);const scale=Math.min(1,maxW/bitmap.width,maxH/bitmap.height);const c=document.createElement("canvas");c.width=Math.max(1,Math.round(bitmap.width*scale));c.height=Math.max(1,Math.round(bitmap.height*scale));c.getContext("2d").drawImage(bitmap,0,0,c.width,c.height);let q=.82,data=c.toDataURL("image/jpeg",q);while(data.length>maxBytes&&q>.42){q-=.06;data=c.toDataURL("image/jpeg",q)}if(data.length>maxBytes)throw new Error("عکس خیلی بزرگ است؛ یک عکس کوچک‌تر انتخاب کن.");return data}
async function chooseAvatar(file){try{const data=await fileToDataURL(file,320,320);await saveProfile({avatar:data});$('avatarInput').value=""}catch(e){toast(e.message)}}
async function chooseCover(file){try{const data=await fileToDataURL(file,1000,420,520000);await saveProfile({cover:data});$('coverInput').value=""}catch(e){toast(e.message)}}
async function saveProfile(patch={}){const id=meId();if(!id){showLogin();return}const name=patch.name!==undefined?String(patch.name).trim():String($('settingsNameInput')?.value||me.name||"").trim();const bio=patch.bio!==undefined?String(patch.bio).trim():String($('settingsBioInput')?.value||me.bio||"").trim();if(name.length<2){toast("نام نمایشی باید حداقل ۲ کاراکتر باشد.");return}try{const payload={id,name,bio,...patch};const d=await api("/api/profile",{method:"POST",body:JSON.stringify(payload)});if(!d?.ok||!d?.user?.id)throw new Error(d?.message||"ذخیره پروفایل انجام نشد.");me={...me,...d.user,id:d.user.id};saveMe();renderMe();if($('settingsNameInput'))$('settingsNameInput').value=me.name||"";if($('settingsBioInput'))$('settingsBioInput').value=me.bio||"";toast(patch.avatar||patch.cover?"عکس پروفایل ذخیره شد":"پروفایل ذخیره شد")}catch(e){toast(e.message||"ذخیره پروفایل انجام نشد")}}
function logout(){try{if(ws)ws.close()}catch{}localStorage.removeItem("gb_me");location.reload()}
window.addEventListener("error",e=>{if(e?.error?.message)toast(e.error.message)});
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('chatList').hidden=b.dataset.tab==='groups';$('groupList').hidden=b.dataset.tab!=='groups'});
$('avatarInput')?.addEventListener('change',e=>{if(e.target.files[0])chooseAvatar(e.target.files[0])});$('coverInput')?.addEventListener('change',e=>{if(e.target.files[0])chooseCover(e.target.files[0])});
if(localStorage.getItem("gb_theme")==="dark")document.body.classList.add("dark");$('themeValue').textContent=document.body.classList.contains("dark")?"تیره":"روشن";
if(me)startApp();else showLogin();
