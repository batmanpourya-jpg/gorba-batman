import { DurableObject } from "cloudflare:workers";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const clean = v => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
const cleanMsg = v => String(v ?? "").replace(/\u0000/g, "").trim().slice(0, 4000);
const uid = () => crypto.randomUUID();
const pairKey = (a, b) => [String(a), String(b)].sort().join(":");
const isOnline = ts => Number(ts || 0) > Date.now() - 45000;

const ADMIN_PASSWORD_HASH="b4edb28913277058d91fb8a5f0f440b20c2c00a4e6a7538176f2fb901362d97a";
export class Directory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    // IMPORTANT: this runs before any request is processed. Older deployments
    // already have a users table, so CREATE TABLE IF NOT EXISTS alone is not
    // enough: we must upgrade the existing schema safely.
    ctx.blockConcurrencyWhile(async () => {
      this.migrate();
    });
  }

  migrate() {
    const sql = this.ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      avatar TEXT,
      cover TEXT,
      bio TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0,
      last_seen INTEGER NOT NULL DEFAULT 0
    );`);
    sql.exec(`CREATE TABLE IF NOT EXISTS moderation_words(
      id TEXT PRIMARY KEY, word TEXT NOT NULL UNIQUE,
      warning TEXT NOT NULL DEFAULT 'لطفاً از این کلمه استفاده نکنید.',
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT 0
    );`);
    sql.exec(`CREATE TABLE IF NOT EXISTS admin_actions(
      id TEXT PRIMARY KEY, action TEXT NOT NULL, target_user TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0
    );`);
    sql.exec(`CREATE TABLE IF NOT EXISTS conversations(
      pair_key TEXT PRIMARY KEY,
      user_a TEXT NOT NULL,
      user_b TEXT NOT NULL,
      last_message TEXT NOT NULL DEFAULT '',
      last_message_at INTEGER NOT NULL DEFAULT 0,
      unread_a INTEGER NOT NULL DEFAULT 0,
      unread_b INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );`);

    sql.exec(`CREATE TABLE IF NOT EXISTS saved_messages(
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, message_id TEXT NOT NULL,
      chat_key TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', media_id TEXT,
      created_at INTEGER NOT NULL DEFAULT 0
    );`);
    sql.exec(`CREATE TABLE IF NOT EXISTS global_message_index(
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL, sender_id TEXT NOT NULL,
      receiver_id TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0
    );`);
    sql.exec("CREATE INDEX IF NOT EXISTS idx_global_msg_text ON global_message_index(text);");
    sql.exec(`CREATE TABLE IF NOT EXISTS reports(
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      message TEXT NOT NULL,
      target_user TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      resolution TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );`);
    sql.exec(`CREATE TABLE IF NOT EXISTS groups(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      photo TEXT,
      creator_id TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0
    );`);
    sql.exec(`CREATE TABLE IF NOT EXISTS group_members(
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      muted INTEGER NOT NULL DEFAULT 0,
      joined_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(group_id,user_id)
    );`);
    sql.exec("CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);");

    // Upgrade tables created by older Gorba Batman builds. Cloudflare
    // recommends doing schema initialization/migrations before requests.
    this.ensureColumn('users', 'avatar', 'TEXT');
    this.ensureColumn('users', 'cover', 'TEXT');
    this.ensureColumn('users', 'bio', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('users', 'created_at', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('users', 'last_seen', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('users', 'theme', "TEXT NOT NULL DEFAULT 'dark'");
    this.ensureColumn('users', 'primary_color', "TEXT NOT NULL DEFAULT '#1677ff'");
    this.ensureColumn('users', 'chat_background', "TEXT NOT NULL DEFAULT 'default'");
    this.ensureColumn('users', 'chat_background_image', 'TEXT');
    this.ensureColumn('users', 'profile_show_bio', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureColumn('users', 'profile_show_last_seen', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureColumn('users', 'profile_show_avatar', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureColumn('moderation_words', 'active', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureColumn('reports', 'target_user', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('reports', 'status', "TEXT NOT NULL DEFAULT 'new'");
    this.ensureColumn('reports', 'resolution', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('reports', 'updated_at', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('reports', 'message_id', "TEXT NOT NULL DEFAULT ''");

    this.ensureColumn('conversations', 'last_message', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('conversations', 'last_message_at', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('conversations', 'unread_a', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('conversations', 'unread_b', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('conversations', 'updated_at', 'INTEGER NOT NULL DEFAULT 0');

    sql.exec(`CREATE INDEX IF NOT EXISTS idx_users_name ON users(name COLLATE NOCASE);`);
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_user_a ON conversations(user_a);`);
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_user_b ON conversations(user_b);`);
  }

  ensureColumn(table, column, definition) {
    const rows = this.ctx.storage.sql.exec(`PRAGMA table_info(${table})`).toArray();
    if (!rows.some(r => r.name === column)) {
      this.ctx.storage.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  user(id) {
    const rows = this.ctx.storage.sql.exec(
      "SELECT id,name,avatar,cover,bio,created_at,last_seen,theme,primary_color,chat_background,chat_background_image,profile_show_bio,profile_show_last_seen,profile_show_avatar FROM users WHERE id=? LIMIT 1", id
    ).toArray();
    return rows[0] || null;
  }

  byName(name) {
    const rows = this.ctx.storage.sql.exec(
      "SELECT id,name,avatar,cover,bio,created_at,last_seen,theme,primary_color,chat_background,chat_background_image,profile_show_bio,profile_show_last_seen,profile_show_avatar FROM users WHERE name=? LIMIT 1", name
    ).toArray();
    return rows[0] || null;
  }

  conversation(a, b) {
    const rows = this.ctx.storage.sql.exec(
      "SELECT * FROM conversations WHERE pair_key=? LIMIT 1", pairKey(a, b)
    ).toArray();
    return rows[0] || null;
  }

  decorate(user) {
    return user ? { ...user, online: isOnline(user.last_seen) } : null;
  }

  allPeople(me) {
    const rows = this.ctx.storage.sql.exec(
      "SELECT id,name,avatar,cover,bio,created_at,last_seen,theme,primary_color,chat_background,chat_background_image,profile_show_bio,profile_show_last_seen,profile_show_avatar FROM users WHERE id<>? ORDER BY name COLLATE NOCASE ASC LIMIT 200", me
    ).toArray();
    return rows.map(u => this.decorate(u));
  }

  groupData(groupId,userId){
    const g=this.ctx.storage.sql.exec("SELECT * FROM groups WHERE id=? LIMIT 1",groupId).toArray()[0];
    if(!g) return null;
    const me=this.ctx.storage.sql.exec("SELECT role,muted FROM group_members WHERE group_id=? AND user_id=? LIMIT 1",groupId,userId).toArray()[0];
    if(!me) return null;
    const count=this.ctx.storage.sql.exec("SELECT COUNT(*) AS n FROM group_members WHERE group_id=?",groupId).toArray()[0]?.n||0;
    return {...g,member_count:Number(count),me_role:me.role,muted:!!me.muted};
  }

  async fetch(req) {
    const url = new URL(req.url);
    try {
      if (req.method === "POST" && url.pathname === "/login") {
        const body = await req.json();
        const name = clean(body.name);
        if (!name) return json({ ok: false, error: "نام را وارد کنید" }, 400);

        let user = this.byName(name);
        if (!user) {
          const now = Date.now();
          const id = uid();
          this.ctx.storage.sql.exec(
            "INSERT INTO users(id,name,avatar,cover,bio,created_at,last_seen,theme,primary_color,chat_background,chat_background_image) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            id, name, null, null, "", now, now, 'dark', '#1677ff', 'default', null
          );
          user = this.user(id);
        } else {
          this.ctx.storage.sql.exec("UPDATE users SET last_seen=? WHERE id=?", Date.now(), user.id);
          user = this.user(user.id);
        }
        return json({ ok: true, user: this.decorate(user) });
      }

      if (req.method === "POST" && url.pathname === "/presence") {
        const id = url.searchParams.get("id") || "";
        if (!this.user(id)) return json({ ok: false, error: "کاربر پیدا نشد" }, 404);
        this.ctx.storage.sql.exec("UPDATE users SET last_seen=? WHERE id=?", Date.now(), id);
        return json({ ok: true });
      }

      if (req.method === "GET" && url.pathname === "/user") {
        const user = this.user(url.searchParams.get("id") || "");
        return user ? json({ ok: true, user: this.decorate(user) }) : json({ ok: false, error: "کاربر پیدا نشد" }, 404);
      }

      if (req.method === "GET" && url.pathname === "/search") {
        const q = clean(url.searchParams.get("q"));
        if (!q) return json({ ok: true, users: [] });
        const like = "%" + q.replace(/[\\%_]/g, m => "\\" + m) + "%";
        const rows = this.ctx.storage.sql.exec(
          "SELECT id,name,avatar,cover,bio,created_at,last_seen,theme,primary_color,chat_background,chat_background_image,profile_show_bio,profile_show_last_seen,profile_show_avatar FROM users WHERE name LIKE ? ESCAPE '\\\\' ORDER BY name COLLATE NOCASE LIMIT 30",
          like
        ).toArray();
        return json({ ok: true, users: rows.map(u => this.decorate(u)) });
      }

      if (req.method === "POST" && url.pathname === "/profile") {
        const body = await req.json();
        const old = this.user(body.id);
        if (!old) return json({ ok: false, error: "حساب پیدا نشد" }, 404);
        const name = body.name === undefined ? old.name : clean(body.name);
        if (!name) return json({ ok: false, error: "نام نمی‌تواند خالی باشد" }, 400);
        const same = this.byName(name);
        if (same && same.id !== old.id) return json({ ok: false, error: "این نام قبلاً استفاده شده است" }, 409);
        this.ctx.storage.sql.exec(
          "UPDATE users SET name=?,avatar=?,cover=?,bio=? WHERE id=?",
          name,
          body.avatar === undefined ? old.avatar : body.avatar,
          body.cover === undefined ? old.cover : body.cover,
          String(body.bio === undefined ? old.bio : body.bio).slice(0, 160),
          old.id
        );
        return json({ ok: true, user: this.decorate(this.user(old.id)) });
      }

      if (req.method === "GET" && url.pathname === "/appearance") {
        const id = url.searchParams.get("id") || "";
        const user = this.user(id);
        if (!user) return json({ ok: false, error: "حساب پیدا نشد" }, 404);
        return json({ ok: true, appearance: {
          theme: user.theme || "dark",
          primary_color: user.primary_color || "#1677ff",
          chat_background: user.chat_background || "default",
          chat_background_image: user.chat_background_image || null
        }});
      }

      if (req.method === "POST" && url.pathname === "/appearance") {
        const body = await req.json();
        const id = String(body.id || "");
        const old = this.user(id);
        if (!old) return json({ ok: false, error: "حساب پیدا نشد" }, 404);
        const allowedThemes = new Set(["dark","light"]);
        const allowedBackgrounds = new Set(["default","blue","gradient","image"]);
        const theme = allowedThemes.has(String(body.theme)) ? String(body.theme) : (old.theme || "dark");
        const color = /^#[0-9a-fA-F]{6}$/.test(String(body.primary_color || "")) ? String(body.primary_color) : (old.primary_color || "#1677ff");
        const background = allowedBackgrounds.has(String(body.chat_background)) ? String(body.chat_background) : (old.chat_background || "default");
        let image = body.chat_background_image === undefined ? (old.chat_background_image || null) : body.chat_background_image;
        if (image && String(image).length > 1800000) return json({ ok:false, error:"تصویر پس‌زمینه خیلی بزرگ است" },413);
        if (image !== null && image !== undefined && !String(image).startsWith("data:image/")) image = null;
        this.ctx.storage.sql.exec(
          "UPDATE users SET theme=?,primary_color=?,chat_background=?,chat_background_image=? WHERE id=?",
          theme, color, background, image, id
        );
        const u = this.user(id);
        return json({ ok:true, appearance:{theme:u.theme,primary_color:u.primary_color,chat_background:u.chat_background,chat_background_image:u.chat_background_image} });
      }


      if (req.method === "POST" && url.pathname === "/group-create") {
        const body = await req.json();
        const creator = String(body.creator_id || "");
        const name = clean(String(body.name || "")).slice(0, 80);
        if (!creator || !this.user(creator)) return json({ok:false,error:"کاربر سازنده پیدا نشد"},404);
        if (!name) return json({ok:false,error:"نام گروه را وارد کنید"},400);
        let photo = body.photo ? String(body.photo) : null;
        if (photo && (!photo.startsWith("data:image/") || photo.length > 1800000)) photo = null;
        const id = uid(), now = Date.now();
        this.ctx.storage.sql.exec("INSERT INTO groups(id,name,photo,creator_id,created_at) VALUES(?,?,?,?,?)", id,name,photo,creator,now);
        this.ctx.storage.sql.exec("INSERT INTO group_members(group_id,user_id,role,muted,joined_at) VALUES(?,?,?,?,?)", id,creator,"owner",0,now);
        const members = Array.isArray(body.members) ? body.members : [];
        for (const userId of members.slice(0,100)) {
          const u=String(userId||"");
          if (!u || u===creator || !this.user(u)) continue;
          this.ctx.storage.sql.exec("INSERT OR IGNORE INTO group_members(group_id,user_id,role,muted,joined_at) VALUES(?,?,?,?,?)",id,u,"member",0,now);
        }
        return json({ok:true,group:this.groupData(id,creator)});
      }

      if (req.method === "GET" && url.pathname === "/groups") {
        const userId = String(url.searchParams.get("id") || "");
        if (!userId || !this.user(userId)) return json({ok:false,error:"شناسه نامعتبر"},400);
        const rows=this.ctx.storage.sql.exec(
          `SELECT g.id,g.name,g.photo,g.creator_id,g.created_at,
                  gm.role,gm.muted,
                  (SELECT COUNT(*) FROM group_members x WHERE x.group_id=g.id) AS member_count
           FROM groups g JOIN group_members gm ON gm.group_id=g.id
           WHERE gm.user_id=? ORDER BY g.created_at DESC`,userId
        ).toArray();
        return json({ok:true,groups:rows});
      }

      if (req.method === "GET" && url.pathname === "/group") {
        const gid=String(url.searchParams.get("id")||""), uid2=String(url.searchParams.get("user")||"");
        if(!gid||!uid2) return json({ok:false,error:"گروه نامعتبر"},400);
        const g=this.groupData(gid,uid2);
        return g ? json({ok:true,group:g}) : json({ok:false,error:"گروه پیدا نشد یا عضو نیست"},404);
      }

      if (req.method === "POST" && url.pathname === "/group-add") {
        const body=await req.json(), gid=String(body.group_id||""), actor=String(body.actor_id||"");
        const target=String(body.user_id||"");
        const g=this.groupData(gid,actor);
        if(!g) return json({ok:false,error:"گروه پیدا نشد یا دسترسی ندارید"},404);
        if(!["owner","admin"].includes(g.me_role)) return json({ok:false,error:"فقط مدیر گروه می‌تواند عضو اضافه کند"},403);
        if(!this.user(target)) return json({ok:false,error:"کاربر پیدا نشد"},404);
        this.ctx.storage.sql.exec("INSERT OR IGNORE INTO group_members(group_id,user_id,role,muted,joined_at) VALUES(?,?,?,?,?)",gid,target,"member",0,Date.now());
        return json({ok:true,group:this.groupData(gid,actor)});
      }

      if (req.method === "POST" && url.pathname === "/group-promote") {
        const body=await req.json(), gid=String(body.group_id||""), actor=String(body.actor_id||""), target=String(body.user_id||"");
        const g=this.groupData(gid,actor);
        if(!g) return json({ok:false,error:"گروه پیدا نشد"},404);
        if(g.me_role!=="owner") return json({ok:false,error:"فقط سازنده گروه می‌تواند مدیر تعیین کند"},403);
        const member=this.ctx.storage.sql.exec("SELECT * FROM group_members WHERE group_id=? AND user_id=? LIMIT 1",gid,target).toArray()[0];
        if(!member) return json({ok:false,error:"این کاربر عضو گروه نیست"},404);
        const role=member.role==="admin"?"member":"admin";
        this.ctx.storage.sql.exec("UPDATE group_members SET role=? WHERE group_id=? AND user_id=?",role,gid,target);
        return json({ok:true,role});
      }

      if (req.method === "POST" && url.pathname === "/group-mute") {
        const body=await req.json(), gid=String(body.group_id||""), userId=String(body.user_id||"");
        const member=this.ctx.storage.sql.exec("SELECT * FROM group_members WHERE group_id=? AND user_id=? LIMIT 1",gid,userId).toArray()[0];
        if(!member) return json({ok:false,error:"عضو گروه نیست"},404);
        const muted=body.muted?1:0;
        this.ctx.storage.sql.exec("UPDATE group_members SET muted=? WHERE group_id=? AND user_id=?",muted,gid,userId);
        return json({ok:true,muted:!!muted});
      }

      if (req.method === "GET" && url.pathname === "/group-members") {
        const gid=String(url.searchParams.get("id")||""), actor=String(url.searchParams.get("user")||"");
        const g=this.groupData(gid,actor);
        if(!g) return json({ok:false,error:"گروه پیدا نشد یا عضو نیست"},404);
        const rows=this.ctx.storage.sql.exec(
          `SELECT u.id,u.name,u.avatar,u.bio,gm.role,gm.muted
           FROM group_members gm JOIN users u ON u.id=gm.user_id
           WHERE gm.group_id=? ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,u.name COLLATE NOCASE`,gid
        ).toArray();
        return json({ok:true,members:rows});
      }


      if (req.method === "GET" && url.pathname === "/global-search") {
        const q=clean(url.searchParams.get("q")||"").trim();
        if(!q) return json({ok:true,users:[],messages:[]});
        const like="%"+q.replace(/[%_]/g,m=>"\\"+m)+"%";
        const users=this.ctx.storage.sql.exec("SELECT id,name,avatar,bio,last_seen FROM users WHERE name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT 30",like).toArray().map(u=>this.decorate(u));
        const messages=this.ctx.storage.sql.exec("SELECT * FROM global_message_index WHERE text LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 50",like).toArray();
        return json({ok:true,users,messages});
      }
      if (req.method === "POST" && url.pathname === "/index-message") {
        const b=await req.json(); if(!b.id||!b.sender_id||!b.receiver_id)return json({ok:false,error:"پیام نامعتبر"},400);
        this.ctx.storage.sql.exec("INSERT OR REPLACE INTO global_message_index(id,message_id,sender_id,receiver_id,text,created_at) VALUES(?,?,?,?,?,?)",
          uid(),String(b.id),String(b.sender_id),String(b.receiver_id),cleanMsg(String(b.text||"")),Number(b.created_at||Date.now()));
        return json({ok:true});
      }
      if (req.method === "POST" && url.pathname === "/save-message") {
        const b=await req.json(), uid2=String(b.user_id||"");
        if(!uid2||!this.user(uid2))return json({ok:false,error:"کاربر نامعتبر"},400);
        const id=uid(); this.ctx.storage.sql.exec("INSERT INTO saved_messages(id,user_id,message_id,chat_key,text,media_id,created_at) VALUES(?,?,?,?,?,?,?)",
          id,uid2,String(b.message_id||""),String(b.chat_key||""),cleanMsg(String(b.text||"")),b.media_id?String(b.media_id):null,Date.now());
        return json({ok:true});
      }
      if (req.method === "GET" && url.pathname === "/saved-messages") {
        const uid2=String(url.searchParams.get("user_id")||"");
        const rows=this.ctx.storage.sql.exec("SELECT * FROM saved_messages WHERE user_id=? ORDER BY created_at DESC LIMIT 200",uid2).toArray();
        return json({ok:true,messages:rows});
      }
      if (req.method === "POST" && url.pathname === "/report") {
        const b=await req.json();
        const uid2=String(b.user_id||"");
        const target=String(b.target_user||"");
        const message=cleanMsg(String(b.message||"")).slice(0,2000);
        const messageId=String(b.message_id||"");
        if(!uid2||!message)return json({ok:false,error:"گزارش خالی است"},400);
        this.ctx.storage.sql.exec(
          "INSERT INTO reports(id,user_id,message,target_user,message_id,status,resolution,updated_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
          uid(),uid2,message,target,messageId,"new","",0,Date.now()
        );
        return json({ok:true});
      }
      if (req.method === "POST" && url.pathname === "/profile-visibility") {
        const b=await req.json(), uid2=String(b.id||"");
        if(!this.user(uid2))return json({ok:false,error:"کاربر پیدا نشد"},404);
        this.ctx.storage.sql.exec("UPDATE users SET profile_show_bio=?,profile_show_last_seen=?,profile_show_avatar=? WHERE id=?",
          b.show_bio?1:0,b.show_last_seen?1:0,b.show_avatar?1:0,uid2);
        return json({ok:true,user:this.decorate(this.user(uid2))});
      }
      if(req.method==="POST" && url.pathname==="/admin-login"){
        const b=await req.json();
        const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(b.password||"")));
        const got=Array.from(new Uint8Array(h)).map(x=>x.toString(16).padStart(2,"0")).join("");
        if(got!==ADMIN_PASSWORD_HASH)return json({ok:false,error:"رمز مدیریت اشتباه است"},401);
        const hour=Math.floor(Date.now()/3600000);
        const th=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(ADMIN_PASSWORD_HASH+":"+hour));
        const token=Array.from(new Uint8Array(th)).map(x=>x.toString(16).padStart(2,"0")).join("");
        return json({ok:true,token});
      }
      if(req.url && !url.pathname.startsWith("/admin-login")){
        const adminPaths=["/admin-words","/admin-word-add","/admin-word-delete","/admin-word-toggle","/admin-users","/admin-actions","/admin-reports","/admin-report-update","/admin-stats"];
        if(adminPaths.includes(url.pathname)){
          const token=req.headers.get("x-admin-token")||"";
          const hour=Math.floor(Date.now()/3600000);
          let ok=false;
          for(const h of [hour,hour-1]){
            const th=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(ADMIN_PASSWORD_HASH+":"+h));
            const expected=Array.from(new Uint8Array(th)).map(x=>x.toString(16).padStart(2,"0")).join("");
            if(token===expected){ok=true;break}
          }
          if(!ok)return json({ok:false,error:"دسترسی مدیریت منقضی شده است"},401);
        }
      }
      if(req.method==="GET" && url.pathname==="/admin-stats"){
        const users=this.ctx.storage.sql.exec("SELECT COUNT(*) c FROM users").toArray()[0]?.c||0;
        const online=this.ctx.storage.sql.exec("SELECT COUNT(*) c FROM users WHERE last_seen>?",Date.now()-45000).toArray()[0]?.c||0;
        const reports=this.ctx.storage.sql.exec("SELECT COUNT(*) c FROM reports WHERE status<>'closed'").toArray()[0]?.c||0;
        const words=this.ctx.storage.sql.exec("SELECT COUNT(*) c FROM moderation_words WHERE active=1").toArray()[0]?.c||0;
        return json({ok:true,stats:{users,online,reports,words}});
      }
      if(req.method==="GET" && url.pathname==="/admin-words"){
        return json({ok:true,words:this.ctx.storage.sql.exec("SELECT * FROM moderation_words ORDER BY created_at DESC").toArray()});
      }
      if(req.method==="POST" && url.pathname==="/admin-word-add"){
        const b=await req.json(),w=String(b.word||"").trim(),warning=String(b.warning||"لطفاً از این کلمه استفاده نکنید.").trim();
        if(!w)return json({ok:false,error:"کلمه خالی است"},400);
        this.ctx.storage.sql.exec("INSERT OR IGNORE INTO moderation_words(id,word,warning,active,created_at) VALUES(?,?,?,?,?)",uid(),w,warning,b.active===false?0:1,Date.now());
        this.ctx.storage.sql.exec("INSERT INTO admin_actions(id,action,target_user,details,created_at) VALUES(?,?,?,?,?)",uid(),"add_word","",w,Date.now());
        return json({ok:true});
      }
      if(req.method==="POST" && url.pathname==="/admin-word-delete"){
        const b=await req.json();
        this.ctx.storage.sql.exec("DELETE FROM moderation_words WHERE id=?",String(b.id||""));
        this.ctx.storage.sql.exec("INSERT INTO admin_actions(id,action,target_user,details,created_at) VALUES(?,?,?,?,?)",uid(),"delete_word","",String(b.id||""),Date.now());
        return json({ok:true});
      }
      if(req.method==="POST" && url.pathname==="/admin-word-toggle"){
        const b=await req.json();
        this.ctx.storage.sql.exec("UPDATE moderation_words SET active=? WHERE id=?",b.active?1:0,String(b.id||""));
        this.ctx.storage.sql.exec("INSERT INTO admin_actions(id,action,target_user,details,created_at) VALUES(?,?,?,?,?)",uid(),"toggle_word","",String(b.id||"")+"="+(b.active?"on":"off"),Date.now());
        return json({ok:true});
      }
      if(req.method==="GET" && url.pathname==="/admin-users"){
        return json({ok:true,users:this.ctx.storage.sql.exec("SELECT id,name,avatar,bio,created_at,last_seen FROM users ORDER BY last_seen DESC, name COLLATE NOCASE LIMIT 500").toArray()});
      }
      if(req.method==="GET" && url.pathname==="/admin-actions"){
        return json({ok:true,actions:this.ctx.storage.sql.exec("SELECT * FROM admin_actions ORDER BY created_at DESC LIMIT 300").toArray()});
      }
      if(req.method==="GET" && url.pathname==="/admin-reports"){
        return json({ok:true,reports:this.ctx.storage.sql.exec("SELECT * FROM reports ORDER BY created_at DESC LIMIT 300").toArray()});
      }
      if(req.method==="POST" && url.pathname==="/admin-report-update"){
        const b=await req.json();
        const id=String(b.id||"");
        const status=["new","in_progress","closed"].includes(String(b.status||""))?String(b.status):"new";
        const resolution=cleanMsg(String(b.resolution||"")).slice(0,2000);
        const row=this.ctx.storage.sql.exec("SELECT * FROM reports WHERE id=? LIMIT 1",id).toArray()[0];
        if(!row)return json({ok:false,error:"گزارش پیدا نشد"},404);
        this.ctx.storage.sql.exec("UPDATE reports SET status=?,resolution=?,updated_at=? WHERE id=?",status,resolution,Date.now(),id);
        this.ctx.storage.sql.exec("INSERT INTO admin_actions(id,action,target_user,details,created_at) VALUES(?,?,?,?,?)",uid(),"report_update",row.target_user||row.user_id,status+" | "+resolution,Date.now());
        return json({ok:true});
      }

      if(req.method==="GET" && url.pathname==="/moderation-check"){
        const q=cleanMsg(String(url.searchParams.get("q")||"")).toLocaleLowerCase();
        if(!q)return json({ok:true,blocked:false});
        const rows=this.ctx.storage.sql.exec("SELECT word,warning FROM moderation_words WHERE active=1").toArray();
        for(const row of rows){
          if(q.includes(String(row.word||"").toLocaleLowerCase()))return json({ok:true,blocked:true,word:row.word,warning:row.warning});
        }
        return json({ok:true,blocked:false});
      }

      if(req.method==="POST" && url.pathname==="/resend-saved"){
        const b=await req.json(); const text=String(b.text||"").trim(), sender=String(b.sender_id||""), receiver=String(b.receiver_id||"");
        if(!text||!sender||!receiver)return json({ok:false,error:"پیام نامعتبر"},400);
        const pair=pairKey(sender,receiver);
        const id=this.env?.CHAT ? null : null;
        return json({ok:true,pair_key:pair,text});
      }
      if (req.method === "GET" && url.pathname === "/conversations") {
        const me = url.searchParams.get("id") || "";
        if (!me || !this.user(me)) return json({ ok: false, error: "شناسه نامعتبر" }, 400);

        // For this private friends messenger, every registered person is immediately
        // visible in the chat list. No second search is required after they join.
        const people = this.allPeople(me);
        const convRows = this.ctx.storage.sql.exec(
          "SELECT * FROM conversations WHERE user_a=? OR user_b=?", me, me
        ).toArray();
        const convMap = new Map(convRows.map(c => {
          const other = c.user_a === me ? c.user_b : c.user_a;
          return [other, c];
        }));

        const conversations = people.map(user => {
          const c = convMap.get(user.id);
          return {
            pair_key: c?.pair_key || pairKey(me, user.id),
            user,
            last_message: c?.last_message || "",
            last_message_at: c?.last_message_at || 0,
            unread: c ? (c.user_a === me ? c.unread_a : c.unread_b) : 0,
            started: Boolean(c)
          };
        });

        conversations.sort((a, b) => {
          if (a.last_message_at !== b.last_message_at) return b.last_message_at - a.last_message_at;
          return a.user.name.localeCompare(b.user.name, "fa");
        });
        return json({ ok: true, conversations });
      }

      if (req.method === "POST" && url.pathname === "/conversation") {
        const body = await req.json();
        const me = String(body.me || ""), other = String(body.other || "");
        if (!me || !other || me === other) return json({ ok: false, error: "گفتگوی نامعتبر" }, 400);
        if (!this.user(me) || !this.user(other)) return json({ ok: false, error: "کاربر پیدا نشد" }, 404);
        const existing = this.conversation(me, other);
        if (!existing) {
          const now = Date.now();
          this.ctx.storage.sql.exec(
            "INSERT INTO conversations(pair_key,user_a,user_b,last_message,last_message_at,unread_a,unread_b,updated_at) VALUES(?,?,?,?,?,?,?,?)",
            pairKey(me, other), me, other, "", 0, 0, 0, now
          );
        }
        return json({ ok: true });
      }

      if (req.method === "POST" && url.pathname === "/message-event") {
        const body = await req.json();
        const sender = String(body.sender_id || ""), receiver = String(body.receiver_id || "");
        const text = cleanMsg(body.text), now = Number(body.created_at) || Date.now();
        const preview = text || (body.media_type === 'image' ? '📷 عکس' : body.media_type === 'video' ? '🎬 ویدیو' : body.media_type === 'audio' ? '🎤 پیام صوتی' : body.media_name ? '📎 '+String(body.media_name).slice(0,80) : 'فایل');
        if (!sender || !receiver || (!text && !body.media_id)) return json({ ok:false, error:"پیام نامعتبر" },400);

        const old = this.conversation(sender, receiver);
        if (!old) {
          this.ctx.storage.sql.exec(
            "INSERT INTO conversations(pair_key,user_a,user_b,last_message,last_message_at,unread_a,unread_b,updated_at) VALUES(?,?,?,?,?,?,?,?)",
            pairKey(sender, receiver), sender, receiver, preview, now, 0, 1, now
          );
        } else {
          const unreadColumn = old.user_a === receiver ? "unread_a" : "unread_b";
          this.ctx.storage.sql.exec(
            `UPDATE conversations SET last_message=?,last_message_at=?,updated_at=?,${unreadColumn}=${unreadColumn}+1 WHERE pair_key=?`,
            preview, now, now, old.pair_key
          );
        }
        if(body.id){
          this.ctx.storage.sql.exec("INSERT OR REPLACE INTO global_message_index(id,message_id,sender_id,receiver_id,text,created_at) VALUES(?,?,?,?,?,?)",
            uid(),String(body.id),sender,receiver,text,now);
        }
        return json({ ok: true });
      }

      if (req.method === "POST" && url.pathname === "/read") {
        const body = await req.json();
        const me = String(body.me || ""), other = String(body.other || "");
        const c = this.conversation(me, other);
        if (!c) return json({ ok: true });
        const column = c.user_a === me ? "unread_a" : "unread_b";
        this.ctx.storage.sql.exec(`UPDATE conversations SET ${column}=0 WHERE pair_key=?`, c.pair_key);
        return json({ ok: true });
      }

      return json({ ok: false, error: "not found" }, 404);
    } catch (error) {
      return json({ ok: false, error: error?.message || "خطای سرور" }, 500);
    }
  }
}

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    ctx.blockConcurrencyWhile(async () => {
      const sql = this.ctx.storage.sql;
      sql.exec(`CREATE TABLE IF NOT EXISTS messages(
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        receiver_id TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        reply_to_id TEXT,
        edited INTEGER NOT NULL DEFAULT 0,
        edited_at INTEGER,
        read_at INTEGER,
        pinned INTEGER NOT NULL DEFAULT 0
      );`);
      const cols = sql.exec('PRAGMA table_info(messages)').toArray();
      const add = (c,d) => { if (!cols.some(r => r.name === c)) sql.exec(`ALTER TABLE messages ADD COLUMN ${c} ${d}`); };
      add('reply_to_id','TEXT'); add('edited','INTEGER NOT NULL DEFAULT 0'); add('edited_at','INTEGER'); add('read_at','INTEGER'); add('pinned','INTEGER NOT NULL DEFAULT 0'); add('hidden_for_sender','INTEGER NOT NULL DEFAULT 0'); add('hidden_for_receiver','INTEGER NOT NULL DEFAULT 0');
      sql.exec("CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id,receiver_id,created_at);");
      sql.exec("CREATE INDEX IF NOT EXISTS idx_messages_reply ON messages(reply_to_id);");
      sql.exec(`CREATE TABLE IF NOT EXISTS media_chunks(
        media_id TEXT NOT NULL, chunk_no INTEGER NOT NULL, data BLOB NOT NULL,
        PRIMARY KEY(media_id,chunk_no)
      );`);
      sql.exec(`CREATE TABLE IF NOT EXISTS media_files(
        id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, sender_id TEXT NOT NULL, receiver_id TEXT NOT NULL,
        name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL,
        created_at INTEGER NOT NULL, duration INTEGER
      );`);
      add('media_id','TEXT'); add('media_type','TEXT'); add('media_name','TEXT'); add('media_size','INTEGER'); add('media_mime','TEXT');
      sql.exec("CREATE INDEX IF NOT EXISTS idx_media_chat ON media_files(chat_id,created_at);");
    });
  }

  socketsFor(a, b) {
    const p = pairKey(a, b);
    return this.ctx.getWebSockets().filter(ws => ws.deserializeAttachment()?.pair === p);
  }

  async fetch(req) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/ws") {
        if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
        const a = url.searchParams.get("a") || "", b = url.searchParams.get("b") || "";
        if (!a || !b || a === b) return new Response("Bad chat", { status: 400 });
        const [client, server] = Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ pair: pairKey(a, b), user: a });
        return new Response(null, { status: 101, webSocket: client });
      }

      if (req.method === "GET" && url.pathname === "/history") {
        const a = url.searchParams.get("a") || "", b = url.searchParams.get("b") || "";
        const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit") || 4)));
        const beforeAt = Number(url.searchParams.get("before_at") || url.searchParams.get("before") || 0);
        const beforeId = String(url.searchParams.get("before_id") || "");
        if (!a || !b || a === b) return json({ ok:false,error:"چت نامعتبر است" },400);
        const cols="id,sender_id,receiver_id,text,created_at,deleted,reply_to_id,edited,edited_at,read_at,pinned,media_id,media_type,media_name,media_size,media_mime,hidden_for_sender,hidden_for_receiver";
        let rows;
        if (beforeAt) {
          rows=this.ctx.storage.sql.exec(
            `SELECT ${cols} FROM messages WHERE ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?))
             AND NOT ((sender_id=? AND receiver_id=? AND hidden_for_sender=1) OR (sender_id=? AND receiver_id=? AND hidden_for_receiver=1))
             AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC,id DESC LIMIT ?`,
            a,b,b,a,a,b,b,a,beforeAt,beforeAt,beforeId,limit
          ).toArray().reverse();
        } else {
          rows=this.ctx.storage.sql.exec(`SELECT ${cols} FROM messages
             WHERE ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?))
             AND NOT ((sender_id=? AND receiver_id=? AND hidden_for_sender=1) OR (sender_id=? AND receiver_id=? AND hidden_for_receiver=1))
             ORDER BY created_at DESC,id DESC LIMIT ?`,a,b,b,a,a,b,b,a,limit).toArray().reverse();
        }
        const first=rows[0], last=rows[rows.length-1];
        return json({ok:true,messages:rows,has_more:rows.length===limit,cursor:first?{created_at:first.created_at,id:first.id}:null,next_cursor:last?{created_at:last.created_at,id:last.id}:null});
      }

      if (req.method === "POST" && url.pathname === "/send") {
        const body = await req.json();
        const sender = String(body.sender_id || ""), receiver = String(body.receiver_id || ""), text = cleanMsg(body.text);
        const reply_to_id = body.reply_to_id ? String(body.reply_to_id) : null;
        const media_id = body.media_id ? String(body.media_id) : null;
        const media_type = body.media_type ? String(body.media_type).slice(0,30) : null;
        const media_name = body.media_name ? String(body.media_name).slice(0,200) : null;
        const media_size = Number(body.media_size||0);
        const media_mime = body.media_mime ? String(body.media_mime).slice(0,120) : null;
        if (!sender || !receiver || sender === receiver || (!text && !media_id)) return json({ ok:false,error:"پیام نامعتبر است" },400);
        const id=uid(), now=Date.now();
        this.ctx.storage.sql.exec(
          "INSERT INTO messages(id,sender_id,receiver_id,text,created_at,deleted,reply_to_id,edited,edited_at,read_at,pinned,media_id,media_type,media_name,media_size,media_mime) VALUES(?,?,?,?,?,0,?,0,NULL,NULL,0,?,?,?,?,?)",
          id,sender,receiver,text,now,reply_to_id,media_id,media_type,media_name,media_size,media_mime
        );
        const message={id,sender_id:sender,receiver_id:receiver,text,created_at:now,deleted:0,reply_to_id,edited:0,edited_at:null,read_at:null,pinned:0,media_id,media_type,media_name,media_size,media_mime};
        await this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName("main")).fetch(
          new Request("https://internal/message-event", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(message)
          })
        );
        for (const ws of this.socketsFor(sender, receiver)) {
          try { ws.send(JSON.stringify({ type: "message", message })); } catch {}
        }
        return json({ ok: true, message });
      }

      if (req.method === "POST" && url.pathname === "/read-message") {
        const body = await req.json();
        const id = String(body.id || ""), requester = String(body.requester || "");
        const rows = this.ctx.storage.sql.exec("SELECT * FROM messages WHERE id=? LIMIT 1", id).toArray();
        const m = rows[0];
        if (!m) return json({ ok:false, error:"پیام پیدا نشد" },404);
        if (m.receiver_id !== requester) return json({ok:false,error:"دسترسی ندارید"},403);
        const at=Date.now(); this.ctx.storage.sql.exec("UPDATE messages SET read_at=? WHERE id=?",at,id);
        const out={...m,read_at:at};
        for(const ws of this.socketsFor(m.sender_id,m.receiver_id)){try{ws.send(JSON.stringify({type:'read',message:out}));}catch{}}
        return json({ok:true,message:out});
      }

      if (req.method === "POST" && url.pathname === "/edit") {
        const body=await req.json(); const id=String(body.id||''), requester=String(body.requester||''), text=cleanMsg(body.text);
        if(!id||!text) return json({ok:false,error:'متن نامعتبر است'},400);
        const rows=this.ctx.storage.sql.exec("SELECT * FROM messages WHERE id=? LIMIT 1",id).toArray(); const m=rows[0];
        if(!m) return json({ok:false,error:'پیام پیدا نشد'},404); if(m.sender_id!==requester) return json({ok:false,error:'فقط فرستنده می‌تواند ویرایش کند'},403); if(m.deleted) return json({ok:false,error:'پیام حذف شده است'},400);
        const at=Date.now(); this.ctx.storage.sql.exec("UPDATE messages SET text=?,edited=1,edited_at=? WHERE id=?",text,at,id);
        const out={...m,text,edited:1,edited_at:at}; for(const ws of this.socketsFor(m.sender_id,m.receiver_id)){try{ws.send(JSON.stringify({type:'edited',message:out}));}catch{}}
        return json({ok:true,message:out});
      }

      if (req.method === "POST" && url.pathname === "/pin") {
        const body=await req.json(); const id=String(body.id||''), requester=String(body.requester||''), pinned=!!body.pinned;
        const rows=this.ctx.storage.sql.exec("SELECT * FROM messages WHERE id=? LIMIT 1",id).toArray(); const m=rows[0];
        if(!m) return json({ok:false,error:'پیام پیدا نشد'},404); if(m.sender_id!==requester && m.receiver_id!==requester) return json({ok:false,error:'دسترسی ندارید'},403);
        this.ctx.storage.sql.exec("UPDATE messages SET pinned=? WHERE id=?",pinned?1:0,id); const out={...m,pinned:pinned?1:0};
        for(const ws of this.socketsFor(m.sender_id,m.receiver_id)){try{ws.send(JSON.stringify({type:'pinned',message:out}));}catch{}}
        return json({ok:true,message:out,pinned:pinned?1:0});
      }

      if (req.method === "POST" && url.pathname === "/upload") {
        const form=await req.formData();
        const sender=String(form.get("sender_id")||""), receiver=String(form.get("receiver_id")||"");
        const file=form.get("file");
        if(!sender||!receiver||!(file instanceof File)) return json({ok:false,error:"فایل نامعتبر است"},400);
        const MAX=20*1024*1024; if(file.size>MAX) return json({ok:false,error:"حداکثر حجم فایل ۲۰ مگابایت است"},413);
        const allowedTypes=new Set(["image","video","audio","file"]);
        let type=String(form.get("type")||""); if(!allowedTypes.has(type)) type=file.type.startsWith("image/")?"image":file.type.startsWith("video/")?"video":file.type.startsWith("audio/")?"audio":"file";
        const mediaId=uid(), chatId=pairKey(sender,receiver), now=Date.now(), duration=Number(form.get("duration")||0)||null;
        const buf=await file.arrayBuffer(), bytes=new Uint8Array(buf), CHUNK=1024*1024;
        for(let off=0,no=0;off<bytes.length;off+=CHUNK,no++){ this.ctx.storage.sql.exec("INSERT INTO media_chunks(media_id,chunk_no,data) VALUES(?,?,?)",mediaId,no,bytes.slice(off,Math.min(off+CHUNK,bytes.length))); }
        this.ctx.storage.sql.exec("INSERT INTO media_files(id,chat_id,sender_id,receiver_id,name,mime,size,type,created_at,duration) VALUES(?,?,?,?,?,?,?,?,?,?)",mediaId,chatId,sender,receiver,String(file.name||"file"),String(file.type||"application/octet-stream"),file.size,type,now,duration);
        return json({ok:true,media:{id:mediaId,chat_id:chatId,sender_id:sender,receiver_id:receiver,name:String(file.name||"file"),mime:String(file.type||"application/octet-stream"),size:file.size,type,created_at:now,duration}});
      }

      if (req.method === "GET" && url.pathname === "/gallery") {
        const a=String(url.searchParams.get("a")||""), b=String(url.searchParams.get("b")||"");
        if(!a||!b) return json({ok:false,error:"چت نامعتبر است"},400);
        const rows=this.ctx.storage.sql.exec("SELECT id,chat_id,sender_id,receiver_id,name,mime,size,type,created_at,duration FROM media_files WHERE chat_id=? ORDER BY created_at DESC LIMIT 200",pairKey(a,b)).toArray();
        return json({ok:true,media:rows});
      }

      if (req.method === "GET" && url.pathname === "/media") {
        const id=String(url.searchParams.get("id")||""); if(!id) return new Response("Not found",{status:404});
        const rows=this.ctx.storage.sql.exec("SELECT name,mime,size FROM media_files WHERE id=? LIMIT 1",id).toArray(); const meta=rows[0]; if(!meta) return new Response("Not found",{status:404});
        const chunks=this.ctx.storage.sql.exec("SELECT data FROM media_chunks WHERE media_id=? ORDER BY chunk_no ASC",id).toArray();
        const out=new Uint8Array(meta.size); let pos=0; for(const c of chunks){const b=new Uint8Array(c.data);out.set(b,pos);pos+=b.byteLength;}
        return new Response(out,{headers:{"content-type":meta.mime||"application/octet-stream","content-length":String(out.byteLength),"content-disposition":`inline; filename*=UTF-8''${encodeURIComponent(meta.name)}`,"cache-control":"public,max-age=31536000,immutable"}});
      }

      if (req.method === "GET" && url.pathname === "/pinned") {
        const a=String(url.searchParams.get('a')||''), b=String(url.searchParams.get('b')||'');
        const rows=this.ctx.storage.sql.exec("SELECT id,sender_id,receiver_id,text,created_at,deleted,pinned,media_id,media_type,media_name FROM messages WHERE ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)) AND pinned=1 ORDER BY created_at DESC LIMIT 100",a,b,b,a).toArray();
        return json({ok:true,messages:rows});
      }

      if (req.method === "GET" && url.pathname === "/search-messages") {
        const a=String(url.searchParams.get('a')||''), b=String(url.searchParams.get('b')||''), q=String(url.searchParams.get('q')||'').trim();
        if(!a||!b||!q) return json({ok:true,messages:[]}); const like='%'+q.replace(/[\%_]/g,m=>'\\'+m)+'%';
        const rows=this.ctx.storage.sql.exec("SELECT id,sender_id,receiver_id,text,created_at,deleted,reply_to_id,edited,edited_at,read_at,pinned FROM messages WHERE ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)) AND text LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 50",a,b,b,a,like).toArray();
        return json({ok:true,messages:rows});
      }

      if (req.method === "POST" && url.pathname === "/delete") {
        const body = await req.json();
        const id = String(body.id || ""), requester = String(body.requester || ""), mode=String(body.mode||"all");
        const m = this.ctx.storage.sql.exec("SELECT id,sender_id,receiver_id FROM messages WHERE id=? LIMIT 1", id).toArray()[0];
        if (!m) return json({ok:false,error:"پیام پیدا نشد"},404);
        if(mode==="me"){
          if(requester!==m.sender_id && requester!==m.receiver_id) return json({ok:false,error:"دسترسی ندارید"},403);
          const col=requester===m.sender_id?"hidden_for_sender":"hidden_for_receiver";
          this.ctx.storage.sql.exec(`UPDATE messages SET ${col}=1 WHERE id=?`,id);
          return json({ok:true,mode:"me"});
        }
        if (m.sender_id !== requester) return json({ ok:false,error:"برای همه فقط فرستنده می‌تواند حذف کند" },403);
        this.ctx.storage.sql.exec("UPDATE messages SET text='',deleted=1 WHERE id=?", id);
        for (const ws of this.socketsFor(m.sender_id,m.receiver_id)) { try { ws.send(JSON.stringify({type:"deleted",id})); } catch {} }
        return json({ok:true,mode:"all"});
      }
      return json({ ok: false, error: "not found" }, 404);
    } catch (error) {
      return json({ ok: false, error: error?.message || "خطای چت" }, 500);
    }
  }

  // Hibernation-compatible real-time events (typing indicator).
  webSocketMessage(ws, message) {
    try {
      const data = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
      const att = ws.deserializeAttachment() || {};
      if(data.type==='typing'){
        for(const peer of this.socketsForPair(att.pair)){if(peer===ws)continue;try{peer.send(JSON.stringify({type:'typing',show:!!data.show}))}catch{}}
        return;
      }
      if(['call-offer','call-answer','call-ice','call-end'].includes(data.type)){
        for(const peer of this.socketsForPair(att.pair)){if(peer===ws)continue;try{peer.send(JSON.stringify({type:data.type,from:att.user||'',payload:data.payload||null}))}catch{}}
      }
    } catch {}
  }
  socketsForPair(pair) { return this.ctx.getWebSockets().filter(x => x.deserializeAttachment()?.pair === pair); }
  webSocketClose() {}
  webSocketError() {}
}


export class GroupRoom extends DurableObject {
  constructor(ctx, env){
    super(ctx,env);
    this.ctx=ctx; this.env=env;
    ctx.blockConcurrencyWhile(async()=>{
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS group_messages(
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT 0,
        media_id TEXT, media_type TEXT, media_name TEXT, media_size INTEGER, media_mime TEXT
      );`);
      const cols=ctx.storage.sql.exec("PRAGMA table_info(group_messages)").toArray();
      const add=(c,d)=>{if(!cols.some(r=>r.name===c))ctx.storage.sql.exec(`ALTER TABLE group_messages ADD COLUMN ${c} ${d}`)};
      add('media_id','TEXT');add('media_type','TEXT');add('media_name','TEXT');add('media_size','INTEGER');add('media_mime','TEXT');
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS group_media_chunks(media_id TEXT NOT NULL,chunk_no INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(media_id,chunk_no));`);
      ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS idx_group_messages_time ON group_messages(created_at,id);");
    });
  }
  sockets(){
    return this.ctx.getWebSockets();
  }
  async fetch(req){
    const url=new URL(req.url);
    try{
      if(url.pathname==="/ws"){
        if(req.headers.get("Upgrade")!=="websocket") return new Response("Expected WebSocket",{status:426});
        const user=url.searchParams.get("user")||"";
        const [client,server]=Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({user});
        return new Response(null,{status:101,webSocket:client});
      }
      if(req.method==="GET"&&url.pathname==="/history"){
        const limit=Math.min(30,Math.max(1,Number(url.searchParams.get("limit")||20)));
        const beforeAt=Number(url.searchParams.get("before_at")||0);
        const beforeId=String(url.searchParams.get("before_id")||"");
        const where=beforeAt?"WHERE (created_at < ? OR (created_at=? AND id<?))":"";
        const args=beforeAt?[beforeAt,beforeAt,beforeId,limit]:[limit];
        const rows=this.ctx.storage.sql.exec(
          `SELECT id,sender_id,text,created_at,media_id,media_type,media_name,media_size,media_mime FROM group_messages ${where} ORDER BY created_at DESC,id DESC LIMIT ?`,...args
        ).toArray().reverse();
        return json({ok:true,messages:rows,has_more:rows.length===limit});
      }
      if(req.method==="POST"&&url.pathname==="/send"){
        const b=await req.json(); const sender=String(b.sender_id||""), text=cleanMsg(b.text);
        const media_id=b.media_id?String(b.media_id):null, media_type=b.media_type?String(b.media_type):null, media_name=b.media_name?String(b.media_name):null, media_size=Number(b.media_size||0), media_mime=b.media_mime?String(b.media_mime):null;
        if(!sender||(!text&&!media_id))return json({ok:false,error:"پیام نامعتبر"},400);
        const id=uid(),now=Date.now();
        this.ctx.storage.sql.exec("INSERT INTO group_messages(id,sender_id,text,created_at,media_id,media_type,media_name,media_size,media_mime) VALUES(?,?,?,?,?,?,?,?,?)",id,sender,text,now,media_id,media_type,media_name,media_size,media_mime);
        const message={id,sender_id:sender,text,created_at:now,media_id,media_type,media_name,media_size,media_mime};
        for(const ws of this.sockets()){try{ws.send(JSON.stringify({type:"group-message",message}))}catch{}}
        return json({ok:true,message});
      }
      if(req.method==="POST"&&url.pathname==="/upload"){
        const form=await req.formData(), sender=String(form.get("sender_id")||""), file=form.get("file");
        if(!sender||!(file instanceof File))return json({ok:false,error:"فایل نامعتبر"},400);
        const MAX=20*1024*1024;if(file.size>MAX)return json({ok:false,error:"حداکثر ۲۰MB"},413);
        const id=uid(),buf=new Uint8Array(await file.arrayBuffer()),CHUNK=1024*1024;
        for(let off=0,no=0;off<buf.length;off+=CHUNK,no++)this.ctx.storage.sql.exec("INSERT INTO group_media_chunks(media_id,chunk_no,data) VALUES(?,?,?)",id,no,buf.slice(off,Math.min(off+CHUNK,buf.length)));
        const type=String(form.get("type")|| (file.type.startsWith("image/")?"image":file.type.startsWith("video/")?"video":file.type.startsWith("audio/")?"audio":"file"));
        return json({ok:true,media:{id,name:String(file.name||"file"),mime:String(file.type||"application/octet-stream"),size:file.size,type}});
      }
      if(req.method==="GET"&&url.pathname==="/media"){
        const id=String(url.searchParams.get("id")||"");const meta=this.ctx.storage.sql.exec("SELECT media_id,media_name,media_mime,media_size FROM group_messages WHERE media_id=? LIMIT 1",id).toArray()[0];
        if(!meta)return new Response("Not found",{status:404});
        const rows=this.ctx.storage.sql.exec("SELECT data FROM group_media_chunks WHERE media_id=? ORDER BY chunk_no",id).toArray();
        const out=new Uint8Array(Number(meta.media_size||0));let p=0;for(const r of rows){const b=new Uint8Array(r.data);out.set(b,p);p+=b.byteLength}
        return new Response(out,{headers:{"content-type":meta.media_mime||"application/octet-stream","content-length":String(out.length)}});
      }
      return json({ok:false,error:"مسیر گروه پیدا نشد"},404);
    }catch(e){return json({ok:false,error:e?.message||"خطای گروه"},500)}
  }
  webSocketClose(){}
  webSocketError(){}
  webSocketMessage(){}
}

export class UserInbox extends DurableObject {}
export class ChatRoomV2 extends ChatRoom {}
export class Messenger extends UserInbox {}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const directory = () => env.DIRECTORY.get(env.DIRECTORY.idFromName("main"));
    try {
      if (url.pathname.startsWith("/api/")) {
        const map = {
          "/api/login": "/login",
          "/api/search": "/search",
          "/api/user": "/user",
          "/api/profile": "/profile",
          "/api/presence": "/presence",
          "/api/conversations": "/conversations",
          "/api/conversation": "/conversation",
          "/api/read": "/read",
          "/api/appearance": "/appearance",
          "/api/global-search": "/global-search",
          "/api/save-message": "/save-message",
          "/api/saved-messages": "/saved-messages",
          "/api/report": "/report",
          "/api/profile-visibility": "/profile-visibility",
          "/api/admin-login": "/admin-login",
          "/api/admin-words": "/admin-words",
          "/api/admin-word-add": "/admin-word-add",
          "/api/admin-word-delete": "/admin-word-delete",
          "/api/admin-users": "/admin-users",
          "/api/admin-actions": "/admin-actions",
          "/api/admin-reports": "/admin-reports",
          "/api/admin-word-toggle": "/admin-word-toggle",
          "/api/admin-report-update": "/admin-report-update",
          "/api/admin-stats": "/admin-stats"
        };
        if (map[url.pathname]) {
          return directory().fetch(new Request(new URL(map[url.pathname] + url.search, "https://internal"), req));
        }

        if (url.pathname === "/api/history") {
          const a = url.searchParams.get("a") || "", b = url.searchParams.get("b") || "";
          if (!a || !b) return json({ ok: false, error: "چت نامعتبر" }, 400);
          const chat = env.CHAT.get(env.CHAT.idFromName(pairKey(a, b)));
          return chat.fetch(new Request("https://internal/history" + url.search));
        }

        if (url.pathname === "/api/send") {
          const body = await req.clone().json();
          const moderationText = String(body.text || "");
          if (moderationText.trim()) {
            const check = await directory().fetch(new Request("https://internal/moderation-check?q="+encodeURIComponent(moderationText)));
            const md = await check.json().catch(()=>({blocked:false}));
            if (md.blocked) return json({ok:false,error:md.warning||"این پیام شامل کلمه هشدار است",moderation:true},422);
          }
          const a = String(body.sender_id || ""), b = String(body.receiver_id || "");
          const chat = env.CHAT.get(env.CHAT.idFromName(pairKey(a, b)));
          return chat.fetch(new Request("https://internal/send", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
          }));
        }

        if (["/api/read-message","/api/edit","/api/pin","/api/delete"].includes(url.pathname)) {
          const body = await req.clone().json();
          const a = String(body.sender_id || body.requester || body.me || ""), b = String(body.receiver_id || body.other || "");
          const chatId = body.chat_id || (a && b ? pairKey(a,b) : "");
          if (!chatId) return json({ok:false,error:"شناسه چت نامعتبر"},400);
          const chat = env.CHAT.get(env.CHAT.idFromName(chatId));
          const target = url.pathname.replace('/api','');
          return chat.fetch(new Request("https://internal"+target,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}));
        }


        if (url.pathname === "/api/groups") {
          const id=url.searchParams.get("id")||"";
          return directory().fetch(new Request(new URL("/groups?id="+encodeURIComponent(id),"https://internal"),req));
        }
        if (["/api/group-create","/api/group-add","/api/group-promote","/api/group-mute"].includes(url.pathname)) {
          return directory().fetch(new Request(new URL(url.pathname.replace("/api",""),"https://internal"),req));
        }
        if (url.pathname === "/api/group") {
          return directory().fetch(new Request(new URL("/group"+url.search,"https://internal"),req));
        }
        if (url.pathname === "/api/group-members") {
          return directory().fetch(new Request(new URL("/group-members"+url.search,"https://internal"),req));
        }
                if (url.pathname === "/api/group-upload") {
          const form=await req.formData(); const gid=String(form.get("group_id")||""); if(!gid)return json({ok:false,error:"گروه نامعتبر"},400);
          const room=env.GROUP.get(env.GROUP.idFromName(gid)); return room.fetch(new Request("https://internal/upload",{method:"POST",body:form}));
        }
        if (url.pathname === "/api/group-media") {
          const gid=url.searchParams.get("group_id")||"", id=url.searchParams.get("id")||""; if(!gid||!id)return new Response("Not found",{status:404});
          const room=env.GROUP.get(env.GROUP.idFromName(gid)); return room.fetch(new Request("https://internal/media?id="+encodeURIComponent(id)));
        }
if (url.pathname === "/api/group-history" || url.pathname === "/api/group-send" || url.pathname === "/api/group-ws") {
          const gid=url.searchParams.get("id") || (url.pathname==="/api/group-send" ? "" : "");
          let groupId=gid;
          let body=null;
          if(url.pathname==="/api/group-send"){ body=await req.clone().json(); groupId=String(body.group_id||""); }
          if(!groupId) return json({ok:false,error:"گروه نامعتبر"},400);
          if(!env.GROUP) return json({ok:false,error:"بایند گروه تنظیم نشده"},500);
          const room=env.GROUP.get(env.GROUP.idFromName(groupId));
          const target=url.pathname==="/api/group-history"?"/history":url.pathname==="/api/group-send"?"/send":"/ws";
          const q=url.pathname==="/api/group-ws" ? url.searchParams.toString() : "";
          const init = url.pathname==="/api/group-send"
            ? {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}
            : req;
          return room.fetch(new Request("https://internal"+target+(q?"?"+q:""),init));
        }

        if (url.pathname === "/api/upload") {
          const form=await req.formData(); const a=String(form.get("sender_id")||""),b=String(form.get("receiver_id")||""); if(!a||!b)return json({ok:false,error:"چت نامعتبر"},400);
          const chat=env.CHAT.get(env.CHAT.idFromName(pairKey(a,b))); return chat.fetch(new Request("https://internal/upload",{method:"POST",body:form}));
        }
        if (url.pathname === "/api/gallery") {
          const a=url.searchParams.get("a")||"",b=url.searchParams.get("b")||""; if(!a||!b)return json({ok:false,error:"چت نامعتبر"},400); const chat=env.CHAT.get(env.CHAT.idFromName(pairKey(a,b))); return chat.fetch(new Request("https://internal/gallery"+url.search));
        }
        if (url.pathname === "/api/media") {
          const id=url.searchParams.get("id")||""; if(!id)return new Response("Not found",{status:404});
          // media IDs are globally random; locate through a small authenticated-free lookup is not possible across DOs.
          // The client always supplies the chat pair as a,b.
          const a=url.searchParams.get("a")||"",b=url.searchParams.get("b")||""; if(!a||!b)return new Response("Missing chat",{status:400});
          const chat=env.CHAT.get(env.CHAT.idFromName(pairKey(a,b))); return chat.fetch(new Request("https://internal/media?id="+encodeURIComponent(id)));
        }

        if (url.pathname === "/api/pinned") {
          const a=url.searchParams.get("a")||"",b=url.searchParams.get("b")||"";
          const chat=env.CHAT.get(env.CHAT.idFromName(pairKey(a,b)));
          return chat.fetch(new Request("https://internal/pinned"+url.search));
        }

        if (url.pathname === "/api/search-messages") {
          const a=url.searchParams.get('a')||'', b=url.searchParams.get('b')||'';
          if(!a||!b) return json({ok:false,error:'چت نامعتبر'},400);
          const chat=env.CHAT.get(env.CHAT.idFromName(pairKey(a,b)));
          return chat.fetch(new Request("https://internal/search-messages"+url.search));
        }

        if (url.pathname === "/api/ws") {
          const a = url.searchParams.get("a") || "", b = url.searchParams.get("b") || "";
          if (!a || !b) return new Response("Bad chat", { status: 400 });
          const chat = env.CHAT.get(env.CHAT.idFromName(pairKey(a, b)));
          return chat.fetch(new Request("https://internal/ws?a=" + encodeURIComponent(a) + "&b=" + encodeURIComponent(b), req));
        }

        return json({ ok: false, error: "API not found" }, 404);
      }
      return env.ASSETS.fetch(req);
    } catch (error) {
      return json({ ok: false, error: error?.message || "خطای داخلی" }, 500);
    }
  }
};
