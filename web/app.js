/* SmartAttend emergency loader — last good app.js from commit ec37c619 */
(function () {
  var s = document.createElement("script");
  s.src = "https://cdn.jsdelivr.net/gh/odoema/smartattend@ec37c619d634f5f6d2f91dd24e1d2f351bdd04cf/web/app.js";
  s.crossOrigin = "anonymous";
  s.onerror = function () {
    document.body.innerHTML = "<p style='font:16px system-ui;padding:2rem'>Could not load SmartAttend. Hard-refresh or try again in a minute.</p>";
  };
  document.head.appendChild(s);
})();
