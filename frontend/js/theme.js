(function () {
  var KEY = "avs_theme";
  function apply(t) {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem(KEY, t);
    var btn = document.querySelector(".theme-toggle");
    if (btn) btn.textContent = t === "light" ? "☀" : "☾";
  }
  var saved = localStorage.getItem(KEY) || "dark";
  apply(saved);
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest(".theme-toggle")) {
      e.preventDefault();
      var cur = document.documentElement.getAttribute("data-theme") || "dark";
      apply(cur === "dark" ? "light" : "dark");
    }
  });
})();
