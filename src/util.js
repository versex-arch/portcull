// Small helpers: JSON responses, ids, cookies, CORS.

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export class HttpError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const bad = (msg, status = 400) => { throw new HttpError(msg, status); };

export const uuid = () => crypto.randomUUID();
export const now = () => Date.now();

export function parseCookies(req) {
  const h = req.headers.get("Cookie") || "";
  const out = {};
  for (const part of h.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(name, val, opts = {}) {
  let s = `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; Secure; SameSite=${opts.sameSite || "Lax"}`;
  if (opts.maxAge != null) s += `; Max-Age=${opts.maxAge}`;
  return s;
}
export const clearCookie = (name) =>
  `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

// CORS: reflect only an allowed origin, allow credentials.
export function corsHeaders(origin, allowedList) {
  const ok = origin && allowedList.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowedList[0] || "null",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-CSRF",
    "Vary": "Origin",
  };
}

// Match "/a/:id" against a path; returns params object or null.
export function match(pattern, path) {
  const pk = pattern.split("/"), pp = path.split("/");
  if (pk.length !== pp.length) return null;
  const params = {};
  for (let i = 0; i < pk.length; i++) {
    if (pk[i].startsWith(":")) params[pk[i].slice(1)] = decodeURIComponent(pp[i]);
    else if (pk[i] !== pp[i]) return null;
  }
  return params;
}

export async function readJson(req, maxBytes = 70 * 1024) {
  const text = await req.text();
  if (text.length > maxBytes) bad("payload too large", 413);
  try { return JSON.parse(text); } catch { bad("invalid JSON"); }
}
