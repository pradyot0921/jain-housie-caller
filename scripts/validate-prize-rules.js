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
  "    ticketHtml: ticketHtml,\n" +
  "    tickets: TICKETS,\n" +
  "    setCalled: function (called) { state.called = called.slice(); }\n" +
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

rules.tickets.forEach((ticket, index) => {
  const expected = [
    ticket[0].filter(Boolean)[0],
    ticket[0].filter(Boolean)[4],
    ticket[2].filter(Boolean)[0],
    ticket[2].filter(Boolean)[4]
  ];
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

console.log("Validated custom pattern rules across all 40 tickets.");
