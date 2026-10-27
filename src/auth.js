// Authentication: GitHub OAuth + stateless JWT in an HttpOnly cookie.
// No passwords are ever stored.

import { parseCookies, bad } from "./util.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlFromStr(s) { return b64url(enc.encode(s)); }
function bytesFromB64url(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
}

export async function signJWT(payload, secret, ttlSec = 60 * 60 * 24 * 7) {
  const header = { alg: "HS256", typ: "JWT" };
  const nowSec = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: nowSec, exp: nowSec + ttlSec };
  const data = b64urlFromStr(JSON.stringify(header)) + "." + b64urlFromStr(JSON.stringify(body));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return data + "." + b64url(sig);
}

export async function verifyJWT(token, secret) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const data = parts[0] + "." + parts[1];
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, bytesFromB64url(parts[2]), enc.encode(data));
  if (!ok) return null;
  let body;
  try { body = JSON.parse(dec.decode(bytesFromB64url(parts[1]))); } catch { return null; }
  if (body.exp && body.exp * 1000 < Date.now()) return null;
  return body;
}

// Returns the fresh DB user row (so role changes take effect), or null.
export async function getUser(req, env) {
  const c = parseCookies(req);
  const claims = await verifyJWT(c.session, env.JWT_SECRET);
  if (!claims) return null;
  const row = await env.DB
    .prepare("SELECT id, username, display_name, role FROM users WHERE id = ?")
    .bind(claims.uid).first();
  return row || null;
}

export async function requireUser(req, env) {
  const u = await getUser(req, env);
  if (!u) bad("auth required", 401);
  return u;
}
export function requireRole(user, ...roles) {
  if (!roles.includes(user.role)) bad("forbidden", 403);
}

export function randomState() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return b64url(b.buffer);
}

// Exchange the OAuth code for a GitHub profile.
export async function githubExchange(code, env) {
  const tokRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const tok = await tokRes.json();
  if (!tok.access_token) bad("github token exchange failed", 502);
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      "Authorization": "Bearer " + tok.access_token,
      "User-Agent": "portcull",
      "Accept": "application/vnd.github+json",
    },
  });
  if (!userRes.ok) bad("github profile fetch failed", 502);
  return userRes.json(); // { id, login, name, ... }
}
