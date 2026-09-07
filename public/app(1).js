const $=id=>document.getElementById(id);
const nameInput=$("name"), join=$("join"), login=$("login"), main=$("main"), status=$("status");
const search=$("search"), results=$("results"), peerName=$("peerName"), hint=$("chatHint");
const messages=$("messages"), form=$("form"), text=$("text"), send=$("send"), back=$("back");
const avatarButton=$("avatarButton"), avatarFile=$("avatarFile"), avatar=$("avatar"), avatarText=$("avatarText");
const mediaFile=$("mediaFile"), myName=$("myName"), conversations=$("conversations"), chatTitle=$("chatTitle"), chat=$("chat");
let me=localStorage.getItem("gorba_me")||"", peer="", ws=null, inboxWs=null;
const inboxKey=()=>`gorba_inbox_${encodeURIComponent(me)}`;

function setStatus(s){status.textContent=s}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function time(ts){return new Date(ts).toLocaleTimeString("fa-IR",{hour:"2-digit",minute:"2-digit"})}
function preview(c){
  if(c.last_text)return String(c.last_text).slice(0,55);
  if((c.last_media_type||"").startsWith("image/"))return "📷 عکس";
  if((c.last_media_type||"").startsWith("video/"))return "🎥 ویدیو";
  return c.last_file_name?`📎 ${String(c.last_file_name).slice(0,45)}`:"پیام";
}

