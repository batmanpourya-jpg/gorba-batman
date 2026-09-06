let ws;
let myName = "";

const $ = id => document.getElementById(id);

$("join").onclick = async () => {
  myName = $("name").value.trim();

  if (!myName) {
    alert("نامت را وارد کن");
    return;
  }

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

  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => $("status").textContent = "متصل";
  ws.onclose = () => $("status").textContent = "قطع شد";
  ws.onerror = () => $("status").textContent = "خطا";

  ws.onmessage = event => {
    try {
      const m = JSON.parse(event.data);
      add(m.name, m.text);
    } catch {}
  };
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
      const button = document.createElement("button");
      button.className = "user";
      button.type = "button";
      button.textContent = name;
      button.onclick = () => {
        $("search").value = name;
        results.innerHTML = "";
        $("text").focus();
      };
      results.appendChild(button);
    }
  } catch {}
}

$("form").onsubmit = event => {
  event.preventDefault();

  const text = $("text").value.trim();

  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({ name: myName, text }));
  add("من", text);
  $("text").value = "";
  $("text").focus();
};

function add(name, text) {
  const d = document.createElement("div");
  d.className = "msg";

  const b = document.createElement("b");
  b.textContent = name;

  const span = document.createElement("span");
  span.textContent = text;

  d.appendChild(b);
  d.appendChild(span);
  $("messages").appendChild(d);
  $("messages").scrollTop = $("messages").scrollHeight;
}