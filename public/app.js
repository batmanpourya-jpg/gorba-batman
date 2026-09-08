const $ = s => document.querySelector(s);
let me=null,current=null,ws=null,presenceTimer=null,peopleTimer=null,searchTimer=null,typingTimer=null,replyTo=null;
try{me=JSON.parse(localStorage.getItem('gb_me')||'null')}catch{localStorage.removeItem('gb_me')}
const api=async(url,opt={})=>{const r=await fetch(url,{...opt,headers:{...(opt.body instanceof FormData?{}:{...(opt.body?{'content-type':'application/json'}:{})}),...(opt.headers||{})}});const d=await r.json().catch(()=>({ok:false,error:'پاسخ نامعتبر'}));if(!r.ok||d.ok===false)throw Error(d.error||'خطا');return d};
function av(el,u){el.innerHTML='';if(u?.avatar){const i=document.createElement('img');i.src=u.avatar;el.append(i)}else el.textContent=String(u?.name||'?').slice(0,1)}
function applyTheme(){const t=me?.theme||'midnight',bg=me?.background||'default';document.body.dataset.theme=t;document.body.dataset.bg=bg;const custom=me?.background_image;document.documentElement.style.setProperty('--custom-bg',custom?`url(${custom})`:'none');localStorage.setItem('gb_theme',t);localStorage.setItem('gb_bg',bg)}
function enter(){if(!me)return;$('#auth').classList.add('hidden');$('#app').classList.remove('hidden');$('#myName').textContent=me.name;av($('#myAvatar'),me);applyTheme();loadChats();presence();clearInterval(presenceTimer);clearInterval(peopleTimer);presenceTimer=setInterval(presence,20000);peopleTimer=setInterval(loadChats,15000)}
async function login(){const name=$('#name').value.trim();if(!name)return $('#err').textContent='نام را وارد کن';$('#err').textContent='در حال ورود…';try{const d=await api('/api/login',{method:'POST',body:JSON.stringify({name})});me=d.user;localStorage.setItem('gb_me',JSON.stringify(me));enter()}catch(e){$('#err').textContent=e.message}}
function person(u){const el=document.createElement('div');el.className='person';const a=document.createElement('div');a.className='avatar';av(a,u);const box=document.createElement('div');box.className='grow';const b=document.createElement('b');b.textContent=u.name;const s=document.createElement('small');s.innerHTML=`<span class="dot ${u.online?'on':''}"></span>${u.online?'آنلاین':'آفلاین'} · شروع گفتگو`;box.append(b,s);el.append(a,box);el.onclick=()=>openChat(u);return el}
$('#search').oninput=()=>{clearTimeout(searchTimer);const q=$('#search').value.trim();if(!q){$('#results').innerHTML='';return}searchTimer=setTimeout(async()=>{try{const d=await api('/api/search?q='+encodeURIComponent(q));$('#results').innerHTML='';const us=d.users.filter(u=>u.id!==me.id);if(!us.length)$('#results').innerHTML='<div class="empty-list">کسی پیدا نشد</div>';else us.forEach(u=>$('#results').append(person(u)))}catch{$('#results').innerHTML='<div class="empty-list">خطا در جستجو</div>'}},180)};
function chatItem(c){const el=document.createElement('div');el.className='chatitem'+(current?.id===c.user.id?' selected':'');const a=document.createElement('div');a.className='avatar';av(a,c.user);const box=document.createElement('div');box.className='grow';const b=document.createElement('b');b.textContent=c.user.name;const s=document.createElement('small');const p=c.last_message||'هنوز پیامی نیست · برای شروع لمس کن';s.innerHTML=`<span class="dot ${c.user.online?'on':''}"></span>${escapeHtml(p)}${c.last_message_at?' · '+new Date(c.last_message_at).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'}):''}`;box.append(b,s);el.append(a,box);if(c.unread){const n=document.createElement('span');n.className='unread';n.textContent=c.unread>99?'99+':c.unread;el.append(n)}el.onclick=()=>openChat(c.user);return el}
const escapeHtml=v=>{const d=document.createElement('div');d.textContent=String(v);return d.innerHTML};
async function loadChats(){if(!me)return;try{const d=await api('/api/conversations?id='+encodeURIComponent(me.id));$('#chats').innerHTML='';if(!d.conversations.length){$('#chats').innerHTML='<div class="empty-list">هنوز کسی وارد گوربا بتمن نشده.</div>';return}d.conversations.forEach(c=>$('#chats').append(chatItem(c)))}catch{$('#chats').innerHTML='<div class="empty-list">خطا در بارگذاری گفتگوها</div>'}}
function bubble(m){
 const w=document.createElement('div');
 w.className='bubble-wrap '+(m.sender_id===me.id?'mine-wrap':'theirs-wrap'); w.dataset.messageId=m.id;
 const b=document.createElement('div'); b.className='bubble '+(m.sender_id===me.id?'mine':'theirs')+(m.deleted?' deleted':'')+(m.pinned?' replying':'');
 if(m.deleted)b.textContent='پیام حذف شد';
 else{
   if(m.reply_to_id){
     const q=document.createElement('div'); q.className='reply-quote'; q.textContent='در پاسخ به یک پیام'; b.append(q);
   }
   if(m.media_id){
     const url=`/api/media?id=${encodeURIComponent(m.media_id)}&a=${encodeURIComponent(m.sender_id)}&b=${encodeURIComponent(m.receiver_id)}`;
     if(m.media_type?.startsWith('image/')){const i=document.createElement('img');i.className='media-img';i.src=url;i.alt=m.media_name||'عکس';b.append(i)}
     else{const v=document.createElement('video');v.className='media-video';v.controls=true;v.preload='metadata';v.src=url;b.append(v)}
     if(m.media_name){const nm=document.createElement('div');nm.className='media-name';nm.textContent=m.media_name;b.append(nm)}
   } else {
     const tx=document.createElement('span');tx.textContent=m.text;b.append(tx);
     if(m.edited){const ed=document.createElement('span');ed.className='edited-label';ed.textContent='ویرایش‌شده';b.append(ed)}
   }
 }
 const t=document.createElement('div');t.className='time';
 t.textContent=new Date(m.created_at).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'});
 if(m.sender_id===me.id && !m.deleted){
   const mark=document.createElement('span');mark.className='read-mark';mark.textContent=m.read_at?'✓✓':'✓';t.append(mark);
 }
 w.append(b,t);
 if(!m.deleted){
   const actions=document.createElement('div');actions.className='bubble-actions';
   const reply=document.createElement('button');reply.textContent='↩ پاسخ';reply.onclick=()=>setReply(m);actions.append(reply);
   if(m.sender_id===me.id&&!m.media_id){
     const edit=document.createElement('button');edit.textContent='✏️ ویرایش';edit.onclick=()=>editMessage(m);actions.append(edit);
   }
   const pin=document.createElement('button');pin.textContent=m.pinned?'📌 برداشتن':'📌 سنجاق';pin.onclick=()=>togglePin(m);actions.append(pin);
   if(m.sender_id===me.id){const del=document.createElement('button');del.textContent='🗑️ حذف برای همه';del.onclick=()=>deleteMessage(m);actions.append(del)}
   w.append(actions);
 }
 return w;
}
function setReply(m){
 replyTo=m; $('#replyPreview').textContent=(m.media_id?(m.media_type?.startsWith('image/')?'📷 عکس':'🎬 فیلم'):m.text).slice(0,120);
 $('#replyBar').classList.remove('hidden'); $('#text').focus();
}
function cancelReply(){replyTo=null;$('#replyBar').classList.add('hidden');$('#replyPreview').textContent=''}
async function editMessage(m){
 const next=prompt('متن جدید پیام:',m.text); if(next===null)return; const text=next.trim(); if(!text||text===m.text)return;
 try{const d=await api('/api/edit',{method:'POST',body:JSON.stringify({id:m.id,requester:me.id,sender_id:me.id,receiver_id:current.id,text})});replaceBubble(d.message)}
 catch(e){alert(e.message)}
}
async function togglePin(m){
 try{const d=await api('/api/pin',{method:'POST',body:JSON.stringify({id:m.id,requester:me.id,sender_id:me.id,receiver_id:current.id,pinned:!m.pinned}));m.pinned=d.pinned;replaceBubble(m)}
 catch(e){alert(e.message)}
}
function replaceBubble(m){const old=[...$('#messages').children()].find(x=>x.dataset.messageId===m.id);if(old)old.replaceWith(bubble(m))}
function markRead(id,read_at){const n=[...$('#messages').children()].find(x=>x.dataset.messageId===id);if(!n)return;const b=n.querySelector('.bubble');if(b){const m={id,sender_id:me.id,receiver_id:current?.id,text:'',created_at:Date.now(),read_at,deleted:0};const mark=n.querySelector('.read-mark');if(mark)mark.textContent='✓✓'}}
function clearTyping(){clearTimeout(typingTimer);$('#typing').classList.add('hidden')}
function notifyTyping(active){$('#typing').classList.toggle('hidden',!active);if(active){clearTimeout(typingTimer);typingTimer=setTimeout(()=>$('#typing').classList.add('hidden'),1800)}}
function sendTyping(active){if(ws?.readyState===WebSocket.OPEN)try{ws.send(JSON.stringify({type:'typing',active}))}catch{}}
function renderDeleted(id){const n=[...$('#messages').children()].find(x=>x.dataset.messageId===id);if(!n)return;const b=n.querySelector('.bubble');if(b){b.innerHTML='پیام حذف شد';b.classList.add('deleted');b.onclick=null}}
async function openChat(u){
 if(!u||u.id===me.id)return; current=u; cancelReply(); $('#side').classList.remove('open'); $('#empty').classList.add('hidden');$('#chat').classList.remove('hidden');
 av($('#chatAvatar'),u);$('#chatName').textContent=u.name;setStatus(u);$('#messages').innerHTML='<div class="empty-list">در حال باز کردن گفتگو…</div>';
 if(ws)try{ws.close()}catch{} ws=null;
 try{
  await api('/api/conversation',{method:'POST',body:JSON.stringify({me:me.id,other:u.id})});
  const d=await api(`/api/history?a=${encodeURIComponent(me.id)}&b=${encodeURIComponent(u.id)}`);
  $('#messages').innerHTML=''; if(!d.messages.length)$('#messages').innerHTML='<div class="empty-list">اولین پیام را تو بفرست 👋</div>';
  d.messages.forEach(m=>$('#messages').append(bubble(m)));scrollBottom();
  await api('/api/read',{method:'POST',body:JSON.stringify({me:me.id,other:u.id})}); loadChats();
  const proto=location.protocol==='https:'?'wss':'ws';
  ws=new WebSocket(`${proto}://${location.host}/api/ws?a=${encodeURIComponent(me.id)}&b=${encodeURIComponent(u.id)}`);
  ws.onmessage=e=>{try{const d=JSON.parse(e.data);
    if(d.type==='message'){const m=d.message;if(current&&((m.sender_id===me.id&&m.receiver_id===current.id)||(m.receiver_id===me.id&&m.sender_id===current.id))){const empty=$('#messages').querySelector('.empty-list');if(empty)empty.remove();if(!document.querySelector(`[data-message-id="${CSS.escape(m.id)}"]`))$('#messages').append(bubble(m));scrollBottom();if(m.receiver_id===me.id){api('/api/read-message',{method:'POST',body:JSON.stringify({id:m.id,reader:me.id,sender_id:me.id,receiver_id:current.id})}).catch(()=>{})}}loadChats()}
    if(d.type==='deleted')renderDeleted(d.id);
    if(d.type==='edited')replaceBubble(d.message);
    if(d.type==='pinned'){const n=[...$('#messages').children()].find(x=>x.dataset.messageId===d.id);if(n){const b=n.querySelector('.bubble');b?.classList.toggle('replying',!!d.pinned)}}
    if(d.type==='read')markRead(d.id,d.read_at);
    if(d.type==='typing'&&d.user!==me.id)notifyTyping(d.active);
  }catch{}};
  ws.onclose=()=>clearTyping();
 }catch(e){$('#messages').innerHTML=`<div class="empty-list">${escapeHtml(e.message)}</div>`}
}
function setStatus(u){$('#chatStatus').innerHTML=`<span class="dot ${u.online?'on':''}"></span>${u.online?'آنلاین':'آخرین بازدید '+lastSeen(u.last_seen)}`}
function lastSeen(ts){if(!ts)return'نامشخص';return new Date(ts).toLocaleString('fa-IR',{dateStyle:'medium',timeStyle:'short'})}
function scrollBottom(){const m=$('#messages');m.scrollTop=m.scrollHeight}
async function send(){
 if(!current)return;const text=$('#text').value.trim();if(!text)return;
 $('#text').value='';sendTyping(false);
 try{
  const d=await api('/api/send',{method:'POST',body:JSON.stringify({sender_id:me.id,receiver_id:current.id,text,reply_to_id:replyTo?.id||null})});
  cancelReply();
  if(!ws||ws.readyState!==WebSocket.OPEN){const e=$('#messages').querySelector('.empty-list');if(e)e.remove();$('#messages').append(bubble(d.message));scrollBottom()}
  loadChats()
 }catch(e){$('#text').value=text;alert(e.message)}
}
async function sendMedia(file){if(!current||!file)return;const ok=file.type.startsWith('image/')||file.type.startsWith('video/');if(!ok)return alert('فقط عکس و فیلم مجاز است');if(file.size>20*1024*1024)return alert('حجم فایل باید حداکثر ۲۰ مگابایت باشد');const fd=new FormData();fd.append('sender_id',me.id);fd.append('receiver_id',current.id);fd.append('file',file);try{const d=await api('/api/upload',{method:'POST',body:fd});const e=$('#messages').querySelector('.empty-list');if(e)e.remove();if(!document.querySelector(`[data-message-id="${CSS.escape(d.message.id)}"]`))$('#messages').append(bubble(d.message));scrollBottom();loadChats()}catch(e){alert(e.message)}}
async function deleteMessage(m){if(!confirm('این پیام برای هر دو نفر حذف شود؟'))return;try{await api('/api/delete',{method:'POST',body:JSON.stringify({id:m.id,requester:me.id,sender_id:me.id,receiver_id:current.id,for_everyone:true})});renderDeleted(m.id);loadChats()}catch(e){alert(e.message)}}
function pairKey(a,b){return[String(a),String(b)].sort().join(':')};async function presence(){if(me)api('/api/presence?id='+encodeURIComponent(me.id),{method:'POST'}).catch(()=>{})}
function openProfile(){fillMyProfile();$('#profileBox').classList.remove('hidden')}
function fillMyProfile(){$('#profileName').value=me.name;$('#profileBio').value=me.bio||'';$('#avatarFile').value='';$('#profileErr').textContent='';}
function imageData(file,max=256,quality=.78){if(!file)return Promise.resolve(null);return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas'),sc=Math.min(1,max/Math.max(img.width,img.height));c.width=Math.max(1,Math.round(img.width*sc));c.height=Math.max(1,Math.round(img.height*sc));c.getContext('2d').drawImage(img,0,0,c.width,c.height);res(c.toDataURL('image/jpeg',quality))};img.onerror=rej;img.src=r.result};r.onerror=rej;r.readAsDataURL(file)})}
async function saveProfile(){try{$('#profileErr').textContent='در حال ذخیره…';const avatar=await imageData($('#avatarFile').files[0],256,.78);const d=await api('/api/profile',{method:'POST',body:JSON.stringify({id:me.id,name:$('#profileName').value,bio:$('#profileBio').value,...(avatar?{avatar}:{}),theme:me.theme||'midnight',background:me.background||'default',background_image:me.background_image||null})});me=d.user;localStorage.setItem('gb_me',JSON.stringify(me));$('#profileBox').classList.add('hidden');enter()}catch(e){$('#profileErr').textContent=e.message}}
function openOtherProfile(){if(!current)return;$('#otherAvatar').innerHTML='';av($('#otherAvatar'),current);$('#otherName').textContent=current.name;$('#otherBio').textContent=current.bio||'بیوگرافی تنظیم نشده';$('#otherLast').textContent=current.online?'آنلاین':'آخرین بازدید: '+lastSeen(current.last_seen);$('#otherBox').classList.remove('hidden')}
async function refreshCurrentProfile(){if(!current)return;try{const d=await api('/api/user?id='+encodeURIComponent(current.id));current=d.user;av($('#chatAvatar'),current);setStatus(current)}catch{}}
function openSettings(){syncSettingsUI();$('#settingsBox').classList.remove('hidden')}
function syncSettingsUI(){document.querySelectorAll('[data-theme]').forEach(x=>x.classList.toggle('active',x.dataset.theme===(me.theme||'midnight')));document.querySelectorAll('[data-bg]').forEach(x=>x.classList.toggle('active',x.dataset.bg===(me.background||'default')))}
async function saveSettings(changes){const old={...me};me={...me,...changes};applyTheme();syncSettingsUI();try{const d=await api('/api/profile',{method:'POST',body:JSON.stringify({id:me.id,name:me.name,bio:me.bio||'',avatar:me.avatar||null,cover:me.cover||null,theme:me.theme,background:me.background,background_image:me.background_image||null})});me=d.user;localStorage.setItem('gb_me',JSON.stringify(me));applyTheme()}catch(e){me=old;applyTheme();alert(e.message)}}

$('#text').addEventListener('input',()=>{sendTyping(true);clearTimeout(typingTimer);typingTimer=setTimeout(()=>sendTyping(false),1200)});
$('#cancelReply').onclick=cancelReply;
$('#chatSearchBtn').onclick=()=>{$('#chatSearchBox').classList.toggle('hidden');if(!$('#chatSearchBox').classList.contains('hidden'))$('#chatSearch').focus()};
$('#chatSearchClose').onclick=()=>{$('#chatSearchBox').classList.add('hidden');$('#chatSearch').value=''};
$('#chatSearch').onkeydown=async e=>{if(e.key!=='Enter'||!current)return;const q=e.target.value.trim();if(!q)return;try{const d=await api(`/api/search-messages?a=${encodeURIComponent(me.id)}&b=${encodeURIComponent(current.id)}&q=${encodeURIComponent(q)}`);document.querySelectorAll('.search-hit').forEach(x=>x.classList.remove('search-hit'));if(!d.messages.length)return alert('پیامی پیدا نشد');const first=d.messages[0],n=[...$('#messages').children()].find(x=>x.dataset.messageId===first.id);if(n){n.scrollIntoView({behavior:'smooth',block:'center'});n.classList.add('search-hit')}}catch(err){alert(err.message)}};
$('#login').onclick=login;$('#name').onkeydown=e=>{if(e.key==='Enter')login()};$('#send').onclick=send;$('#text').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}};$('#logout').onclick=()=>{try{ws?.close()}catch{}clearInterval(presenceTimer);clearInterval(peopleTimer);localStorage.removeItem('gb_me');location.reload()};$('#profileBtn').onclick=openProfile;$('#closeProfile').onclick=()=>$('#profileBox').classList.add('hidden');$('#saveProfile').onclick=saveProfile;$('#mobileOpen').onclick=()=>$('#side').classList.add('open');$('#mobileOpen2').onclick=()=>$('#side').classList.add('open');$('#mobileClose').onclick=()=>$('#side').classList.remove('open');$('#chatName').onclick=openOtherProfile;$('#chatAvatar').onclick=openOtherProfile;$('#closeOther').onclick=()=>$('#otherBox').classList.add('hidden');$('#attachBtn').onclick=()=>$('#mediaFile').click();$('#mediaFile').onchange=e=>{const f=e.target.files[0];if(f)sendMedia(f);e.target.value=''};$('#settingsBtn').onclick=openSettings;$('#closeSettings').onclick=()=>$('#settingsBox').classList.add('hidden');document.querySelectorAll('[data-theme]').forEach(x=>x.onclick=()=>saveSettings({theme:x.dataset.theme}));document.querySelectorAll('[data-bg]').forEach(x=>x.onclick=()=>saveSettings({background:x.dataset.bg,background_image:null}));$('#bgFile').onchange=async e=>{const data=await imageData(e.target.files[0],900,.65);if(data)await saveSettings({background:'gallery',background_image:data});e.target.value=''};if(me)enter();
