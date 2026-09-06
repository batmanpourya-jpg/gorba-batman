import { DurableObject } from "cloudflare:workers";

function normalizeName(name) {
  return String(name || "").trim().slice(0, 40);
}

function pairRoomName(a, b) {
  const names = [a, b].map(normalizeName).filter(Boolean).sort((x, y) =>
    x.localeCompare(y, "fa")
  );
  return names.join("::");
}

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sessions = new Set();
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/register" && request.method === "POST") {
      try {
        const body = await request.json();
        const name = normalizeName(body.name);

        if (!name) {
          return Response.json(
            { ok: false, error: "نام وارد نشده" },
            { status: 400 }
          );
        }

        const key = "user:" + name.toLocaleLowerCase("fa-IR");
        await this.ctx.storage.put(key, {
          name,
          createdAt: Date.now()
        });

        return Response.json({ ok: true, name });
      } catch {
        return Response.json(
          { ok: false, error: "درخواست نامعتبر است" },
          { status: 400 }
        );
      }
    }

    if (url.pathname === "/api/search" && request.method === "GET") {
      const q = (url.searchParams.get("q") || "")
        .trim()
        .toLocaleLowerCase("fa-IR");

      if (!q) {
        return Response.json({ ok: true, users: [] });
      }

      const entries = await this.ctx.storage.list({ prefix: "user:" });
      const users = [];

      for (const value of entries.values()) {
        if (
          value?.name &&
          value.name.toLocaleLowerCase("fa-IR").includes(q)
        ) {
          users.push(value.name);
        }
      }

      users.sort((a, b) => a.localeCompare(b, "fa"));
      return Response.json({
        ok: true,
        users: users.slice(0, 20)
      });
    }

    if (url.pathname !== "/ws") {
      return new Response("Not found", { status: 404 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket required", { status: 426 });
    }

    const me = normalizeName(url.searchParams.get("me"));
    const peer = normalizeName(url.searchParams.get("peer"));

    if (!me || !peer || me.toLocaleLowerCase("fa-IR") === peer.toLocaleLowerCase("fa-IR")) {
      return new Response("Two different users are required", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();
    this.sessions.add(server);

    server.addEventListener("message", event => {
      for (const other of this.sessions) {
        try {
          other.send(event.data);
        } catch {}
      }
    });

    const close = () => this.sessions.delete(server);
    server.addEventListener("close", close);
    server.addEventListener("error", close);

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/register" || url.pathname === "/api/search") {
      const id = env.CHAT.idFromName("users");
      return env.CHAT.get(id).fetch(request);
    }

    if (url.pathname === "/ws") {
      const me = normalizeName(url.searchParams.get("me"));
      const peer = normalizeName(url.searchParams.get("peer"));

      if (!me || !peer) {
        return new Response("Missing users", { status: 400 });
      }

      const roomName = pairRoomName(me, peer);
      const id = env.CHAT.idFromName(roomName);
      return env.CHAT.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};