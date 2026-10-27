// Server-side validation. Stored `data` is treated strictly as data and is
// NEVER executed on the server. Text fields are stripped and length-capped;
// the frontend always renders them escaped (defence against stored XSS).

import { bad } from "./util.js";

const KINDS = new Set([
  "pc", "attacker", "person", "switch", "router", "server", "cloud", "firewall", "ap",
]);
const CATEGORIES = new Set([
  "spoof", "dos", "cred", "web", "social", "malware", "other",
]);

const MAX_DEVICES = 120;
const MAX_LINKS = 300;
const MAX_LABEL = 60;
const MAX_CODE_LINES = 40;
const MAX_CODE_LEN = 4000;
const MAX_DATA_BYTES = 64 * 1024;

export function cleanText(s, max) {
  s = String(s == null ? "" : s);
  s = s.replace(/[\u0000-\u001F\u007F]/g, "").trim(); // drop control chars
  return s.slice(0, max);
}

// Validate the layout object (devices / links / code). Throws on bad input.
export function validateLayout(data) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) bad("layout must be an object");
  const { devices, links, code } = data;
  if (!Array.isArray(devices) || !Array.isArray(links)) bad("devices and links are required arrays");
  if (devices.length > MAX_DEVICES) bad("too many devices");
  if (links.length > MAX_LINKS) bad("too many links");

  const ids = new Set();
  for (const d of devices) {
    if (typeof d !== "object" || d === null) bad("bad device");
    if (typeof d.id !== "number" || !Number.isFinite(d.id)) bad("bad device id");
    if (!KINDS.has(d.kind)) bad("unknown device kind: " + d.kind);
    if (typeof d.x !== "number" || typeof d.y !== "number") bad("bad device position");
    if (String(d.label ?? "").length > MAX_LABEL || String(d.sub ?? "").length > MAX_LABEL) bad("label too long");
    ids.add(d.id);
  }
  for (const l of links) {
    if (!Array.isArray(l) || l.length !== 2) bad("bad link");
    if (typeof l[0] !== "number" || typeof l[1] !== "number") bad("bad link ids");
  }
  if (code != null) {
    if (typeof code !== "object" || Array.isArray(code)) bad("bad code block");
    const keys = Object.keys(code);
    if (keys.length > MAX_CODE_LINES) bad("too many code entries");
    for (const k of keys) {
      if (typeof code[k] !== "string") bad("code must be strings");
      if (code[k].length > MAX_CODE_LEN) bad("code entry too long");
    }
  }
  // Re-serialize canonically and enforce a hard size cap.
  const canonical = JSON.stringify({ devices, links, code: code ?? {} });
  if (canonical.length > MAX_DATA_BYTES) bad("layout too large", 413);
  return canonical;
}

export function validateCategory(c) {
  const v = cleanText(c, 32).toLowerCase();
  return CATEGORIES.has(v) ? v : "other";
}
