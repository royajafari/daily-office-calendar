// Standalone captcha service. Zero dependencies: `node server/server.js`.
//
//   GET  /not-robot.js   the widget script
//   POST /challenge      widget → { token, salt, bits }
//   POST /solve          widget { token, nonce } → { pass, expiresIn }
//   POST /siteverify     YOUR BACKEND { secret, token } → { success, error }
//   GET  /               demo page (disable with DEMO=off)
//
// Env: CAPTCHA_SECRET (HMAC key), SITEVERIFY_SECRET (shared with your
// backends), PORT (8787), ALLOWED_ORIGINS (comma list, default *),
// CAPTCHA_BITS (17), DEMO (on).

import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createCaptcha } from "./core.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const isProd = process.env.NODE_ENV === "production";

function requiredSecret(name) {
  const value = process.env[name];
  if (value) return value;
  if (isProd) throw new Error(`${name} must be set in production.`);
  const generated = randomBytes(24).toString("hex");
  console.warn(`[not-robot] ${name} not set — using a random dev value: ${generated}`);
  return generated;
}

const CAPTCHA_SECRET = requiredSecret("CAPTCHA_SECRET");
const SITEVERIFY_SECRET = requiredSecret("SITEVERIFY_SECRET");
const PORT = Number(process.env.PORT) || 8787;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
const DEMO = process.env.DEMO !== "off";

const captcha = createCaptcha({
  secret: CAPTCHA_SECRET,
  bits: Number(process.env.CAPTCHA_BITS) || 17,
});

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string";
  res.writeHead(status, {
    "Content-Type": isJson ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  const allowed = ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin);
  if (!allowed) return null;
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes("*") ? "*" : origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error("body-too-large");
  }
  const type = req.headers["content-type"] || "";
  if (type.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  return raw ? JSON.parse(raw) : {};
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function handle(req, res) {
  const { pathname } = new URL(req.url, "http://localhost");

  if (req.method === "GET" && pathname === "/not-robot.js") {
    const js = await readFile(`${root}widget/not-robot.js`, "utf8");
    return send(res, 200, js, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    });
  }

  if (DEMO && req.method === "GET" && pathname === "/") {
    return send(res, 200, await readFile(`${root}demo/index.html`, "utf8"));
  }

  // Browser-facing endpoints (called by the widget, cross-origin).
  if (pathname === "/challenge" || pathname === "/solve") {
    const cors = corsHeaders(req);
    if (cors === null) return send(res, 403, { error: "origin-not-allowed" });
    if (req.method === "OPTIONS") return send(res, 204, "", cors);
    if (req.method !== "POST") return send(res, 405, { error: "method-not-allowed" }, cors);

    if (pathname === "/challenge") return send(res, 200, captcha.issueChallenge(), cors);

    const body = await readBody(req);
    const result = captcha.verifySolution(body.token, body.nonce);
    if (!result.ok) return send(res, 400, { error: result.error }, cors);
    return send(res, 200, { pass: result.pass, expiresIn: result.expiresAt - Date.now() }, cors);
  }

  // Server-to-server: your backend confirms the token before accepting a form.
  if (req.method === "POST" && pathname === "/siteverify") {
    const body = await readBody(req);
    if (!safeEqual(body.secret, SITEVERIFY_SECRET)) {
      return send(res, 401, { success: false, error: "invalid-secret" });
    }
    const result = captcha.consumePass(body.token);
    return send(res, 200, result.ok ? { success: true } : { success: false, error: result.error });
  }

  // Demo backend: shows exactly what your own backend should do.
  if (DEMO && req.method === "POST" && pathname === "/demo/submit") {
    const form = await readBody(req);
    const verify = await fetch(`http://127.0.0.1:${PORT}/siteverify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: SITEVERIFY_SECRET, token: form["captcha-token"] }),
    }).then((r) => r.json());

    const ok = verify.success === true;
    return send(
      res,
      ok ? 200 : 403,
      `<!doctype html><meta charset="utf-8"><body dir="rtl" style="font-family:Tahoma,sans-serif;padding:24px">` +
        (ok
          ? `<h2>✅ فرم پذیرفته شد</h2><p>سرور کپچا تأیید کرد که این ارسال از یک کاربر واقعی است.</p>`
          : `<h2>⛔ فرم رد شد</h2><p>کد خطا: <code>${String(verify.error).replace(/[<>&]/g, "")}</code></p>`) +
        `<p><a href="/">بازگشت</a></p>`
    );
  }

  return send(res, 404, { error: "not-found" });
}

createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = err instanceof SyntaxError || err.message === "body-too-large" ? 400 : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, status, { error: status === 400 ? "bad-request" : "server-error" });
  });
}).listen(PORT, () => {
  console.log(`[not-robot] listening on http://localhost:${PORT}${DEMO ? "  (demo at /)" : ""}`);
});
