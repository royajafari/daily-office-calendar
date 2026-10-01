import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createCaptcha, leadingZeroBits } from "../server/core.js";

// Load the browser widget in a sandbox (no customElements → only the solver is exposed).
const widget = { setTimeout };
vm.runInNewContext(readFileSync(new URL("../widget/not-robot.js", import.meta.url), "utf8"), widget);
const { sha256Ascii, solve } = widget.NotRobot;

const SECRET = "test-secret-at-least-16-chars";

test("widget SHA-256 matches node:crypto", () => {
  for (const input of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "f00d:123456"]) {
    const expected = createHash("sha256").update(input).digest("hex");
    assert.equal(Buffer.from(sha256Ascii(input)).toString("hex"), expected, `input length ${input.length}`);
  }
});

test("leadingZeroBits counts across bytes", () => {
  assert.equal(leadingZeroBits(Uint8Array.from([0x00, 0x00, 0x10])), 19);
  assert.equal(leadingZeroBits(Uint8Array.from([0x80])), 0);
  assert.equal(leadingZeroBits(Uint8Array.from([0x00, 0x00])), 16);
});

test("full flow: challenge → widget solve → pass → consume once", async () => {
  const captcha = createCaptcha({ secret: SECRET, bits: 12 });
  const t0 = 1_000_000;
  const ch = captcha.issueChallenge(t0);
  const nonce = await solve(ch.salt, ch.bits);

  const solved = captcha.verifySolution(ch.token, nonce, t0 + 1000);
  assert.equal(solved.ok, true);

  assert.deepEqual(captcha.consumePass(solved.pass, t0 + 2000), { ok: true });
  assert.deepEqual(captcha.consumePass(solved.pass, t0 + 3000), { ok: false, error: "token-reused" });
});

test("rejects wrong, reused, too-fast and expired solutions", async () => {
  const captcha = createCaptcha({ secret: SECRET, bits: 12 });
  const t0 = 1_000_000;
  const ch = captcha.issueChallenge(t0);
  const nonce = await solve(ch.salt, ch.bits);

  assert.equal(captcha.verifySolution(ch.token, nonce, t0 + 10).error, "too-fast");
  assert.equal(captcha.verifySolution(ch.token, nonce, t0 + 10 * 60_000).error, "challenge-expired");
  assert.equal(captcha.verifySolution(ch.token, "1", t0 + 1000).error, "invalid-nonce");

  let wrong = nonce + 1;
  while (leadingZeroBits(createHash("sha256").update(`${ch.salt}:${wrong}`).digest()) >= 12) wrong++;
  assert.equal(captcha.verifySolution(ch.token, wrong, t0 + 1000).error, "wrong-solution");

  assert.equal(captcha.verifySolution(ch.token, nonce, t0 + 1000).ok, true);
  assert.equal(captcha.verifySolution(ch.token, nonce, t0 + 1100).error, "challenge-reused");
});

test("rejects forged or tampered tokens and expired passes", async () => {
  const captcha = createCaptcha({ secret: SECRET, bits: 8 });
  const other = createCaptcha({ secret: "a-different-secret-key", bits: 8 });
  const t0 = 1_000_000;

  const foreign = other.issueChallenge(t0);
  const n = await solve(foreign.salt, foreign.bits);
  assert.equal(captcha.verifySolution(foreign.token, n, t0 + 1000).error, "invalid-challenge");

  // Lowering the difficulty inside the token breaks the signature.
  const ch = captcha.issueChallenge(t0);
  const [body, mac] = ch.token.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  const easier = Buffer.from(JSON.stringify({ ...payload, bits: 0 })).toString("base64url");
  assert.equal(captcha.verifySolution(`${easier}.${mac}`, 0, t0 + 1000).error, "invalid-challenge");

  // A challenge token is not a pass.
  assert.equal(captcha.consumePass(ch.token, t0).error, "invalid-token");

  const solved = captcha.verifySolution(ch.token, await solve(ch.salt, ch.bits), t0 + 1000);
  assert.equal(captcha.consumePass(solved.pass, t0 + 10 * 60_000).error, "token-expired");
});

test("default difficulty solves in reasonable time", async () => {
  const captcha = createCaptcha({ secret: SECRET });
  const ch = captcha.issueChallenge();
  const started = performance.now();
  const nonce = await solve(ch.salt, ch.bits);
  const ms = performance.now() - started;
  console.log(`  bits=${ch.bits} solved with nonce=${nonce} in ${ms.toFixed(0)}ms`);
  assert.ok(ms < 10_000);
});
