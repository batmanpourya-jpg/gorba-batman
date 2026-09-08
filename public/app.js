const $ = s => document.querySelector(s);
let me = null, current = null, ws = null, presenceTimer = null, peopleTimer = null, searchTimer = null;
try { me = JSON.parse(localStorage.getItem('gb_me') || 'null'); } catch { localStorage.removeItem('gb_me'); }

async function api(url, opt = {}) {
  const r = await fetch(url, {
    ...opt,
    headers: { ...(opt.body ? { 'content-type': 'application/json' } : {}), ...(opt.headers || {}) }
  });
  const d = await r.json().catch(() => ({ ok: false, error: 'پاسخ نامعتبر' }));
  if (!r.ok || d.ok === false) throw Error(d.error || 'خطا');
  return d;
}

function av(el, u) {
  el.innerHTML = '';
  if (u?.avatar) {
    const img = document.createElement('img');
    img.src = u.avatar;
    img.alt = '';
    el.append(img);
  } else el.textContent = String(u?.name || '?').slice(0, 1);
}

function enter() {
  if (!me) return;
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#myName').textContent = me.name;
  av($('#myAvatar'), me);
  loadChats();
  presence();
  clearInterval(presenceTimer);
  clearInterval(peopleTimer);
  presenceTimer = setInterval(presence, 20000);
  peopleTimer = setInterval(loadChats, 15000);
}

async function login() {
  const name = $('#name').value.trim();
  if (!name) return $('#err').textContent = 'نام را وارد کن';
  $('#err').textContent = 'در حال ورود…';
  try {
    const d = await api('/api/login', { method: 'POST', body: JSON.stringify({ name }) });
    me = d.user;
    localStorage.setItem('gb_me', JSON.stringify(me));
    enter();
  } catch (e) { $('#err').textContent = e.message; }
}

function person(u) {
  const el = document.createElement('div');
  el.className = 'person';
  const a = document.createElement('div'); a.className = 'avatar'; av(a, u);
  const box = document.createElement('div'); box.className = 'grow';
  const b = document.createElement('b'); b.textContent = u.name;
  const s = document.createElement('small');
  s.innerHTML = `<span class="dot ${u.online ? 'on' : ''}"></span>${u.online ? 'آنلاین' : 'آفلاین'} · شروع گفتگو`;
  box.append(b, s); el.append(a, box); el.onclick = () => openChat(u);
  return el;
}

$('#search').oninput = () => {
  clearTimeout(searchTimer);
  const q = $('#search').value.trim();
  if (!q) { $('#results').innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    try {
      const d = await api('/api/search?q=' + encodeURIComponent(q));
      $('#results').innerHTML = '';
      const users = d.users.filter(u => u.id !== me.id);
      if (!users.length) { $('#results').innerHTML = '<div class="empty-list">کسی پیدا نشد</div>'; return; }
      users.forEach(u => $('#results').append(person(u)));
    } catch { $('#results').innerHTML = '<div class="empty-list">خطا در جستجو</div>'; }
  }, 180);
};

function chatItem(c) {
  const el = document.createElement('div');
  el.className = 'chatitem' + (current?.id === c.user.id ? ' selected' : '');
  const a = document.createElement('div'); a.className = 'avatar'; av(a, c.user);
  const box = document.createElement('div'); box.className = 'grow';
  const b = document.createElement('b'); b.textContent = c.user.name;
  const s = document.createElement('small');
  const preview = c.last_message || 'هنوز پیامی نیست · برای شروع لمس کن';
  s.innerHTML = `<span class="dot ${c.user.online ? 'on' : ''}"></span>${escapeHtml(preview)}${c.last_message_at ? ' · ' + new Date(c.last_message_at).toLocaleTimeString('fa-IR', {hour:'2-digit', minute:'2-digit'}) : ''}`;
  box.append(b, s); el.append(a, box);
  if (c.unread > 0) {
    const n = document.createElement('span'); n.className = 'unread'; n.textContent = c.unread > 99 ? '99+' : c.unread; el.append(n);
  }
  el.onclick = () => openChat(c.user);
  return el;
}

