// Route handlers. Every mutating handler checks auth, ownership and roles.

import { json, bad, uuid, now, readJson, setCookie, clearCookie } from "./util.js";
import { requireUser, requireRole, signJWT, randomState, githubExchange, verifyJWT } from "./auth.js";
import { validateLayout, cleanText, validateCategory } from "./validate.js";
import { parseCookies } from "./util.js";

/* ---------------- Auth ---------------- */

export function authGithub(req, env) {
  const state = randomState();
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  u.searchParams.set("redirect_uri", env.GITHUB_REDIRECT);
  u.searchParams.set("scope", "read:user");
  u.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: { Location: u.toString(), "Set-Cookie": setCookie("oauthstate", state, { maxAge: 600 }) },
  });
}

export async function authCallback(req, env, _params, url) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const saved = parseCookies(req).oauthstate;
  if (!code || !state || !saved || state !== saved) bad("invalid OAuth state", 400);

  const gh = await githubExchange(code, env);
  const ghId = gh.id;
  let user = await env.DB.prepare("SELECT * FROM users WHERE github_id = ?").bind(ghId).first();
  if (!user) {
    // derive a unique username from the GitHub login
    let base = cleanText(gh.login || ("user" + ghId), 32).replace(/[^A-Za-z0-9_-]/g, "") || ("user" + ghId);
    let username = base, n = 1;
    while (await env.DB.prepare("SELECT 1 FROM users WHERE username = ?").bind(username).first()) {
      username = base + (++n);
    }
    const id = uuid();
    await env.DB.prepare(
      "INSERT INTO users (id, github_id, username, display_name, role, created_at) VALUES (?,?,?,?,?,?)"
    ).bind(id, ghId, username, cleanText(gh.name || username, 60), "user", now()).run();
    user = { id, username, role: "user" };
  }
  const token = await signJWT({ uid: user.id, role: user.role }, env.JWT_SECRET);
  return new Response(null, {
    status: 302,
    headers: {
      Location: env.APP_URL,
      "Set-Cookie": setCookie("session", token, { maxAge: 60 * 60 * 24 * 7, sameSite: "Lax" }),
    },
  });
}

export function authLogout() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json", "Set-Cookie": clearCookie("session") },
  });
}

export async function me(req, env) {
  const u = await requireUser(req, env);
  return json({ id: u.id, username: u.username, display_name: u.display_name, role: u.role });
}

/* ---------------- Private layouts ---------------- */

export async function listLayouts(req, env) {
  const u = await requireUser(req, env);
  const r = await env.DB.prepare(
    "SELECT id, name, updated_at FROM layouts WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200"
  ).bind(u.id).all();
  return json({ layouts: r.results || [] });
}

export async function createLayout(req, env) {
  const u = await requireUser(req, env);
  const body = await readJson(req);
  const name = cleanText(body.name, 80) || "Untitled";
  const data = validateLayout(body.data);
  // cap how many layouts one user keeps
  const count = await env.DB.prepare("SELECT COUNT(*) c FROM layouts WHERE user_id = ?").bind(u.id).first();
  if (count && count.c >= 200) bad("layout limit reached (200)", 409);
  const id = uuid();
  await env.DB.prepare("INSERT INTO layouts (id, user_id, name, data, updated_at) VALUES (?,?,?,?,?)")
    .bind(id, u.id, name, data, now()).run();
  return json({ id, name });
}

export async function getLayout(req, env, p) {
  const u = await requireUser(req, env);
  const row = await env.DB.prepare("SELECT id, name, data, updated_at FROM layouts WHERE id = ? AND user_id = ?")
    .bind(p.id, u.id).first();
  if (!row) bad("not found", 404);
  return json({ ...row, data: JSON.parse(row.data) });
}

