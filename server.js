import express from "express";
import multer from "multer";
import { WebSocketServer } from "ws";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const dataDir = path.join(__dirname, "data");
const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const dbFile = path.join(dataDir, "db.json");
let db = fs.existsSync(dbFile)
  ? JSON.parse(fs.readFileSync(dbFile, "utf8"))
  : { users: {}, messages: [] };

function saveDb() {
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

function cleanName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, 30);
}

function publicUser(u) {
  return { id: u.id, name: u.name, avatar: u.avatar || "" };
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(uploadDir));

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, crypto.randomUUID() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

app.post("/api/login", upload.single("avatar"), (req, res) => {
  const name = cleanName(req.body.name);
  if (name.length < 2) return res.status(400).json({ error: "نام باید حداقل ۲ حرف داشته باشد." });

  const id = crypto.randomUUID();
  const avatar = req.file ? `/uploads/${req.file.filename}` : "";
  const user = { id, name, avatar, createdAt: Date.now() };
  db.users[id] = user;
  saveDb();
  res.json({ user: publicUser(user) });
});

app.get("/api/users", (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const users = Object.values(db.users)
    .filter(u => !q || u.name.toLowerCase().includes(q))
    .slice(0, 50)
    .map(publicUser);
  res.json({ users });
});

app.get("/api/messages", (req, res) => {
  const a = String(req.query.a || "");
  const b = String(req.query.b || "");
  if (!a || !b) return res.json({ messages: [] });
  const messages = db.messages.filter(m =>
    (m.senderId === a && m.receiverId === b) ||
    (m.senderId === b && m.receiverId === a)
  ).slice(-100);
  res.json({ messages });
});

function broadcastToUser(userId, payload) {
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.userId === userId) {
      client.send(JSON.stringify(payload));
    }
  }
}

wss.on("connection", ws => {
  ws.on("message", raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "identify") {
        ws.userId = String(msg.userId || "");
        return;
      }
      if (msg.type === "message") {
        const senderId = ws.userId;
        const receiverId = String(msg.receiverId || "");
        const text = String(msg.text || "").trim().slice(0, 2000);
        if (!senderId || !db.users[senderId] || !db.users[receiverId] || !text) return;

        const saved = {
          id: crypto.randomUUID(),
          senderId,
          receiverId,
          type: "text",
          text,
          time: Date.now()
        };
        db.messages.push(saved);
        if (db.messages.length > 5000) db.messages = db.messages.slice(-5000);
        saveDb();

        broadcastToUser(senderId, { type: "message", message: saved });
        broadcastToUser(receiverId, { type: "message", message: saved });
      }
    } catch {}
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Gorba Batman running on port ${PORT}`));