async function register(){
  const name=(nameInput.value||"").trim();
  if(!name)return alert("یک نام وارد کن.");
  const r=await fetch("/api/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name})});
  const d=await r.json(); if(!d.ok)return alert(d.error||"خطا");
  me=d.name; localStorage.setItem("gorba_me",me); showMain(); await loadProfile(); connectInbox(); loadConversations();
}
function showMain(){login.classList.add("hidden");main.classList.remove("hidden");myName.textContent=me;setStatus("آماده")}
async function loadProfile(){
  if(!me)return;
  const r=await fetch("/api/profile?name="+encodeURIComponent(me)); const d=await r.json();
  if(d.user?.avatar_url){avatar.src=d.user.avatar_url;avatar.hidden=false;avatarText.hidden=true}
}
async function loadConversations(){
  if(!me)return;
  try{
    const cached=JSON.parse(localStorage.getItem(inboxKey())||"null");
    if(Array.isArray(cached)&&cached.length)renderConversations(cached);
    const r=await fetch("/api/conversations?me="+encodeURIComponent(me));
    const d=await r.json();
    if(d.ok)renderConversations(d.conversations||[]);
  }catch{}
}
function renderConversations(list){
  try{localStorage.setItem(inboxKey(),JSON.stringify(list))}catch{}
  conversations.innerHTML="";
  if(!list.length){conversations.innerHTML='<div class="empty-list">هنوز پیامی نداری. اسم یک کاربر را جستجو کن و اولین پیام را بفرست.</div>';return}
  for(const c of list){
    const b=document.createElement("button");b.className="conversation"+(c.peer===peer?" active":"");
    const avatarHtml=c.avatar_url?`<img src="${esc(c.avatar_url)}" alt="">`:`<span>👤</span>`;
    const unread=Number(c.unread||0)>0?`<b class="unread">${Number(c.unread)>99?"99+":Number(c.unread)}</b>`:"";
    b.innerHTML=`<div class="conv-avatar">${avatarHtml}</div><div class="conv-body"><div class="conv-top"><strong>${esc(c.peer)}</strong><time>${time(c.last_at)}</time></div><div class="conv-bottom"><span>${c.last_sender===me?"شما: ":""}${esc(preview(c))}</span>${unread}</div></div>`;
    b.onclick=()=>selectUser(c.peer);
    conversations.appendChild(b);
  }
}
function upsertConversation(c){
  // The server already returns the full ordered list. Re-rendering is cheap at this scale.
  if(Array.isArray(c))renderConversations(c); else loadConversations();
}
function connectInbox(){
  if(!me)return;
  if(inboxWs)try{inboxWs.close()}catch{}
  const proto=location.protocol==="https:"?"wss:":"ws:";
  inboxWs=new WebSocket(`${proto}//${location.host}/inboxws?me=${encodeURIComponent(me)}`);
  inboxWs.onopen=()=>{
    setActiveInbox(peer);
    loadConversations();
  };
  inboxWs.onmessage=e=>{
    try{
      const d=JSON.parse(e.data);
      if(d.type==="inbox"){
        renderConversations(d.conversations||[]);
        // If a message arrives while this page is on another screen, keep the
        // conversation list immediately visible without requiring a search.
      }
    }catch{}
  };
  inboxWs.onclose=()=>{if(me)setTimeout(connectInbox,1500)};
  inboxWs.onerror=()=>{};
}
function setActiveInbox(peerNameValue){
  if(!inboxWs||inboxWs.readyState!==WebSocket.OPEN)return;
  inboxWs.send(JSON.stringify({type:"active",peer:peerNameValue||""}));
}

join.onclick=register;
nameInput.addEventListener("keydown",e=>{if(e.key==="Enter")register()});

search.addEventListener("input",async()=>{
  const q=search.value.trim(); results.innerHTML=""; if(!q)return;
  const r=await fetch("/api/search?q="+encodeURIComponent(q)); const d=await r.json();
  for(const u of d.users||[]){
    const b=document.createElement("button");b.className="result";b.textContent=u.name;
    b.onclick=()=>selectUser(u.name);results.appendChild(b);
  }
});

function selectUser(name){
  if(!name||name===me)return;
  peer=name;
  chatTitle.hidden=false;
  chat.hidden=false;peerName.textContent=name;hint.textContent="در حال اتصال...";
  results.innerHTML="";search.value="";messages.innerHTML="";
  setActiveInbox(peer);
  if(ws)try{ws.close()}catch{}
  const proto=location.protocol==="https:"?"wss:":"ws:";
  ws=new WebSocket(`${proto}//${location.host}/ws?me=${encodeURIComponent(me)}&peer=${encodeURIComponent(peer)}`);
  ws.onopen=()=>{setStatus("متصل");hint.textContent="متصل؛ پیام‌ها ذخیره می‌شوند.";text.disabled=false;send.disabled=false;text.focus();setActiveInbox(peer)};
  // Sending uses /api/send and therefore does not depend on this WebSocket.
  text.disabled=false; send.disabled=false;
  ws.onmessage=e=>{try{const d=JSON.parse(e.data);if(d.type==="message")render(d)}catch{}};
  ws.onerror=()=>{setStatus("خطا");hint.textContent="اتصال برقرار نشد."};
  ws.onclose=()=>{if(ws?.readyState!==WebSocket.OPEN){text.disabled=true;send.disabled=true}setStatus("آماده")};
  loadConversations();
}
function render(m){
  const div=document.createElement("div");div.className="msg"+(m.sender===me?" mine":"");
  let html=`<div class="sender">${esc(m.sender)}</div>`;
  if(m.text)html+=`<div>${esc(m.text)}</div>`;
  if(m.media_url){
    if((m.media_type||"").startsWith("video/"))html+=`<video controls preload="metadata" src="${esc(m.media_url)}"></video>`;
    else if((m.media_type||"").startsWith("image/"))html+=`<img loading="lazy" src="${esc(m.media_url)}" alt="${esc(m.file_name||"عکس")}">`;
    else html+=`<a href="${esc(m.media_url)}" target="_blank" rel="noopener">${esc(m.file_name||"فایل")}</a>`;
  }
  html+=`<div class="time">${time(m.created_at)}</div>`;div.innerHTML=html;messages.appendChild(div);messages.scrollTop=messages.scrollHeight;
}
let sending=false;
form.addEventListener("submit",async e=>{
  e.preventDefault();
  const value=text.value.trim();
  if(!me||!peer||(!value))return;
  if(sending)return;
  sending=true; send.disabled=true;
  try{
    const r=await fetch("/api/send",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sender:me,peer,text:value})});
    const d=await r.json();
    if(!d.ok)throw new Error(d.error||"خطا");
    text.value="";
    // The WebSocket broadcasts the same message to every open chat tab.
    // Render here only when the chat socket is not open, so offline sending
    // still works and the message is immediately visible to the sender.
    if(!ws||ws.readyState!==WebSocket.OPEN) render(d.message);
  }catch(err){
    alert(err.message||"ارسال پیام ناموفق بود");
  }finally{
    sending=false; send.disabled=false; text.focus();
  }
});
back.onclick=()=>{peer="";setActiveInbox("");if(ws)try{ws.close()}catch{}ws=null;chatTitle.hidden=true;chat.hidden=true;peerName.textContent="یک نفر را انتخاب کن";hint.textContent="برای شروع، یک کاربر را انتخاب کن.";messages.innerHTML="";text.disabled=true;send.disabled=true;loadConversations()};

avatarButton.onclick=()=>avatarFile.click();
avatarFile.onchange=async()=>{
  const f=avatarFile.files?.[0];if(!f)return;
  if(!f.type.startsWith("image/"))return alert("فقط عکس انتخاب کن.");
  const local=URL.createObjectURL(f);avatar.src=local;avatar.hidden=false;avatarText.hidden=true;
  alert("عکس پروفایل انتخاب شد. برای ذخیره دائمی بین دستگاه‌ها، بخش Storage باید به یک فضای فایل مثل Supabase متصل شود.");
};

mediaFile.onchange=async()=>{
  const f=mediaFile.files?.[0];if(!f)return;
  if(!ws||ws.readyState!==WebSocket.OPEN){alert("اول وارد یک چت شو.");mediaFile.value="";return}
  const local=URL.createObjectURL(f);
  ws.send(JSON.stringify({type:"message",text:"",mediaUrl:local,mediaType:f.type,fileName:f.name}));
  mediaFile.value="";
};

if(me){
  nameInput.value=me;showMain();
  try{const cached=JSON.parse(localStorage.getItem(inboxKey())||"null");if(Array.isArray(cached))renderConversations(cached)}catch{}
  loadProfile();connectInbox();loadConversations()
}
