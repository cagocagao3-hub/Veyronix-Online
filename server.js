require("dotenv").config();

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const { DatabaseSync } = require("node:sqlite");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const { rateLimit } = require("express-rate-limit");

const app = express();
// O serviço fica atrás de um proxy HTTPS no Render; necessário para cookies Secure.
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
const dbPath = path.resolve(process.env.DATABASE_PATH || "./data/veyronix.sqlite");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error("Configure SESSION_SECRET com pelo menos 32 caracteres no .env.");
  process.exit(1);
}

// Node.js 24 includes SQLite, avoiding native addons that fail to compile on Android/Termux.
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000; PRAGMA wal_autocheckpoint = 1000;");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#7567F8',
  display_name TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  avatar_data TEXT NOT NULL DEFAULT '',
  banner_data TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pending_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE,
  email TEXT NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_email ON pending_registrations(email);
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`);
// Add profile columns safely when upgrading an existing Veyronix database.
const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(column => column.name));
for (const [name, definition] of Object.entries({
  display_name: "TEXT NOT NULL DEFAULT ''",
  bio: "TEXT NOT NULL DEFAULT ''",
  avatar_data: "TEXT NOT NULL DEFAULT ''",
  banner_data: "TEXT NOT NULL DEFAULT ''"
})) {
  if (!userColumns.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
}


// Etapa 4: comunidades, canais, convites, mensagens e identificação beta.
const extraUserColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(column => column.name));
if (!extraUserColumns.has("beta_badge")) db.exec("ALTER TABLE users ADD COLUMN beta_badge INTEGER NOT NULL DEFAULT 0");
db.exec(`
CREATE TABLE IF NOT EXISTS communities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  banner_data TEXT NOT NULL DEFAULT '',
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS community_members (
  community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (community_id,user_id)
);
CREATE TABLE IF NOT EXISTS community_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS community_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_community_messages_channel ON community_messages(channel_id,id);
CREATE TABLE IF NOT EXISTS community_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS community_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#9b8cff',
  position INTEGER NOT NULL DEFAULT 0,
  permissions TEXT NOT NULL DEFAULT '[]',
  UNIQUE(community_id,name)
);
CREATE TABLE IF NOT EXISTS community_member_roles (
  community_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL REFERENCES community_roles(id) ON DELETE CASCADE,
  PRIMARY KEY(community_id,user_id,role_id),
  FOREIGN KEY(community_id,user_id) REFERENCES community_members(community_id,user_id) ON DELETE CASCADE
);
`);
const communityColumns = new Set(db.prepare('PRAGMA table_info(communities)').all().map(column => column.name));
if (!communityColumns.has('banner_data')) db.exec("ALTER TABLE communities ADD COLUMN banner_data TEXT NOT NULL DEFAULT ''");
db.exec("UPDATE communities SET banner_data='' WHERE banner_data=icon");

const categoryColumns = new Set(db.prepare('PRAGMA table_info(community_categories)').all().map(column => column.name));
if (!categoryColumns.has("private_role_ids")) db.exec("ALTER TABLE community_categories ADD COLUMN private_role_ids TEXT NOT NULL DEFAULT '[]'");
const channelColumns = new Set(db.prepare('PRAGMA table_info(community_channels)').all().map(column => column.name));
if (!channelColumns.has('category_id')) db.exec('ALTER TABLE community_channels ADD COLUMN category_id INTEGER REFERENCES community_categories(id) ON DELETE SET NULL');
if (!channelColumns.has('read_role_ids')) db.exec("ALTER TABLE community_channels ADD COLUMN read_role_ids TEXT NOT NULL DEFAULT '[]'");
if (!channelColumns.has('send_role_ids')) db.exec("ALTER TABLE community_channels ADD COLUMN send_role_ids TEXT NOT NULL DEFAULT '[]'");
db.exec(`
INSERT INTO community_categories(community_id,name,position)
SELECT c.id,'CANAIS',0 FROM communities c
WHERE NOT EXISTS(SELECT 1 FROM community_categories x WHERE x.community_id=c.id);
UPDATE community_channels SET category_id=(SELECT id FROM community_categories c WHERE c.community_id=community_channels.community_id ORDER BY position,id LIMIT 1)
WHERE category_id IS NULL;
DELETE FROM community_member_roles WHERE role_id IN (SELECT id FROM community_roles WHERE name IN ('Owner','Membro'));
DELETE FROM community_roles WHERE name IN ('Owner','Membro');
`);

const betaNames = new Set(String(process.env.BETA_USERNAMES || "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean));
function applyBetaFlag(user) {
  if (!user) return user;
  const isBeta = betaNames.has(String(user.username).toLowerCase()) || Number(user.beta_badge) === 1;
  return { ...user, is_beta: isBeta };
}
function makeInviteCode() { return crypto.randomBytes(5).toString("hex").toUpperCase(); }
function memberOf(communityId, userId) {
  return db.prepare("SELECT role FROM community_members WHERE community_id = ? AND user_id = ?").get(communityId, userId);
}
function channelPermission(channelId, userId, action) {
  const channel=db.prepare("SELECT community_id,read_role_ids,send_role_ids FROM community_channels WHERE id=?").get(channelId);
  if(!channel) return false;
  const member=memberOf(channel.community_id,userId);
  if(!member) return false;
  if(["owner","admin"].includes(member.role)) return true;
  const category=db.prepare("SELECT private_role_ids FROM community_categories WHERE id=(SELECT category_id FROM community_channels WHERE id=?)").get(channelId);
  if(category){
    let privateRoles=[];try{privateRoles=JSON.parse(category.private_role_ids||"[]")||[];}catch{}
    if(privateRoles.length){
      const assignedRoles=db.prepare("SELECT role_id FROM community_member_roles WHERE community_id=? AND user_id=?").all(channel.community_id,userId).map(x=>x.role_id);
      if(!privateRoles.some(id=>assignedRoles.includes(Number(id)))) return false;
    }
  }
  let allowed=[];
  try{allowed=JSON.parse(action==="send"?channel.send_role_ids:channel.read_role_ids)||[];}catch{}
  if(!Array.isArray(allowed)||allowed.length===0) return true;
  const assigned=db.prepare("SELECT role_id FROM community_member_roles WHERE community_id=? AND user_id=?").all(channel.community_id,userId).map(x=>x.role_id);
  return allowed.some(id=>assigned.includes(Number(id)));
}


// SQLite-backed session store using the same built-in node:sqlite driver.
class SQLiteSessionStore extends session.Store {
  constructor(database, tableName = "sessions") {
    super();
    this.database = database;
    this.tableName = tableName;
    this.database.exec(`CREATE TABLE IF NOT EXISTS ${this.tableName} (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expired INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS idx_sessions_expired ON ${this.tableName}(expired);`);
  }
  get(sid, callback) {
    try {
      const row = this.database.prepare(
        `SELECT sess FROM ${this.tableName} WHERE sid = ? AND expired > ?`
      ).get(sid, Date.now());
      callback(null, row ? JSON.parse(row.sess) : null);
    } catch (error) { callback(error); }
  }
  set(sid, sess, callback = () => {}) {
    try {
      const cookieExpiry = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 7 * 24 * 60 * 60 * 1000;
      this.database.prepare(
        `INSERT INTO ${this.tableName} (sid, sess, expired) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expired = excluded.expired`
      ).run(sid, JSON.stringify(sess), cookieExpiry);
      callback(null);
    } catch (error) { callback(error); }
  }
  destroy(sid, callback = () => {}) {
    try {
      this.database.prepare(`DELETE FROM ${this.tableName} WHERE sid = ?`).run(sid);
      callback(null);
    } catch (error) { callback(error); }
  }
  touch(sid, sess, callback = () => {}) { this.set(sid, sess, callback); }
}

const voiceIceServers = (() => {
  const servers = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  if (process.env.TURN_SERVER_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    servers.push({ urls: process.env.TURN_SERVER_URL.split(",").map(v => v.trim()).filter(Boolean), username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  }
  return servers;
})();
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:"],
      mediaSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  }
}));
app.use(express.json({ limit: "16mb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

app.use(session({
  store: new SQLiteSessionStore(db),
  name: "veyronix.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

const mailConfigured = Boolean(
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS &&
  process.env.MAIL_FROM
);
const transporter = mailConfigured ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
}) : null;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." }
});

function cleanString(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 190;
}
function codeHash(code, salt) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET)
    .update(`${salt}:${code}`).digest("hex");
}
function makeCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}
function safeEqual(a, b) {
  const aa = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
async function sendCode(to, code, purpose) {
  if (!transporter) {
    const error = new Error("EMAIL_NOT_CONFIGURED");
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }
  const title = purpose === "verify" ? "Confirme seu e-mail" : "Redefina sua senha";
  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject: `${title} • Veyronix`,
    text: `Seu código Veyronix é ${code}. Ele expira em 10 minutos. Se você não solicitou isso, ignore esta mensagem.`,
    html: `<div style="background:#10121b;padding:32px;font-family:Arial,sans-serif;color:#f6f5ff"><div style="max-width:480px;margin:auto;background:#1b1e2d;border:1px solid #34364d;border-radius:18px;padding:30px"><div style="font-size:12px;letter-spacing:3px;color:#a69cff;font-weight:bold">VEYRONIX</div><h1 style="font-size:24px">${title}</h1><p style="color:#b9bbcc">Use o código abaixo. Por segurança, ele expira em 10 minutos.</p><div style="font-size:34px;letter-spacing:10px;font-weight:bold;background:#111320;border-radius:12px;padding:18px;text-align:center;color:#fff">${code}</div><p style="font-size:12px;color:#85889e">Se você não solicitou esta ação, ignore este e-mail.</p></div></div>`
  });
}
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Faça login para continuar." });
  next();
}
function csrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const token = req.get("x-veyronix-request");
  if (!req.session.csrfToken || token !== req.session.csrfToken) {
    return res.status(403).json({ error: "Sessão expirada. Atualize a página e tente novamente." });
  }
  next();
}
app.use("/api", csrf);
app.get("/api/voice/config", requireAuth, (_req,res)=>res.json({iceServers:voiceIceServers}));

app.get("/api/session", (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString("hex");
  if (!req.session.userId) return res.json({ authenticated: false, csrfToken: req.session.csrfToken });
  const user = db.prepare("SELECT id, username, email, display_name, bio, avatar_data, banner_data, beta_badge, created_at FROM users WHERE id = ?").get(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.json({ authenticated: false, csrfToken: crypto.randomBytes(24).toString("hex") });
  }
  res.json({ authenticated: true, user: applyBetaFlag(user), csrfToken: req.session.csrfToken });
});

app.post("/api/auth/register", authLimiter, async (req, res) => {
  try {
    const username = cleanString(req.body.username, 24).toLowerCase();
    const email = cleanString(req.body.email, 190).toLowerCase();
    const password = String(req.body.password || "");
    if (!/^[a-z0-9_.]{3,24}$/.test(username)) {
      return res.status(400).json({ error: "Use de 3 a 24 caracteres: apenas letras minúsculas, números, _ ou ponto. Sem espaços." });
    }
    if (!validEmail(email)) return res.status(400).json({ error: "Digite um e-mail válido." });
    if (password.length < 8 || password.length > 72) {
      return res.status(400).json({ error: "A senha precisa ter entre 8 e 72 caracteres." });
    }
    if (db.prepare("SELECT 1 FROM users WHERE username = ? OR email = ?").get(username, email)) {
      return res.status(409).json({ error: "Esse nome de usuário ou e-mail já está em uso." });
    }
    if (!transporter) return res.status(503).json({ error: "O envio de e-mail ainda não está configurado. Configure o SMTP no arquivo .env antes de criar contas." });

    const code = makeCode();
    const passwordHash = await bcrypt.hash(password, 12);
    const salt = crypto.randomBytes(16).toString("hex");
    db.prepare("DELETE FROM pending_registrations WHERE email = ?").run(email);
    const info = db.prepare(`INSERT INTO pending_registrations
      (username,email,password_hash,code_hash,expires_at,created_at)
      VALUES (?,?,?,?,?,?)`).run(username, email, passwordHash, codeHash(code, salt), Date.now() + 10 * 60 * 1000, Date.now());
    // Store per-record salt alongside the digest without storing the plaintext code.
    db.prepare("UPDATE pending_registrations SET code_hash = ? WHERE id = ?")
      .run(`${salt}:${codeHash(code, salt)}`, info.lastInsertRowid);
    try {
      await sendCode(email, code, "verify");
    } catch (mailError) {
      db.prepare("DELETE FROM pending_registrations WHERE id = ?").run(info.lastInsertRowid);
      console.error("SMTP error:", mailError.message);
      return res.status(502).json({ error: "Não foi possível enviar o e-mail. Confira as configurações SMTP e tente novamente." });
    }
    res.json({ ok: true, message: "Código enviado. Confira sua caixa de entrada e o spam.", email });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Não foi possível iniciar o cadastro." });
  }
});

app.post("/api/auth/verify", authLimiter, async (req, res) => {
  const email = cleanString(req.body.email, 190).toLowerCase();
  const code = cleanString(req.body.code, 6);
  const pending = db.prepare("SELECT * FROM pending_registrations WHERE email = ? ORDER BY id DESC LIMIT 1").get(email);
  if (!pending) return res.status(400).json({ error: "Cadastro não encontrado. Comece novamente." });
  if (pending.expires_at < Date.now()) {
    db.prepare("DELETE FROM pending_registrations WHERE id = ?").run(pending.id);
    return res.status(400).json({ error: "O código expirou. Faça o cadastro novamente." });
  }
  if (pending.attempts >= 5) {
    db.prepare("DELETE FROM pending_registrations WHERE id = ?").run(pending.id);
    return res.status(429).json({ error: "Limite de tentativas atingido. Faça o cadastro novamente." });
  }
  const [salt, digest] = pending.code_hash.split(":");
  const expected = codeHash(code, salt);
  if (!/^\d{6}$/.test(code) || !safeEqual(digest, expected)) {
    db.prepare("UPDATE pending_registrations SET attempts = attempts + 1 WHERE id = ?").run(pending.id);
    return res.status(400).json({ error: "Código incorreto. Confira os seis dígitos e tente novamente." });
  }
  try {
    const result = db.prepare("INSERT INTO users (username,email,password_hash) VALUES (?,?,?)")
      .run(pending.username, pending.email, pending.password_hash);
    db.prepare("DELETE FROM pending_registrations WHERE id = ?").run(pending.id);
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Conta criada, mas não foi possível iniciar a sessão. Faça login." });
      req.session.userId = Number(result.lastInsertRowid);
      req.session.csrfToken = crypto.randomBytes(24).toString("hex");
      registerDevice(req, req.session.userId);
      res.json({ ok: true, message: "E-mail confirmado. Sua conta foi criada.", redirect: true });
    });
  } catch (error) {
    if (String(error.code).startsWith("SQLITE_CONSTRAINT")) {
      return res.status(409).json({ error: "Esse usuário ou e-mail já foi cadastrado." });
    }
    console.error(error);
    res.status(500).json({ error: "Não foi possível concluir o cadastro." });
  }
});

function deviceLabel(req) {
  const ua = String(req.get("user-agent") || "");
  if (/Android/i.test(ua)) return "Android · navegador";
  if (/iPhone|iPad/i.test(ua)) return "iOS · navegador";
  if (/Windows/i.test(ua)) return "Windows · navegador";
  if (/Macintosh|Mac OS/i.test(ua)) return "macOS · navegador";
  return "Dispositivo · navegador";
}
function registerDevice(req, userId) {
  db.prepare("INSERT INTO user_devices(user_id,sid,label) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET user_id=excluded.user_id,label=excluded.label,last_seen=CURRENT_TIMESTAMP")
    .run(userId, req.sessionID, deviceLabel(req));
  db.prepare("INSERT OR IGNORE INTO user_preferences(user_id) VALUES(?)").run(userId);
}

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const identity = cleanString(req.body.identity, 190);
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE")
    .get(identity, identity);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Usuário/e-mail ou senha incorretos." });
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "Não foi possível iniciar sua sessão." });
    req.session.userId = user.id;
    req.session.csrfToken = crypto.randomBytes(24).toString("hex");
    registerDevice(req, req.session.userId);
    res.json({ ok: true, message: "Login realizado.", redirect: true });
  });
});

app.post("/api/auth/forgot", authLimiter, async (req, res) => {
  const email = cleanString(req.body.email, 190).toLowerCase();
  if (!validEmail(email)) return res.status(400).json({ error: "Digite um e-mail válido." });
  if (!transporter) return res.status(503).json({ error: "O envio de e-mail ainda não está configurado." });
  const user = db.prepare("SELECT id,email FROM users WHERE email = ? COLLATE NOCASE").get(email);
  // Avoid revealing whether the email exists.
  if (user) {
    const code = makeCode();
    const salt = crypto.randomBytes(16).toString("hex");
    db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(user.id);
    db.prepare(`INSERT INTO password_resets (user_id,code_hash,expires_at,created_at)
      VALUES (?,?,?,?)`).run(user.id, `${salt}:${codeHash(code, salt)}`, Date.now() + 10 * 60 * 1000, Date.now());
    try { await sendCode(email, code, "reset"); }
    catch (error) {
      db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(user.id);
      console.error("SMTP error:", error.message);
      return res.status(502).json({ error: "Não foi possível enviar o e-mail agora." });
    }
  }
  res.json({ ok: true, message: "Se o endereço estiver cadastrado, enviaremos um código de recuperação." });
});

app.post("/api/auth/reset", authLimiter, async (req, res) => {
  const email = cleanString(req.body.email, 190).toLowerCase();
  const code = cleanString(req.body.code, 6);
  const password = String(req.body.password || "");
  if (password.length < 8 || password.length > 72) return res.status(400).json({ error: "A nova senha precisa ter entre 8 e 72 caracteres." });
  const user = db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE").get(email);
  if (!user) return res.status(400).json({ error: "Código inválido ou expirado." });
  const reset = db.prepare("SELECT * FROM password_resets WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(user.id);
  if (!reset || reset.expires_at < Date.now() || reset.attempts >= 5) {
    return res.status(400).json({ error: "Código inválido ou expirado." });
  }
  const [salt, digest] = reset.code_hash.split(":");
  if (!/^\d{6}$/.test(code) || !safeEqual(digest, codeHash(code, salt))) {
    db.prepare("UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?").run(reset.id);
    return res.status(400).json({ error: "Código inválido ou expirado." });
  }
  const hash = await bcrypt.hash(password, 12);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, user.id);
  db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(user.id);
  res.json({ ok: true, message: "Senha atualizada. Agora você pode entrar." });
});

app.get("/api/profile", requireAuth, (req, res) => {
  const user = db.prepare("SELECT id, username, email, display_name, bio, avatar_data, banner_data, beta_badge, created_at FROM users WHERE id = ?").get(req.session.userId);
  if (!user) return res.status(404).json({ error: "Conta não encontrada." });
  res.json({ user: applyBetaFlag(user) });
});

app.patch("/api/profile", requireAuth, (req, res) => {
  const username = cleanString(req.body.username, 24).toLowerCase();
  const displayName = cleanString(req.body.displayName, 20);
  if (String(req.body.displayName || "").trim().length > 20) {
    return res.status(400).json({ error: "O nome principal pode ter no máximo 20 caracteres." });
  }
  const bio = cleanString(req.body.bio, 190);
  const avatarData = typeof req.body.avatarData === "string" ? req.body.avatarData : "";
  const bannerData = typeof req.body.bannerData === "string" ? req.body.bannerData : "";
  if (!/^[a-z0-9_.]{3,24}$/.test(username)) {
    return res.status(400).json({ error: "O usuário deve ter 3–24 caracteres: letras minúsculas, números, _ ou ponto." });
  }
  for (const [label, data] of [["Avatar", avatarData], ["Banner", bannerData]]) {
    if (data && (!/^data:image\/(png|jpeg|webp|gif);base64,/.test(data) || data.length > 14000000)) {
      return res.status(400).json({ error: `${label}: use PNG, JPG, WEBP ou GIF de até 10 MB.` });
    }
  }
  const conflict = db.prepare("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE AND id <> ?").get(username, req.session.userId);
  if (conflict) return res.status(409).json({ error: `O nome @${username} já está em uso. Escolha outro.` });
  try {
    db.prepare(`UPDATE users SET username = ?, display_name = ?, bio = ?,
      avatar_data = CASE WHEN ? = 1 THEN '' WHEN ? = '' THEN avatar_data ELSE ? END,
      banner_data = CASE WHEN ? = 1 THEN '' WHEN ? = '' THEN banner_data ELSE ? END
      WHERE id = ?`).run(username, displayName, bio, req.body.clearAvatar ? 1 : 0, avatarData, avatarData,
        req.body.clearBanner ? 1 : 0, bannerData, bannerData, req.session.userId);
    const user = db.prepare("SELECT id, username, email, display_name, bio, avatar_data, banner_data, beta_badge, created_at FROM users WHERE id = ?").get(req.session.userId);
    res.json({ ok: true, message: "Perfil atualizado com sucesso.", user: applyBetaFlag(user) });
  } catch (error) {
    if (String(error.code).startsWith("SQLITE_CONSTRAINT")) return res.status(409).json({ error: `O nome @${username} já está em uso. Escolha outro.` });
    console.error(error);
    res.status(500).json({ error: "Não foi possível salvar seu perfil." });
  }
});


// Perfil público: somente informações que o próprio usuário escolheu exibir.
app.get("/api/users/:username", requireAuth, (req, res) => {
  const username = cleanString(req.params.username, 24).toLowerCase();
  const user = db.prepare(`SELECT id, username, display_name, bio, avatar_data, banner_data, beta_badge, created_at
    FROM users WHERE username = ? COLLATE NOCASE`).get(username);
  if (!user) return res.status(404).json({ error: "Perfil não encontrado." });
  const blocked = db.prepare("SELECT 1 FROM blocked_users WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)").get(req.session.userId,user.id,user.id,req.session.userId);
  if (blocked) return res.status(404).json({error:"Este perfil não está disponível."});
  const pref=db.prepare("SELECT profile_public FROM user_preferences WHERE user_id=?").get(user.id);
  const relation=friendshipBetween(req.session.userId,user.id);
  if (pref && !pref.profile_public && relation?.status!=="accepted" && user.id!==req.session.userId) return res.status(403).json({error:"Este perfil é privado."});
  res.json({ user: applyBetaFlag(user) });
});


// Lista comunidades e canais que pertencem ao usuário.
app.get("/api/communities", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT c.id,c.name,c.description,c.icon,c.banner_data,c.owner_id,c.invite_code,m.role
    FROM communities c JOIN community_members m ON m.community_id=c.id
    WHERE m.user_id=? ORDER BY c.id DESC
  `).all(req.session.userId);
  const channels = db.prepare("SELECT id,community_id,name,kind,position,category_id,read_role_ids,send_role_ids FROM community_channels ORDER BY position,id").all();
  const categories = db.prepare("SELECT id,community_id,name,position,private_role_ids FROM community_categories ORDER BY position,id").all();
  const result = rows.map(c => {
    const assigned = db.prepare("SELECT role_id FROM community_member_roles WHERE community_id=? AND user_id=?").all(c.id,req.session.userId).map(x=>x.role_id);
    const privileged = ["owner","admin"].includes(c.role);
    const visible = categories.filter(cat => cat.community_id===c.id && (privileged || !JSON.parse(cat.private_role_ids||"[]").length || JSON.parse(cat.private_role_ids||"[]").some(id=>assigned.includes(Number(id)))));
    const visibleIds = new Set(visible.map(cat=>cat.id));
    return {...c, channels:channels.filter(ch=>ch.community_id===c.id && (!ch.category_id || visibleIds.has(ch.category_id))), categories:visible};
  });
  res.json({ communities: result });
});
app.post("/api/communities", requireAuth, (req, res) => {
  const name = cleanString(req.body.name, 32);
  const description = cleanString(req.body.description, 160);
  const icon = typeof req.body.icon === "string" && req.body.icon.startsWith("data:image/") && req.body.icon.length <= 13*1024*1024 ? req.body.icon : "";
  const banner = typeof req.body.banner === "string" && req.body.banner.startsWith("data:image/") && req.body.banner.length <= 13*1024*1024 ? req.body.banner : "";
  if (name.length < 2) return res.status(400).json({error:"O servidor precisa ter pelo menos 2 caracteres."});
  let code = makeInviteCode();
  while (db.prepare("SELECT 1 FROM communities WHERE invite_code=?").get(code)) code = makeInviteCode();
  const result = db.prepare("INSERT INTO communities(name,description,icon,banner_data,owner_id,invite_code) VALUES(?,?,?,?,?,?)")
    .run(name, description, icon, banner, req.session.userId, code);
  const id = Number(result.lastInsertRowid);
  db.prepare("INSERT INTO community_members(community_id,user_id,role) VALUES(?,?,'owner')").run(id, req.session.userId);
  db.prepare("INSERT INTO community_channels(community_id,name,kind,position) VALUES(?,?,?,?)").run(id,"geral","text",0);
  db.prepare("INSERT INTO community_channels(community_id,name,kind,position) VALUES(?,?,?,?)").run(id,"avisos","text",1);
  const categoryId = Number(db.prepare("INSERT INTO community_categories(community_id,name,position) VALUES(?,?,0)").run(id,"CANAIS DE TEXTO").lastInsertRowid);
  db.prepare("UPDATE community_channels SET category_id=? WHERE community_id=?").run(categoryId,id);

  res.json({ok:true, community: db.prepare("SELECT * FROM communities WHERE id=?").get(id)});
});
app.post("/api/communities/join", requireAuth, (req,res) => {
  const code = cleanString(req.body.code, 16).toUpperCase();
  if (!/^[A-F0-9]{10}$/.test(code)) return res.status(400).json({error:"Código de convite inválido. Confira os 10 caracteres."});
  const community = db.prepare("SELECT id,name,owner_id FROM communities WHERE invite_code=?").get(code);
  if (!community) return res.status(404).json({error:"Convite não encontrado ou não está mais válido."});
  if (community.owner_id === req.session.userId) return res.status(409).json({error:"Você é o proprietário deste servidor e já faz parte dele."});
  if (memberOf(community.id, req.session.userId)) return res.status(409).json({error:"Você já participa deste servidor."});
  db.prepare("INSERT INTO community_members(community_id,user_id,role) VALUES(?,?,'member')").run(community.id,req.session.userId);
  res.json({ok:true,message:`Você entrou em ${community.name}.`});
});
app.post("/api/communities/:id/channels", requireAuth, (req,res) => {
  const id = Number(req.params.id), name = cleanString(req.body.name, 32);
  const kind = req.body.kind === "voice" ? "voice" : "text";
  const member = memberOf(id,req.session.userId);
  if (!member) return res.status(403).json({error:"Você não participa deste servidor."});
  if (!["owner","admin"].includes(member.role)) return res.status(403).json({error:"Somente administradores podem criar canais."});
  if (!/^[\p{L}\p{N}_-]{2,32}$/u.test(name)) return res.status(400).json({error:"Use 2–32 caracteres: letras, números, _ ou -."});
  const categoryId = Number(req.body.categoryId) || db.prepare("SELECT id FROM community_categories WHERE community_id=? ORDER BY position,id LIMIT 1").get(id)?.id || null;
  const result = db.prepare("INSERT INTO community_channels(community_id,name,kind,position,category_id) VALUES(?,?,?,(SELECT COALESCE(MAX(position),0)+1 FROM community_channels WHERE community_id=?),?)").run(id,name.toLowerCase(),kind,id,categoryId);
  res.json({ok:true,channel:db.prepare("SELECT * FROM community_channels WHERE id=?").get(Number(result.lastInsertRowid))});
});
// Lista de membros do servidor, organizada por cargos e com dados públicos.
app.get("/api/communities/:id/members", requireAuth, (req,res) => {
  const id=Number(req.params.id);
  if(!memberOf(id,req.session.userId)) return res.status(403).json({error:"Você não participa deste servidor."});
  const members=db.prepare(`SELECT u.id,u.username,u.display_name,u.bio,u.avatar_data,u.banner_data,u.beta_badge,m.role AS base_role,m.joined_at
    FROM community_members m JOIN users u ON u.id=m.user_id WHERE m.community_id=? ORDER BY u.display_name COLLATE NOCASE,u.username COLLATE NOCASE`).all(id);
  const roles=db.prepare("SELECT id,name,color,position FROM community_roles WHERE community_id=? ORDER BY position DESC,id").all(id);
  const assignments=db.prepare("SELECT user_id,role_id FROM community_member_roles WHERE community_id=? ORDER BY rowid ASC").all(id);
  const result=members.map(user=>({...applyBetaFlag(user),roles:assignments.filter(a=>a.user_id===user.id).map(a=>roles.find(r=>r.id===a.role_id)).filter(Boolean)}));
  res.json({members:result,roles});
});
app.post("/api/communities/:id/categories", requireAuth, (req,res)=>{
  const id=Number(req.params.id), member=memberOf(id,req.session.userId), name=cleanString(req.body.name,32).toUpperCase();
  if(!member) return res.status(403).json({error:"Você não participa deste servidor."});
  if(!["owner","admin"].includes(member.role)) return res.status(403).json({error:"Você não tem permissão para criar categorias."});
  if(name.length<2) return res.status(400).json({error:"Informe um nome de categoria válido."});
  const roleIds=Array.isArray(req.body.roleIds)?[...new Set(req.body.roleIds.map(Number).filter(Number.isInteger).filter(roleId=>db.prepare("SELECT 1 FROM community_roles WHERE id=? AND community_id=?").get(roleId,id)))]:[];
  if(req.body.isPrivate && !roleIds.length) return res.status(400).json({error:"Uma categoria privada precisa liberar pelo menos um cargo."});
  const privateIds=req.body.isPrivate?JSON.stringify(roleIds):"[]";
  const result=db.prepare("INSERT INTO community_categories(community_id,name,position,private_role_ids) VALUES(?,?,(SELECT COALESCE(MAX(position),0)+1 FROM community_categories WHERE community_id=?),?)").run(id,name,id,privateIds);
  res.json({ok:true,category:db.prepare("SELECT * FROM community_categories WHERE id=?").get(Number(result.lastInsertRowid))});
});
app.post("/api/communities/:id/roles", requireAuth, (req,res)=>{
  const id=Number(req.params.id), member=memberOf(id,req.session.userId), name=cleanString(req.body.name,32), color=/^#[0-9a-fA-F]{6}$/.test(req.body.color||"")?req.body.color:"#9b8cff";
  if(!member) return res.status(403).json({error:"Você não participa deste servidor."});
  if(!["owner","admin"].includes(member.role)) return res.status(403).json({error:"Somente a equipe de administração pode criar cargos."});
  if(name.length<2) return res.status(400).json({error:"O cargo precisa ter pelo menos 2 caracteres."});
  try { const result=db.prepare("INSERT INTO community_roles(community_id,name,color,position) VALUES(?,?,?,(SELECT COALESCE(MAX(position),0)+1 FROM community_roles WHERE community_id=?))").run(id,name,color,id); res.json({ok:true,role:db.prepare("SELECT id,name,color,position FROM community_roles WHERE id=?").get(Number(result.lastInsertRowid))}); }
  catch { res.status(409).json({error:"Já existe um cargo com esse nome."}); }
});
app.patch("/api/communities/:id/roles/:roleId", requireAuth, (req,res)=>{
  const id=Number(req.params.id), roleId=Number(req.params.roleId), member=memberOf(id,req.session.userId);
  if(!member || !["owner","admin"].includes(member.role)) return res.status(403).json({error:"Somente a equipe de administração pode editar cargos."});
  const role=db.prepare("SELECT id FROM community_roles WHERE id=? AND community_id=?").get(roleId,id);
  if(!role) return res.status(404).json({error:"Cargo não encontrado."});
  const name=cleanString(req.body.name,32), color=/^#[0-9a-fA-F]{6}$/.test(req.body.color||"")?req.body.color:"#9b8cff";
  if(name.length<2) return res.status(400).json({error:"O cargo precisa ter pelo menos 2 caracteres."});
  try {
    const currentPosition=db.prepare("SELECT position FROM community_roles WHERE id=? AND community_id=?").get(roleId,id).position;
    const position=Number.isFinite(Number(req.body.position))?Math.max(0,Math.min(9999,Math.trunc(Number(req.body.position)))):currentPosition;
    db.prepare("UPDATE community_roles SET name=?,color=?,position=? WHERE id=? AND community_id=?").run(name,color,position,roleId,id);
    res.json({ok:true,role:db.prepare("SELECT id,name,color,position FROM community_roles WHERE id=?").get(roleId)});
  } catch { res.status(409).json({error:"Já existe outro cargo com esse nome."}); }
});
app.post("/api/communities/:id/members/:userId/roles", requireAuth, (req,res)=>{
  const id=Number(req.params.id), target=Number(req.params.userId), roleId=Number(req.body.roleId), actor=memberOf(id,req.session.userId);
  if(!actor || !["owner","admin"].includes(actor.role)) return res.status(403).json({error:"Você não tem permissão para gerenciar cargos."});
  const targetMember=memberOf(id,target);
  if(!targetMember) return res.status(404).json({error:"Membro não encontrado neste servidor."});
  if(targetMember.role==="owner" && !(actor.role==="owner" && target===req.session.userId)) return res.status(403).json({error:"Somente o proprietário pode gerenciar os próprios cargos; outros membros não podem alterar o proprietário."});
  if(req.session.userId===target && actor.role!=="owner") return res.status(403).json({error:"Somente o proprietário pode gerenciar os próprios cargos."});
  const role=db.prepare("SELECT id FROM community_roles WHERE id=? AND community_id=?").get(roleId,id);
  if(!role) return res.status(404).json({error:"Cargo não encontrado."});
  db.prepare("INSERT OR IGNORE INTO community_member_roles(community_id,user_id,role_id) VALUES(?,?,?)").run(id,target,roleId);
  res.json({ok:true});
});
app.delete("/api/communities/:id/members/:userId/roles/:roleId", requireAuth, (req,res)=>{
  const id=Number(req.params.id), target=Number(req.params.userId), roleId=Number(req.params.roleId), actor=memberOf(id,req.session.userId);
  if(!actor || !["owner","admin"].includes(actor.role)) return res.status(403).json({error:"Você não tem permissão para gerenciar cargos."});
  const targetMember=memberOf(id,target);
  if(!targetMember) return res.status(404).json({error:"Membro não encontrado neste servidor."});
  if(targetMember.role==="owner" && !(actor.role==="owner" && target===req.session.userId)) return res.status(403).json({error:"Somente o proprietário pode gerenciar os próprios cargos; outros membros não podem alterar o proprietário."});
  if(req.session.userId===target && actor.role!=="owner") return res.status(403).json({error:"Somente o proprietário pode gerenciar os próprios cargos."});
  const result=db.prepare("DELETE FROM community_member_roles WHERE community_id=? AND user_id=? AND role_id=? AND role_id IN (SELECT id FROM community_roles WHERE community_id=?)").run(id,target,roleId,id);
  if(!result.changes) return res.status(404).json({error:"Esse cargo não está atribuído a este membro."});
  res.json({ok:true});
});

