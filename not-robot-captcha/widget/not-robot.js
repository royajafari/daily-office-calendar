/*!
 * not-robot.js — framework-free "I'm not a robot" checkbox.
 *
 *   <script src="https://captcha.example.com/not-robot.js" defer></script>
 *   <form method="post" action="/submit">
 *     <not-robot-captcha server="https://captcha.example.com"></not-robot-captcha>
 *     <button>Send</button>
 *   </form>
 *
 * When ticked, it fetches a challenge, solves a small proof-of-work and puts
 * the resulting pass token in a hidden input (name="captcha-token" by
 * default) inside the form. Your backend MUST send that token to the
 * server's /siteverify — the tick alone proves nothing.
 *
 * Attributes: server (default: this script's origin), name (name="" → no hidden
 *   input, e.g. when the page copies the token itself), lang ("fa" | "en"),
 *   guard="off" to disable the submit guard below.
 * Events: "captcha-verified" (detail.token), "captcha-expired", "captcha-error" (detail.message).
 * Methods: reset(), requireValid(). Properties: token, valid, transport
 *   (optional function(path, body) → Promise<json> replacing fetch to `server`).
 *
 * Submit guard: if the enclosing form is submitted while the token is missing
 * or expired, the submit is cancelled (so typed data survives) and the user
 * is asked to tick again. It checks the clock at submit time rather than
 * trusting the expiry timer, which browsers throttle in background tabs.
 * form.submit() bypasses submit events; fetch-based forms (and frameworks
 * with their own submit, e.g. Oracle APEX) call requireValid() instead.
 */
