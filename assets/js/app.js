(function () {
  "use strict";

  var STORAGE_KEY = "jain-housie-host-v2";
  var LEGACY_KEY = "jain-housie-caller-v1";
  var TAB_KEY = "jain-housie-active-tab";
  var TOTAL = WORDS.length;
  var SHUFFLE_MS = 900;
  var SVG_NS = "http://www.w3.org/2000/svg";
  var $ = function (id) { return document.getElementById(id); };

  var VALID_RULES = ["any", "top", "middle", "bottom", "full", "pattern"];
  var state;
  var busy = false;
  var tiles = {};
  var ticks = [];
  var probe;
  var wakeLock = null;
  var wakeWanted = false;
  var installPrompt = null;
  var lastFocus = null;
  var prizeDraft = [];
  var patternPrizeIndex = -1;
  var patternDraft = [];
  var DATA_OK = validateData();

  function defaultPrizes() {
    return [
      { id: "early5", label: "Early Five", rule: "any", count: 5 },
      { id: "top", label: "Top Line", rule: "top" },
      { id: "middle", label: "Middle Line", rule: "middle" },
      { id: "bottom", label: "Bottom Line", rule: "bottom" },
      { id: "full", label: "Full House", rule: "full" }
    ];
  }

  function clonePrizes(prizes) {
    return (prizes || []).map(function (p) {
      return {
        id: p.id,
        label: p.label,
        rule: p.rule,
        count: p.rule === "any" ? p.count : undefined,
        pattern: p.rule === "pattern" && Array.isArray(p.pattern) ? p.pattern.slice() : undefined
      };
    });
  }

  function freshState(prizes) {
    var now = Date.now();
    return {
      version: 4,
      startedAt: now,
      updatedAt: now,
      called: [],
      callTimes: [],
      winners: [],
      prizes: clonePrizes(prizes && prizes.length ? prizes : defaultPrizes())
    };
  }

  state = freshState();

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
    var found = state.prizes.find(function (p) { return p.id === id; });
    return found ? found.label : id;
  }

  function winnerPrizeLabel(winner) {
    return winner.prizeLabel || prizeLabel(winner.prize);
  }

  function ruleLabel(prize) {
    if (!prize) return "";
    if (prize.rule === "any") return "Any " + prize.count + " numbers on the ticket";
    if (prize.rule === "top") return "All 5 numbers in the top line";
    if (prize.rule === "middle") return "All 5 numbers in the middle line";
    if (prize.rule === "bottom") return "All 5 numbers in the bottom line";
    if (prize.rule === "full") return "All 15 numbers on the ticket";
    if (prize.rule === "pattern") return "All " + prize.pattern.length + " selected positions on the ticket";
    return "";
  }

  function validPatternKey(key) {
    return /^[0-2]:[0-4]$/.test(String(key));
  }

  function normalizePattern(pattern) {
    var seen = new Set();
    return (Array.isArray(pattern) ? pattern : []).map(String).filter(function (key) {
      if (!validPatternKey(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort();
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

  function normalizePrize(p, index) {
    if (!p || typeof p !== "object") return null;
    var rule = VALID_RULES.indexOf(p.rule) !== -1 ? p.rule : null;
    if (!rule) return null;
    var label = String(p.label || "").trim().slice(0, 60);
    if (!label) return null;
    var id = String(p.id || ("prize-" + index)).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
    if (!id) id = "prize-" + index;
    var out = { id: id, label: label, rule: rule };
    if (rule === "any") {
      var count = parseInt(p.count, 10);
      out.count = count >= 1 && count <= 15 ? count : 5;
    }
    if (rule === "pattern") {
      out.pattern = normalizePattern(p.pattern);
      if (!out.pattern.length) return null;
    }
    return out;
  }

  function normalizeState(saved) {
    if (!saved || typeof saved !== "object" || !Array.isArray(saved.called)) return null;
    var validCalled = saved.called.every(function (n) { return Number.isInteger(n) && n >= 1 && n <= TOTAL; }) && new Set(saved.called).size === saved.called.length;
    if (!validCalled) return null;

    var out = freshState();
    out.startedAt = Number(saved.startedAt) || out.startedAt;
    out.updatedAt = Number(saved.updatedAt) || out.startedAt;
    out.called = saved.called.slice();
    out.callTimes = Array.isArray(saved.callTimes) ? saved.callTimes.slice(0, out.called.length) : [];
    while (out.callTimes.length < out.called.length) out.callTimes.push(null);

    if (Array.isArray(saved.prizes) && saved.prizes.length) {
      var normalized = saved.prizes.map(normalizePrize).filter(Boolean);
      if (normalized.length) out.prizes = normalized;
    }

    out.winners = Array.isArray(saved.winners) ? saved.winners.filter(function (w) {
      return w && typeof w.prize === "string" && Number.isInteger(w.ticket) && w.ticket >= 1 && w.ticket <= TICKETS.length;
    }).map(function (w) {
      return {
        prize: w.prize,
        prizeLabel: w.prizeLabel || "",
        ticket: w.ticket,
        player: String(w.player || "").slice(0, 60),
        completedAtCall: Number(w.completedAtCall) || 0,
        awardedAt: Number(w.awardedAt) || 0
      };
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

  function injectPrizeUi() {
    if (!document.querySelector('link[href="assets/css/prizes.css"]')) {
      var css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "assets/css/prizes.css";
      document.head.appendChild(css);
    }

    var actions = document.querySelector(".actions");
    if (actions && !$("prizeSetupBtn")) {
      var button = document.createElement("button");
      button.className = "btn";
      button.id = "prizeSetupBtn";
      button.type = "button";
      button.textContent = "Prize setup";
      var newBtn = $("newBtn");
      actions.insertBefore(button, newBtn || null);
    }

    if (!$("prizeDlg")) {
      var wrap = document.createElement("div");
      wrap.innerHTML = '<div class="overlay" id="prizeDlg" role="dialog" aria-modal="true" aria-labelledby="prizeTitle" aria-hidden="true">' +
        '<div class="dialog prize-dialog">' +
          '<h2 id="prizeTitle">Prize setup</h2>' +
          '<p class="dialog-intro">Choose which prizes are available and exactly what makes each claim valid. These settings stay saved on this device.</p>' +
          '<div class="prize-config" id="prizeConfigList"></div>' +
          '<section class="pattern-editor" id="patternEditor" hidden aria-labelledby="patternEditorTitle">' +
            '<div class="pattern-editor-head"><div><h3 id="patternEditorTitle">Choose the winning pattern</h3><p>Select every word position that must be cut. The same relative positions are checked on every ticket.</p></div><strong id="patternCount">0 selected</strong></div>' +
            '<div class="pattern-ticket-scroll"><div class="pattern-ticket" id="patternTicket" aria-label="Selectable sample ticket"></div></div>' +
            '<p class="pattern-error" id="patternError" role="alert" hidden></p>' +
            '<div class="pattern-presets"><button class="btn" id="fourCornersBtn" type="button">Select four corners</button><button class="text-btn danger-text" id="clearPatternBtn" type="button">Clear selection</button></div>' +
            '<div class="pattern-editor-actions"><button class="btn" id="cancelPatternBtn" type="button">Cancel</button><button class="btn btn-primary" id="savePatternBtn" type="button">Use this pattern</button></div>' +
          '</section>' +
          '<div class="prize-add-actions">' +
            '<button class="btn" id="addPrizeBtn" type="button">Add custom prize</button>' +
            '<button class="btn" id="addFullHouseBtn" type="button">Add another Full House</button>' +
          '</div>' +
          '<p class="prize-help">For “Any N numbers”, any N called numbers anywhere on that ticket count. For a custom pattern, select the required positions on the sample ticket, such as its four corners.</p>' +
          '<p class="prize-error" id="prizeSetupError" role="alert" hidden></p>' +
          '<div class="dialog-actions">' +
            '<button class="btn" type="button" data-close>Cancel</button>' +
            '<button class="btn btn-primary" id="savePrizesBtn" type="button">Save prizes</button>' +
          '</div>' +
        '</div>' +
      '</div>';
      document.body.appendChild(wrap.firstElementChild);
    }
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
      return '<button type="button" data-winner-open><b>' + escapeHtml(winnerPrizeLabel(w)) + '</b><span>Ticket ' + w.ticket + " · " + (w.player ? escapeHtml(w.player) : "Name needed") + "</span></button>";
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
    $("checkBtn").disabled = busy || !DATA_OK || !state.prizes.length;
    $("newBtn").disabled = busy || state.called.length === 0;
    if ($("prizeSetupBtn")) $("prizeSetupBtn").disabled = busy;

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
    var items = Array.prototype.slice.call(overlay.querySelectorAll("button:not([disabled]):not([hidden]),input:not([disabled]),select:not([disabled]),[href],[tabindex]:not([tabindex='-1'])"))
      .filter(function (item) { return !item.closest("[hidden]"); });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function askNewGame() {
    if (busy || !state.called.length) return;
    var n = state.called.length;
    $("newMsg").textContent = n + (n === 1 ? " word has" : " words have") + " been called and " + state.winners.length + " prize award(s) are saved. Starting a new game clears calls and winners, but keeps your prize setup.";
    openDialog("newDlg", "[data-close]");
  }

  function startNewGame() {
    var prizes = clonePrizes(state.prizes);
    state = freshState(prizes);
    save();
    closeDialogs();
    buildPrizeOptions();
    render();
    $("drawBtn").focus();
    try { sessionStorage.setItem(TAB_KEY, "1"); } catch (e) {}
  }

  function buildPrizeOptions() {
    var select = $("prizeType");
    if (!select) return;
    select.innerHTML = state.prizes.map(function (p) {
      return '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.label) + "</option>";
    }).join("");
  }

  function ticketNumbers(ticketNo) {
    var out = [];
    TICKETS[ticketNo - 1].forEach(function (row) { row.forEach(function (n) { if (n) out.push(n); }); });
    return out;
  }

  function patternTargets(ticketNo, pattern) {
    var rows = TICKETS[ticketNo - 1].map(function (row) { return row.filter(Boolean); });
    return normalizePattern(pattern).map(function (key) {
      var parts = key.split(":");
      return rows[parseInt(parts[0], 10)][parseInt(parts[1], 10)];
    }).filter(Boolean);
  }

  function callPosition(n) {
    var idx = state.called.indexOf(n);
    return idx === -1 ? 0 : idx + 1;
  }

  function evaluateClaim(ticketNo, prize) {
    var grid = TICKETS[ticketNo - 1];
    var targets;

    if (prize.rule === "top") targets = grid[0].filter(Boolean);
    else if (prize.rule === "middle") targets = grid[1].filter(Boolean);
    else if (prize.rule === "bottom") targets = grid[2].filter(Boolean);
    else if (prize.rule === "pattern") targets = patternTargets(ticketNo, prize.pattern);
    else targets = ticketNumbers(ticketNo);

    if (prize.rule === "any") {
      var calledTargets = targets.map(function (n) { return { n: n, pos: callPosition(n) }; })
        .filter(function (x) { return x.pos; })
        .sort(function (a, b) { return a.pos - b.pos; });
      var required = prize.count;
      if (calledTargets.length >= required) {
        return {
          valid: true,
          completion: calledTargets[required - 1].pos,
          missing: [],
          progress: calledTargets.length + " ticket numbers are called; " + required + " are needed"
        };
      }
      return {
        valid: false,
        completion: 0,
        missing: targets.filter(function (n) { return !callPosition(n); }),
        progress: calledTargets.length + " of " + required + " needed numbers are called"
      };
    }

    var positions = targets.map(callPosition);
    var missing = targets.filter(function (n, i) { return !positions[i]; });
    var count = targets.length - missing.length;
    return {
      valid: missing.length === 0,
      completion: missing.length ? 0 : Math.max.apply(null, positions),
      missing: missing,
      progress: count + " of " + targets.length + " required numbers are called"
    };
  }

  function ticketHtml(ticketNo, prize) {
    var grid = TICKETS[ticketNo - 1];
    var done = new Set(state.called);
    var pattern = prize && prize.rule === "pattern" ? new Set(normalizePattern(prize.pattern)) : null;
    var html = '<div class="ticket" aria-label="Ticket ' + ticketNo + '">';
    grid.forEach(function (row, rowIndex) {
      var slot = 0;
      row.forEach(function (w) {
        var key = w ? rowIndex + ":" + slot++ : "";
        var required = pattern && pattern.has(key);
        html += w
          ? '<div class="tcell' + (done.has(w) ? " cut" : "") + (required ? " pattern-required" : "") + '"><span>' + escapeHtml(word(w)) + "</span></div>"
          : '<div class="tcell empty"></div>';
      });
    });
    return html + "</div>";
  }

  function awardExists(ticketNo, prizeId) {
    return state.winners.some(function (w) { return w.ticket === ticketNo && w.prize === prizeId; });
  }

  function verifyClaim() {
    var ticketNo = parseInt($("ticketNo").value, 10);
    var prizeId = $("prizeType").value;
    var prize = state.prizes.find(function (p) { return p.id === prizeId; });
    var out = $("ticketOut");

    if (!(ticketNo >= 1 && ticketNo <= TICKETS.length)) {
      out.innerHTML = '<p class="error">Enter a ticket number from 1 to ' + TICKETS.length + ".</p>";
      return;
    }
    if (!prize) {
      out.innerHTML = '<p class="error">Choose a configured prize.</p>';
      return;
    }

    var result = evaluateClaim(ticketNo, prize);
    var html = ticketHtml(ticketNo, prize);
    var already = awardExists(ticketNo, prize.id);

    if (result.valid) {
      var finalWord = state.called[result.completion - 1];
      html += '<section class="claim-result valid"><div><span class="result-kicker">Valid claim</span><h3>' + escapeHtml(prize.label) + " · Ticket " + ticketNo + '</h3><p class="rule-note">' + escapeHtml(ruleLabel(prize)) + '.</p><p>Completed on call <b>#' + result.completion + "</b> with <span class=\"hindi\">" + escapeHtml(word(finalWord)) + "</span>.</p></div>";
      if (already) {
        html += '<p class="already">This prize has already been recorded for Ticket ' + ticketNo + ".</p>";
      } else {
        html += '<div class="award-box"><label>Winner name<input id="playerName" type="text" autocomplete="off" maxlength="60" placeholder="Enter winner name" required aria-describedby="winnerNameHelp"><span id="winnerNameHelp">Required for the winner ledger</span></label><button class="btn btn-primary" id="awardBtn" type="button">Award prize</button></div>';
      }
      html += "</section>";
    } else {
      html += '<section class="claim-result invalid"><div><span class="result-kicker">Not complete yet</span><h3>' + escapeHtml(prize.label) + " · Ticket " + ticketNo + '</h3><p class="rule-note">' + escapeHtml(ruleLabel(prize)) + '.</p><p>' + escapeHtml(result.progress) + ".</p></div>";
      if (result.missing.length && prize.rule !== "any") {
        html += '<div class="missing"><b>Still uncalled</b><div>' + result.missing.slice(0, 8).map(function (n) { return '<span class="hindi">' + escapeHtml(word(n)) + "</span>"; }).join("") + (result.missing.length > 8 ? "<em>+" + (result.missing.length - 8) + " more</em>" : "") + "</div></div>";
      }
      html += "</section>";
    }

    out.innerHTML = html;
    var awardBtn = $("awardBtn");
    if (awardBtn) awardBtn.addEventListener("click", function () { awardPrize(ticketNo, prize, result.completion); });
    var playerName = $("playerName");
    if (playerName) {
      playerName.addEventListener("input", function () { playerName.classList.remove("input-invalid"); playerName.removeAttribute("aria-invalid"); });
      playerName.addEventListener("keydown", function (e) {
        if (e.key === "Enter") awardPrize(ticketNo, prize, result.completion);
      });
    }
  }

  function awardPrize(ticketNo, prize, completion) {
    if (awardExists(ticketNo, prize.id)) return;
    var player = $("playerName") ? $("playerName").value.trim() : "";
    if (!player) {
      $("playerName").classList.add("input-invalid");
      $("playerName").setAttribute("aria-invalid", "true");
      $("playerName").focus();
      $("announce").textContent = "Enter the winner name before awarding the prize.";
      return;
    }
    state.winners.push({
      prize: prize.id,
      prizeLabel: prize.label,
      ticket: ticketNo,
      player: player,
      completedAtCall: completion,
      awardedAt: Date.now()
    });
    save();
    renderWinnersMini();
    verifyClaim();
    $("announce").textContent = prize.label + " awarded to Ticket " + ticketNo + ".";
  }

  function openClaim() {
    if (busy || !DATA_OK || !state.prizes.length) return;
    buildPrizeOptions();
    $("ticketOut").innerHTML = "";
    $("ticketNo").value = "";
    $("prizeType").selectedIndex = 0;
    openDialog("checkDlg", "#ticketNo");
  }

  function newPrizeId() {
    return "prize-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  function ruleOptions(selected) {
    var choices = [
      ["any", "Any N numbers on ticket"],
      ["top", "Top line (all 5)"],
      ["middle", "Middle line (all 5)"],
      ["bottom", "Bottom line (all 5)"],
      ["full", "Full House (all 15)"],
      ["pattern", "Choose pattern on sample ticket"]
    ];
    return choices.map(function (c) {
      return '<option value="' + c[0] + '"' + (selected === c[0] ? " selected" : "") + ">" + c[1] + "</option>";
    }).join("");
  }

  function renderPrizeDraft() {
    var out = $("prizeConfigList");
    out.innerHTML = prizeDraft.map(function (p, index) {
      var count = p.rule === "any" ? p.count : 5;
      var ruleSetting;
      if (p.rule === "any") {
        ruleSetting = '<label class="prize-count-label">How many?<input type="number" min="1" max="15" inputmode="numeric" value="' + count + '" data-prize-field="count"></label>';
      } else if (p.rule === "pattern") {
        var selected = normalizePattern(p.pattern).length;
        ruleSetting = '<div class="prize-pattern-cell"><span>Selected pattern</span><button class="btn pattern-open" type="button" data-edit-pattern="' + index + '">Choose cells <small>' + selected + ' selected</small></button></div>';
      } else {
        ruleSetting = '<span class="prize-setting-spacer" aria-hidden="true"></span>';
      }
      return '<div class="prize-config-row" data-prize-index="' + index + '">' +
        '<label class="prize-name-label">Prize name<input type="text" maxlength="60" value="' + escapeHtml(p.label) + '" data-prize-field="label"></label>' +
        '<label class="prize-rule-label">Claim rule<select data-prize-field="rule">' + ruleOptions(p.rule) + "</select></label>" +
        ruleSetting +
        '<button class="text-btn danger-text prize-remove" type="button" data-remove-prize="' + index + '">Remove</button>' +
      "</div>";
    }).join("");
  }

  function hidePatternEditor() {
    $("patternEditor").hidden = true;
    patternPrizeIndex = -1;
    patternDraft = [];
  }

  function renderPatternTicket() {
    var selected = new Set(patternDraft);
    var sample = TICKETS[0];
    var html = "";
    sample.forEach(function (row, rowIndex) {
      var slot = 0;
      row.forEach(function (n) {
        if (!n) {
          html += '<div class="pattern-blank" aria-hidden="true"></div>';
          return;
        }
        var key = rowIndex + ":" + slot++;
        var on = selected.has(key);
        html += '<button class="pattern-cell' + (on ? " selected" : "") + '" type="button" data-pattern-key="' + key + '" aria-pressed="' + on + '"><small>' + n + '</small><span>' + escapeHtml(word(n)) + "</span></button>";
      });
    });
    $("patternTicket").innerHTML = html;
    $("patternCount").textContent = patternDraft.length + (patternDraft.length === 1 ? " selected" : " selected");
  }

  function openPatternEditor(index) {
    var prize = prizeDraft[index];
    if (!prize || prize.rule !== "pattern") return;
    patternPrizeIndex = index;
    patternDraft = normalizePattern(prize.pattern);
    $("patternEditorTitle").textContent = "Choose cells for " + (String(prize.label || "").trim() || "this prize");
    $("patternError").hidden = true;
    $("patternEditor").hidden = false;
    renderPatternTicket();
    $("patternEditor").scrollIntoView({ behavior: "smooth", block: "nearest" });
    var first = $("patternTicket").querySelector("button");
    if (first) first.focus();
  }

  function togglePatternCell(key) {
    if (!validPatternKey(key)) return;
    var index = patternDraft.indexOf(key);
    if (index === -1) patternDraft.push(key);
    else patternDraft.splice(index, 1);
    patternDraft = normalizePattern(patternDraft);
    $("patternError").hidden = true;
    renderPatternTicket();
    var active = $("patternTicket").querySelector('[data-pattern-key="' + key + '"]');
    if (active) active.focus();
  }

  function useFourCornersPattern() {
    patternDraft = ["0:0", "0:4", "2:0", "2:4"];
    $("patternError").hidden = true;
    renderPatternTicket();
  }

  function savePatternSelection() {
    if (patternPrizeIndex < 0 || !prizeDraft[patternPrizeIndex]) return;
    if (!patternDraft.length) {
      $("patternError").textContent = "Select at least one word position for this prize.";
      $("patternError").hidden = false;
      return;
    }
    var index = patternPrizeIndex;
    prizeDraft[index].pattern = normalizePattern(patternDraft);
    hidePatternEditor();
    renderPrizeDraft();
    var edit = $("prizeConfigList").querySelector('[data-edit-pattern="' + index + '"]');
    if (edit) edit.focus();
  }

  function openPrizeSetup() {
    if (busy) return;
    prizeDraft = clonePrizes(state.prizes);
    hidePatternEditor();
    $("prizeSetupError").hidden = true;
    renderPrizeDraft();
    openDialog("prizeDlg", "[data-prize-field='label']");
  }

  function addCustomPrize() {
    prizeDraft.push({ id: newPrizeId(), label: "New Prize", rule: "any", count: 5 });
    renderPrizeDraft();
    var rows = $("prizeConfigList").querySelectorAll(".prize-config-row");
    var last = rows[rows.length - 1];
    if (last) last.querySelector("input").focus();
  }

  function addFullHousePrize() {
    var fulls = prizeDraft.filter(function (p) { return p.rule === "full"; });
    if (fulls.length === 1 && /^Full House$/i.test(fulls[0].label)) fulls[0].label = "Full House 1";
    var next = fulls.length + 1;
    prizeDraft.push({ id: newPrizeId(), label: "Full House " + next, rule: "full" });
    renderPrizeDraft();
  }

  function handlePrizeDraftInput(e) {
    var row = e.target.closest("[data-prize-index]");
    var field = e.target.getAttribute("data-prize-field");
    if (!row || !field) return;
    var index = parseInt(row.getAttribute("data-prize-index"), 10);
    var prize = prizeDraft[index];
    if (!prize) return;
    $("prizeSetupError").hidden = true;

    if (field === "label") prize.label = e.target.value;
    if (field === "rule") {
      prize.rule = e.target.value;
      if (prize.rule === "any" && !(prize.count >= 1 && prize.count <= 15)) prize.count = 5;
      if (prize.rule === "pattern" && !Array.isArray(prize.pattern)) prize.pattern = [];
      renderPrizeDraft();
      if (prize.rule === "pattern") openPatternEditor(index);
    }
    if (field === "count") prize.count = parseInt(e.target.value, 10) || 1;
  }

  function removeDraftPrize(index) {
    if (patternPrizeIndex === index) hidePatternEditor();
    else if (patternPrizeIndex > index) patternPrizeIndex--;
    prizeDraft.splice(index, 1);
    renderPrizeDraft();
  }

  function savePrizeSetup() {
    var invalidIndex = prizeDraft.findIndex(function (p) {
      return !String(p.label || "").trim() || (p.rule === "pattern" && !normalizePattern(p.pattern).length);
    });
    if (invalidIndex !== -1) {
      var invalid = prizeDraft[invalidIndex];
      $("prizeSetupError").textContent = !String(invalid.label || "").trim()
        ? "Every prize needs a name."
        : "Choose at least one sample-ticket position for " + invalid.label + ".";
      $("prizeSetupError").hidden = false;
      if (invalid.rule === "pattern") openPatternEditor(invalidIndex);
      else {
        var row = $("prizeConfigList").querySelector('[data-prize-index="' + invalidIndex + '"] input');
        if (row) row.focus();
      }
      return;
    }
    var normalized = prizeDraft.map(function (p, i) {
      var copy = {
        id: p.id || newPrizeId(),
        label: String(p.label || "").trim(),
        rule: p.rule,
        count: p.count,
        pattern: p.pattern
      };
      return normalizePrize(copy, i);
    }).filter(Boolean);

    if (!normalized.length) {
      $("announce").textContent = "Add at least one valid prize before saving.";
      return;
    }

    var ids = new Set();
    normalized.forEach(function (p) {
      while (ids.has(p.id)) p.id = newPrizeId();
      ids.add(p.id);
    });
    state.prizes = normalized;
    save();
    buildPrizeOptions();
    render();
    closeDialogs();
    $("announce").textContent = "Prize setup saved.";
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
      return '<div class="ledger-row"><div class="ledger-summary"><b>' + escapeHtml(winnerPrizeLabel(w)) + '</b><span>Ticket ' + w.ticket + ' · Completed #' + (w.completedAtCall || "?") + '</span></div><div class="ledger-winner"><label><span>Winner name</span><input type="text" maxlength="60" autocomplete="off" value="' + escapeHtml(w.player || "") + '" placeholder="Enter winner name" data-winner-name="' + i + '" required></label><div class="ledger-actions"><button class="btn ledger-save" type="button" data-save-winner="' + i + '">Save name</button><button class="text-btn danger-text" type="button" data-remove-award="' + i + '">Remove</button></div></div></div>';
    }).join("") + "</div>";
    out.querySelectorAll("[data-save-winner]").forEach(function (btn) {
      btn.addEventListener("click", function () { updateWinnerName(parseInt(btn.getAttribute("data-save-winner"), 10)); });
    });
    out.querySelectorAll("[data-winner-name]").forEach(function (input) {
      input.addEventListener("input", function () { input.classList.remove("input-invalid"); input.removeAttribute("aria-invalid"); });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") updateWinnerName(parseInt(input.getAttribute("data-winner-name"), 10));
      });
    });
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

  function updateWinnerName(index) {
    var winner = state.winners[index];
    var input = $("winnerLedger").querySelector('[data-winner-name="' + index + '"]');
    if (!winner || !input) return;
    var name = input.value.trim();
    if (!name) {
      input.classList.add("input-invalid");
      input.setAttribute("aria-invalid", "true");
      input.focus();
      $("announce").textContent = "Enter the winner name before saving.";
      return;
    }
    winner.player = name;
    save();
    renderWinnersMini();
    renderWinnerLedger();
    $("announce").textContent = "Winner name saved for " + winnerPrizeLabel(winner) + ".";
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

  injectPrizeUi();
  buildBoard();
  buildTicks();
  load();
  buildPrizeOptions();
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
  $("prizeSetupBtn").addEventListener("click", openPrizeSetup);
  $("addPrizeBtn").addEventListener("click", addCustomPrize);
  $("addFullHouseBtn").addEventListener("click", addFullHousePrize);
  $("savePrizesBtn").addEventListener("click", savePrizeSetup);
  $("fourCornersBtn").addEventListener("click", useFourCornersPattern);
  $("clearPatternBtn").addEventListener("click", function () { patternDraft = []; renderPatternTicket(); });
  $("cancelPatternBtn").addEventListener("click", hidePatternEditor);
  $("savePatternBtn").addEventListener("click", savePatternSelection);
  $("patternTicket").addEventListener("click", function (e) {
    var cell = e.target.closest("[data-pattern-key]");
    if (cell) togglePatternCell(cell.getAttribute("data-pattern-key"));
  });
  $("prizeConfigList").addEventListener("input", handlePrizeDraftInput);
  $("prizeConfigList").addEventListener("change", handlePrizeDraftInput);
  $("prizeConfigList").addEventListener("click", function (e) {
    var edit = e.target.closest("[data-edit-pattern]");
    if (edit) {
      openPatternEditor(parseInt(edit.getAttribute("data-edit-pattern"), 10));
      return;
    }
    var btn = e.target.closest("[data-remove-prize]");
    if (!btn) return;
    removeDraftPrize(parseInt(btn.getAttribute("data-remove-prize"), 10));
  });

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
