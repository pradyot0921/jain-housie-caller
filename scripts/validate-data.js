#!/usr/bin/env node
"use strict";

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const dataPath = path.join(__dirname, "..", "assets", "js", "data.js");
const source = fs.readFileSync(dataPath, "utf8") + "\nthis.__WORDS = WORDS; this.__TICKETS = TICKETS;";
const context = {};
vm.runInNewContext(source, context, { filename: dataPath });

const WORDS = context.__WORDS;
const TICKETS = context.__TICKETS;
const errors = [];

if (!Array.isArray(WORDS) || WORDS.length !== 90) errors.push("WORDS must contain exactly 90 entries.");
if (!Array.isArray(TICKETS) || TICKETS.length !== 40) errors.push("TICKETS must contain exactly 40 tickets.");

const frequency = new Array(91).fill(0);

if (Array.isArray(TICKETS)) {
  TICKETS.forEach((ticket, ti) => {
    if (!Array.isArray(ticket) || ticket.length !== 3) {
      errors.push(`Ticket ${ti + 1} must have 3 rows.`);
      return;
    }

    const seen = new Set();
    ticket.forEach((row, ri) => {
      if (!Array.isArray(row) || row.length !== 9) {
        errors.push(`Ticket ${ti + 1}, row ${ri + 1} must have 9 cells.`);
        return;
      }
      if (row.filter(Boolean).length !== 5) errors.push(`Ticket ${ti + 1}, row ${ri + 1} must contain 5 words.`);

      row.forEach((n, col) => {
        if (!n) return;
        if (!Number.isInteger(n) || n < 1 || n > 90) errors.push(`Ticket ${ti + 1} contains invalid word ${n}.`);
        const min = col === 0 ? 1 : col * 10;
        const max = col === 8 ? 90 : col * 10 + 9;
        if (n < min || n > max) errors.push(`Ticket ${ti + 1}: word ${n} is in column ${col + 1}.`);
        if (seen.has(n)) errors.push(`Ticket ${ti + 1} repeats word ${n}.`);
        seen.add(n);
        if (n >= 1 && n <= 90) frequency[n] += 1;
      });
    });

    if (seen.size !== 15) errors.push(`Ticket ${ti + 1} must contain 15 unique words.`);

    for (let col = 0; col < 9; col += 1) {
      const values = ticket.map(row => row[col]).filter(Boolean);
      for (let i = 1; i < values.length; i += 1) {
        if (values[i] <= values[i - 1]) errors.push(`Ticket ${ti + 1}, column ${col + 1} is not ascending.`);
      }
    }
  });
}

if (errors.length) {
  console.error(`Data validation failed with ${errors.length} error(s):`);
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}

const placements = frequency.slice(1).reduce((a, b) => a + b, 0);
const minFrequency = Math.min(...frequency.slice(1));
const maxFrequency = Math.max(...frequency.slice(1));
console.log(`Validated ${WORDS.length} words and ${TICKETS.length} tickets.`);
console.log(`${placements} ticket placements; each word appears ${minFrequency}-${maxFrequency} times.`);
