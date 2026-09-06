let ws = null;
let myName = "";
let selectedPeer = "";

const $ = id => document.getElementById(id);

$("join").onclick = async () => {
  myName = $("name").value.trim();

  if (!myName) {
    alert("نامت را وارد کن");
    return;
  }

  try {
    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: myName })
    });

    if (!response.ok) {
      alert("ثبت نام انجام نشد");
      return;
    }

    $("login").classList.add("hidden");
    $("main").classList.remove("hidden");
    $("status").textContent = "آماده";
  } catch {
    alert("اتصال به سرور برقرار نشد");
  }
};

let searchTimer;

$("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchUsers, 250);
});

async function searchUsers() {
  const q = $("search").value.trim();
  const results = $("results");
  results.innerHTML = "";

  if (!q) return;

  try {
    const response = await fetch("/api/search?q=" + encodeURIComponent(q));
    const data = await response.json();

    for (const name of data.users || []) {
      if (name.toLocaleLowerCase("fa-IR") === myName.toLocaleLowerCase("fa-IR")) {
        continue;
      }

      const button = document.createElement("button");
      button.className = "user";
      button.type = "button";
      button.textContent = "👤 " + name;

      button.onclick = () => selectUser(name);

      results.appendChild(button);
    }
  } catch {}
}

function selectUser(name) {
  selectedPeer = name;
  $("peerName").textContent = name;
  $("chatHint").textContent = "چت خصوصی با " + name;
  $("results").innerHTML = "";
  $("search").value = "";
  $("messages").innerHTML = "";

  $("text").disabled = false;
  $("form button").disabled = false;

  connectPrivateChat();
}

function connectPrivateChat() {
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }

  const proto = location.protocol === "https:" ? "wss" : "ws";
  const params = new URLSearchParams({
    me: myName,
    peer: selectedPeer
  });

  ws = new WebSocket(`${proto}://${location.host}/ws?${params.toString()}`);

  $("status").textContent = "در حال اتصال...";

  ws.onopen = () => {
    $("status").textContent = "متصل";
  };

  ws.onclose = () => {
    $("status").textContent = "قطع شد";
  };

  ws.onerror = () => {
    $("status").textContent = "خطا";
  };

  ws.onmessage = event => {
    try {
      const message = JSON.parse(event.data);
      add(message.name, message.text);
    } catch {}
  };
}

$("back").onclick = () => {
  selectedPeer = "";

  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }

  $("peerName").textContent = "یک نفر را انتخاب کن";
  $("chatHint").textContent = "برای شروع، از بالا یک کاربر را انتخاب کن.";
  $("messages").innerHTML = '<div class="empty">برای شروع، یک کاربر را از جستجو انتخاب کن.</div>';
  $("text").disabled = true;
  $("form button").disabled = true;
};

$("form").onsubmit = event => {
  event.preventDefault();

  const text = $("text").value.trim();

  if (
    !text ||
    !selectedPeer ||
    !ws ||
    ws.readyState !== WebSocket.OPEN
  ) {
    return;
  }

  ws.send(JSON.stringify({
    name: myName,
    text,
    to: selectedPeer
  }));

  $("text").value = "";
  $("text").focus();
};

function add(name, text) {
  const d = document.createElement("div");
  d.className = "msg" +
    (name.toLocaleLowerCase("fa-IR") === myName.toLocaleLowerCase("fa-IR") ? " mine" : "");

  const b = document.createElement("b");
  b.textContent = name;

  const span = document.createElement("span");
  span.textContent = text;

  d.appendChild(b);
  d.appendChild(span);
  $("messages").appendChild(d);
  $("messages").scrollTop = $("messages").scrollHeight;
}