app.patch("/api/communities/:id/categories/:categoryId/permissions", requireAuth, (req,res)=>{
  const id=Number(req.params.id), categoryId=Number(req.params.categoryId), member=memberOf(id,req.session.userId);
  if(!member || !["owner","admin"].includes(member.role)) return res.status(403).json({error:"Somente a equipe de administração pode alterar a visibilidade das categorias."});
  if(!db.prepare("SELECT id FROM community_categories WHERE id=? AND community_id=?").get(categoryId,id)) return res.status(404).json({error:"Categoria não encontrada."});
  const ids=Array.isArray(req.body.roleIds)?[...new Set(req.body.roleIds.map(Number).filter(Number.isInteger).filter(roleId=>db.prepare("SELECT 1 FROM community_roles WHERE id=? AND community_id=?").get(roleId,id)))]:[];
  if(req.body.isPrivate && !ids.length) return res.status(400).json({error:"Uma categoria privada precisa liberar pelo menos um cargo."});
  db.prepare("UPDATE community_categories SET private_role_ids=? WHERE id=? AND community_id=?").run(req.body.isPrivate?JSON.stringify(ids):"[]",categoryId,id);
  res.json({ok:true});
});
app.patch("/api/communities/:id/channels/:channelId/category", requireAuth, (req,res)=>{
  const id=Number(req.params.id), channelId=Number(req.params.channelId), member=memberOf(id,req.session.userId);
  if(!member || !["owner","admin"].includes(member.role)) return res.status(403).json({error:"Somente a equipe de administração pode mover canais."});
  const channel=db.prepare("SELECT id FROM community_channels WHERE id=? AND community_id=?").get(channelId,id);
  if(!channel) return res.status(404).json({error:"Canal não encontrado."});
  const categoryId=req.body.categoryId===null || req.body.categoryId==="" ? null : Number(req.body.categoryId);
  if(categoryId!==null && !db.prepare("SELECT 1 FROM community_categories WHERE id=? AND community_id=?").get(categoryId,id)) return res.status(400).json({error:"Categoria inválida para este servidor."});
  db.prepare("UPDATE community_channels SET category_id=? WHERE id=? AND community_id=?").run(categoryId,channelId,id);
  res.json({ok:true});
});

