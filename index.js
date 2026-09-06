import { DurableObject } from "cloudflare:workers";
export class ChatRoom extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.sessions = new Set(); }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/ws") return new Response("Not found", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket required", { status: 426 });
    const pair = new WebSocketPair(), client = pair[0], server = pair[1];
    server.accept(); this.sessions.add(server);
    server.addEventListener("message", event => { for (const other of this.sessions) if (other !== server) { try { other.send(event.data); } catch {} } });
    const close = () => this.sessions.delete(server);
    server.addEventListener("close", close); server.addEventListener("error", close);
    return new Response(null, { status: 101, webSocket: client });
  }
}
export default { async fetch(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/ws") return env.CHAT.get(env.CHAT.idFromName("main")).fetch(request);
  return env.ASSETS.fetch(request);
} };