(function () {
  "use strict";

  // ---- SHA-256 (sync; crypto.subtle is async per call and far too slow for ~100k small hashes)
  var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  var W = new Uint32Array(64);

  /** SHA-256 of an ASCII string (hex salt + digits only). */
  function sha256Ascii(input) {
    var len = input.length;
    var blocks = ((len + 9 + 63) >> 6) << 6;
    var bytes = new Uint8Array(blocks);
    for (var i = 0; i < len; i++) bytes[i] = input.charCodeAt(i);
    bytes[len] = 0x80;
    var bitLen = len * 8;
    bytes[blocks - 4] = bitLen >>> 24;
    bytes[blocks - 3] = bitLen >>> 16;
    bytes[blocks - 2] = bitLen >>> 8;
    bytes[blocks - 1] = bitLen;

    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    for (var off = 0; off < blocks; off += 64) {
      for (i = 0; i < 16; i++) {
        var j = off + i * 4;
        W[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
      }
      for (i = 16; i < 64; i++) {
        var x = W[i - 15], y = W[i - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (i = 0; i < 64; i++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }

    var out = new Uint8Array(32);
    var words = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (i = 0; i < 8; i++) {
      out[i * 4] = words[i] >>> 24;
      out[i * 4 + 1] = words[i] >>> 16;
      out[i * 4 + 2] = words[i] >>> 8;
      out[i * 4 + 3] = words[i];
    }
    return out;
  }

  function leadingZeroBits(hash) {
    var bits = 0;
    for (var i = 0; i < hash.length; i++) {
      if (hash[i] === 0) { bits += 8; continue; }
      return bits + Math.clz32(hash[i]) - 24;
    }
    return bits;
  }

  /** Finds the proof-of-work nonce, yielding to the page between chunks so the UI stays responsive. */
  function solve(salt, bits, onYield) {
    return new Promise(function (resolve) {
      var nonce = 0;
      (function step() {
        var end = nonce + 4000;
        for (; nonce < end; nonce++) {
          if (leadingZeroBits(sha256Ascii(salt + ":" + nonce)) >= bits) return resolve(nonce);
        }
        (onYield || setTimeout)(step, 0);
      })();
    });
  }

  var api = { sha256Ascii: sha256Ascii, leadingZeroBits: leadingZeroBits, solve: solve };
  (typeof window !== "undefined" ? window : globalThis).NotRobot = api;

  if (typeof customElements === "undefined" || customElements.get("not-robot-captcha")) return;

  // ---- Widget
  var scriptOrigin = (function () {
    try { return new URL(document.currentScript.src).origin; } catch (_) { return ""; }
  })();

  var TEXT = {
    fa: {
      label: "من ربات نیستم",
      verifying: "در حال بررسی…",
      brand: "محافظت‌شده",
      expired: "تأیید منقضی شد. دوباره تیک بزنید.",
      required: "لطفاً ابتدا تیک «من ربات نیستم» را بزنید.",
      failed: "تأیید ناموفق بود. دوباره تیک بزنید.",
      network: "ارتباط با سرور برقرار نشد. دوباره تیک بزنید.",
      busy: "درخواست‌ها زیاد است. یک دقیقه بعد دوباره تیک بزنید.",
    },
    en: {
      label: "I'm not a robot",
      verifying: "Verifying…",
      brand: "Protected",
      expired: "Verification expired. Please tick again.",
      required: "Please tick \"I'm not a robot\" first.",
      failed: "Verification failed. Please tick again.",
      network: "Could not reach the server. Please tick again.",
      busy: "Too many requests. Please tick again in a minute.",
    },
  };

  var STYLE =
    // Variables live on :host so both .box and .msg (its sibling) see them.
    ":host{display:block;font-family:inherit;color-scheme:light dark;" +
    "--bg:#f9f9f9;--fg:#222;--line:#d3d3d3;--muted:#777;--ok:#0f9d58;--bad:#d93025;--tick:#4a90e2;" +
    "--ok-bg:#e6f4ea;--ok-line:#34a853;--warn:#b45309;--warn-bg:#fff4e5;--warn-line:#f59e0b}" +
    "@media (prefers-color-scheme:dark){:host{--bg:#222428;--fg:#eceef2;--line:#3a3d44;--muted:#9aa0ab;" +
    "--bad:#ff8a80;--ok-bg:#16301f;--ok-line:#3ddc84;--warn:#fbbf24;--warn-bg:#33270f;--warn-line:#f59e0b}}" +
    ".box{display:flex;align-items:center;gap:12px;width:300px;max-width:100%;min-height:74px;padding:0 12px;" +
    "box-sizing:border-box;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:6px;" +
    "box-shadow:0 1px 3px rgba(0,0,0,.08);transition:background-color .25s,border-color .25s}" +
    // Ticked and accepted: green. Expired or failed: orange, and clickable again.
    ".state-verified .box{background:var(--ok-bg);border-color:var(--ok-line)}" +
    ".state-warn .box{background:var(--warn-bg);border-color:var(--warn-line)}" +
    ".check{flex:none;width:28px;height:28px;border:2px solid #c1c1c1;border-radius:3px;background:#fff;cursor:pointer;" +
    "display:grid;place-items:center;padding:0;transition:border-color .15s}" +
    ".check:hover{border-color:#b2b2b2}.check:focus-visible{outline:2px solid var(--tick);outline-offset:2px}" +
    ".check[disabled]{cursor:default}.state-warn .check{border-color:var(--warn-line)}" +
    ".spin{width:24px;height:24px;border:3px solid var(--tick);border-top-color:transparent;border-radius:50%;" +
    "animation:r .8s linear infinite}@keyframes r{to{transform:rotate(360deg)}}" +
    ".state-verifying .check,.state-verified .check{border-color:transparent;background:transparent}" +
    ".tick{width:28px;height:28px;stroke:var(--ok);stroke-width:4;fill:none;stroke-dasharray:40;stroke-dashoffset:40;" +
    "animation:d .35s ease-out forwards}@keyframes d{to{stroke-dashoffset:0}}" +
    ".label{flex:1;user-select:none;cursor:pointer}" +
    ".brand{flex:none;font-size:10px;color:var(--muted);text-align:center;line-height:1.3}" +
    ".brand svg{display:block;margin:0 auto 2px;width:26px;height:26px;fill:none;stroke:var(--tick);stroke-width:2}" +
    ".msg{margin:4px 2px 0;font-size:12px;color:var(--bad);max-width:300px}.state-warn .msg{color:var(--warn)}" +
    "@media (prefers-reduced-motion:reduce){.spin,.tick{animation-duration:0s}.tick{stroke-dashoffset:0}" +
    ".box{transition:none}}";

  var SHIELD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg>';
  var TICK = '<svg class="tick" viewBox="0 0 28 28" aria-hidden="true"><path d="M5 15l6 6 12-13"/></svg>';

  class NotRobotCaptcha extends HTMLElement {
    constructor() {
      super();
      this._token = "";
      this._deadline = 0;
      this._timer = 0;
      this._busy = false;
      this.attachShadow({ mode: "open" });
    }

    get token() { return this._token; }

    /** True while the token exists and has not expired (with a small safety margin). */
    get valid() { return !!this._token && Date.now() < this._deadline; }

    connectedCallback() {
      this._attachGuard();
      if (this._root) return;
      var t = this._t();
      var fa = t === TEXT.fa;
      this.shadowRoot.innerHTML =
        "<style>" + STYLE + "</style>" +
        '<div class="wrap state-idle" dir="' + (fa ? "rtl" : "ltr") + '">' +
        '<div class="box">' +
        '<button type="button" class="check" role="checkbox" aria-checked="false" aria-labelledby="l"></button>' +
        '<span class="label" id="l">' + t.label + "</span>" +
        '<span class="brand">' + SHIELD + t.brand + "</span>" +
        "</div>" +
        '<div class="msg" role="alert" hidden></div>' +
        "</div>";
      this._root = this.shadowRoot.querySelector(".wrap");
      this._check = this.shadowRoot.querySelector(".check");
      this._msg = this.shadowRoot.querySelector(".msg");

      var self = this;
      function start(ev) {
        // Synthetic .click()/dispatchEvent from page scripts is ignored.
        if (ev.isTrusted) self._verify();
      }
      this._check.addEventListener("click", start);
      this.shadowRoot.querySelector(".label").addEventListener("click", start);

      // Light-DOM hidden input so a plain <form> submit carries the token.
      var name = this.hasAttribute("name") ? this.getAttribute("name") : "captcha-token";
      if (name) {
        this._input = document.createElement("input");
        this._input.type = "hidden";
        this._input.name = name;
        this.appendChild(this._input);
      }
    }

    disconnectedCallback() {
      clearTimeout(this._timer);
      if (this._form) this._form.removeEventListener("submit", this._guard, true);
      this._form = null;
    }

    _attachGuard() {
      if (this.getAttribute("guard") === "off") return;
      this._form = this.closest("form");
      if (!this._form) return;
      var self = this;
      this._guard = this._guard || function (ev) {
        if (self.requireValid()) return;
        // Capture phase on the form runs before the page's own submit handlers
        // (including React/Vue ones), so stop them too: nothing should send.
        ev.preventDefault();
        ev.stopImmediatePropagation();
      };
      this._form.addEventListener("submit", this._guard, true);
    }

    /**
     * True if the token can be submitted. Otherwise shows why, clears an
     * expired tick, moves focus to the checkbox and returns false.
     */
    requireValid() {
      if (this.valid) return true;
      if (this._token) {
        this._expire();
      } else if (!this._busy) {
        this._showMsg(this._t().required);
      }
      this.scrollIntoView({ block: "center", behavior: "smooth" });
      this._check.focus({ preventScroll: true });
      return false;
    }

    _expire() {
      this.reset();
      this._setState("warn");
      this._showMsg(this._t().expired);
      this.dispatchEvent(new CustomEvent("captcha-expired", { bubbles: true }));
    }

    reset() { this._setState("idle"); this._setToken(""); this._showMsg(""); }

    _t() { return TEXT[(this.getAttribute("lang") || "fa").slice(0, 2)] || TEXT.fa; }

    _server() { return (this.getAttribute("server") || scriptOrigin).replace(/\/+$/, ""); }

    /** idle | verifying | verified (green) | warn (orange: expired or failed, can tick again) */
    _setState(state) {
      this._root.className = "wrap state-" + state;
      var check = this._check;
      check.setAttribute("aria-checked", state === "verified" ? "true" : "false");
      check.setAttribute("aria-busy", state === "verifying" ? "true" : "false");
      check.disabled = state === "verifying" || state === "verified";
      check.innerHTML = state === "verifying" ? '<span class="spin"></span>' : state === "verified" ? TICK : "";
      this.shadowRoot.querySelector(".label").textContent =
        state === "verifying" ? this._t().verifying : this._t().label;
    }

    _setToken(token) {
      clearTimeout(this._timer);
      this._token = token;
      if (this._input) this._input.value = token;
    }

    _showMsg(text) {
      this._msg.textContent = text;
      this._msg.hidden = !text;
    }

    _post(path, body) {
      // A page can route the two calls itself (e.g. APEX Ajax Callbacks where
      // there is no REST endpoint): transport(path, body) → Promise of the JSON;
      // reject with Error(code) for a server error, TypeError for a network one.
      if (typeof this.transport === "function") {
        return Promise.resolve(this.transport(path, body || {})).then(function (json) {
          if (json && json.error) throw new Error(json.error);
          return json;
        });
      }
      return fetch(this._server() + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      }).then(function (res) {
        return res.json().then(function (json) {
          if (!res.ok) throw new Error(json.error || "http-" + res.status);
          return json;
        });
      });
    }

    _verify() {
      if (this._busy || this._token) return;
      this._busy = true;
      this._showMsg("");
      this._setState("verifying");

      var self = this;
      var t = this._t();
      this._post("/challenge")
        .then(function (ch) {
          var received = Date.now();
          return solve(ch.salt, ch.bits).then(function (nonce) {
            // The server rejects answers sooner than ch.wait after issuing; hold a lucky fast solve.
            var remaining = (ch.wait || 0) - (Date.now() - received);
            return new Promise(function (r) { setTimeout(r, Math.max(0, remaining)); }).then(function () {
              return self._post("/solve", { token: ch.token, nonce: nonce });
            });
          });
        })
        .then(function (res) {
          self._busy = false;
          self._setState("verified");
          self._setToken(res.pass);
          // 5s margin so a token that is valid here doesn't expire on its way to the server.
          var lifetime = Math.max(0, res.expiresIn - 5000);
          self._deadline = Date.now() + lifetime;
          self._timer = setTimeout(function () { self._expire(); }, lifetime);
          self.dispatchEvent(new CustomEvent("captcha-verified", { bubbles: true, detail: { token: res.pass } }));
        })
        .catch(function (err) {
          self._busy = false;
          self.reset();
          self._setState("warn");
          var message =
            err instanceof TypeError ? t.network : err.message === "rate-limited" ? t.busy : t.failed;
          self._showMsg(message);
          self.dispatchEvent(
            new CustomEvent("captcha-error", { bubbles: true, detail: { message: message, code: err.message } })
          );
        });
    }
  }

  customElements.define("not-robot-captcha", NotRobotCaptcha);
})();