export async function updateLayout(req, env, p) {
  const u = await requireUser(req, env);
  const body = await readJson(req);
  const own = await env.DB.prepare("SELECT 1 FROM layouts WHERE id = ? AND user_id = ?").bind(p.id, u.id).first();
  if (!own) bad("not found", 404);
  const name = cleanText(body.name, 80) || "Untitled";
  const data = validateLayout(body.data);
  await env.DB.prepare("UPDATE layouts SET name = ?, data = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(name, data, now(), p.id, u.id).run();
  return json({ ok: true });
}

export async function deleteLayout(req, env, p) {
  const u = await requireUser(req, env);
  await env.DB.prepare("DELETE FROM layouts WHERE id = ? AND user_id = ?").bind(p.id, u.id).run();
  return json({ ok: true });
}

/* ---------------- Publish / community ---------------- */

export async function publish(req, env) {
  const u = await requireUser(req, env);
  const body = await readJson(req);
  const title = cleanText(body.title, 80);
  if (title.length < 3) bad("title too short");
  const description = cleanText(body.description, 500);
  const category = validateCategory(body.category);
  const data = validateLayout(body.data);
  // rate limit: max 10 submissions per hour per user
  const hourAgo = now() - 3600 * 1000;
  const recent = await env.DB.prepare("SELECT COUNT(*) c FROM published WHERE user_id = ? AND created_at > ?")
    .bind(u.id, hourAgo).first();
  if (recent && recent.c >= 10) bad("too many submissions, try later", 429);
  const id = uuid();
  await env.DB.prepare(
    "INSERT INTO published (id, user_id, title, description, category, data, status, created_at) VALUES (?,?,?,?,?,?, 'pending', ?)"
  ).bind(id, u.id, title, description, category, data, now()).run();
  return json({ id, status: "pending" });
}

export async function community(req, env, _params, url) {
  const q = cleanText(url.searchParams.get("q") || "", 60).toLowerCase();
  const cat = url.searchParams.get("category") || "";
  const sort = url.searchParams.get("sort") === "top" ? "p.likes DESC" : "p.created_at DESC";
  const page = Math.max(0, parseInt(url.searchParams.get("page") || "0", 10) || 0);
  const limit = 24, offset = page * limit;

  let sql = `SELECT p.id, p.title, p.description, p.category, p.likes, p.created_at, u.username
             FROM published p JOIN users u ON u.id = p.user_id
             WHERE p.status = 'approved'`;
  const binds = [];
  if (cat && cat !== "all") { sql += " AND p.category = ?"; binds.push(validateCategory(cat)); }
  if (q) { sql += " AND lower(p.title) LIKE ?"; binds.push("%" + q + "%"); }
  sql += ` ORDER BY ${sort} LIMIT ? OFFSET ?`;
  binds.push(limit, offset);
  const r = await env.DB.prepare(sql).bind(...binds).all();
  return json({ items: r.results || [], page });
}

export async function communityItem(req, env, p) {
  const row = await env.DB.prepare(
    `SELECT p.id, p.title, p.description, p.category, p.likes, p.data, p.created_at, u.username
     FROM published p JOIN users u ON u.id = p.user_id
     WHERE p.id = ? AND p.status = 'approved'`
  ).bind(p.id).first();
  if (!row) bad("not found", 404);
  return json({ ...row, data: JSON.parse(row.data) });
}

export async function like(req, env, p) {
  const u = await requireUser(req, env);
  const exists = await env.DB.prepare("SELECT 1 FROM likes WHERE user_id = ? AND published_id = ?")
    .bind(u.id, p.id).first();
  if (exists) {
    await env.DB.prepare("DELETE FROM likes WHERE user_id = ? AND published_id = ?").bind(u.id, p.id).run();
    await env.DB.prepare("UPDATE published SET likes = MAX(0, likes - 1) WHERE id = ?").bind(p.id).run();
    return json({ liked: false });
  }
  await env.DB.prepare("INSERT INTO likes (user_id, published_id, created_at) VALUES (?,?,?)")
    .bind(u.id, p.id, now()).run();
  await env.DB.prepare("UPDATE published SET likes = likes + 1 WHERE id = ?").bind(p.id).run();
  return json({ liked: true });
}

export async function report(req, env, p) {
  const u = await requireUser(req, env);
  const body = await readJson(req);
  const reason = cleanText(body.reason, 300);
  const dup = await env.DB.prepare("SELECT 1 FROM reports WHERE published_id = ? AND user_id = ?")
    .bind(p.id, u.id).first();
  if (dup) return json({ ok: true });
  await env.DB.prepare("INSERT INTO reports (id, published_id, user_id, reason, created_at) VALUES (?,?,?,?,?)")
    .bind(uuid(), p.id, u.id, reason, now()).run();
  await env.DB.prepare("UPDATE published SET report_count = report_count + 1 WHERE id = ?").bind(p.id).run();
  // auto-hide after 3 reports: send back to the moderation queue
  await env.DB.prepare("UPDATE published SET status = 'pending' WHERE id = ? AND report_count >= 3 AND status = 'approved'")
    .bind(p.id).run();
  return json({ ok: true });
}

/* ---------------- Moderation ---------------- */

export async function modQueue(req, env) {
  const u = await requireUser(req, env);
  requireRole(u, "moderator", "admin");
  const r = await env.DB.prepare(
    `SELECT p.id, p.title, p.description, p.category, p.report_count, p.created_at, u.username
     FROM published p JOIN users u ON u.id = p.user_id
     WHERE p.status = 'pending' ORDER BY p.report_count DESC, p.created_at ASC LIMIT 100`
  ).all();
  return json({ items: r.results || [] });
}

export async function modItem(req, env, p) {
  const u = await requireUser(req, env);
  requireRole(u, "moderator", "admin");
  const row = await env.DB.prepare(
    `SELECT p.*, u.username FROM published p JOIN users u ON u.id = p.user_id WHERE p.id = ?`
  ).bind(p.id).first();
  if (!row) bad("not found", 404);
  return json({ ...row, data: JSON.parse(row.data) });
}

export async function modApprove(req, env, p) {
  const u = await requireUser(req, env);
  requireRole(u, "moderator", "admin");
  const row = await env.DB.prepare("SELECT user_id FROM published WHERE id = ?").bind(p.id).first();
  if (!row) bad("not found", 404);
  // Moderators cannot approve their own posts; the site owner (admin) can.
  if (row.user_id === u.id && u.role !== "admin") bad("cannot approve your own submission", 403);
  await env.DB.prepare("UPDATE published SET status='approved', reviewer_id=?, reviewed_at=?, report_count=0 WHERE id=?")
    .bind(u.id, now(), p.id).run();
  await env.DB.prepare("UPDATE reports SET status='resolved' WHERE published_id = ?").bind(p.id).run();
  return json({ ok: true });
}

export async function modReject(req, env, p) {
  const u = await requireUser(req, env);
  requireRole(u, "moderator", "admin");
  const body = await readJson(req);
  await env.DB.prepare("UPDATE published SET status='rejected', reviewer_id=?, reviewed_at=?, reject_reason=? WHERE id=?")
    .bind(u.id, now(), cleanText(body.reason, 300), p.id).run();
  await env.DB.prepare("UPDATE reports SET status='resolved' WHERE published_id = ?").bind(p.id).run();
  return json({ ok: true });
}

export async function modReports(req, env) {
  const u = await requireUser(req, env);
  requireRole(u, "moderator", "admin");
  const r = await env.DB.prepare(
    `SELECT r.id, r.published_id, r.reason, r.created_at, p.title
     FROM reports r JOIN published p ON p.id = r.published_id
     WHERE r.status = 'open' ORDER BY r.created_at DESC LIMIT 100`
  ).all();
  return json({ items: r.results || [] });
}

/* ---------------- Progress ---------------- */

export async function getProgress(req, env) {
  const u = await requireUser(req, env);
  const row = await env.DB.prepare("SELECT data FROM progress WHERE user_id = ?").bind(u.id).first();
  return json({ data: row ? JSON.parse(row.data) : {} });
}

export async function putProgress(req, env) {
  const u = await requireUser(req, env);
  const body = await readJson(req);
  const data = JSON.stringify(body.data ?? {});
  if (data.length > 32 * 1024) bad("progress too large", 413);
  await env.DB.prepare(
    "INSERT INTO progress (user_id, data, updated_at) VALUES (?,?,?) " +
    "ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at"
  ).bind(u.id, data, now()).run();
  return json({ ok: true });
}
