// Portcull API — Cloudflare Worker entry point.
// Router + CORS + CSRF guard. All business logic lives in handlers.js.

import { json, corsHeaders, match, HttpError } from "./util.js";
import * as H from "./handlers.js";

// [method, pattern, handler, { csrf?:true }]
const ROUTES = [
  ["GET",    "/auth/github",            H.authGithub],
  ["GET",    "/auth/callback",          H.authCallback],
  ["POST",   "/auth/logout",            H.authLogout,   { csrf: true }],
  ["GET",    "/me",                     H.me],

  ["GET",    "/layouts",                H.listLayouts],
  ["POST",   "/layouts",                H.createLayout, { csrf: true }],
  ["GET",    "/layouts/:id",            H.getLayout],
  ["PUT",    "/layouts/:id",            H.updateLayout, { csrf: true }],
  ["DELETE", "/layouts/:id",            H.deleteLayout, { csrf: true }],

  ["POST",   "/publish",                H.publish,      { csrf: true }],
  ["GET",    "/community",              H.community],
  ["GET",    "/community/:id",          H.communityItem],
  ["POST",   "/community/:id/like",     H.like,         { csrf: true }],
  ["POST",   "/community/:id/report",   H.report,       { csrf: true }],

  ["GET",    "/moderation/queue",       H.modQueue],
  ["GET",    "/moderation/reports",     H.modReports],
  ["GET",    "/moderation/:id",         H.modItem],
  ["POST",   "/moderation/:id/approve", H.modApprove,   { csrf: true }],
  ["POST",   "/moderation/:id/reject",  H.modReject,    { csrf: true }],

  ["GET",    "/progress",               H.getProgress],
  ["PUT",    "/progress",               H.putProgress,  { csrf: true }],
];

async function dispatch(req, env, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  for (const [method, pattern, fn, opts] of ROUTES) {
    if (method !== req.method) continue;
    const params = match(pattern, path);
    if (!params) continue;
    // CSRF: mutating endpoints require a custom header. Cross-site pages cannot
    // set it without a CORS preflight, which our policy only grants to our own
    // origin — so SameSite cookie + this header together block CSRF.
    if (opts && opts.csrf && req.headers.get("X-CSRF") !== "1") {
      throw new HttpError("missing CSRF header", 403);
    }
    return fn(req, env, params, url);
  }
  return json({ error: "not found" }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin");
    const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
    const ch = corsHeaders(origin, allowed);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ch });

    let res;
    try {
      res = await dispatch(req, env, url);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      res = json({ error: e.message || "server error" }, status);
    }
    for (const k in ch) res.headers.set(k, ch[k]);
    return res;
  },
};