function escapeHtml(v) {
  const d = document.createElement('div'); d.textContent = String(v); return d.innerHTML;
}

async function loadChats() {
  if (!me) return;
  try {
    const d = await api('/api/conversations?id=' + encodeURIComponent(me.id));
    $('#chats').innerHTML = '';
    if (!d.conversations.length) {
      $('#chats').innerHTML = '<div class="empty-list">هنوز کسی وارد گوربا بتمن نشده.</div>';
      return;
    }
    // Every registered person is shown here automatically. Search is optional.
    d.conversations.forEach(c => $('#chats').append(chatItem(c)));
  } catch (e) {
    $('#chats').innerHTML = '<div class="empty-list">خطا در بارگذاری گفتگوها</div>';
  }
}

function bubble(m) {
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap ' + (m.sender_id === me.id ? 'mine-wrap' : 'theirs-wrap');
  wrap.dataset.messageId = m.id;
  const d = document.createElement('div');
  d.className = 'bubble ' + (m.sender_id === me.id ? 'mine' : 'theirs') + (m.deleted ? ' deleted' : '');
  d.textContent = m.deleted ? 'پیام حذف شد' : m.text;
  d.title = new Date(m.created_at).toLocaleString('fa-IR');
  if (m.sender_id === me.id && !m.deleted) {
    d.onclick = () => { if (confirm('این پیام حذف شود؟')) deleteMessage(m); };
  }
  const t = document.createElement('div'); t.className = 'time';
  t.textContent = new Date(m.created_at).toLocaleTimeString('fa-IR', {hour:'2-digit', minute:'2-digit'});
  wrap.append(d, t); return wrap;
}

function renderDeleted(id) {
  const node = [...$('#messages').children()].find(n => n.dataset.messageId === id);
  if (!node) return;
  const b = node.querySelector('.bubble');
  if (b) { b.textContent = 'پیام حذف شد'; b.classList.add('deleted'); b.onclick = null; }
}

