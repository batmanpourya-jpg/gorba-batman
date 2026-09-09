const $ = s => document.querySelector(s);
const safeBind=(sel,ev,fn)=>{const el=$(sel);if(el)el.addEventListener(ev,fn)};
let me=null,current=null,currentGroup=null,ws=null,presenceTimer=null,peopleTimer=null,searchTimer=null,chatSearchTimer=null,replyingTo=null,editingId=null,typingTimer=null; window.adminToken='';
let oldestCursor=null, loadingOlder=false, hasOlder=true, pendingFile=null, mediaPreviewUrl=null, mediaRecorder=null, audioChunks=[], recordingStartedAt=0;
let callPc=null,callStream=null,callRemoteStream=null,callKind='audio',callStartedByMe=false;
try{me=JSON.parse(localStorage.getItem('gb_me')||'null')}catch{localStorage.removeItem('gb_me')}
async function api(url,opt={}){const r=await fetch(url,{...opt,headers:{...(opt.body?{'content-type':'application/json'}:{}),...(opt.headers||{})}});const d=await r.json().catch(()=>({ok:false,error:'پاسخ نامعتبر'}));if(!r.ok||d.ok===false)throw Error(d.error||'خطا');return d}
function av(el,u){if(!el)return;el.innerHTML='';if(u?.avatar){const i=document.createElement('img');i.src=u.avatar;i.alt='';el.append(i)}else el.textContent=String(u?.name||'?').slice(0,1)}
function enter(){if(!me)return;$('#auth')?.classList.add('hidden');$('#app')?.classList.remove('hidden');$('#myName').textContent=me.name;av($('#myAvatar'),me);loadChats();presence();clearInterval(presenceTimer);clearInterval(peopleTimer);presenceTimer=setInterval(presence,20000);peopleTimer=setInterval(loadChats,15000)}
async function login(){const name=$('#name').value.trim();if(!name){$('#err').textContent='نام را وارد کن';return}$('#err').textContent='در حال ورود…';try{const d=await api('/api/login',{method:'POST',body:JSON.stringify({name})});me=d.user;localStorage.setItem('gb_me',JSON.stringify(me));enter()}catch(e){$('#err').textContent=e.message}}
function person(u){const el=document.createElement('div');el.className='person';const a=document.createElement('div');a.className='avatar';av(a,u);const box=document.createElement('div');box.className='grow';const b=document.createElement('b');b.textContent=u.name;const s=document.createElement('small');s.innerHTML=`<span class="dot ${u.online?'on':''}"></span>${u.online?'آنلاین':'آفلاین'} · شروع گفتگو`;box.append(b,s);el.append(a,box);el.onclick=()=>openChat(u);return el}

async function adminLogin7(){
  const p=prompt('رمز مدیریت را وارد کن'); if(p===null)return;
  try{
    const d=await api('/api/admin-login',{method:'POST',body:JSON.stringify({password:p})});
    window.adminToken=d.token||'';
    await openAdminPanel7();
  }catch(e){alert(e.message)}
}
async function openAdminPanel7(){
  const box=$('#adminBox'); if(!box)return;
  box.classList.remove('hidden');
  const authHeaders=()=>window.adminToken?{'x-admin-token':window.adminToken}:{};
  const adminApi=(url,opt={})=>api(url,{...opt,headers:{...(opt.headers||{}),...authHeaders()}});
  try{
    const [st,w,u,ac,r]=await Promise.all([
      adminApi('/api/admin-stats'),adminApi('/api/admin-words'),adminApi('/api/admin-users'),
      adminApi('/api/admin-actions'),adminApi('/api/admin-reports')
    ]);
    const stats=st.stats||{};
    $('#adminStats').innerHTML=[
      ['👥','کاربران',stats.users||0],['🟢','آنلاین',stats.online||0],
      ['📝','گزارش باز',stats.reports||0],['⚠️','کلمات فعال',stats.words||0]
    ].map(x=>`<div class="admin-stat"><b>${x[0]}</b><strong>${x[2]}</strong><span>${x[1]}</span></div>`).join('');

    const wl=$('#adminWords'); wl.innerHTML='';
    (w.words||[]).forEach(x=>{
      const row=document.createElement('div');row.className='admin-row';
      row.innerHTML=`<div class="grow"><b>${escapeHtml(x.word)}</b><small>${escapeHtml(x.warning||'')}</small></div>`;
      const toggle=document.createElement('button');toggle.className='ghost';toggle.textContent=x.active?'فعال':'خاموش';
      toggle.onclick=async()=>{await adminApi('/api/admin-word-toggle',{method:'POST',body:JSON.stringify({id:x.id,active:!x.active})});openAdminPanel7()};
      const del=document.createElement('button');del.className='danger';del.textContent='حذف';
      del.onclick=async()=>{await adminApi('/api/admin-word-delete',{method:'POST',body:JSON.stringify({id:x.id})});openAdminPanel7()};
      row.append(toggle,del);wl.append(row);
    });
    $('#adminUsers').innerHTML=(u.users||[]).map(x=>`<div class="admin-row"><div class="avatar">${x.avatar?`<img src="${x.avatar}" alt="">`:escapeHtml((x.name||'?').slice(0,1))}</div><div class="grow"><b>${escapeHtml(x.name)}</b><small>${x.last_seen?'آخرین بازدید: '+new Date(x.last_seen).toLocaleString('fa-IR'):'بدون بازدید'}</small></div><span class="status-pill ${Date.now()-Number(x.last_seen||0)<45000?'on':''}">${Date.now()-Number(x.last_seen||0)<45000?'آنلاین':'آفلاین'}</span></div>`).join('')||'<div class="empty-list">کاربری نیست</div>';

    const statusLabel={new:'جدید',in_progress:'در حال پیگیری',closed:'بسته‌شده'};
    $('#adminReports').innerHTML=(r.reports||[]).map(x=>`<div class="admin-report" data-report="${x.id}"><b>گزارش از: ${escapeHtml(x.user_id)}</b><small>هدف: ${escapeHtml(x.target_user||'مشخص نشده')}</small>${x.message_id?`<small>پیام: ${escapeHtml(x.message_id)}</small>`:''}<p>${escapeHtml(x.message)}</p><div class="row"><select class="report-status"><option value="new"${x.status==='new'?' selected':''}>جدید</option><option value="in_progress"${x.status==='in_progress'?' selected':''}>در حال پیگیری</option><option value="closed"${x.status==='closed'?' selected':''}>بسته‌شده</option></select><input class="report-resolution input" placeholder="نتیجه پیگیری" value="${escapeHtml(x.resolution||'')}"><button class="primary report-save">ذخیره</button></div><small>${statusLabel[x.status]||'جدید'}</small></div>`).join('')||'<div class="empty-list">گزارشی نیست</div>';
    document.querySelectorAll('.report-save').forEach(btn=>btn.onclick=async()=>{
      const row=btn.closest('.admin-report');const id=row.dataset.report;
      await adminApi('/api/admin-report-update',{method:'POST',body:JSON.stringify({id,status:row.querySelector('.report-status').value,resolution:row.querySelector('.report-resolution').value})});
      openAdminPanel7();
    });

    $('#adminActions').innerHTML=(ac.actions||[]).map(x=>`<div class="admin-row"><div class="grow"><b>${escapeHtml(x.action)}</b><small>${x.created_at?new Date(x.created_at).toLocaleString('fa-IR'):''} · هدف: ${escapeHtml(x.target_user||'-')}</small><span>${escapeHtml(x.details||'')}</span></div></div>`).join('')||'<div class="empty-list">اقدامی ثبت نشده</div>';
  }catch(e){alert(e.message)}
}
async function globalSearch7(){
  const q=prompt('نام کاربر را وارد کن');if(q===null)return;
  try{
    const d=await api('/api/global-search?q='+encodeURIComponent(q));
    const users=d.users||[];
    if(!users.length){alert('کسی پیدا نشد');return}
    const names=users.map((x,i)=>`${i+1}. ${x.name}`).join('\n');
    const n=prompt('کاربر را انتخاب کن با شماره:\n'+names);
    if(!n)return;
    const u=users[Number(n)-1];
    if(u && u.id!==me?.id)openChat(u);
  }catch(e){alert(e.message)}
}
function escapeHtml(v){const d=document.createElement('div');d.textContent=String(v);return d.innerHTML}
if($('#search'))$('#search').oninput=()=>{clearTimeout(searchTimer);const q=$('#search').value.trim();searchTimer=setTimeout(async()=>{try{const d=await api('/api/search?q='+encodeURIComponent(q));$('#results').innerHTML='';const users=(d.users||[]).filter(u=>u.id!==me.id);if(!users.length){$('#results').innerHTML='<div class="empty-list">کسی پیدا نشد</div>';return}users.forEach(u=>$('#results').append(person(u)))}catch{$('#results').innerHTML='<div class="empty-list">خطا در جستجو</div>'}},120)};
function chatItem(c){const el=document.createElement('div');el.className='chatitem'+(current?.id===c.user.id?' selected':'');const a=document.createElement('div');a.className='avatar';av(a,c.user);const box=document.createElement('div');box.className='grow';const b=document.createElement('b');b.textContent=c.user.name;const s=document.createElement('small');const preview=c.last_message||'هنوز پیامی نیست · برای شروع لمس کن';s.innerHTML=`<span class="dot ${c.user.online?'on':''}"></span>${escapeHtml(preview)}${c.last_message_at?' · '+new Date(c.last_message_at).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'}):''}`;box.append(b,s);el.append(a,box);if(c.unread>0){const n=document.createElement('span');n.className='unread';n.textContent=c.unread>99?'99+':c.unread;el.append(n)}el.onclick=()=>openChat(c.user);return el}

