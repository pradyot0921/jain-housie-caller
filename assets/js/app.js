(function () {
  "use strict";

  var STORAGE_KEY = "jain-housie-host-v2";
  var LEGACY_KEY = "jain-housie-caller-v1";
  var TAB_KEY = "jain-housie-active-tab";
  var TOTAL = WORDS.length;
  var SHUFFLE_MS = 900;
  var SVG_NS = "http://www.w3.org/2000/svg";
  var $ = function (id) { return document.getElementById(id); };

  var PRIZES = [
    { id: "early5", label: "Early Five" },
    { id: "top", label: "Top Line" },
    { id: "middle", label: "Middle Line" },
    { id: "bottom", label: "Bottom Line" },
    { id: "full", label: "Full House" }
  ];

  var state = freshState();
  var busy = false;
  var tiles = {};
  var ticks = [];
  var probe;
  var wakeLock = null;
  var wakeWanted = false;
  var installPrompt = null;
  var lastFocus = null;
  var DATA_OK = validateData();

  function freshState() {
    var now = Date.now();
    return { version: 2, startedAt: now, updatedAt: now, called: [], callTimes: [], winners: [] };
  }

  function word(n) { return WORDS[n - 1]; }

  function escapeHtml(s) {
    return String(s).replace(/[&<>\"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function formatDate(ts) {
    if (!ts) return "earlier";
    try {
      return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ts));
    } catch (e) {
      return new Date(ts).toLocaleString();
    }
  }

  function prizeLabel(id) {
    var found = PRIZES.find(function (p) { return p.id === id; });
    return found ? found.label : id;
  }

  function validateData() {
    var errors = [];
    if (!Array.isArray(WORDS) || WORDS.length !== 90) errors.push("WORDS must contain exactly 90 entries.");
    if (!Array.isArray(TICKETS) || TICKETS.length !== 40) errors.push("TICKETS must contain exactly 40 tickets.");

    if (Array.isArray(TICKETS)) {
      TICKETS.forEach(function (ticket, ti) {
        if (!Array.isArray(ticket) || ticket.length !== 3) {
          errors.push("Ticket " + (ti + 1) + " must have 3 rows.");
          return;
        }
        var seen = new Set();
        ticket.forEach(function (row, ri) {
          if (!Array.isArray(row) || row.length !== 9) {
            errors.push("Ticket " + (ti + 1) + ", row " + (ri + 1) + " must have 9 cells.");
            return;
          }
          var values = row.filter(Boolean);
          if (values.length !== 5) errors.push("Ticket " + (ti + 1) + ", row " + (ri + 1) + " must contain 5 words.");
          row.forEach(function (n, col) {
            if (!n) return;
            if (!Number.isInteger(n) || n < 1 || n > 90) errors.push("Ticket " + (ti + 1) + " contains an invalid word number.");
            var min = col === 0 ? 1 : col * 10;
            var max = col === 8 ? 90 : col * 10 + 9;
            if (n < min || n > max) errors.push("Ticket " + (ti + 1) + " has word " + n + " in the wrong column.");
            if (seen.has(n)) errors.push("Ticket " + (ti + 1) + " repeats word " + n + ".");
            seen.add(n);
          });
        });
        if (seen.size !== 15) errors.push("Ticket " + (ti + 1) + " must contain 15 unique words.");
        for (var col = 0; col < 9; col++) {
          var column = ticket.map(function (row) { return row[col]; }).filter(Boolean);
          for (var i = 1; i < column.length; i++) {
            if (column[i] <= column[i - 1]) errors.push("Ticket " + (ti + 1) + " column " + (col + 1) + " is not ascending.");
          }
        }
      });
    }

    if (errors.length) {
      console.error("Jain Housie data validation failed:\n" + errors.join("\n"));
      return false;
    }
    return true;
  }

  function normalizeState(saved) {
    if (!saved || typeof saved !== "object") return null;
    if (!Array.isArray(saved.called)) return null;
    var validCalled = saved.called.every(function (n) { return Number.isInteger(n) && n >= 1 && n <= TOTAL; }) && new Set(saved.called).size === saved.called.length;
    if (!validCalled) return null;

    var out = freshState();
    out.startedAt = Number(saved.startedAt) || out.startedAt;
    out.updatedAt = Number(saved.updatedAt) || out.startedAt;
    out.called = saved.called.slice();
    out.callTimes = Array.isArray(saved.callTimes) ? saved.callTimes.slice(0, out.called.length) : [];
    while (out.callTimes.length < out.called.length) out.callTimes.push(null);
    out.winners = Array.isArray(saved.winners) ? saved.winners.filter(function (w) {
      return w && PRIZES.some(function (p) { return p.id === w.prize; }) && Number.isInteger(w.ticket) && w.ticket >= 1 && w.ticket <= TICKETS.length;
    }) : [];
    return out;
  }

  function load() {
    try {
      var saved = normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
      if (saved) {
        state = saved;
        return;
      }
      var legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
      if (Array.isArray(legacy) && legacy.length && legacy.every(function (n) { return Number.isInteger(n) && n >= 1 && n <= TOTAL; }) && new Set(legacy).size === legacy.length) {
        state.called = legacy.slice();
        state.callTimes = legacy.map(function () { return null; });
        save();
      }
    } catch (e) {
      console.warn("Saved game could not be loaded.", e);
    }
  }

  function save() {
    state.updatedAt = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.removeItem(LEGACY_KEY);
    } catch (e) {}
  }

  function remaining() {
    var done = new Set(state.called), left = [];
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

  function buildTicks() {
    var group = $("ticks");
    for (var i = 0; i < TOTAL; i++) {
      var a = (i / TOTAL) * Math.PI * 2 - Math.PI / 2;
      var line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", 170 + Math.cos(a) * 150);
      line.setAttribute("y1", 170 + Math.sin(a) * 150);
      line.setAttribute("x2", 170 + Math.cos(a) * 162);
      line.setAttribute("y2", 170 + Math.sin(a) * 162);
      line.setAttribute("class", "tick");
      group.appendChild(line);
      ticks.push(line);
    }
  }

  function fitCurrent() {
    var el = $("current");
    if (el.classList.contains("idle")) { el.style.fontSize = ""; return; }
    var ring = $("rings").clientWidth;
    var size = Math.round(ring * 0.17);
    var maxHeight = ring * 0.44;
    if (!probe) {
      probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;left:-9999px;top:0";
      document.body.appendChild(probe);
    }
    probe.style.fontFamily = getComputedStyle(el).fontFamily;
    var parts = el.textContent.split(" ");
    var widest = function () {
      probe.style.fontSize = size + "px";
      return Math.max.apply(null, parts.map(function (p) { probe.textContent = p; return probe.getBoundingClientRect().width; }));
    };
    el.style.fontSize = size + "px";
    while (size > 24 && (widest() > el.clientWidth - 4 || el.scrollHeight > maxHeight)) {
      size -= 2;
      el.style.fontSize = size + "px";
    }
  }

  function renderRecent() {
    var before = [];
    for (var i = state.called.length - 2; i >= 0 && before.length < 6; i--) before.push(i);
    $("recent").innerHTML = before.length
      ? before.map(function (idx) { return "<li><i>" + (idx + 1) + "</i><span>" + escapeHtml(word(state.called[idx])) + "</span></li>"; }).join("")
      : '<li class="empty">Nothing yet</li>';
  }

  function renderWinnersMini() {
    var el = $("winnersMini");
    if (!state.winners.length) {
      el.className = "empty-note";
      el.textContent = "No prizes awarded yet";
      return;
    }
    el.className = "winner-chips";
    el.innerHTML = state.winners.slice(-3).reverse().map(function (w) {
      return '<button type="button" data-winner-open><b>' + escapeHtml(prizeLabel(w.prize)) + '</b><span>Ticket ' + w.ticket + (w.player ? " · " + escapeHtml(w.player) : "") + "</span></button>";
    }).join("");
    el.querySelectorAll("[data-winner-open]").forEach(function (b) { b.addEventListener("click", openWinners); });
  }

  function render() {
    var last = state.called[state.called.length - 1];
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

    var done = new Set(state.called);
    for (var n = 1; n <= TOTAL; n++) {
      tiles[n].classList.toggle("called", done.has(n));
      tiles[n].classList.toggle("last", n === last);
    }
    ticks.forEach(function (t, i) {
      t.classList.toggle("on", i < state.called.length);
      t.classList.toggle("last", i === state.called.length - 1);
    });

    $("countText").textContent = state.called.length + " of " + TOTAL + " called";
    $("leftText").textContent = (TOTAL - state.called.length) + " left";
    $("mobileCurrent").textContent = last ? word(last) : "Not started";

    var finished = state.called.length === TOTAL;
    var drawDisabled = busy || finished || !DATA_OK;
    $("drawBtn").disabled = drawDisabled;
    $("mobileDrawBtn").disabled = drawDisabled;
    $("drawLabel").textContent = finished ? "All " + TOTAL + " words called" : "Draw next word";
    $("mobileDrawBtn").textContent = finished ? "Done" : busy ? "Drawing…" : "Draw";
    $("undoBtn").hidden = busy || state.called.length === 0;
    $("checkBtn").disabled = busy || !DATA_OK;
    $("newBtn").disabled = busy || state.called.length === 0;

    renderRecent();
    renderWinnersMini();
  }

  function pulse() {
    var p = $("pulse");
    p.classList.remove("go");
    void p.getBoundingClientRect();
    p.classList.add("go");
  }

  function announceFinal(n) {
    $("announce").textContent = "Called word " + state.called.length + ": " + word(n);
  }

  function drawWord() {
    if (busy || !DATA_OK) return;
    var left = remaining();
    if (!left.length) return;

    var pick = left[randomIndex(left.length)];
    var current = $("current");
    var reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

    function land() {
      busy = false;
      state.called.push(pick);
      state.callTimes.push(Date.now());
      save();
      current.classList.remove("shuffling", "idle", "landed");
      void current.offsetWidth;
      current.classList.add("landed");
      render();
      pulse();
      announceFinal(pick);
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
    if (busy || !state.called.length) return;
    state.called.pop();
    state.callTimes.pop();
    state.winners = state.winners.filter(function (w) { return !w.completedAtCall || w.completedAtCall <= state.called.length; });
    save();
    render();
    $("announce").textContent = "Last draw undone.";
  }

  function setBackgroundInert(on) {
    [$("pageHeader"), $("pageMain"), $("mobileBar")].forEach(function (el) {
      if (el) el.inert = on;
    });
  }

  function openDialog(id, focusSelector) {
    lastFocus = document.activeElement;
    var overlay = $(id);
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    setBackgroundInert(true);
    var box = overlay.querySelector(".dialog");
    box.classList.remove("open-anim");
    void box.offsetWidth;
    box.classList.add("open-anim");
    var target = focusSelector ? overlay.querySelector(focusSelector) : overlay.querySelector("button,input,select,[tabindex]:not([tabindex='-1'])");
    if (target) target.focus();
  }

  function closeDialogs() {
    document.querySelectorAll(".overlay.open").forEach(function (o) {
      o.classList.remove("open");
      o.setAttribute("aria-hidden", "true");
    });
    setBackgroundInert(false);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function dialogOpen() { return document.querySelector(".overlay.open"); }

  function trapFocus(e) {
    var overlay = dialogOpen();
    if (!overlay || e.key !== "Tab") return;
    var items = Array.prototype.slice.call(overlay.querySelectorAll("button:not([disabled]):not([hidden]),input:not([disabled]),select:not([disabled]),[href],[tabindex]:not([tabindex='-1'])"));
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function askNewGame() {
    if (busy || !state.called.length) return;
    var n = state.called.length;
    $("newMsg").textContent = n + (n === 1 ? " word has" : " words have") + " been called and " + state.winners.length + " prize award(s) are saved. Starting a new game clears both and cannot be undone.";
    openDialog("newDlg", "[data-close]");
  }

  function startNewGame() {
    state = freshState();
    save();
    closeDialogs();
    render();
    $("drawBtn").focus();
    try { sessionStorage.setItem(TAB_KEY, "1"); } catch (e) {}
  }

  function buildPrizeOptions() {
    $("prizeType").innerHTML = PRIZES.map(function (p) { return '<option value="' + p.id + '">' + escapeHtml(p.label) + "</option>"; }).join("");
  }

  function ticketNumbers(ticketNo) {
    var out = [];
    TICKETS[ticketNo - 1].forEach(function (row) { row.forEach(function (n) { if (n) out.push(n); }); });
    return out;
  }

  function callPosition(n) {
    var idx = state.called.indexOf(n);
    return idx === -1 ? 0 : idx + 1;
  }

  function evaluateClaim(ticketNo, prize) {
    var grid = TICKETS[ticketNo - 1];
    var targets;
    var required;

    if (prize === "top") targets = grid[0].filter(Boolean);
    else if (prize === "middle") targets = grid[1].filter(Boolean);
    else if (prize === "bottom") targets = grid[2].filter(Boolean);
    else targets = ticketNumbers(ticketNo);

    if (prize === "early5") {
      var calledTargets = targets.map(function (n) { return { n: n, pos: callPosition(n) }; }).filter(function (x) { return x.pos; }).sort(function (a, b) { return a.pos - b.pos; });
      required = 5;
      if (calledTargets.length >= required) {
        return { valid: true, completion: calledTargets[required - 1].pos, missing: [], progress: calledTargets.length + " of 15 ticket words called" };
      }
      return { valid: false, completion: 0, missing: targets.filter(function (n) { return !callPosition(n); }), progress: calledTargets.length + " of 5 needed" };
    }

    required = targets.length;
    var positions = targets.map(callPosition);
    var missing = targets.filter(function (n, i) { return !positions[i]; });
    var count = required - missing.length;
    return {
      valid: missing.length === 0,
      completion: missing.length ? 0 : Math.max.apply(null, positions),
      missing: missing,
      progress: count + " of " + required + " required words called"
    };
  }

  function ticketHtml(ticketNo) {
    var grid = TICKETS[ticketNo - 1];
    var done = new Set(state.called);
    var html = '<div class="ticket" aria-label="Ticket ' + ticketNo + '">';
    grid.forEach(function (row) {
      row.forEach(function (w) {
        html += w
          ? '<div class="tcell' + (done.has(w) ? " cut" : "") + '"><span>' + escapeHtml(word(w)) + "</span></div>"
          : '<div class="tcell empty"></div>';
      });
    });
    return html + "</div>";
  }

  function awardExists(ticketNo, prize) {
    return state.winners.some(function (w) { return w.ticket === ticketNo && w.prize === prize; });
  }

  function verifyClaim() {
    var ticketNo = parseInt($("ticketNo").value, 10);
    var prize = $("prizeType").value;
    var out = $("ticketOut");

    if (!(ticketNo >= 1 && ticketNo <= TICKETS.length)) {
      out.innerHTML = '<p class="error">Enter a ticket number from 1 to ' + TICKETS.length + ".</p>";
      return;
    }

    var result = evaluateClaim(ticketNo, prize);
    var html = ticketHtml(ticketNo);
    var already = awardExists(ticketNo, prize);

    if (result.valid) {
      var finalWord = state.called[result.completion - 1];
      html += '<section class="claim-result valid"><div><span class="result-kicker">Valid claim</span><h3>' + escapeHtml(prizeLabel(prize)) + " · Ticket " + ticketNo + '</h3><p>Completed on call <b>#' + result.completion + "</b> with <span class=\"hindi\">" + escapeHtml(word(finalWord)) + "</span>.</p></div>";
      if (already) {
        html += '<p class="already">This prize has already been recorded for Ticket ' + ticketNo + ".</p>";
      } else {
        html += '<div class="award-box"><label>Player name <span>(optional)</span><input id="playerName" type="text" autocomplete="off" maxlength="60" placeholder="Name"></label><button class="btn btn-primary" id="awardBtn" type="button">Award prize</button></div>';
      }
      html += "</section>";
    } else {
      html += '<section class="claim-result invalid"><div><span class="result-kicker">Not complete yet</span><h3>' + escapeHtml(prizeLabel(prize)) + " · Ticket " + ticketNo + "</h3><p>" + escapeHtml(result.progress) + ".</p></div>";
      if (result.missing.length) {
        html += '<div class="missing"><b>Still uncalled</b><div>' + result.missing.slice(0, 8).map(function (n) { return '<span class="hindi">' + escapeHtml(word(n)) + "</span>"; }).join("") + (result.missing.length > 8 ? "<em>+" + (result.missing.length - 8) + " more</em>" : "") + "</div></div>";
      }
      html += "</section>";
    }

    out.innerHTML = html;
    var awardBtn = $("awardBtn");
    if (awardBtn) awardBtn.addEventListener("click", function () { awardPrize(ticketNo, prize, result.completion); });
  }

  function awardPrize(ticketNo, prize, completion) {
    if (awardExists(ticketNo, prize)) return;
    var player = $("playerName") ? $("playerName").value.trim() : "";
    state.winners.push({
      prize: prize,
      ticket: ticketNo,
      player: player,
      completedAtCall: completion,
      awardedAt: Date.now()
    });
    save();
    renderWinnersMini();
    verifyClaim();
    $("announce").textContent = prizeLabel(prize) + " awarded to Ticket " + ticketNo + ".";
  }

  function openClaim() {
    if (busy || !DATA_OK) return;
    $("ticketOut").innerHTML = "";
    $("ticketNo").value = "";
    $("prizeType").value = "early5";
    openDialog("checkDlg", "#ticketNo");
  }

  function openHistory() {
    var list = $("historyList");
    $("historySummary").textContent = state.called.length ? state.called.length + " of " + TOTAL + " words have been called." : "No words have been called yet.";
    list.innerHTML = state.called.length ? state.called.map(function (n, i) {
      var when = state.callTimes[i] ? '<time datetime="' + new Date(state.callTimes[i]).toISOString() + '">' + escapeHtml(formatDate(state.callTimes[i])) + "</time>" : "";
      return '<li><b>#' + (i + 1) + '</b><span class="hindi">' + escapeHtml(word(n)) + "</span>" + when + "</li>";
    }).join("") : '<li class="history-empty">Nothing yet</li>';
    openDialog("historyDlg", "[data-close]");
  }

  function renderWinnerLedger() {
    var out = $("winnerLedger");
    if (!state.winners.length) {
      out.innerHTML = '<p class="empty-ledger">No prizes have been awarded in this game.</p>';
      return;
    }
    out.innerHTML = '<div class="ledger">' + state.winners.map(function (w, i) {
      return '<div class="ledger-row"><div><b>' + escapeHtml(prizeLabel(w.prize)) + '</b><span>Ticket ' + w.ticket + (w.player ? " · " + escapeHtml(w.player) : "") + '</span></div><div><span>Completed #' + (w.completedAtCall || "?") + '</span><button class="text-btn danger-text" type="button" data-remove-award="' + i + '">Remove</button></div></div>';
    }).join("") + "</div>";
    out.querySelectorAll("[data-remove-award]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = parseInt(btn.getAttribute("data-remove-award"), 10);
        state.winners.splice(idx, 1);
        save();
        renderWinnersMini();
        renderWinnerLedger();
      });
    });
  }

  function openWinners() {
    renderWinnerLedger();
    openDialog("winnersDlg", "[data-close]");
  }

  function buildPrintSheet() {
    var sheet = $("printSheet");
    sheet.innerHTML = TICKETS.map(function (grid, index) {
      var cells = "";
      grid.forEach(function (row) {
        row.forEach(function (n) {
          cells += n ? '<div><small>' + n + '</small><span>' + escapeHtml(word(n)) + '</span></div>' : '<div class="blank"></div>';
        });
      });
      return '<section class="print-ticket"><header><b>Jain Word Housie</b><strong>Ticket ' + (index + 1) + '</strong></header><div class="print-grid">' + cells + "</div></section>";
    }).join("");
  }

  function printTickets() {
    buildPrintSheet();
    closeDialogs();
    setTimeout(function () { window.print(); }, 50);
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (e) {}
    updateToolsState();
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return false;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", function () { wakeLock = null; updateToolsState(); });
      return true;
    } catch (e) {
      wakeLock = null;
      return false;
    }
  }

  async function toggleWake() {
    wakeWanted = !wakeWanted;
    if (wakeWanted) {
      var ok = await requestWakeLock();
      if (!ok) wakeWanted = false;
    } else if (wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
    updateToolsState();
  }

  function updateToolsState() {
    $("fullscreenBtn").querySelector("strong").textContent = document.fullscreenElement ? "Exit" : "Open";
    $("wakeState").textContent = wakeWanted && wakeLock ? "On" : "Off";
    $("wakeBtn").disabled = !("wakeLock" in navigator);
    if (!("wakeLock" in navigator)) $("wakeState").textContent = "Unavailable";
  }

  function openTools() {
    updateToolsState();
    openDialog("toolsDlg", "#fullscreenBtn");
  }

  function maybeShowResume() {
    if (!state.called.length) return;
    var sameSession = false;
    try {
      sameSession = sessionStorage.getItem(TAB_KEY) === "1";
      sessionStorage.setItem(TAB_KEY, "1");
    } catch (e) {}
    if (sameSession) return;
    $("resumeMsg").textContent = state.called.length + " of " + TOTAL + " words were called. This game was last updated " + formatDate(state.updatedAt) + ".";
    openDialog("resumeDlg", "#resumeGame");
  }

  function registerPwa() {
    if (!("serviceWorker" in navigator)) {
      $("offlineStatus").textContent = "Offline installation is not supported by this browser.";
      return;
    }
    navigator.serviceWorker.register("./sw.js").then(function () {
      $("offlineStatus").textContent = "Offline support is ready. Your active game is also saved on this device.";
    }).catch(function () {
      $("offlineStatus").textContent = "Offline support could not be enabled in this browser.";
    });

    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      installPrompt = e;
      $("installBtn").hidden = false;
    });
  }

  async function installApp() {
    if (!installPrompt) return;
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch (e) {}
    installPrompt = null;
    $("installBtn").hidden = true;
  }

  buildBoard();
  buildTicks();
  buildPrizeOptions();
  load();
  if (!DATA_OK) $("dataError").hidden = false;
  render();
  registerPwa();
  maybeShowResume();

  $("drawBtn").addEventListener("click", drawWord);
  $("mobileDrawBtn").addEventListener("click", drawWord);
  $("undoBtn").addEventListener("click", undo);
  $("newBtn").addEventListener("click", askNewGame);
  $("confirmNew").addEventListener("click", startNewGame);
  $("freshGame").addEventListener("click", startNewGame);
  $("resumeGame").addEventListener("click", closeDialogs);
  $("checkBtn").addEventListener("click", openClaim);
  $("verifyClaim").addEventListener("click", verifyClaim);
  $("ticketNo").addEventListener("keydown", function (e) { if (e.key === "Enter") verifyClaim(); });
  $("historyBtn").addEventListener("click", openHistory);
  $("historyInlineBtn").addEventListener("click", openHistory);
  $("winnersBtn").addEventListener("click", openWinners);
  $("toolsBtn").addEventListener("click", openTools);
  $("fullscreenBtn").addEventListener("click", toggleFullscreen);
  $("wakeBtn").addEventListener("click", toggleWake);
  $("printBtn").addEventListener("click", printTickets);
  $("installBtn").addEventListener("click", installApp);

  document.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", closeDialogs); });
  document.querySelectorAll(".overlay").forEach(function (o) {
    o.addEventListener("click", function (e) { if (e.target === o && o.id !== "resumeDlg") closeDialogs(); });
  });

  document.addEventListener("keydown", function (e) {
    trapFocus(e);
    if (e.key === "Escape" && dialogOpen()) {
      if (dialogOpen().id !== "resumeDlg") closeDialogs();
      return;
    }
    if (dialogOpen()) return;
    var tag = (e.target.tagName || "").toLowerCase();
    if (e.code === "Space" && tag !== "input" && tag !== "button" && tag !== "textarea" && tag !== "select") {
      e.preventDefault();
      drawWord();
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && wakeWanted && !wakeLock) requestWakeLock().then(updateToolsState);
  });
  document.addEventListener("fullscreenchange", updateToolsState);
  window.addEventListener("resize", fitCurrent);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitCurrent);
})();
