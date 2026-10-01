// Login page (9999) glue for the "I'm not a robot" widget — the variant WITHOUT
// ORDS (e.g. APEX 18 on Oracle HTTP Server / mod_plsql, Oracle 11g).
// Paste into page 9999 → JavaScript → "Execute when Page Loads".
// Setup guide: docs/apex-captcha-setup-no-ords.md
//
// Instead of fetch() to ORDS, the widget's two calls go to the page's Ajax
// Callback processes CAPTCHA_CHALLENGE and CAPTCHA_SOLVE (both just call
// captcha_api.ajax_response). The rest is as in login-captcha.js: the token is
// copied into P9999_CAPTCHA_TOKEN, and apexbeforepagesubmit blocks a submit
// without a valid tick. ES5 only, to match what APEX 18's own pages expect.
(function () {
  var ITEM = "P9999_CAPTCHA_TOKEN";
  var widget = document.querySelector("not-robot-captcha");
  if (!widget) return;

  widget.transport = function (path, body) {
    var process = path === "/challenge" ? "CAPTCHA_CHALLENGE" : "CAPTCHA_SOLVE";
    return new Promise(function (resolve, reject) {
      apex.server
        .process(process, { x01: body.token, x02: body.nonce }, { dataType: "json" })
        .done(resolve)
        // The widget shows its "could not reach the server" message for a TypeError.
        .fail(function () { reject(new TypeError("network")); });
    });
  };

  widget.addEventListener("captcha-verified", function (e) {
    apex.item(ITEM).setValue(e.detail.token);
  });
  widget.addEventListener("captcha-expired", function () {
    apex.item(ITEM).setValue("");
  });

  apex.jQuery(apex.gPageContext$).on("apexbeforepagesubmit", function () {
    // If the widget script failed to load, let the submit through: the
    // server-side validation still rejects it with a clear message.
    if (typeof widget.requireValid === "function" && !widget.requireValid()) {
      apex.event.gCancelFlag = true;
    }
  });
})();
