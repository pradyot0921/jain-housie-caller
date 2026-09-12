const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const data = fs.readFileSync("assets/js/data.js", "utf8");
const app = fs.readFileSync("assets/js/app.js", "utf8");
const bootMarker = "  injectPrizeUi();";
const bootStart = app.indexOf(bootMarker);
assert.notEqual(bootStart, -1, "Could not isolate app rule functions.");

const instrumented = app.slice(0, bootStart) +
  "  globalThis.__prizeTest = {\n" +
  "    normalizePattern: normalizePattern,\n" +
  "    normalizePrize: normalizePrize,\n" +
  "    patternTargets: patternTargets,\n" +
  "    evaluateClaim: evaluateClaim,\n" +
  "    prizeIsClosed: prizeIsClosed,\n" +
  "    ticketHtml: ticketHtml,\n" +
  "    tickets: TICKETS,\n" +
  "    setCalled: function (called) { state.called = called.slice(); },\n" +
  "    setWinners: function (winners) { state.winners = winners.slice(); }\n" +
  "  };\n" +
  "})();\n";

const context = { console };
vm.createContext(context);
vm.runInContext(data + "\n" + instrumented, context);
const rules = context.__prizeTest;
const corners = ["0:0", "0:4", "2:0", "2:4"];

assert.equal(JSON.stringify(rules.normalizePattern(["2:4", "bad", "0:0", "2:4"])), JSON.stringify(["0:0", "2:4"]));
assert.equal(rules.normalizePrize({ id: "corners", label: "4 Corners", rule: "pattern", pattern: [] }, 0), null);
assert.equal(JSON.stringify(rules.normalizePrize({ id: "corners", label: "4 Corners", rule: "pattern", pattern: corners }, 0).pattern), JSON.stringify(corners));
assert.equal(rules.normalizePrize({ id: "early5", label: "Early Five", rule: "any", count: 5 }, 0).maxWinners, 1);
assert.equal(rules.normalizePrize({ id: "early5", label: "Early Five", rule: "any", count: 5, maxWinners: 3 }, 0).maxWinners, 3);

rules.setWinners([]);
assert.equal(rules.prizeIsClosed({ id: "early5", maxWinners: 1 }), false);
rules.setWinners([{ prize: "early5" }]);
assert.equal(rules.prizeIsClosed({ id: "early5", maxWinners: 1 }), true);
assert.equal(rules.prizeIsClosed({ id: "early5", maxWinners: 2 }), false);
rules.setWinners([{ prize: "early5" }, { prize: "early5" }]);
assert.equal(rules.prizeIsClosed({ id: "early5", maxWinners: 2 }), true);

const physicalCornerColumns = new Set();

rules.tickets.forEach((ticket, index) => {
  const expected = [
    ticket[0].filter(Boolean)[0],
    ticket[0].filter(Boolean)[4],
    ticket[2].filter(Boolean)[0],
    ticket[2].filter(Boolean)[4]
  ];
  [ticket[0], ticket[2]].forEach(row => {
    const filledColumns = row.map((number, column) => number ? column : null).filter(column => column !== null);
    physicalCornerColumns.add(filledColumns[0]);
    physicalCornerColumns.add(filledColumns[4]);
  });
  const targets = rules.patternTargets(index + 1, corners);
  assert.equal(JSON.stringify(targets), JSON.stringify(expected), `Ticket ${index + 1} corner mapping is wrong.`);

  rules.setCalled(targets.slice(0, 3));
  const incomplete = rules.evaluateClaim(index + 1, { rule: "pattern", pattern: corners });
  assert.equal(incomplete.valid, false);
  assert.equal(incomplete.missing.length, 1);

  rules.setCalled([targets[2], targets[0], targets[3], targets[1]]);
  const complete = rules.evaluateClaim(index + 1, { rule: "pattern", pattern: corners });
  assert.equal(complete.valid, true);
  assert.equal(complete.completion, 4);
  assert.equal((rules.ticketHtml(index + 1, { rule: "pattern", pattern: corners }).match(/pattern-required/g) || []).length, 4);
});

assert.equal(physicalCornerColumns.has(0), true, "Four Corners must support a filled cell in printed column 1.");
assert.equal(physicalCornerColumns.has(8), true, "Four Corners must support a filled cell in printed column 9.");

console.log("Validated custom pattern rules across all 40 tickets.");
