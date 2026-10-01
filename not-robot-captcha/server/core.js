// Core of the self-hosted "I'm not a robot" check. Zero dependencies.
//
// The checkbox in the browser proves nothing on its own — anyone can POST to
// your form endpoint directly — so the server is the only party that decides:
//
//   1. issueChallenge()  → random salt, HMAC-signed so it can't be forged.
//   2. The widget finds a nonce so sha256(salt + ":" + nonce) starts with
//      `bits` zero bits (proof-of-work: ~1s for one person, expensive for a
//      bot sending thousands of submissions).
//   3. verifySolution()  → checks signature, expiry, a minimum solve time and
//      the proof-of-work, then issues a short-lived signed pass token.
//   4. consumePass()     → your backend accepts each pass token exactly once.
//
// This deters scripted spam. It is not a risk engine like reCAPTCHA or
// Turnstile and won't stop a determined attacker driving a real browser.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function leadingZeroBits(hash) {
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

/**
 * @param {object} options
 * @param {string} options.secret        HMAC key; keep it identical across instances.
 * @param {number} [options.bits=17]     Proof-of-work difficulty (each +1 doubles the work).
 * @param {number} [options.challengeTtlMs=120000]
 * @param {number} [options.passTtlMs=120000]
 * @param {number} [options.minSolveMs=400] Solving faster than this is not a person.
 */
export function createCaptcha({
  secret,
  bits = 17,
  challengeTtlMs = 2 * 60 * 1000,
  passTtlMs = 2 * 60 * 1000,
  minSolveMs = 400,
} = {}) {
  if (!secret || secret.length < 16) {
    throw new Error("createCaptcha: `secret` must be at least 16 characters.");
  }

  // Single-use bookkeeping. In-memory, so with several server instances a
  // challenge/pass could be replayed once per instance; run one instance or
  // swap these Maps for a shared store (Redis etc.) if that matters.
  const usedChallenges = new Map();
  const usedPasses = new Map();

  function sign(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const mac = createHmac("sha256", secret).update(body).digest("base64url");
    return `${body}.${mac}`;
  }

  function unsign(token) {
    if (typeof token !== "string" || token.length > 2048) return null;
    const [body, mac] = token.split(".");
    if (!body || !mac) return null;

    const expected = createHmac("sha256", secret).update(body).digest();
    const given = Buffer.from(mac, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    try {
      return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
      return null;
    }
  }

  function markUsed(store, key, exp, now) {
    for (const [k, e] of store) if (e < now) store.delete(k);
    if (store.has(key)) return false;
    store.set(key, exp);
    return true;
  }

  function issueChallenge(now = Date.now()) {
    const salt = randomBytes(16).toString("hex");
    const token = sign({ kind: "challenge", salt, bits, iat: now, exp: now + challengeTtlMs });
    // `wait`: the widget holds its answer this long so a lucky fast solve isn't "too-fast".
    return { token, salt, bits, wait: minSolveMs };
  }

  function verifySolution(token, nonce, now = Date.now()) {
    const payload = unsign(token);
    if (!payload || payload.kind !== "challenge") {
      return { ok: false, error: "invalid-challenge" };
    }
    if (payload.exp < now) return { ok: false, error: "challenge-expired" };
    if (now - payload.iat < minSolveMs) return { ok: false, error: "too-fast" };
    if (!Number.isSafeInteger(nonce) || nonce < 0) return { ok: false, error: "invalid-nonce" };

    const hash = createHash("sha256").update(`${payload.salt}:${nonce}`).digest();
    if (leadingZeroBits(hash) < payload.bits) return { ok: false, error: "wrong-solution" };
    if (!markUsed(usedChallenges, payload.salt, payload.exp, now)) {
      return { ok: false, error: "challenge-reused" };
    }

    const expiresAt = now + passTtlMs;
    const pass = sign({ kind: "pass", jti: randomBytes(16).toString("hex"), exp: expiresAt });
    return { ok: true, pass, expiresAt };
  }

  function consumePass(pass, now = Date.now()) {
    const payload = unsign(pass);
    if (!payload || payload.kind !== "pass") return { ok: false, error: "invalid-token" };
    if (payload.exp < now) return { ok: false, error: "token-expired" };
    if (!markUsed(usedPasses, payload.jti, payload.exp, now)) {
      return { ok: false, error: "token-reused" };
    }
    return { ok: true };
  }

  return { issueChallenge, verifySolution, consumePass };
}
