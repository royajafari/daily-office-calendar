import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Server side of the "I'm not a robot" widget (public/not-robot.js) — a
 * TypeScript port of not-robot-captcha/server/core.js, same protocol:
 * HMAC-signed challenge → browser proof-of-work → 2-minute single-use pass,
 * consumed by POST /api/appointments.
 *
 * Tokens are stateless (signed), so they work across serverless instances;
 * the single-use bookkeeping is per instance, like the demo's in-memory
 * request store. With ORACLE_API_BASE_URL set, this only guards the Vercel
 * route: ORDS POST /requests itself stays public.
 */

export const DIFFICULTY_BITS = 17;
const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const PASS_TTL_MS = 2 * 60 * 1000;
/** Faster than this is not a person; the widget waits it out (`wait`). */
const MIN_SOLVE_MS = 400;

type Payload =
  | { kind: "challenge"; salt: string; bits: number; iat: number; exp: number }
  | { kind: "pass"; jti: string; exp: number };

export type CaptchaResult<T> = { ok: true; value: T } | { ok: false; error: string };

let devSecret: string | null = null;

function getSecret(): string {
  const secret = process.env.CAPTCHA_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    // A per-instance random secret would make tokens fail across instances.
    throw new Error("CAPTCHA_SECRET is not set.");
  }
  devSecret ??= randomBytes(32).toString("hex");
  return devSecret;
}

function sign(payload: Payload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", getSecret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function unsign(token: unknown): Payload | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;

  const expected = createHmac("sha256", getSecret()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
  } catch {
    return null;
  }
}

export function leadingZeroBits(hash: Uint8Array): number {
  let bits = 0;
  for (const byte of hash) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

const usedChallenges = new Map<string, number>();
const usedPasses = new Map<string, number>();

function markUsed(store: Map<string, number>, key: string, exp: number, now: number): boolean {
  for (const [k, e] of store) if (e < now) store.delete(k);
  if (store.has(key)) return false;
  store.set(key, exp);
  return true;
}

export function issueChallenge(now = Date.now(), bits = DIFFICULTY_BITS) {
  const salt = randomBytes(16).toString("hex");
  const token = sign({ kind: "challenge", salt, bits, iat: now, exp: now + CHALLENGE_TTL_MS });
  return { token, salt, bits, wait: MIN_SOLVE_MS };
}

export function verifySolution(
  token: unknown,
  nonce: unknown,
  now = Date.now()
): CaptchaResult<{ pass: string; expiresIn: number }> {
  const payload = unsign(token);
  if (!payload || payload.kind !== "challenge") return { ok: false, error: "invalid-challenge" };
  if (payload.exp < now) return { ok: false, error: "challenge-expired" };
  if (now - payload.iat < MIN_SOLVE_MS) return { ok: false, error: "too-fast" };
  if (typeof nonce !== "number" || !Number.isSafeInteger(nonce) || nonce < 0) {
    return { ok: false, error: "invalid-nonce" };
  }

  const hash = createHash("sha256").update(`${payload.salt}:${nonce}`).digest();
  if (leadingZeroBits(hash) < payload.bits) return { ok: false, error: "wrong-solution" };
  if (!markUsed(usedChallenges, payload.salt, payload.exp, now)) {
    return { ok: false, error: "challenge-reused" };
  }

  const pass = sign({ kind: "pass", jti: randomBytes(16).toString("hex"), exp: now + PASS_TTL_MS });
  return { ok: true, value: { pass, expiresIn: PASS_TTL_MS } };
}

const PASS_ERRORS: Record<string, string> = {
  "invalid-token": "لطفاً تیک «من ربات نیستم» را بزنید.",
  "token-expired": "تأیید «من ربات نیستم» منقضی شده است. دوباره تیک بزنید.",
  "token-reused": "این تأیید قبلاً استفاده شده است. دوباره تیک بزنید.",
};

/** Accepts each pass once. On failure, `error` is a Persian message for the form. */
export function consumePass(pass: unknown, now = Date.now()): CaptchaResult<true> {
  const payload = unsign(pass);
  if (!payload || payload.kind !== "pass") return { ok: false, error: PASS_ERRORS["invalid-token"] };
  if (payload.exp < now) return { ok: false, error: PASS_ERRORS["token-expired"] };
  if (!markUsed(usedPasses, payload.jti, payload.exp, now)) {
    return { ok: false, error: PASS_ERRORS["token-reused"] };
  }
  return { ok: true, value: true };
}
