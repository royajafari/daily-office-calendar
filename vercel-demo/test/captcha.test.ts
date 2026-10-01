import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { consumePass, issueChallenge, leadingZeroBits, verifySolution } from "../lib/captcha";

const widgetSource = readFileSync(new URL("../public/not-robot.js", import.meta.url), "utf8");

// Run the browser widget in a sandbox: without customElements it only exposes its solver.
const sandbox: { setTimeout: typeof setTimeout; NotRobot?: { solve(salt: string, bits: number): Promise<number> } } = {
  setTimeout,
};
vm.runInNewContext(widgetSource, sandbox);
const solve = (salt: string, bits: number) => sandbox.NotRobot!.solve(salt, bits);

describe("captcha", () => {
  it("public/not-robot.js is an exact copy of not-robot-captcha/widget/not-robot.js", () => {
    const original = readFileSync(new URL("../../not-robot-captcha/widget/not-robot.js", import.meta.url), "utf8");
    // Normalise line endings: a Windows checkout may differ only in CRLF.
    expect(widgetSource.replace(/\r\n/g, "\n")).toBe(original.replace(/\r\n/g, "\n"));
  });

  it("accepts a solved challenge's pass exactly once", async () => {
    const t0 = 1_000_000;
    const ch = issueChallenge(t0, 10);
    expect(ch.wait).toBeGreaterThan(0);

    const solved = verifySolution(ch.token, await solve(ch.salt, ch.bits), t0 + 1000);
    expect(solved.ok).toBe(true);
    if (!solved.ok) return;

    expect(consumePass(solved.value.pass, t0 + 2000)).toEqual({ ok: true, value: true });
    const again = consumePass(solved.value.pass, t0 + 3000);
    expect(again.ok).toBe(false);
  });

  it("rejects too-fast, wrong, reused and expired answers", async () => {
    const t0 = 2_000_000;
    const ch = issueChallenge(t0, 10);
    const nonce = await solve(ch.salt, ch.bits);

    expect(verifySolution(ch.token, nonce, t0 + 10)).toEqual({ ok: false, error: "too-fast" });
    expect(verifySolution(ch.token, nonce, t0 + 10 * 60_000)).toEqual({ ok: false, error: "challenge-expired" });
    expect(verifySolution(ch.token, "1", t0 + 1000)).toEqual({ ok: false, error: "invalid-nonce" });

    let wrong = nonce + 1;
    while (leadingZeroBits(createHash("sha256").update(`${ch.salt}:${wrong}`).digest()) >= ch.bits) wrong++;
    expect(verifySolution(ch.token, wrong, t0 + 1000)).toEqual({ ok: false, error: "wrong-solution" });

    expect(verifySolution(ch.token, nonce, t0 + 1000).ok).toBe(true);
    expect(verifySolution(ch.token, nonce, t0 + 1100)).toEqual({ ok: false, error: "challenge-reused" });
  });

  it("rejects tampered tokens, a challenge used as a pass, and expired passes", async () => {
    const t0 = 3_000_000;
    const ch = issueChallenge(t0, 10);
    const [body, mac] = ch.token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    const easier = Buffer.from(JSON.stringify({ ...payload, bits: 0 })).toString("base64url");
    expect(verifySolution(`${easier}.${mac}`, 0, t0 + 1000)).toEqual({ ok: false, error: "invalid-challenge" });

    expect(consumePass(ch.token, t0).ok).toBe(false);
    expect(consumePass(undefined, t0)).toEqual({ ok: false, error: "لطفاً تیک «من ربات نیستم» را بزنید." });

    const solved = verifySolution(ch.token, await solve(ch.salt, ch.bits), t0 + 1000);
    if (!solved.ok) throw new Error(solved.error);
    const expired = consumePass(solved.value.pass, t0 + 10 * 60_000);
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.error).toContain("منقضی");
  });
});
