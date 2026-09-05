const $=s=>document.querySelector(s);
let me=null,current=null,ws=null;

function avatar(u){return u.avatar||'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" rx="50" fill="#d9edff"/><text x="50" y="62" text-anchor="middle" font-size="45">👤</text></svg>')}

$('#avatar').onchange=e=>{const f=e.target.files[0];if(f){$('#preview').src=URL.createObjectURL(f);$('#preview').classList.remove('hidden')}};

$('#loginBtn').onclick=async()=>{
 const name=$('#name').value.trim(); if(name.length<2)return alert('نام حداقل ۲ حرف باشد.');
 const fd=new FormData();fd.append('name',name);if($('#avatar').files[0])fd.append('avatar',$('#avatar').files[0]);
 const r=await fetch('/api/login',{method:'POST',body:fd});const d=await r.json();
 if(!r.ok)return alert(d.error||'ورود ناموفق بود');
 me=d.user; localStorage.setItem('gb_user',JSON.stringify(me)); enter();
};

function enter(){
 $('#login').classList.add('hidden');$('#app').classList.remove('hidden');
 $('#me').textContent=me.name; connect(); loadUsers();
}
function connect(){
 ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host);
 ws.onopen=()=>ws.send(JSON.stringify({type:'identify',userId:me.id}));
 ws.onmessage=e=>{const d=JSON.parse(e.data);if(d.type==='message'&&current&&[d.message.senderId,d.message.receiverId].includes(current.id)) addMessage(d.message)}
}
async function loadUsers(q=''){
 const r=await fetch('/api/users?q='+encodeURIComponent(q));const d=await r.json();
 $('#users').innerHTML='';
 d.users.filter(u=>u.id!==me.id).forEach(u=>{
  const el=document.createElement('div');el.className='u'+(current?.id===u.id?' active':'');
  el.innerHTML=`<img src="${avatar(u)}"><div><b>${escape(u.name)}</b><small>شروع گفتگو</small></div>`;
  el.onclick=()=>openChat(u);$('#users').appendChild(el);
 });
 if(!$('#users').children.length)$('#users').innerHTML='<div style="padding:20px;color:#7890a3;text-align:center">کاربری پیدا نشد.</div>';
}
$('#search').oninput=e=>loadUsers(e.target.value.trim());

async function openChat(u){
 current=u;$('#app').classList.add('open');loadUsers($('#search').value.trim());
 $('#head').innerHTML=`<div class="person"><img src="${avatar(u)}"><span>${escape(u.name)}</span></div>`;
 $('#form').classList.remove('hidden');
 const r=await fetch(`/api/messages?a=${me.id}&b=${u.id}`);const d=await r.json();
 $('#messages').innerHTML='';d.messages.forEach(addMessage);scroll();
}
$('#form').onsubmit=e=>{
 e.preventDefault();const text=$('#text').value.trim();
 if(!text||!current||!ws||ws.readyState!==1)return;
 ws.send(JSON.stringify({type:'message',receiverId:current.id,text}));$('#text').value='';
};
function addMessage(m){
 if($('#messages').querySelector('.empty'))$('#messages').innerHTML='';
 const b=document.createElement('div');b.className='bubble '+(m.senderId===me.id?'mine':'theirs');
 b.append(document.createTextNode(m.text));
 const t=document.createElement('span');t.className='time';t.textContent=new Date(m.time).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'});b.append(t);
 $('#messages').appendChild(b);scroll();
}
function scroll(){$('#messages').scrollTop=$('#messages').scrollHeight}
function escape(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}

const saved=localStorage.getItem('gb_user');if(saved){me=JSON.parse(saved);enter()}
