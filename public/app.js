const $=id=>document.getElementById(id);
const nameInput=$("name"), join=$("join"), login=$("login"), main=$("main"), status=$("status");
const search=$("search"), results=$("results"), peerName=$("peerName"), hint=$("chatHint");
const messages=$("messages"), form=$("form"), text=$("text"), send=$("send"), back=$("back");
const avatarButton=$("avatarButton"), avatarFile=$("avatarFile"), avatar=$("avatar"), avatarText=$("avatarText");
const mediaFile=$("mediaFile"), myName=$("myName");
let me=localStorage.getItem("gorba_me")||"", peer="", ws=null;

function setStatus(s){status.textContent=s}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function time(ts){return new Date(ts).toLocaleTimeString("fa-IR",{hour:"2-digit",minute:"2-digit"})}

async function register(){
  const name=(nameInput.value||"").trim();
  if(!name)return alert("یک نام وارد کن.");
  const r=await fetch("/api/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name})});
  const d=await r.json(); if(!d.ok)return alert(d.error||"خطا");
  me=d.name; localStorage.setItem("gorba_me",me); showMain(); loadProfile();
}
function showMain(){
  login.classList.add("hidden");main.classList.remove("hidden");myName.textContent=me;setStatus("آماده");
}
async function loadProfile(){
  if(!me)return;
  const r=await fetch("/api/profile?name="+encodeURIComponent(me)); const d=await r.json();
  if(d.user?.avatar_url){avatar.src=d.user.avatar_url;avatar.hidden=false;avatarText.hidden=true}
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
  peer=name;peerName.textContent=name;hint.textContent="در حال اتصال...";
  results.innerHTML="";search.value="";messages.innerHTML="";
  if(ws)try{ws.close()}catch{}
  const proto=location.protocol==="https:"?"wss:":"ws:";
  ws=new WebSocket(`${proto}//${location.host}/ws?me=${encodeURIComponent(me)}&peer=${encodeURIComponent(peer)}`);
  ws.onopen=()=>{setStatus("متصل");hint.textContent="متصل؛ پیام‌ها ذخیره می‌شوند.";text.disabled=false;send.disabled=false;text.focus()};
  ws.onmessage=e=>{try{const d=JSON.parse(e.data);if(d.type==="message")render(d)}catch{}};
  ws.onerror=()=>{setStatus("خطا");hint.textContent="اتصال برقرار نشد."};
  ws.onclose=()=>{if(ws?.readyState!==WebSocket.OPEN){text.disabled=true;send.disabled=true}setStatus("آماده")};
}
function render(m){
  const div=document.createElement("div");div.className="msg"+(m.sender===me?" mine":"");
  let html=`<div class="sender">${esc(m.sender)}</div>`;
  if(m.text)html+=`<div>${esc(m.text)}</div>`;
  if(m.media_url){
    if((m.media_type||"").startsWith("video/")) html+=`<video controls preload="metadata" src="${esc(m.media_url)}"></video>`;
    else if((m.media_type||"").startsWith("image/")) html+=`<img loading="lazy" src="${esc(m.media_url)}" alt="${esc(m.file_name||"عکس")}">`;
    else html+=`<a href="${esc(m.media_url)}" target="_blank" rel="noopener">${esc(m.file_name||"فایل")}</a>`;
  }
  html+=`<div class="time">${time(m.created_at)}</div>`;div.innerHTML=html;messages.appendChild(div);messages.scrollTop=messages.scrollHeight;
}
form.addEventListener("submit",e=>{
  e.preventDefault(); if(!ws||ws.readyState!==WebSocket.OPEN)return;
  const value=text.value.trim(); if(!value)return;
  ws.send(JSON.stringify({type:"message",text:value}));text.value="";
});
back.onclick=()=>{peer="";if(ws)try{ws.close()}catch{}ws=null;peerName.textContent="یک نفر را انتخاب کن";hint.textContent="برای شروع، یک کاربر را انتخاب کن.";messages.innerHTML="";text.disabled=true;send.disabled=true};

avatarButton.onclick=()=>avatarFile.click();
avatarFile.onchange=async()=>{
  const f=avatarFile.files?.[0];if(!f)return;
  if(!f.type.startsWith("image/"))return alert("فقط عکس انتخاب کن.");
  // Preview immediately; the URL is sent to the server only after the upload/storage
  // provider is configured. Until then it remains local on this device.
  const local=URL.createObjectURL(f);avatar.src=local;avatar.hidden=false;avatarText.hidden=true;
  localStorage.setItem("gorba_avatar_preview",local);
  alert("عکس پروفایل انتخاب شد. برای ذخیره دائمی بین دستگاه‌ها، بخش Storage باید به یک فضای فایل مثل Supabase متصل شود.");
};

mediaFile.onchange=async()=>{
  const f=mediaFile.files?.[0];if(!f)return;
  if(!ws||ws.readyState!==WebSocket.OPEN){alert("اول وارد یک چت شو.");mediaFile.value="";return}
  // Keep the UI ready for media; persistent cross-device media needs a storage bucket.
  const local=URL.createObjectURL(f);
  ws.send(JSON.stringify({type:"message",text:"",mediaUrl:local,mediaType:f.type,fileName:f.name}));
  mediaFile.value="";
};

if(me){nameInput.value=me;showMain();loadProfile()}