app.patch("/api/communities/:id/channels/:channelId/permissions", requireAuth, (req,res)=>{
  const id=Number(req.params.id), channelId=Number(req.params.channelId), member=memberOf(id,req.session.userId);
  if(!member || !["owner","admin"].includes(member.role)) return res.status(403).json({error:"Somente a equipe de administração pode alterar permissões."});
  const channel=db.prepare("SELECT id FROM community_channels WHERE id=? AND community_id=?").get(channelId,id);
  if(!channel) return res.status(404).json({error:"Canal não encontrado."});
  const cleanIds=value=>Array.isArray(value)?[...new Set(value.map(Number).filter(Number.isInteger).filter(roleId=>db.prepare("SELECT 1 FROM community_roles WHERE id=? AND community_id=?").get(roleId,id)))]:[];
  const read=JSON.stringify(cleanIds(req.body.readRoleIds)), send=JSON.stringify(cleanIds(req.body.sendRoleIds));
  db.prepare("UPDATE community_channels SET read_role_ids=?,send_role_ids=? WHERE id=?").run(read,send,channelId);
  res.json({ok:true});
});
// Sinalização de voz WebRTC: presença e troca de ofertas/ICE via SQLite.
db.exec(`
CREATE TABLE IF NOT EXISTS voice_participants (
  channel_id INTEGER NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(channel_id,user_id)
);
CREATE TABLE IF NOT EXISTS voice_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voice_signals_target ON voice_signals(channel_id,to_user_id,id);
`);
app.post("/api/voice/:channelId/join", requireAuth, (req,res)=>{
  const channelId=Number(req.params.channelId);
  const channel=db.prepare("SELECT community_id,kind FROM community_channels WHERE id=?").get(channelId);
  if(!channel || channel.kind!=="voice" || !channelPermission(channelId,req.session.userId,"read")) return res.status(403).json({error:"Você não tem acesso a este canal de voz."});
  const now=Date.now();
  db.prepare("DELETE FROM voice_participants WHERE updated_at<?").run(now-25000);
  db.prepare("INSERT INTO voice_participants(channel_id,user_id,updated_at) VALUES(?,?,?) ON CONFLICT(channel_id,user_id) DO UPDATE SET updated_at=excluded.updated_at").run(channelId,req.session.userId,now);
  const participants=db.prepare(`SELECT u.id,u.username,u.display_name,u.avatar_data,v.updated_at FROM voice_participants v JOIN users u ON u.id=v.user_id WHERE v.channel_id=? AND v.updated_at>? ORDER BY v.updated_at`).all(channelId,now-25000);
  res.json({participants,selfId:req.session.userId});
});
app.post("/api/voice/:channelId/leave", requireAuth, (req,res)=>{
  const channelId=Number(req.params.channelId);
  db.prepare("DELETE FROM voice_participants WHERE channel_id=? AND user_id=?").run(channelId,req.session.userId);
  db.prepare("DELETE FROM voice_signals WHERE channel_id=? AND to_user_id=?").run(channelId,req.session.userId);
  res.json({ok:true});
});
app.get("/api/voice/:channelId/state", requireAuth, (req,res)=>{
  const channelId=Number(req.params.channelId), channel=db.prepare("SELECT kind FROM community_channels WHERE id=?").get(channelId);
  if(!channel || channel.kind!=="voice" || !channelPermission(channelId,req.session.userId,"read")) return res.status(403).json({error:"Canal de voz indisponível."});
  const now=Date.now();
  db.prepare("DELETE FROM voice_participants WHERE updated_at<?").run(now-25000);
  db.prepare("DELETE FROM voice_signals WHERE created_at<?").run(now-120000);
  const participants=db.prepare(`SELECT u.id,u.username,u.display_name,u.avatar_data FROM voice_participants v JOIN users u ON u.id=v.user_id WHERE v.channel_id=? AND v.updated_at>? ORDER BY v.updated_at`).all(channelId,now-25000);
  const after=Math.max(0,Number(req.query.after)||0);
  const signals=db.prepare("SELECT id,from_user_id,signal_type,payload FROM voice_signals WHERE channel_id=? AND to_user_id=? AND id>? ORDER BY id LIMIT 100").all(channelId,req.session.userId,after);
  if(signals.length) db.prepare("DELETE FROM voice_signals WHERE id<=? AND channel_id=? AND to_user_id=?").run(signals[signals.length-1].id,channelId,req.session.userId);
  res.json({participants,signals:signals.map(x=>({...x,payload:JSON.parse(x.payload)}))});
});
app.post("/api/voice/:channelId/signal", requireAuth, (req,res)=>{
  const channelId=Number(req.params.channelId), toUserId=Number(req.body.toUserId), type=String(req.body.type||"");
  const channel=db.prepare("SELECT kind FROM community_channels WHERE id=?").get(channelId);
  if(!channel || channel.kind!=="voice" || !channelPermission(channelId,req.session.userId,"read") || !channelPermission(channelId,toUserId,"read")) return res.status(403).json({error:"Não foi possível sinalizar este participante."});
  if(!["offer","answer","ice","hangup"].includes(type)) return res.status(400).json({error:"Sinal inválido."});
  const payload=JSON.stringify(req.body.payload??{});
  if(payload.length>250000) return res.status(413).json({error:"Sinal muito grande."});
  db.prepare("INSERT INTO voice_signals(channel_id,from_user_id,to_user_id,signal_type,payload,created_at) VALUES(?,?,?,?,?,?)").run(channelId,req.session.userId,toUserId,type,payload,Date.now());
  res.json({ok:true});
});