function groupItem(g){
  const el=document.createElement('div');
  el.className='chatitem'+(currentGroup?.id===g.id?' selected':'');
  const avx=document.createElement('div'); avx.className='avatar';
  if(g.photo){const im=document.createElement('img');im.src=g.photo;im.alt='';avx.append(im)}else avx.textContent='👥';
  const box=document.createElement('div'); box.className='grow';
  const b=document.createElement('b'); b.textContent=g.name;
  const sm=document.createElement('small'); sm.textContent=`👥 ${g.member_count||0} عضو${g.muted?' · 🔕 بی‌صدا':''}`;
  box.append(b,sm); el.append(avx,box); el.onclick=()=>openGroup(g); return el;
}
async function loadGroups(){
  if(!me)return;
  try{
    const d=await api('/api/groups?id='+encodeURIComponent(me.id));
    const host=$('#chats'); if(!host)return;
    (d.groups||[]).forEach(g=>host.append(groupItem(g)));
  }catch{}
}
async function loadGroupPeople(){
  try{
    const d=await api('/api/conversations?id='+encodeURIComponent(me.id));
    const people=d.conversations.map(x=>x.user).filter(u=>u.id!==me.id);
    const host=$('#groupPeopleList'); if(!host)return; host.innerHTML='';
    if(!people.length){host.innerHTML='<div class="empty-list">دوستی برای اضافه‌کردن نیست</div>';return}
    people.forEach(u=>{
      const row=document.createElement('label');row.className='group-person';
      const cb=document.createElement('input');cb.type='checkbox';cb.value=u.id;
      const avx=document.createElement('div');avx.className='avatar';av(avx,u);
      const name=document.createElement('span');name.textContent=u.name;
      row.append(cb,avx,name);host.append(row);
    });
  }catch{}
}
function openCreateGroup(){loadGroupPeople();$('#groupNameInput').value='';$('#groupPhotoInput').value='';$('#groupCreateErr').textContent='';$('#groupCreateBox')?.classList.remove('hidden')}
async function createGroup(){
  try{
    const name=$('#groupNameInput').value.trim(); if(!name){$('#groupCreateErr').textContent='نام گروه را وارد کن';return}
    let photo=null; const f=$('#groupPhotoInput').files?.[0];
    if(f){if(f.size>3*1024*1024){$('#groupCreateErr').textContent='عکس گروه حداکثر ۳MB باشد';return}photo=await imageDataLarge(f)}
    const members=Array.from(document.querySelectorAll('#groupPeopleList input[type=checkbox]:checked')).map(x=>x.value);
    const d=await api('/api/group-create',{method:'POST',body:JSON.stringify({creator_id:me.id,name,photo,members})});
    $('#groupCreateBox')?.classList.add('hidden'); await loadChats(); openGroup(d.group);
  }catch(e){$('#groupCreateErr').textContent=e.message}
}
async function openGroup(g){
  currentGroup=g; current=null; $('#side')?.classList.remove('open');
  $('#empty')?.classList.add('hidden');$('#chat')?.classList.remove('hidden');
  $('#groupInfoBtn')?.classList.remove('hidden'); av($('#chatAvatar'),{name:'👥',avatar:g.photo}); $('#chatName').textContent=g.name; $('#chatStatus').textContent=`👥 ${g.member_count||0} عضو`;
  clearComposerState(); $('#messages').innerHTML='<div class="empty-list">در حال باز کردن گروه…</div>';
  if(ws){try{ws.close()}catch{}ws=null}
  try{
    const gd=await api(`/api/group?id=${encodeURIComponent(g.id)}&user=${encodeURIComponent(me.id)}`); currentGroup=gd.group;
    $('#chatName').textContent=currentGroup.name; $('#chatStatus').textContent=`👥 ${currentGroup.member_count} عضو${currentGroup.muted?' · 🔕 بی‌صدا':''}`;
    const d=await api(`/api/group-history?id=${encodeURIComponent(g.id)}&limit=30`);
    $('#messages').innerHTML=''; oldestCursor=d.messages?.[0]?{created_at:d.messages[0].created_at,id:d.messages[0].id}:null; hasOlder=!!d.has_more;
    if(!d.messages.length)$('#messages').innerHTML='<div class="empty-list">اولین پیام گروه را بفرست 👋</div>';
    d.messages.forEach(m=>$('#messages').append(groupBubble(m))); scrollBottom();
    const proto=location.protocol==='https:'?'wss':'ws';
    ws=new WebSocket(`${proto}://${location.host}/api/group-ws?id=${encodeURIComponent(g.id)}&user=${encodeURIComponent(me.id)}`);
    ws.onmessage=e=>{try{const d=JSON.parse(e.data);if(d.type==='group-message'){const stick=nearBottom();$('#messages').querySelector('.empty-list')?.remove();if(!Array.from($('#messages').children).some(n=>n.dataset.messageId===d.message.id))$('#messages').append(groupBubble(d.message));if(stick)scrollBottom();}}catch{}};
  }catch(e){$('#messages').innerHTML=`<div class="empty-list">${escapeHtml(e.message)}</div>`}
}
function groupBubble(m){
  const wrap=document.createElement('div');wrap.className='bubble-wrap '+(m.sender_id===me.id?'mine-wrap':'theirs-wrap');wrap.dataset.messageId=m.id;
  const d=document.createElement('div');d.className='bubble '+(m.sender_id===me.id?'mine':'theirs');
  if(m.sender_id!==me.id){const who=document.createElement('div');who.className='edited';who.textContent=m.sender_name||'عضو گروه';d.append(who)}
  if(m.media_id){const u=`/api/group-media?group_id=${encodeURIComponent(currentGroup.id)}&id=${encodeURIComponent(m.media_id)}`;if(m.media_type==='image'){const im=document.createElement('img');im.src=u;im.style.maxWidth='260px';im.style.borderRadius='10px';d.append(im)}else if(m.media_type==='video'){const v=document.createElement('video');v.src=u;v.controls=true;v.style.maxWidth='260px';d.append(v)}else if(m.media_type==='audio'){const a=document.createElement('audio');a.src=u;a.controls=true;d.append(a)}else{const a=document.createElement('a');a.href=u;a.target='_blank';a.textContent='📎 '+(m.media_name||'فایل');d.append(a)}}if(m.text){const tx=document.createElement('div');tx.textContent=m.text;d.append(tx)}
  const tm=document.createElement('div');tm.className='time';tm.textContent=new Date(m.created_at).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'});
  wrap.append(d,tm);return wrap;
}
async function loadOlderGroupMessages(){
  if(!currentGroup||loadingOlder||!hasOlder||!oldestCursor)return;
  const box=$('#messages'),oldHeight=box.scrollHeight,oldTop=box.scrollTop;loadingOlder=true;
  try{
    const q=`/api/group-history?id=${encodeURIComponent(currentGroup.id)}&before_at=${encodeURIComponent(oldestCursor.created_at)}&before_id=${encodeURIComponent(oldestCursor.id)}&limit=30`;
    const d=await api(q),rows=d.messages||[]; if(!rows.length){hasOlder=false;return}
    const frag=document.createDocumentFragment();rows.forEach(m=>frag.appendChild(groupBubble(m)));box.insertBefore(frag,box.firstChild);
    oldestCursor={created_at:rows[0].created_at,id:rows[0].id};hasOlder=!!d.has_more;box.scrollTop=box.scrollHeight-oldHeight+oldTop;
  }finally{loadingOlder=false}
}
async function sendGroup(){
  const text=$('#text').value.trim();if(!currentGroup||!text)return;
  try{
    $('#text').value='';
    const d=await api('/api/group-send',{method:'POST',body:JSON.stringify({group_id:currentGroup.id,sender_id:me.id,text})});
    if(!ws||ws.readyState!==WebSocket.OPEN){$('#messages').querySelector('.empty-list')?.remove();$('#messages').append(groupBubble(d.message));scrollBottom()}
  }catch(e){$('#text').value=text;alert(e.message)}
}
async function openGroupInfo(){
  if(!currentGroup)return;
  try{
    const d=await api(`/api/group-members?id=${encodeURIComponent(currentGroup.id)}&user=${encodeURIComponent(me.id)}`);
    $('#groupInfoTitle').textContent='👥 '+currentGroup.name;
    const list=$('#groupMembersList');list.innerHTML='';
    d.members.forEach(m=>{
      const row=document.createElement('div');row.className='group-person';
      const avx=document.createElement('div');avx.className='avatar';av(avx,m);
      const nm=document.createElement('span');nm.textContent=m.name+(m.role==='owner'?' 👑':m.role==='admin'?' 🛡️':'');
      row.append(avx,nm);
      if(currentGroup.me_role==='owner'&&m.id!==me.id){const b=document.createElement('button');b.className='ghost';b.textContent=m.role==='admin'?'برداشتن مدیریت':'👑 مدیر';b.onclick=async()=>{await api('/api/group-promote',{method:'POST',body:JSON.stringify({group_id:currentGroup.id,actor_id:me.id,user_id:m.id})});openGroupInfo()};row.append(b)}
      list.append(row);
    });
    $('#groupMuteBtn').textContent=currentGroup.muted?'🔔 فعال‌کردن اعلان':'🔕 بی‌صدا کردن گروه';
    $('#groupAddArea').classList.toggle('hidden',!['owner','admin'].includes(currentGroup.me_role));
    const add=$('#groupAddPeople');add.innerHTML='';
    const memberIds=new Set(d.members.map(x=>x.id));
    const all=(await api('/api/conversations?id='+encodeURIComponent(me.id))).conversations.map(x=>x.user).filter(u=>!memberIds.has(u.id));
    all.forEach(u=>{const row=document.createElement('label');row.className='group-person';const cb=document.createElement('input');cb.type='checkbox';cb.value=u.id;const avx=document.createElement('div');avx.className='avatar';av(avx,u);const nm=document.createElement('span');nm.textContent=u.name;row.append(cb,avx,nm);add.append(row)});
    $('#groupInfoErr').textContent='';$('#groupInfoBox').classList.remove('hidden');
  }catch(e){$('#groupInfoErr').textContent=e.message}
}
async function addSelectedGroupMembers(){
  const ids=Array.from(document.querySelectorAll('#groupAddPeople input:checked')).map(x=>x.value);
  try{for(const id of ids)await api('/api/group-add',{method:'POST',body:JSON.stringify({group_id:currentGroup.id,actor_id:me.id,user_id:id})});openGroupInfo()}catch(e){$('#groupInfoErr').textContent=e.message}
}
async function toggleGroupMute(){
  if(!currentGroup)return;
  try{const d=await api('/api/group-mute',{method:'POST',body:JSON.stringify({group_id:currentGroup.id,user_id:me.id,muted:!currentGroup.muted})});currentGroup.muted=d.muted;$('#groupMuteBtn').textContent=currentGroup.muted?'🔔 فعال‌کردن اعلان':'🔕 بی‌صدا کردن گروه';$('#chatStatus').textContent=`👥 ${currentGroup.member_count} عضو${currentGroup.muted?' · 🔕 بی‌صدا':''}`}catch(e){$('#groupInfoErr').textContent=e.message}
}

