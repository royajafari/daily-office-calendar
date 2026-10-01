// Login page (9999) glue for the "I'm not a robot" widget.
// Paste into page 9999 → JavaScript → "Execute when Page Loads".
// See apex/pages/page-9999-login.apexlang for the rest of the setup.
//
// APEX only submits its own page items, so the token is copied into
// P9999_CAPTCHA_TOKEN; the Login validation then burns it with
// captcha_api.consume_pass. APEX also submits through its own code rather
// than a plain form submit, so the widget's built-in guard is off
// (guard="off") and the check hooks APEX's apexbeforepagesubmit instead.
(function () {
  var ITEM = "P9999_CAPTCHA_TOKEN";
  var widget = document.querySelector("not-robot-captcha");
  if (!widget) return;

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