app.get("/api/channels/:id/messages", requireAuth, (req,res) => {
  const channelId=Number(req.params.id);
  const channel=db.prepare("SELECT community_id FROM community_channels WHERE id=?").get(channelId);
  if (!channel || !channelPermission(channelId,req.session.userId,"read")) return res.status(403).json({error:"Você não tem acesso a este canal."});
  const after=Math.max(0,Number(req.query.after)||0);
  const messages=db.prepare(`SELECT m.id,m.content,m.created_at,u.id AS user_id,u.username,u.display_name,u.bio,u.avatar_data,u.banner_data,u.beta_badge,
      (SELECT r.color FROM community_member_roles mr JOIN community_roles r ON r.id=mr.role_id
       WHERE mr.community_id=(SELECT community_id FROM community_channels WHERE id=m.channel_id) AND mr.user_id=u.id
       ORDER BY mr.rowid ASC LIMIT 1) AS primary_role_color
    FROM community_messages m JOIN users u ON u.id=m.user_id
    WHERE m.channel_id=? AND m.id>? ORDER BY m.id DESC LIMIT 60`).all(channelId,after).reverse()
    .map(m=>({...m,is_beta:applyBetaFlag({username:m.username,beta_badge:m.beta_badge}).is_beta}));
  res.json({messages});
});
app.post("/api/channels/:id/messages", requireAuth, (req,res) => {
  const channelId=Number(req.params.id), content=cleanString(req.body.content,1500);
  const channel=db.prepare("SELECT community_id FROM community_channels WHERE id=?").get(channelId);
  if (!channel || !channelPermission(channelId,req.session.userId,"send")) return res.status(403).json({error:"Você não tem permissão para enviar mensagens neste canal."});
  if (!content) return res.status(400).json({error:"Digite uma mensagem antes de enviar."});
  const result=db.prepare("INSERT INTO community_messages(channel_id,user_id,content) VALUES(?,?,?)").run(channelId,req.session.userId,content);
  const message=db.prepare(`SELECT m.id,m.content,m.created_at,u.id AS user_id,u.username,u.display_name,u.bio,u.avatar_data,u.banner_data,u.beta_badge,
    (SELECT r.color FROM community_member_roles mr JOIN community_roles r ON r.id=mr.role_id
     WHERE mr.community_id=? AND mr.user_id=u.id ORDER BY mr.rowid ASC LIMIT 1) AS primary_role_color
    FROM community_messages m JOIN users u ON u.id=m.user_id WHERE m.id=?`).get(channel.community_id,Number(result.lastInsertRowid));
  res.json({ok:true,message:{...message,is_beta:applyBetaFlag({username:message.username,beta_badge:message.beta_badge}).is_beta}});
});
app.delete("/api/channels/:channelId/messages/:messageId", requireAuth, (req,res)=>{
  const channelId=Number(req.params.channelId), messageId=Number(req.params.messageId);
  const message=db.prepare("SELECT id,user_id FROM community_messages WHERE id=? AND channel_id=?").get(messageId,channelId);
  if(!message) return res.status(404).json({error:"Mensagem não encontrada."});
  if(message.user_id!==req.session.userId) return res.status(403).json({error:"Você só pode excluir suas próprias mensagens."});
  db.prepare("DELETE FROM community_messages WHERE id=?").run(messageId);
  res.json({ok:true});
});
// Configurações do servidor: proprietário controla identidade e exclusão; equipe gerencia estrutura.
app.patch("/api/communities/:id", requireAuth, (req,res)=>{
  const id=Number(req.params.id), community=db.prepare("SELECT * FROM communities WHERE id=?").get(id);
  if(!community) return res.status(404).json({error:"Servidor não encontrado."});
  if(community.owner_id!==req.session.userId) return res.status(403).json({error:"Somente o proprietário pode alterar os dados principais."});
  const name=cleanString(req.body.name ?? community.name,32), description=cleanString(req.body.description ?? community.description,160);
  let icon=community.icon, banner=community.banner_data||"";
  if(req.body.clearIcon) icon="";
  else if(typeof req.body.icon==="string"){
    if(req.body.icon && (!req.body.icon.startsWith("data:image/") || req.body.icon.length>13*1024*1024)) return res.status(400).json({error:"A imagem deve ser PNG, JPG ou WEBP e ter até 8 MB."});
    icon=req.body.icon;
  }
  if(typeof req.body.banner==="string"){
    if(req.body.banner && (!req.body.banner.startsWith("data:image/") || req.body.banner.length>13*1024*1024)) return res.status(400).json({error:"O banner deve ser PNG, JPG ou WEBP e ter até 8 MB."});
    banner=req.body.banner;
  }
  if(req.body.clearBanner) banner="";
  if(name.length<2) return res.status(400).json({error:"O nome precisa ter pelo menos 2 caracteres."});
  db.prepare("UPDATE communities SET name=?,description=?,icon=?,banner_data=? WHERE id=?").run(name,description,icon,banner,id);
  res.json({ok:true,community:db.prepare("SELECT id,name,description,icon,banner_data,owner_id,invite_code FROM communities WHERE id=?").get(id)});
});
app.delete("/api/communities/:id", requireAuth, (req,res)=>{
  const id=Number(req.params.id), community=db.prepare("SELECT owner_id FROM communities WHERE id=?").get(id);
  if(!community) return res.status(404).json({error:"Servidor não encontrado."});
  if(community.owner_id!==req.session.userId) return res.status(403).json({error:"Somente o proprietário pode excluir este servidor."});
  db.prepare("DELETE FROM communities WHERE id=?").run(id);
  res.json({ok:true});
});
app.delete("/api/communities/:id/categories/:categoryId", requireAuth, (req,res)=>{
  const id=Number(req.params.id), cat=Number(req.params.categoryId), member=memberOf(id,req.session.userId);
  if(!member || !["owner","admin"].includes(member.role)) return res.status(403).json({error:"Sem permissão para excluir categorias."});
  db.prepare("UPDATE community_channels SET category_id=(SELECT id FROM community_categories WHERE community_id=? AND id<>? ORDER BY position,id LIMIT 1) WHERE community_id=? AND category_id=?").run(id,cat,id,cat);
  const result=db.prepare("DELETE FROM community_categories WHERE id=? AND community_id=?").run(cat,id);
  if(!result.changes) return res.status(404).json({error:"Categoria não encontrada."});
  res.json({ok:true});
});
app.delete("/api/communities/:id/channels/:channelId", requireAuth, (req,res)=>{
  const id=Number(req.params.id), channelId=Number(req.params.channelId), member=memberOf(id,req.session.userId);
  if(!member || !["owner","admin"].includes(member.role)) return res.status(403).json({error:"Sem permissão para excluir canais."});
  const result=db.prepare("DELETE FROM community_channels WHERE id=? AND community_id=?").run(channelId,id);
  if(!result.changes) return res.status(404).json({error:"Canal não encontrado."});
  res.json({ok:true});
});
app.delete("/api/communities/:id/roles/:roleId", requireAuth, (req,res)=>{
  const id=Number(req.params.id), roleId=Number(req.params.roleId), member=memberOf(id,req.session.userId);
  if(!member || !["owner","admin"].includes(member.role)) return res.status(403).json({error:"Sem permissão para excluir cargos."});
  const result=db.prepare("DELETE FROM community_roles WHERE id=? AND community_id=?").run(roleId,id);
  if(!result.changes) return res.status(404).json({error:"Cargo não encontrado."});
  res.json({ok:true});
});
app.post("/api/communities/:id/invite", requireAuth, (req,res) => {
  const id=Number(req.params.id), member=memberOf(id,req.session.userId);
  if (!member) return res.status(403).json({error:"Você não participa deste servidor."});
  const community=db.prepare("SELECT invite_code FROM communities WHERE id=?").get(id);
  res.json({invite_code:community.invite_code});
});


