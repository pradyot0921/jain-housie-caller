(function () {
  "use strict";

  var STORAGE_KEY = "jain-housie-caller-v1";
  var TOTAL = WORDS.length;
  var SHUFFLE_MS = 900;
  var $ = function (id) { return document.getElementById(id); };

  var called = [];   // word numbers (1 to 90) in the order they were drawn
  var busy = false;  // true while the shuffle animation runs
  var tiles = {};

  function word(n) { return WORDS[n - 1]; }

  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      var valid = Array.isArray(saved) &&
        saved.every(function (n) { return Number.isInteger(n) && n >= 1 && n <= TOTAL; }) &&
        new Set(saved).size === saved.length;
      if (valid) called = saved;
    } catch (e) { /* storage unavailable: game still works, it just won't survive a refresh */ }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(called)); } catch (e) {}
  }

  function remaining() {
    var done = new Set(called), left = [];
    for (var n = 1; n <= TOTAL; n++) if (!done.has(n)) left.push(n);
    return left;
  }

  function randomIndex(length) {
    if (window.crypto && crypto.getRandomValues) {
      var buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return buf[0] % length;
    }
    return Math.floor(Math.random() * length);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  function buildBoard() {
    var board = $("board");
    for (var n = 1; n <= TOTAL; n++) {
      var tile = document.createElement("div");
      tile.className = "tile";
      tile.innerHTML = "<b>" + n + "</b><span>" + escapeHtml(word(n)) + "</span>";
      board.appendChild(tile);
      tiles[n] = tile;
    }
  }

  // Shrink the big word only if a single unbreakable part would not fit the panel.
  var probe;
  function fitCurrent() {
    var el = $("current");
    if (el.classList.contains("idle")) { el.style.fontSize = ""; return; }
    var size = window.innerWidth <= 860 ? 56 : 68;
    el.style.fontSize = size + "px";
    if (!probe) {
      probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;left:-9999px";
      probe.style.fontFamily = getComputedStyle(el).fontFamily;
      document.body.appendChild(probe);
    }
    var parts = el.textContent.split(" ");
    var widest = function () {
      probe.style.fontSize = size + "px";
      return Math.max.apply(null, parts.map(function (p) { probe.textContent = p; return probe.getBoundingClientRect().width; }));
    };
    while (size > 28 && widest() > el.clientWidth - 8) size -= 2;
    el.style.fontSize = size + "px";
  }

  function render() {
    var last = called[called.length - 1];
    var current = $("current");

    if (!busy) {
      if (last) {
        current.textContent = word(last);
        current.classList.remove("idle");
      } else {
        current.textContent = "Press draw to call the first word";
        current.classList.add("idle");
      }
      fitCurrent();
    }

    var done = new Set(called);
    for (var n = 1; n <= TOTAL; n++) {
      tiles[n].classList.toggle("called", done.has(n));
      tiles[n].classList.toggle("last", n === last);
    }

    $("countText").textContent = called.length + " of " + TOTAL + " called";
    $("leftText").textContent = (TOTAL - called.length) + " left";
    $("bar").style.width = (called.length / TOTAL * 100) + "%";

    var finished = called.length === TOTAL;
    var draw = $("drawBtn");
    draw.disabled = busy || finished;
    draw.textContent = finished ? "All " + TOTAL + " words called" : "Draw next word";
    $("undoBtn").hidden = busy || called.length === 0;

    var before = called.slice(0, -1).slice(-6).reverse();
    $("recent").innerHTML = before.length
      ? before.map(function (n) { return "<li>" + escapeHtml(word(n)) + "</li>"; }).join("")
      : '<li class="empty">Nothing yet</li>';
  }

  function drawWord() {
    if (busy) return;
    var left = remaining();
    if (!left.length) return;

    var pick = left[randomIndex(left.length)];
    var current = $("current");
    var reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

    function land() {
      busy = false;
      called.push(pick);
      save();
      current.classList.remove("shuffling", "idle", "landed");
      void current.offsetWidth; // restart the landing animation
      current.classList.add("landed");
      render();
    }

    if (reduceMotion || left.length === 1) { land(); return; }

    busy = true;
    render();
    current.classList.remove("idle");
    current.classList.add("shuffling");
    var timer = setInterval(function () {
      current.textContent = word(left[randomIndex(left.length)]);
      fitCurrent();
    }, 75);
    setTimeout(function () { clearInterval(timer); land(); }, SHUFFLE_MS);
  }

  function undo() {
    if (busy || !called.length) return;
    called.pop();
    save();
    render();
  }

  // dialogs
  var lastFocus = null;
  function openDialog(id, focusSelector) {
    lastFocus = document.activeElement;
    $(id).classList.add("open");
    var target = $(id).querySelector(focusSelector);
    if (target) target.focus();
  }
  function closeDialogs() {
    document.querySelectorAll(".overlay.open").forEach(function (o) { o.classList.remove("open"); });
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function dialogOpen() { return !!document.querySelector(".overlay.open"); }

  function askNewGame() {
    if (busy) return;
    if (!called.length) return;
    var n = called.length;
    $("newMsg").textContent = n + (n === 1 ? " word has" : " words have") + " been called. Starting a new game clears the board.";
    openDialog("newDlg", "[data-close]");
  }

  function startNewGame() {
    called = [];
    save();
    closeDialogs();
    render();
    $("drawBtn").focus();
  }

  function showTicket() {
    var n = parseInt($("ticketNo").value, 10);
    var out = $("ticketOut");
    if (!(n >= 1 && n <= TICKETS.length)) {
      out.innerHTML = '<p class="error">Enter a ticket number from 1 to ' + TICKETS.length + ".</p>";
      return;
    }
    var grid = TICKETS[n - 1];
    var done = new Set(called);
    var html = '<div class="ticket" aria-label="Ticket ' + n + '">';
    grid.forEach(function (row) {
      row.forEach(function (w) {
        html += w
          ? '<div class="tcell' + (done.has(w) ? " cut" : "") + '"><span>' + escapeHtml(word(w)) + "</span></div>"
          : '<div class="tcell empty"></div>';
      });
    });
    html += "</div>";

    var total = 0, lines = "";
    grid.forEach(function (row, i) {
      var count = row.filter(function (w) { return w && done.has(w); }).length;
      total += count;
      lines += "<span>Line " + (i + 1) + ": " + count + " of 5 called" + (count === 5 ? ' <span class="ok">Complete</span>' : "") + "</span>";
    });
    html += '<div class="summary"><strong>Ticket ' + n + ": " + total + " of 15 words called" +
      (total === 15 ? ' <span class="ok">Full house</span>' : "") + "</strong>" + lines + "</div>";
    out.innerHTML = html;
  }

  // wire up
  buildBoard();
  load();
  render();

  $("drawBtn").addEventListener("click", drawWord);
  $("undoBtn").addEventListener("click", undo);
  $("newBtn").addEventListener("click", askNewGame);
  $("confirmNew").addEventListener("click", startNewGame);
  $("checkBtn").addEventListener("click", function () {
    $("ticketOut").innerHTML = "";
    $("ticketNo").value = "";
    openDialog("checkDlg", "#ticketNo");
  });
  $("showTicket").addEventListener("click", showTicket);
  $("ticketNo").addEventListener("keydown", function (e) { if (e.key === "Enter") showTicket(); });
  document.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", closeDialogs); });
  document.querySelectorAll(".overlay").forEach(function (o) {
    o.addEventListener("click", function (e) { if (e.target === o) closeDialogs(); });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && dialogOpen()) { closeDialogs(); return; }
    if (dialogOpen()) return;
    var tag = (e.target.tagName || "").toLowerCase();
    if (e.code === "Space" && tag !== "input" && tag !== "button" && tag !== "textarea") {
      e.preventDefault();
      drawWord();
    }
  });

  window.addEventListener("resize", fitCurrent);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitCurrent);
})();