async function openChat(u) {
  if (!u || u.id === me.id) return;
  current = u;
  $('#side').classList.remove('open');
  $('#empty').classList.add('hidden');
  $('#chat').classList.remove('hidden');
  av($('#chatAvatar'), u);
  $('#chatName').textContent = u.name;
  setStatus(u);
  $('#messages').innerHTML = '<div class="empty-list">در حال باز کردن گفتگو…</div>';
  if (ws) { try { ws.close(); } catch {} ws = null; }

  try {
    await api('/api/conversation', { method: 'POST', body: JSON.stringify({ me: me.id, other: u.id }) });
    const d = await api(`/api/history?a=${encodeURIComponent(me.id)}&b=${encodeURIComponent(u.id)}`);
    $('#messages').innerHTML = '';
    if (!d.messages.length) $('#messages').innerHTML = '<div class="empty-list">اولین پیام را تو بفرست 👋</div>';
    d.messages.forEach(m => $('#messages').append(bubble(m)));
    scrollBottom();
    await api('/api/read', { method:'POST', body: JSON.stringify({me:me.id, other:u.id}) });
    loadChats();

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/api/ws?a=${encodeURIComponent(me.id)}&b=${encodeURIComponent(u.id)}`);
    ws.onopen = () => setStatus(current);
    ws.onmessage = e => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === 'message') {
          const m = d.message;
          const belongs = current && ((m.sender_id === me.id && m.receiver_id === current.id) || (m.receiver_id === me.id && m.sender_id === current.id));
          if (belongs) {
            const empty = $('#messages').querySelector('.empty-list'); if (empty) empty.remove();
            // Avoid duplicate delivery to a tab that already rendered the message.
            if (!document.querySelector(`[data-message-id="${CSS.escape(m.id)}"]`)) $('#messages').append(bubble(m));
            scrollBottom();
            if (m.receiver_id === me.id) api('/api/read', {method:'POST', body:JSON.stringify({me:me.id,other:current.id})}).catch(()=>{});
          }
          loadChats();
        }
        if (d.type === 'deleted') { renderDeleted(d.id); loadChats(); }
      } catch {}
    };
    ws.onclose = () => {};
  } catch (e) {
    $('#messages').innerHTML = `<div class="empty-list">${escapeHtml(e.message)}</div>`;
  }
}

function setStatus(u) {
  $('#chatStatus').innerHTML = `<span class="dot ${u.online ? 'on' : ''}"></span>${u.online ? 'آنلاین' : 'آفلاین'}`;
}

function scrollBottom() { const m = $('#messages'); m.scrollTop = m.scrollHeight; }

async function send() {
  if (!current) return;
  const text = $('#text').value.trim();
  if (!text) return;
  $('#text').value = '';
  try {
    const d = await api('/api/send', { method:'POST', body:JSON.stringify({sender_id:me.id,receiver_id:current.id,text}) });
    // If the WebSocket is not connected, HTTP response keeps this tab usable.
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      const empty = $('#messages').querySelector('.empty-list'); if (empty) empty.remove();
      $('#messages').append(bubble(d.message)); scrollBottom();
    }
    loadChats();
  } catch (e) { $('#text').value = text; alert(e.message); }
}

async function deleteMessage(m) {
  try {
    await api('/api/delete', { method:'POST', body:JSON.stringify({id:m.id,requester:me.id,chat_id:pairKey(m.sender_id,m.receiver_id)}) });
    renderDeleted(m.id); loadChats();
  } catch (e) { alert(e.message); }
}

function pairKey(a,b) { return [String(a),String(b)].sort().join(':'); }
async function presence() { if (me) api('/api/presence?id=' + encodeURIComponent(me.id), {method:'POST'}).catch(()=>{}); }

function openProfile() {
  $('#profileName').value = me.name;
  $('#profileBio').value = me.bio || '';
  $('#avatarFile').value = '';
  $('#profileErr').textContent = '';
  $('#profileBox').classList.remove('hidden');
}

async function imageData(file) {
  if (!file) return null;
  return new Promise((resolve,reject)=>{
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'), max = 256;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        c.getContext('2d').drawImage(img,0,0,c.width,c.height);
        resolve(c.toDataURL('image/jpeg', .78));
      };
      img.onerror = reject; img.src = r.result;
    };
    r.onerror = reject; r.readAsDataURL(file);
  });
}

async function saveProfile() {
  try {
    $('#profileErr').textContent = 'در حال ذخیره…';
    const avatar = await imageData($('#avatarFile').files[0]);
    const d = await api('/api/profile', {method:'POST', body:JSON.stringify({
      id:me.id, name:$('#profileName').value, bio:$('#profileBio').value, ...(avatar ? {avatar} : {})
    })});
    me = d.user; localStorage.setItem('gb_me', JSON.stringify(me));
    $('#profileBox').classList.add('hidden'); enter();
  } catch (e) { $('#profileErr').textContent = e.message; }
}

$('#login').onclick = login;
$('#name').onkeydown = e => { if (e.key === 'Enter') login(); };
$('#send').onclick = send;
$('#text').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
$('#logout').onclick = () => { if (ws) try { ws.close(); } catch {} clearInterval(presenceTimer); clearInterval(peopleTimer); localStorage.removeItem('gb_me'); location.reload(); };
$('#profileBtn').onclick = openProfile;
$('#closeProfile').onclick = () => $('#profileBox').classList.add('hidden');
$('#saveProfile').onclick = saveProfile;
$('#mobileOpen').onclick = () => $('#side').classList.add('open');
$('#mobileOpen2').onclick = () => $('#side').classList.add('open');
$('#mobileClose').onclick = () => $('#side').classList.remove('open');

if (me) enter();