async function loadChats(){if(!me)return;try{const d=await api('/api/conversations?id='+encodeURIComponent(me.id));$('#chats').innerHTML='';if(d.conversations.length){d.conversations.forEach(c=>$('#chats').append(chatItem(c)))}else{$('#chats').innerHTML='<div class="empty-list">هنوز گفتگوی خصوصی‌ای نیست.</div>'}try{await loadGroups()}catch(e){}}catch{$('#chats').innerHTML='<div class="empty-list">خطا در بارگذاری گفتگوها</div>'}}
async function reportMessage(m){if(!m||m.deleted||m.sender_id===me.id)return;const reason=prompt('دلیل گزارش این پیام را بنویس:','پیام نامناسب / مزاحمت');if(reason===null)return;const text=reason.trim();if(!text)return;try{await api('/api/report',{method:'POST',body:JSON.stringify({user_id:me.id,target_user:m.sender_id,message_id:m.id,message:text})});alert('گزارش پیام برای پنل مدیریت ارسال شد ✅')}catch(e){alert(e.message)}}
function actionButtons(m){if(m.deleted)return null;const row=document.createElement('div');row.className='msg-actions';[['↩','پاسخ',()=>startReply(m)],['✎','ویرایش',()=>startEdit(m)],['📌',m.pinned?'برداشتن سنجاق':'سنجاق',()=>togglePin(m)],['😠','گزارش پیام',()=>reportMessage(m)],['⭐','ذخیره',()=>saveMessage(m)],['⌫','حذف',()=>deleteMessage(m)]].forEach(([txt,title,fn])=>{if((txt==='✎'||txt==='⌫')&&m.sender_id!==me.id)return;if(txt==='😠'&&m.sender_id===me.id)return;const b=document.createElement('button');b.textContent=txt;b.title=title;b.setAttribute('aria-label',title);b.onclick=e=>{e.stopPropagation();fn()};row.append(b)});return row}
function bubble(m){const wrap=document.createElement('div');wrap.className='bubble-wrap '+(m.sender_id===me.id?'mine-wrap':'theirs-wrap');wrap.dataset.messageId=m.id;const d=document.createElement('div');d.className='bubble '+(m.sender_id===me.id?'mine':'theirs')+(m.deleted?' deleted':'')+(m.pinned?' pinned':'');if(m.reply_to_id&&!m.deleted){const r=document.createElement('div');r.className='reply-preview';r.textContent='پاسخ به پیام';d.append(r)}if(m.media_id&&!m.deleted){const card=document.createElement('div');card.className='media-card';const url=mediaUrl(m.media_id);if(m.media_type==='image'){const im=document.createElement('img');im.src=url;im.loading='lazy';im.alt=m.media_name||'image';card.append(im)}else if(m.media_type==='video'){const v=document.createElement('video');v.src=url;v.controls=true;v.preload='metadata';card.append(v)}else if(m.media_type==='audio'){const a=document.createElement('audio');a.src=url;a.controls=true;card.append(a)}else{const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.className='file-card';a.textContent='📎 '+(m.media_name||'فایل');card.append(a)}d.append(card)}if(m.text){const text=document.createElement('div');text.textContent=m.deleted?'پیام حذف شد':m.text;d.append(text)}if(m.deleted&&!m.text){const text=document.createElement('div');text.textContent='پیام حذف شد';d.append(text)}if(m.edited&&!m.deleted){const ed=document.createElement('span');ed.className='edited';ed.textContent=' ویرایش‌شده';d.append(ed)}const meta=document.createElement('div');meta.className='time';let ticks='';if(m.sender_id===me.id)ticks=m.read_at?' ✓✓':' ✓';meta.textContent=new Date(m.created_at).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'})+ticks;wrap.append(d,meta);const actions=actionButtons(m);if(actions)wrap.append(actions);return wrap}
function replaceBubble(m){const old=Array.from($('#messages').children).find(n=>n.dataset.messageId===m.id);if(old)old.replaceWith(bubble(m))}
function renderDeleted(id){const node=Array.from($('#messages').children).find(n=>n.dataset.messageId===id);if(node)node.replaceWith(bubble({id,deleted:1,sender_id:'',receiver_id:'',text:'',created_at:Date.now()}))}
function setStatus(u){if($('#chatStatus'))$('#chatStatus').innerHTML=u.profile_show_last_seen===0?'':`<span class="dot ${u.online?'on':''}"></span>${u.online?'آنلاین':'آفلاین'}`}
function scrollBottom(){const m=$("#messages");if(m){requestAnimationFrame(()=>{m.scrollTop=m.scrollHeight;});}}
function nearBottom(){const m=$("#messages");return !m||m.scrollHeight-m.scrollTop-m.clientHeight<140;}
function mediaUrl(id){return `/api/media?id=${encodeURIComponent(id)}&a=${encodeURIComponent(me.id)}&b=${encodeURIComponent(current.id)}`;}
async function loadOlderMessages(){
  if(!current||loadingOlder||!hasOlder||!oldestCursor)return;
  const box=$("#messages"); const oldHeight=box.scrollHeight,oldTop=box.scrollTop; loadingOlder=true;
  try{
    const q=`/api/history?a=${encodeURIComponent(me.id)}&b=${encodeURIComponent(current.id)}&before_at=${encodeURIComponent(oldestCursor.created_at)}&before_id=${encodeURIComponent(oldestCursor.id)}&limit=30`;
    const d=await api(q),rows=d.messages||[];
    if(!rows.length){hasOlder=false;return;}
    const frag=document.createDocumentFragment(); rows.forEach(m=>frag.appendChild(bubble(m))); box.insertBefore(frag,box.firstChild);
    const first=rows[0]; oldestCursor={created_at:first.created_at,id:first.id}; hasOlder=!!d.has_more;
    box.scrollTop=box.scrollHeight-oldHeight+oldTop;
  }catch(e){console.warn('older messages',e)}finally{loadingOlder=false;}
}

async function openChat(u){if(!u||u.id===me.id)return;currentGroup=null;$('#groupInfoBtn')?.classList.add('hidden');current=u;replyingTo=null;editingId=null;$('#side')?.classList.remove('open');$('#empty')?.classList.add('hidden');$('#chat')?.classList.remove('hidden');av($('#chatAvatar'),u);$('#chatName').textContent=u.name;setStatus(u);clearComposerState();$('#messages').innerHTML='<div class="empty-list">در حال باز کردن گفتگو…</div>';if(ws){try{ws.close()}catch{}ws=null}try{await api('/api/conversation',{method:'POST',body:JSON.stringify({me:me.id,other:u.id})});const d=await api(`/api/history?a=${encodeURIComponent(me.id)}&b=${encodeURIComponent(u.id)}&limit=30`);$('#messages').innerHTML='';oldestCursor=d.messages?.[0]?{created_at:d.messages[0].created_at,id:d.messages[0].id}:null;hasOlder=!!d.has_more;if(!d.messages.length)$('#messages').innerHTML='<div class="empty-list">اولین پیام را تو بفرست 👋</div>';d.messages.forEach(m=>$('#messages').append(bubble(m)));scrollBottom();await api('/api/read',{method:'POST',body:JSON.stringify({me:me.id,other:u.id})});loadChats();const proto=location.protocol==='https:'?'wss':'ws';ws=new WebSocket(`${proto}://${location.host}/api/ws?a=${encodeURIComponent(me.id)}&b=${encodeURIComponent(u.id)}`);ws.onopen=()=>setStatus(current);ws.onmessage=e=>{try{const d=JSON.parse(e.data);if(d.type==='message'){const m=d.message;notifyIncoming(m);if(current&&((m.sender_id===me.id&&m.receiver_id===current.id)||(m.receiver_id===me.id&&m.sender_id===current.id))){$('#messages').querySelector('.empty-list')?.remove();const stick=nearBottom();if(!Array.from($('#messages').children).some(n=>n.dataset.messageId===m.id))$('#messages').append(bubble(m));if(stick)scrollBottom();if(m.receiver_id===me.id){api('/api/read',{method:'POST',body:JSON.stringify({me:me.id,other:current.id})}).catch(()=>{});api('/api/read-message',{method:'POST',body:JSON.stringify({id:m.id,requester:me.id,sender_id:m.sender_id,receiver_id:m.receiver_id,chat_id:pairKey(m.sender_id,m.receiver_id)})}).catch(()=>{})}}loadChats()}else if(d.type==='deleted'){renderDeleted(d.id);loadChats()}else if(d.type==='edited'||d.type==='pinned'||d.type==='read'){if(d.message)replaceBubble(d.message)}else if(d.type==='call-offer'){handleCallOffer(d.payload)}else if(d.type==='call-answer'){handleCallAnswer(d.payload)}else if(d.type==='call-ice'){handleCallIce(d.payload)}else if(d.type==='call-end'){endCall(false)}else if(d.type==='typing'){if(d.show&&current)$('#chatStatus').textContent='در حال نوشتن…';else if(current)setStatus(current)}}catch{}}}catch(e){$('#messages').innerHTML=`<div class="empty-list">${escapeHtml(e.message)}</div>`}}
function clearComposerState(){replyingTo=null;editingId=null;if($('#replyBar')){$('#replyBar').classList.add('hidden');$('#replyText').textContent=''}if($('#editBar'))$('#editBar').classList.add('hidden');$('#text').value=''}
function startReply(m){replyingTo=m;editingId=null;$('#editBar')?.classList.add('hidden');if($('#replyBar')){$('#replyBar').classList.remove('hidden');$('#replyText').textContent=(m.text||'پیام').slice(0,120);$('#text').focus()}}
function startEdit(m){if(m.sender_id!==me.id||m.deleted)return;editingId=m.id;replyingTo=null;$('#replyBar')?.classList.add('hidden');if($('#editBar'))$('#editBar').classList.remove('hidden');$('#text').value=m.text;$('#text').focus()}
function clearPendingFile(){pendingFile=null; if(mediaPreviewUrl){URL.revokeObjectURL(mediaPreviewUrl);mediaPreviewUrl=null;} const box=$("#mediaPreview");if(box){box.classList.add('hidden');box.innerHTML='';}}
function chooseFile(){if(current)$("#fileInput")?.click();}
function showFilePreview(file){pendingFile=file;const box=$("#mediaPreview");if(!box)return;box.classList.remove('hidden');box.innerHTML='';const info=document.createElement('div');info.className='grow';info.textContent=`${file.name} · ${(file.size/1024/1024).toFixed(1)} MB`;box.append(info);if(file.type.startsWith('image/')||file.type.startsWith('video/')){mediaPreviewUrl=URL.createObjectURL(file);const el=document.createElement(file.type.startsWith('image/')?'img':'video');el.src=mediaPreviewUrl;if(el.tagName==='VIDEO')el.controls=true;box.prepend(el)}const x=document.createElement('button');x.className='ghost';x.textContent='✕';x.onclick=clearPendingFile;box.append(x);}
function uploadWithProgress(file){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST','/api/upload');xhr.upload.onprogress=e=>{if(e.lengthComputable){const pct=Math.round((e.loaded/e.total)*100);const bar=$("#uploadBar");if(bar)bar.style.width=pct+'%';const p=$("#uploadPct");if(p)p.textContent=pct+'%';}};xhr.onload=()=>{try{const d=JSON.parse(xhr.responseText);if(xhr.status>=200&&xhr.status<300&&d.ok)resolve(d.media);else reject(Error(d.error||'آپلود ناموفق بود'))}catch{reject(Error('پاسخ نامعتبر'))}};xhr.onerror=()=>reject(Error('خطا در آپلود'));const f=new FormData();f.append('sender_id',me.id);f.append('receiver_id',current.id);f.append('file',file);f.append('type',file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':'file');xhr.send(f);});}
function uploadGroupWithProgress(form){return new Promise((resolve,reject)=>{const x=new XMLHttpRequest();x.open('POST','/api/group-upload');x.upload.onprogress=e=>{if(e.lengthComputable){const p=Math.round(e.loaded/e.total*100);const b=$('#uploadBar');if(b)b.style.width=p+'%'}};x.onload=()=>{try{const d=JSON.parse(x.responseText);d.ok?resolve(d.media):reject(Error(d.error||'آپلود ناموفق'))}catch{reject(Error('پاسخ نامعتبر'))}};x.onerror=()=>reject(Error('خطای آپلود'));x.send(form)})}
async function sendMedia(file){if(currentGroup){
    if(!file)return;
    const MAX=20*1024*1024;if(file.size>MAX)return alert('حداکثر ۲۰MB');
    try{const f=new FormData();f.append('group_id',currentGroup.id);f.append('sender_id',me.id);f.append('file',file);f.append('type',file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':'file');
      const xhr=await uploadGroupWithProgress(f);const d=await api('/api/group-send',{method:'POST',body:JSON.stringify({group_id:currentGroup.id,sender_id:me.id,text:$('#text').value.trim(),media_id:xhr.id,media_type:xhr.type,media_name:xhr.name,media_size:xhr.size,media_mime:xhr.mime})});$('#text').value='';if(!ws||ws.readyState!==WebSocket.OPEN){$('#messages').append(groupBubble(d.message));scrollBottom()}return;
    }catch(e){alert(e.message);return}
  }if(!file||!current)return;const MAX=20*1024*1024;if(file.size>MAX){alert('حداکثر حجم فایل ۲۰ مگابایت است');return;}const box=$("#mediaPreview");if(box){box.innerHTML='<div class="grow">در حال آپلود… <span id="uploadPct">0%</span></div><div class="upload-progress"><i id="uploadBar"></i></div>';box.classList.remove('hidden');}try{const media=await uploadWithProgress(file);const text=$("#text").value.trim();const reply=replyingTo?.id||null;const d=await api('/api/send',{method:'POST',body:JSON.stringify({sender_id:me.id,receiver_id:current.id,text,reply_to_id:reply,media_id:media.id,media_type:media.type,media_name:media.name,media_size:media.size,media_mime:media.mime})});$("#text").value='';clearComposerState();clearPendingFile();if(!ws||ws.readyState!==WebSocket.OPEN){$("#messages").querySelector('.empty-list')?.remove();$("#messages").append(bubble(d.message));scrollBottom();}loadChats();}catch(e){alert(e.message);clearPendingFile();}}
async function openGallery(){if(!current)return;try{const d=await api(`/api/gallery?a=${encodeURIComponent(me.id)}&b=${encodeURIComponent(current.id)}`);const g=$("#galleryGrid");g.innerHTML='';if(!d.media.length){g.innerHTML='<div class="empty-list">هنوز رسانه‌ای نیست</div>'; }d.media.forEach(m=>{const el=m.type==='image'?document.createElement('img'):m.type==='video'?document.createElement('video'):document.createElement('a');const u=mediaUrl(m.id);if(el.tagName==='A'){el.href=u;el.target='_blank';el.textContent='📎 '+m.name;el.className='file-card'}else{el.src=u;if(el.tagName==='VIDEO')el.controls=true;el.title=m.name;el.onclick=()=>window.open(u,'_blank')}g.append(el)});$("#galleryBox").classList.remove('hidden')}catch(e){alert(e.message)}}
async function toggleVoice(){if(!current&&!currentGroup)return;if(mediaRecorder&&mediaRecorder.state==='recording'){mediaRecorder.stop();$("#voiceBtn").textContent='🎤';return;}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});audioChunks=[];mediaRecorder=new MediaRecorder(stream);recordingStartedAt=Date.now();mediaRecorder.ondataavailable=e=>{if(e.data.size)audioChunks.push(e.data)};mediaRecorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(audioChunks,{type:mediaRecorder.mimeType||'audio/webm'});const file=new File([blob],`voice-${Date.now()}.webm`,{type:blob.type});await sendMedia(file)};mediaRecorder.start();$("#voiceBtn").textContent='⏹️';}catch(e){alert('دسترسی میکروفون داده نشد')}}