// Etapa 6: amizades, solicitações, conversas privadas e anexos.
db.exec(`
CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(requester_id,addressee_id),
  CHECK(requester_id <> addressee_id)
);
CREATE TABLE IF NOT EXISTS dm_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  friendship_id INTEGER NOT NULL REFERENCES friendships(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  attachment_data TEXT NOT NULL DEFAULT '',
  attachment_name TEXT NOT NULL DEFAULT '',
  attachment_type TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dm_messages_friendship ON dm_messages(friendship_id,id);
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  profile_public INTEGER NOT NULL DEFAULT 1,
  friend_requests INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS blocked_users (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(blocker_id,blocked_id), CHECK(blocker_id <> blocked_id)
);
CREATE TABLE IF NOT EXISTS user_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sid TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT 'Navegador',
  last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
function friendshipBetween(a,b){
  return db.prepare(`SELECT * FROM friendships WHERE
    (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)`).get(a,b,b,a);
}
function friendUser(id){
  return db.prepare("SELECT id,username,display_name,avatar_data,beta_badge FROM users WHERE id=?").get(id);
}
app.get("/api/friends/search", requireAuth, (req,res)=>{
  const username=cleanString(req.query.username,24).toLowerCase();
  if(!/^[a-z0-9_.]{3,24}$/.test(username)) return res.json({user:null});
  const user=db.prepare("SELECT id,username,display_name,avatar_data,beta_badge FROM users WHERE username=? COLLATE NOCASE AND id<>?").get(username,req.session.userId);
  if(!user) return res.json({user:null});
  const blocked=db.prepare("SELECT 1 FROM blocked_users WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)").get(req.session.userId,user.id,user.id,req.session.userId);
  if(blocked) return res.json({user:null});
  const relation=friendshipBetween(req.session.userId,user.id);
  res.json({user:{...user,is_beta:applyBetaFlag(user).is_beta,relationship:!relation?"none":relation.status==="accepted"?"friends":relation.requester_id===req.session.userId?"sent":"received"}});
});
app.post("/api/friends/request", requireAuth, (req,res)=>{
  const username=cleanString(req.body.username,24).toLowerCase();
  const target=db.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE").get(username);
  if(!target || target.id===req.session.userId) return res.status(404).json({error:"Usuário não encontrado."});
  const prefs=db.prepare("SELECT friend_requests FROM user_preferences WHERE user_id=?").get(target.id);
  if(prefs && !prefs.friend_requests) return res.status(403).json({error:"Este usuário não está recebendo solicitações."});
  const blocked=db.prepare("SELECT 1 FROM blocked_users WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)").get(req.session.userId,target.id,target.id,req.session.userId);
  if(blocked) return res.status(404).json({error:"Usuário não encontrado."});
  const old=friendshipBetween(req.session.userId,target.id);
  if(old?.status==="accepted") return res.status(409).json({error:"Vocês já são amigos."});
  if(old?.status==="pending") return res.status(409).json({error:"Já existe uma solicitação entre vocês."});
  db.prepare("INSERT INTO friendships(requester_id,addressee_id) VALUES(?,?)").run(req.session.userId,target.id);
  res.json({ok:true,message:"Solicitação enviada."});
});
app.get("/api/friends/requests", requireAuth, (req,res)=>{
  const uid=req.session.userId;
  const incoming=db.prepare(`SELECT f.id,f.created_at,u.username,u.display_name,u.avatar_data
    FROM friendships f JOIN users u ON u.id=f.requester_id WHERE f.addressee_id=? AND f.status='pending' ORDER BY f.id DESC`).all(uid);
  const outgoing=db.prepare(`SELECT f.id,f.created_at,u.username,u.display_name,u.avatar_data
    FROM friendships f JOIN users u ON u.id=f.addressee_id WHERE f.requester_id=? AND f.status='pending' ORDER BY f.id DESC`).all(uid);
  const friends=db.prepare(`SELECT f.id,f.created_at,u.id AS user_id,u.username,u.display_name,u.avatar_data
    FROM friendships f JOIN users u ON u.id=CASE WHEN f.requester_id=? THEN f.addressee_id ELSE f.requester_id END
    WHERE (f.requester_id=? OR f.addressee_id=?) AND f.status='accepted' ORDER BY u.username`).all(uid,uid,uid);
  res.json({incoming,outgoing,friends});
});
app.post("/api/friends/:id/accept", requireAuth, (req,res)=>{
  const f=db.prepare("SELECT * FROM friendships WHERE id=? AND addressee_id=? AND status='pending'").get(Number(req.params.id),req.session.userId);
  if(!f) return res.status(404).json({error:"Solicitação não encontrada."});
  db.prepare("UPDATE friendships SET status='accepted' WHERE id=?").run(f.id);
  res.json({ok:true});
});
app.delete("/api/friends/:id", requireAuth, (req,res)=>{
  const f=db.prepare("SELECT * FROM friendships WHERE id=? AND (requester_id=? OR addressee_id=?)").get(Number(req.params.id),req.session.userId,req.session.userId);
  if(!f) return res.status(404).json({error:"Relação não encontrada."});
  db.prepare("DELETE FROM friendships WHERE id=?").run(f.id);
  res.json({ok:true});
});
app.get("/api/dm/:friendId/messages", requireAuth, (req,res)=>{
  const friendId=Number(req.params.friendId), f=friendshipBetween(req.session.userId,friendId);
  const blocked=db.prepare("SELECT 1 FROM blocked_users WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)").get(req.session.userId,friendId,friendId,req.session.userId);
  if(blocked || !f || f.status!=="accepted") return res.status(403).json({error:"Esta conversa não está disponível."});
  const after=Math.max(0,Number(req.query.after)||0);
  const rows=db.prepare(`SELECT m.id,m.content,m.attachment_data,m.attachment_name,m.attachment_type,m.created_at,m.sender_id,u.username,u.display_name
    FROM dm_messages m JOIN users u ON u.id=m.sender_id WHERE m.friendship_id=? AND m.id>? ORDER BY m.id LIMIT 100`).all(f.id,after);
  res.json({messages:rows});
});
app.post("/api/dm/:friendId/messages", requireAuth, (req,res)=>{
  const friendId=Number(req.params.friendId), f=friendshipBetween(req.session.userId,friendId);
  const blocked=db.prepare("SELECT 1 FROM blocked_users WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)").get(req.session.userId,friendId,friendId,req.session.userId);
  if(blocked || !f || f.status!=="accepted") return res.status(403).json({error:"Esta conversa não está disponível."});
  const content=cleanString(req.body.content,2000);
  const data=typeof req.body.attachmentData==="string"?req.body.attachmentData:"";
  const name=cleanString(req.body.attachmentName,120), type=cleanString(req.body.attachmentType,80);
  if(!content && !data) return res.status(400).json({error:"Escreva uma mensagem ou anexe um arquivo."});
  if(data && (!/^data:(image\/(png|jpeg|webp|gif)|audio\/(webm|ogg|mp4|mpeg)(?:;[^;,]+)?|video\/(mp4|webm|quicktime)|application\/(pdf|zip|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|msword|vnd\.ms-excel|octet-stream)|text\/(plain|csv));base64,/.test(data) || data.length>11000000))
    return res.status(400).json({error:"Arquivo inválido ou maior que o limite de 8 MB."});
  const result=db.prepare(`INSERT INTO dm_messages(friendship_id,sender_id,content,attachment_data,attachment_name,attachment_type)
    VALUES(?,?,?,?,?,?)`).run(f.id,req.session.userId,content,data,name,type);
  const message=db.prepare("SELECT * FROM dm_messages WHERE id=?").get(Number(result.lastInsertRowid));
  res.json({ok:true,message});
});
app.delete("/api/dm/:friendId/messages/:messageId", requireAuth, (req,res)=>{
  const friendId=Number(req.params.friendId), messageId=Number(req.params.messageId);
  const friendship=friendshipBetween(req.session.userId,friendId);
  if(!friendship || friendship.status!=="accepted") return res.status(403).json({error:"Esta conversa não está disponível."});
  const message=db.prepare("SELECT id,sender_id FROM dm_messages WHERE id=? AND friendship_id=?").get(messageId,friendship.id);
  if(!message) return res.status(404).json({error:"Mensagem não encontrada."});
  if(message.sender_id!==req.session.userId) return res.status(403).json({error:"Você só pode excluir suas próprias mensagens."});
  db.prepare("DELETE FROM dm_messages WHERE id=?").run(messageId);
  res.json({ok:true});
});

// Etapa 7: controles reais de conta, privacidade, segurança, dispositivos e bloqueios.
app.get("/api/settings", requireAuth, (req,res)=>{
  registerDevice(req,req.session.userId);
  db.prepare("DELETE FROM user_devices WHERE sid NOT IN (SELECT sid FROM sessions)").run();
  db.prepare("INSERT OR IGNORE INTO user_preferences(user_id) VALUES(?)").run(req.session.userId);
  const preferences=db.prepare("SELECT profile_public,friend_requests FROM user_preferences WHERE user_id=?").get(req.session.userId);
  const devices=db.prepare("SELECT id,label,last_seen,sid FROM user_devices WHERE user_id=? ORDER BY last_seen DESC").all(req.session.userId)
    .map(d=>({id:d.id,label:d.label,last_seen:d.last_seen,current:d.sid===req.sessionID}));
  const blocked=db.prepare("SELECT u.username,u.display_name FROM blocked_users b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=? ORDER BY b.created_at DESC").all(req.session.userId);
  res.json({preferences,devices,blocked});
});
app.patch("/api/settings/privacy", requireAuth, (req,res)=>{
  const profilePublic=req.body.profilePublic===false?0:1, friendRequests=req.body.friendRequests===false?0:1;
  db.prepare("INSERT INTO user_preferences(user_id,profile_public,friend_requests) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET profile_public=excluded.profile_public,friend_requests=excluded.friend_requests,updated_at=CURRENT_TIMESTAMP")
    .run(req.session.userId,profilePublic,friendRequests);
  res.json({ok:true,preferences:{profile_public:profilePublic,friend_requests:friendRequests}});
});
app.post("/api/settings/password", requireAuth, async (req,res)=>{
  const current=String(req.body.currentPassword||""), next=String(req.body.newPassword||"");
  if(next.length<8 || next.length>128) return res.status(400).json({error:"A nova senha deve ter entre 8 e 128 caracteres."});
  const user=db.prepare("SELECT password_hash FROM users WHERE id=?").get(req.session.userId);
  if(!user || !(await bcrypt.compare(current,user.password_hash))) return res.status(400).json({error:"A senha atual não confere."});
  const hash=await bcrypt.hash(next,12); db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hash,req.session.userId);
  const other=db.prepare("SELECT sid FROM user_devices WHERE user_id=? AND sid<>?").all(req.session.userId,req.sessionID);
  const remove=db.prepare("DELETE FROM sessions WHERE sid=?"); other.forEach(d=>remove.run(d.sid));
  db.prepare("DELETE FROM user_devices WHERE user_id=? AND sid<>?").run(req.session.userId,req.sessionID);
  res.json({ok:true,message:"Senha alterada. Outros dispositivos foram desconectados."});
});
app.get("/api/settings/export", requireAuth, (req,res)=>{
  const user=db.prepare("SELECT id,username,email,display_name,bio,created_at FROM users WHERE id=?").get(req.session.userId);
  const friends=db.prepare("SELECT u.username,u.display_name,f.status,f.created_at FROM friendships f JOIN users u ON u.id=CASE WHEN f.requester_id=? THEN f.addressee_id ELSE f.requester_id END WHERE f.requester_id=? OR f.addressee_id=?").all(req.session.userId,req.session.userId,req.session.userId);
  const messages=db.prepare("SELECT sender_id,content,attachment_name,attachment_type,created_at FROM dm_messages WHERE friendship_id IN (SELECT id FROM friendships WHERE requester_id=? OR addressee_id=?) ORDER BY id").all(req.session.userId,req.session.userId);
  res.setHeader("Content-Disposition","attachment; filename=veyronix-dados.json"); res.json({exported_at:new Date().toISOString(),account:user,friends,messages});
});
app.delete("/api/settings/blocked/:username", requireAuth, (req,res)=>{
  const target=db.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE").get(cleanString(req.params.username,24));
  if(target) db.prepare("DELETE FROM blocked_users WHERE blocker_id=? AND blocked_id=?").run(req.session.userId,target.id);
  res.json({ok:true});
});
app.post("/api/users/:username/block", requireAuth, (req,res)=>{
  const target=db.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE").get(cleanString(req.params.username,24));
  if(!target || target.id===req.session.userId) return res.status(404).json({error:"Usuário não encontrado."});
  db.prepare("INSERT OR IGNORE INTO blocked_users(blocker_id,blocked_id) VALUES(?,?)").run(req.session.userId,target.id);
  db.prepare("DELETE FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)").run(req.session.userId,target.id,target.id,req.session.userId);
  res.json({ok:true,message:"Usuário bloqueado."});
});
app.delete("/api/settings/devices/:id", requireAuth, (req,res)=>{
  const device=db.prepare("SELECT sid FROM user_devices WHERE id=? AND user_id=?").get(Number(req.params.id),req.session.userId);
  if(!device) return res.status(404).json({error:"Dispositivo não encontrado."});
  if(device.sid===req.sessionID) return res.status(400).json({error:"Use Sair para encerrar o dispositivo atual."});
  db.prepare("DELETE FROM sessions WHERE sid=?").run(device.sid); db.prepare("DELETE FROM user_devices WHERE id=?").run(Number(req.params.id));
  res.json({ok:true});
});
app.post("/api/settings/logout-all", requireAuth, (req,res)=>{
  const ids=db.prepare("SELECT sid FROM user_devices WHERE user_id=? AND sid<>?").all(req.session.userId,req.sessionID);
  const del=db.prepare("DELETE FROM sessions WHERE sid=?"); ids.forEach(x=>del.run(x.sid));
  db.prepare("DELETE FROM user_devices WHERE user_id=? AND sid<>?").run(req.session.userId,req.sessionID);
  res.json({ok:true,closed:ids.length});
});
// Members and role controls: only owners may grant/revoke admin; admins can manage regular members.
app.get("/api/communities/:id/members", requireAuth, (req,res)=>{
  const id=Number(req.params.id); if(!memberOf(id,req.session.userId)) return res.status(403).json({error:"Você não participa deste servidor."});
  const members=db.prepare("SELECT u.id,u.username,u.display_name,u.avatar_data,m.role,m.joined_at FROM community_members m JOIN users u ON u.id=m.user_id WHERE m.community_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,u.username").all(id);
  res.json({members});
});
app.patch("/api/communities/:id/members/:userId/role", requireAuth, (req,res)=>{
  const id=Number(req.params.id), target=Number(req.params.userId), actor=memberOf(id,req.session.userId), targetMember=memberOf(id,target), role=String(req.body.role||'');
  if(!actor || !targetMember) return res.status(404).json({error:"Membro não encontrado."});
  if(!['admin','member'].includes(role)) return res.status(400).json({error:"Cargo inválido."});
  if(actor.role!=='owner' && (actor.role!=='admin' || role!=='member' || targetMember.role!=='member')) return res.status(403).json({error:"Você não tem permissão para alterar este cargo."});
  if(targetMember.role==='owner') return res.status(403).json({error:"O proprietário não pode perder o cargo por aqui."});
  db.prepare("UPDATE community_members SET role=? WHERE community_id=? AND user_id=?").run(role,id,target);
  res.json({ok:true});
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  db.prepare("DELETE FROM user_devices WHERE sid=?").run(req.sessionID);
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Não foi possível encerrar a sessão." });
    res.clearCookie("veyronix.sid", { httpOnly: true, sameSite: "lax", secure: isProduction });
    res.json({ ok: true });
  });
});

app.get("/health", (_req, res) => res.status(200).json({ ok: true, service: "veyronix", timestamp: new Date().toISOString() }));

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const httpServer = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Veyronix Web escutando na porta ${PORT} (0.0.0.0)`);
  console.log(`Acesso local neste aparelho: http://127.0.0.1:${PORT}`);
  console.log(`Para acesso externo com microfone, publique usando HTTPS.`);
  console.log(`Banco persistente: ${dbPath}`);
});

// Finaliza as gravações do SQLite/WAL ao encerrar pelo Termux.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal}: finalizando e salvando os dados...`);
  httpServer.close(() => {
    try { db.exec("PRAGMA wal_checkpoint(FULL);"); db.close(); }
    catch (error) { console.error("Falha ao finalizar o banco:", error.message); }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