async function send(){if(currentGroup){await sendGroup();return}if(!current)return;if(pendingFile){await sendMedia(pendingFile);return;}const text=$('#text').value.trim();if(!text)return;try{if(editingId){const d=await api('/api/edit',{method:'POST',body:JSON.stringify({id:editingId,requester:me.id,text})});replaceBubble(d.message);editingId=null;$('#editBar')?.classList.add('hidden');$('#text').value='';return}const reply=replyingTo?.id||null;$('#text').value='';clearComposerState();const d=await api('/api/send',{method:'POST',body:JSON.stringify({sender_id:me.id,receiver_id:current.id,text,reply_to_id:reply})});if(!ws||ws.readyState!==WebSocket.OPEN){$('#messages').querySelector('.empty-list')?.remove();$('#messages').append(bubble(d.message));scrollBottom()}loadChats()}catch(e){$('#text').value=text;alert(e.message)}}
async function deleteMessage(m){
  const all=m.sender_id===me.id&&confirm('برای همه حذف شود؟');
  const mode=all?'all':'me';
  if(!all&&!confirm('فقط از دستگاه/حساب من حذف شود؟'))return;
  try{await api('/api/delete',{method:'POST',body:JSON.stringify({id:m.id,requester:me.id,mode,chat_id:pairKey(m.sender_id,m.receiver_id)})});if(mode==='all')renderDeleted(m.id);else m._hidden=true;const n=Array.from($('#messages').children).find(x=>x.dataset.messageId===m.id);if(mode==='me')n?.remove();loadChats()}catch(e){alert(e.message)}
}
async function saveMessage(m){try{await api('/api/save-message',{method:'POST',body:JSON.stringify({user_id:me.id,message_id:m.id,chat_key:pairKey(m.sender_id,m.receiver_id),text:m.text||'',media_id:m.media_id||null})});alert('⭐ پیام ذخیره شد')}catch(e){alert(e.message)}}
async function openSaved(){
  const box=$('#savedBox'); if(!box)return;
  try{
    const d=await api('/api/saved-messages?user_id='+encodeURIComponent(me.id));
    const host=$('#savedList'); host.innerHTML='';
    (d.messages||[]).forEach(m=>{
      const row=document.createElement('div');row.className='group-person';
      const t=document.createElement('span');t.className='grow';t.textContent='⭐ '+(m.text||'رسانه');
      const b=document.createElement('button');b.className='primary';b.textContent='ارسال';
      b.onclick=async()=>{
        if(!current){alert('اول یک گفتگو را باز کن');return}
        if(!m.text&&!m.media_id){alert('این ذخیره قابل ارسال نیست');return}
        try{
          const d=await api('/api/send',{method:'POST',body:JSON.stringify({sender_id:me.id,receiver_id:current.id,text:m.text||'',media_id:m.media_id||null})});
          box.classList.add('hidden');
          if(d.message){
            $('#messages').querySelector('.empty-list')?.remove();
            if(!Array.from($('#messages').children).some(n=>n.dataset.messageId===d.message.id))$('#messages').append(bubble(d.message));
            scrollBottom();
          }else{
            await openChat(current);
          }
          loadChats();
        }catch(err){alert(err.message)}
      };
      row.append(t,b);host.append(row);
    });
    if(!host.children.length)host.innerHTML='<div class="empty-list">پیام ذخیره‌شده‌ای نیست</div>';
    box.classList.remove('hidden');
  }catch(err){alert(err.message)}
}
async function openPinned(){if(!current)return;try{const d=await api(`/api/pinned?a=${encodeURIComponent(me.id)}&b=${encodeURIComponent(current.id)}`);alert(d.messages.length?d.messages.map(x=>'📌 '+(x.text||x.media_name||'پیام')).join('\n'):'پیام سنجاق‌شده‌ای نیست')}catch(e){alert(e.message)}}
async function togglePin(m){try{const d=await api('/api/pin',{method:'POST',body:JSON.stringify({id:m.id,requester:me.id,chat_id:pairKey(m.sender_id,m.receiver_id),pinned:!m.pinned})});replaceBubble(d.message)}catch(e){alert(e.message)}}
function pairKey(a,b){return[String(a),String(b)].sort().join(':')}
async function presence(){if(me)api('/api/presence?id='+encodeURIComponent(me.id),{method:'POST'}).catch(()=>{})}
function searchMessages(){if(!current)return;const q=($('#chatSearch')?.value||'').trim();if(!q){$('#searchResults').innerHTML='';return}clearTimeout(chatSearchTimer);chatSearchTimer=setTimeout(async()=>{try{const d=await api(`/api/search-messages?a=${encodeURIComponent(me.id)}&b=${encodeURIComponent(current.id)}&q=${encodeURIComponent(q)}`);$('#searchResults').innerHTML='';if(!d.messages.length){$('#searchResults').innerHTML='<div class="empty-list">چیزی پیدا نشد</div>';return}d.messages.forEach(m=>{const el=document.createElement('button');el.className='search-hit';el.textContent=m.text||'پیام حذف شد';el.onclick=()=>{const n=Array.from($('#messages').children).find(x=>x.dataset.messageId===m.id);n?.scrollIntoView({behavior:'smooth',block:'center'})};$('#searchResults').append(el)})}catch{$('#searchResults').innerHTML='<div class="empty-list">خطا در جستجو</div>'}},180)}
function openProfile(){$('#profileName').value=me.name;$('#profileBio').value=me.bio||'';$('#showBio').checked=me.profile_show_bio!==0;$('#showLastSeen').checked=me.profile_show_last_seen!==0;$('#showAvatar').checked=me.profile_show_avatar!==0;$('#avatarFile').value='';$('#profileErr').textContent='';$('#profileBox').classList.remove('hidden')}
async function imageData(file){if(!file)return null;return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas'),max=256,scale=Math.min(1,max/Math.max(img.width,img.height));c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));c.getContext('2d').drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL('image/jpeg',.78))};img.onerror=reject;img.src=r.result};r.onerror=reject;r.readAsDataURL(file)})}
async function saveProfile(){try{$('#profileErr').textContent='در حال ذخیره…';const avatar=await imageData($('#avatarFile').files[0]);const d=await api('/api/profile',{method:'POST',body:JSON.stringify({id:me.id,name:$('#profileName').value,bio:$('#profileBio').value,...(avatar?{avatar}: {})})});me=d.user;await api('/api/profile-visibility',{method:'POST',body:JSON.stringify({id:me.id,show_bio:$('#showBio').checked,show_last_seen:$('#showLastSeen').checked,show_avatar:$('#showAvatar').checked})});me=(await api('/api/user?id='+encodeURIComponent(me.id))).user;localStorage.setItem('gb_me',JSON.stringify(me));$('#profileBox').classList.add('hidden');enter()}catch(e){$('#profileErr').textContent=e.message}}

let appearance={theme:'dark',primary_color:'#1677ff',chat_background:'default',chat_background_image:null};
function applyAppearance(a){appearance={...appearance,...a};document.documentElement.style.setProperty('--primary',appearance.primary_color||'#1677ff');document.documentElement.dataset.theme=appearance.theme||'dark';document.body.classList.toggle('light-mode',appearance.theme==='light');const chat=$('#chat');if(chat){chat.classList.remove('chat-bg-default','chat-bg-blue','chat-bg-gradient','chat-bg-image');if(appearance.chat_background==='blue')chat.classList.add('chat-bg-blue');else if(appearance.chat_background==='gradient')chat.classList.add('chat-bg-gradient');else if(appearance.chat_background==='image'&&appearance.chat_background_image){chat.classList.add('chat-bg-image');chat.style.backgroundImage=`url(${appearance.chat_background_image})`;}else{chat.classList.add('chat-bg-default');chat.style.backgroundImage='';}}}
async function loadAppearance(){if(!me)return;try{const d=await api('/api/appearance?id='+encodeURIComponent(me.id));appearance=d.appearance||appearance;applyAppearance(appearance);}catch(e){applyAppearance(appearance)}}
function updateSettingsUI(){document.querySelectorAll('[data-theme]').forEach(b=>b.classList.toggle('active',b.dataset.theme===appearance.theme));document.querySelectorAll('.color-dot').forEach(b=>b.classList.toggle('active',b.dataset.color===appearance.primary_color));if($('#customColor'))$('#customColor').value=appearance.primary_color||'#1677ff';document.querySelectorAll('[data-bg]').forEach(b=>b.classList.toggle('active',b.dataset.bg===appearance.chat_background));const p=$('#settingsPreview');if(p){p.style.backgroundImage=appearance.chat_background==='image'&&appearance.chat_background_image?`url(${appearance.chat_background_image})`:'';p.className='settings-preview '+(appearance.chat_background==='blue'?'chat-bg-blue':appearance.chat_background==='gradient'?'chat-bg-gradient':'');}}
function openSettings(){updateSettingsUI();$('#settingsErr').textContent='';$('#settingsBox')?.classList.remove('hidden')}
async function saveSettings(){try{const d=await api('/api/appearance',{method:'POST',body:JSON.stringify({id:me.id,theme:appearance.theme,primary_color:appearance.primary_color,chat_background:appearance.chat_background,chat_background_image:appearance.chat_background_image})});appearance=d.appearance||appearance;applyAppearance(appearance);localStorage.setItem('gb_appearance',JSON.stringify(appearance));$('#settingsBox')?.classList.add('hidden')}catch(e){$('#settingsErr').textContent=e.message}}
async function loadLocalAppearance(){try{const a=JSON.parse(localStorage.getItem('gb_appearance')||'null');if(a)applyAppearance(a)}catch{}}
function setTheme(t){appearance.theme=t;applyAppearance(appearance);updateSettingsUI()}
function setPrimary(c){appearance.primary_color=c;applyAppearance(appearance);updateSettingsUI()}
async function setBgImage(file){if(!file)return;try{const data=await imageDataLarge(file);appearance.chat_background='image';appearance.chat_background_image=data;applyAppearance(appearance);updateSettingsUI()}catch(e){$('#settingsErr').textContent='تصویر آماده نشد'}}
function imageDataLarge(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas'),max=1280,scale=Math.min(1,max/Math.max(img.width,img.height));c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));const ctx=c.getContext('2d');ctx.drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL('image/jpeg',.76))};img.onerror=reject;img.src=r.result};r.onerror=reject;r.readAsDataURL(file)})}


async function enableNotifications(){
  try{if('Notification' in window&&Notification.permission==='default')await Notification.requestPermission()}catch{}
}
function notifyIncoming(m){
  if(m.sender_id===me.id)return;
  if('Notification' in window&&Notification.permission==='granted'&&document.hidden)new Notification('پیام جدید در گوربا بتمن',{body:m.text||'رسانه جدید'});
}
async function globalSearch(){
  const q=($('#globalSearch')?.value||'').trim();const out=$('#globalResults');if(!out||!q)return;
  try{const d=await api('/api/global-search?q='+encodeURIComponent(q));out.innerHTML='';
    (d.users||[]).forEach(u=>{const b=document.createElement('button');b.className='group-person';b.textContent='👤 '+u.name;b.onclick=()=>{openChat(u);$('#adminBox').classList.add('hidden')};out.append(b)});
    (d.messages||[]).forEach(m=>{const b=document.createElement('button');b.className='group-person';b.textContent='💬 '+(m.text||'پیام رسانه‌ای');out.append(b)});
    if(!out.children.length)out.innerHTML='<div class="empty-list">نتیجه‌ای پیدا نشد</div>';
  }catch(e){out.textContent=e.message}
}
async function sendReport(){const text=$('#reportText').value.trim();if(!text)return;try{await api('/api/report',{method:'POST',body:JSON.stringify({user_id:me.id,target_user:current?.id||'',message:text})});$('#reportText').value='';$('#reportErr').textContent='گزارش ارسال شد ✅'}catch(e){$('#reportErr').textContent=e.message}}
function openAdmin(){$('#reportErr').textContent='';$('#adminBox').classList.remove('hidden')}
function setupPeer(){
  callPc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
  callPc.onicecandidate=e=>{if(e.candidate&&ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'call-ice',payload:e.candidate}))};
  callPc.ontrack=e=>{callRemoteStream=e.streams[0];$('#remoteVideo').srcObject=callRemoteStream};
  if(callStream)callStream.getTracks().forEach(t=>callPc.addTrack(t,callStream));
  return callPc;
}
async function startCall(kind){
  if(!current||currentGroup)return alert('تماس فعلاً فقط در گفتگوی خصوصی است');
  try{
    callKind=kind;callStartedByMe=true;callStream=await navigator.mediaDevices.getUserMedia({audio:true,video:kind==='video'});
    $('#localVideo').srcObject=callStream;$('#callTitle').textContent=kind==='video'?'📹 تماس تصویری':'📞 تماس صوتی';$('#callStatus').textContent='در حال برقراری تماس…';$('#callBox').classList.remove('hidden');
    setupPeer();const offer=await callPc.createOffer();await callPc.setLocalDescription(offer);ws?.send(JSON.stringify({type:'call-offer',payload:{sdp:offer,kind}}));
  }catch(e){alert('دسترسی دوربین/میکروفون داده نشد')}
}
async function handleCallOffer(payload){
  if(!current)return;
  try{
    callKind=payload.kind||'audio';callStartedByMe=false;callStream=await navigator.mediaDevices.getUserMedia({audio:true,video:callKind==='video'});
    $('#localVideo').srcObject=callStream;$('#callTitle').textContent=callKind==='video'?'📹 تماس تصویری':'📞 تماس صوتی';$('#callStatus').textContent='تماس ورودی';$('#callBox').classList.remove('hidden');
    setupPeer();await callPc.setRemoteDescription(payload.sdp);const ans=await callPc.createAnswer();await callPc.setLocalDescription(ans);ws?.send(JSON.stringify({type:'call-answer',payload:{sdp:ans}}));
  }catch(e){$('#callStatus').textContent='تماس برقرار نشد'}
}
async function handleCallAnswer(payload){try{if(callPc)await callPc.setRemoteDescription(payload.sdp);$('#callStatus').textContent='تماس وصل شد'}catch{}}
async function handleCallIce(payload){try{if(callPc&&payload)await callPc.addIceCandidate(payload)}catch{}}
function endCall(send=true){if(send)ws?.send(JSON.stringify({type:'call-end'}));callPc?.close();callPc=null;callStream?.getTracks().forEach(t=>t.stop());callStream=null;$('#localVideo').srcObject=null;$('#remoteVideo').srcObject=null;$('#callBox')?.classList.add('hidden');$('#callStatus').textContent=''}
function toggleCallMute(){if(callStream){const t=callStream.getAudioTracks()[0];if(t){t.enabled=!t.enabled;$('#callMute').textContent=t.enabled?'🎤 بی‌صدا':'🔇 صدای من خاموش'}}}
function toggleCallCamera(){if(callStream){const t=callStream.getVideoTracks()[0];if(t){t.enabled=!t.enabled;$('#callCamera').textContent=t.enabled?'📷 دوربین':'🚫 دوربین'}}}
function sendTyping(){typing(true);clearTimeout(typingTimer);typingTimer=setTimeout(()=>typing(false),900)}
const bind=(sel,event,fn)=>{const el=$(sel);if(el)el.addEventListener(event,fn)};
bind('#login','click',login);bind('#name','keydown',e=>{if(e.key==='Enter')login()});bind('#send','click',send);bind('#text','keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}else sendTyping()});bind('#text','blur',()=>typing(false));bind('#logout','click',()=>{if(ws)try{ws.close()}catch{}clearInterval(presenceTimer);clearInterval(peopleTimer);localStorage.removeItem('gb_me');location.reload()});bind('#profileBtn','click',openProfile);bind('#closeProfile','click',()=>$('#profileBox')?.classList.add('hidden'));bind('#saveProfile','click',saveProfile);bind('#mobileOpen','click',()=>$('#side')?.classList.add('open'));bind('#mobileOpen2','click',()=>$('#side')?.classList.add('open'));bind('#mobileClose','click',()=>$('#side')?.classList.remove('open'));
if($('#messages'))$('#messages').addEventListener('scroll',()=>{if($('#messages').scrollTop<80){if(currentGroup)loadOlderGroupMessages();else loadOlderMessages()}});if($('#chatSearch'))$('#chatSearch').oninput=searchMessages;if($('#cancelReply'))$('#cancelReply').onclick=()=>{replyingTo=null;$('#replyBar').classList.add('hidden')};if($('#cancelEdit'))$('#cancelEdit').onclick=()=>{editingId=null;$('#editBar').classList.add('hidden');$('#text').value=''};if($('#closeSearch'))$('#closeSearch').onclick=()=>{$('#searchPanel').classList.add('hidden');$('#chatSearch').value='';$('#searchResults').innerHTML=''};if($('#chatSearchBtn'))$('#chatSearchBtn').onclick=()=>$('#searchPanel').classList.toggle('hidden');
loadLocalAppearance();
bind('#settingsBtn','click',openSettings);bind('#closeSettings','click',()=>$('#settingsBox')?.classList.add('hidden'));bind('#saveSettings','click',saveSettings);document.querySelectorAll('[data-theme]').forEach(b=>b.addEventListener('click',()=>setTheme(b.dataset.theme)));document.querySelectorAll('.color-dot').forEach(b=>b.addEventListener('click',()=>setPrimary(b.dataset.color)));bind('#customColor','input',e=>setPrimary(e.target.value));document.querySelectorAll('[data-bg]').forEach(b=>b.addEventListener('click',()=>{appearance.chat_background=b.dataset.bg;applyAppearance(appearance);updateSettingsUI()}));bind('#chatBgFile','change',e=>setBgImage(e.target.files?.[0]));
bind('#createGroupBtn','click',openCreateGroup);
bind('#closeGroupCreate','click',()=>$('#groupCreateBox')?.classList.add('hidden'));
bind('#createGroupSave','click',createGroup);
bind('#groupInfoBtn','click',openGroupInfo);
bind('#closeGroupInfo','click',()=>$('#groupInfoBox')?.classList.add('hidden'));
bind('#groupAddSave','click',addSelectedGroupMembers);
bind('#groupMuteBtn','click',toggleGroupMute);
bind('#closeAdmin','click',()=>$('#adminBox')?.classList.add('hidden'));bind('#globalSearch','input',globalSearch);bind('#sendReport','click',sendReport);
bind('#voiceCallBtn','click',()=>startCall('audio'));bind('#videoCallBtn','click',()=>startCall('video'));bind('#hangup','click',()=>endCall(true));bind('#closeCall','click',()=>endCall(true));bind('#callMute','click',toggleCallMute);bind('#callCamera','click',toggleCallCamera);
bind('#pinnedBtn','click',openPinned);bind('#savedBtn','click',openSaved);enableNotifications();


if(me){enter();loadAppearance();}

bind('#fileBtn','click',chooseFile);bind('#fileInput','change',e=>{const f=e.target.files?.[0];if(f)showFilePreview(f);e.target.value=''});bind('#galleryBtn','click',openGallery);bind('#closeGallery','click',()=>$('#galleryBox')?.classList.add('hidden'));bind('#voiceBtn','click',toggleVoice);

safeBind('#closeSaved','click',()=>$('#savedBox')?.classList.add('hidden'));
safeBind('#closeAdmin','click',()=>$('#adminBox')?.classList.add('hidden'));
safeBind('#adminBtn','click',adminLogin7);
safeBind('#globalSearchBtn','click',globalSearch7);
(function(){
  const oldAdminBind=document.querySelector('#adminBtn');
  if(oldAdminBind && !oldAdminBind.dataset.complete21){
    oldAdminBind.dataset.complete21='1';
    oldAdminBind.onclick=adminLogin7;
  }
  const add=document.querySelector('#adminWordAdd');
  if(add && !add.dataset.complete21){
    add.dataset.complete21='1';
    add.onclick=async()=>{
      const word=document.querySelector('#adminWord')?.value.trim();
      const warning=document.querySelector('#adminWarning')?.value.trim()||'لطفاً از این کلمه استفاده نکنید.';
      if(!word){alert('کلمه را وارد کن');return}
      try{
        await api('/api/admin-word-add',{method:'POST',headers:{'x-admin-token':window.adminToken||''},body:JSON.stringify({word,warning})});
        document.querySelector('#adminWord').value='';document.querySelector('#adminWarning').value='';
        openAdminPanel7();
      }catch(e){alert(e.message)}
    };
  }
  const close=document.querySelector('#closeSaved');
  if(close) close.onclick=()=>document.querySelector('#savedBox')?.classList.add('hidden');
  const closeAdmin=document.querySelector('#closeAdmin');
  if(closeAdmin) closeAdmin.onclick=()=>document.querySelector('#adminBox')?.classList.add('hidden');
})();
