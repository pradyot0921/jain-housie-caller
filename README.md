# Jain Word Housie: host console

A dependency-free website for hosting Jain Word Housie. It draws the 90 words at random, tracks the complete call order, verifies prize claims against the 40 printed tickets, records winners and works offline once installed or cached.

## Host features

- **Draw next word** chooses a random word that has not been called. Spacebar works too.
- **Board** shows all 90 words, highlights the latest call and strikes off previous calls.
- **Undo last draw** removes the latest call. Awards that depended on that call are also removed.
- **Claim verifier** checks Early Five, Top Line, Middle Line, Bottom Line, Full House and host-defined patterns from the exact call order.
- **Custom pattern prizes** let the host select required positions on a sample ticket, including a one-click Four Corners preset. Those relative positions are then checked correctly on every ticket.
- **Winner ledger** requires a winner name when a prize is awarded and lets the host edit that name later. It records the prize, ticket and completion call. The same ticket/prize cannot be awarded twice, while ties across different tickets are allowed.
- **Call history** lists every called word in order, with timestamps for new V2 calls.
- **Print tickets** generates all 40 paper tickets directly from `assets/js/data.js`, so printed tickets and the checker share one source of truth.
- **Host tools** include fullscreen mode, Screen Wake Lock where supported, install-to-device support and offline caching.
- **Mobile caller bar** keeps the current word and Draw control available while scrolling the board.
- **Saved games** survive refreshes and browser restarts. The previous V1 caller state is migrated automatically.

## Data integrity

`assets/js/data.js` contains the 90 words and 40 ticket layouts. The app validates that data at runtime before drawing. GitHub Actions also runs `scripts/validate-data.js` on every push and pull request.

The validator checks exactly 90 words and 40 tickets, 3 rows × 9 columns per ticket, exactly 5 words per row and 15 unique words per ticket, correct Housie decade-column placement, and ascending values within each column.

Run it locally with:

```bash
node scripts/validate-data.js
node scripts/validate-prize-rules.js
```

## Files

```text
index.html
app.webmanifest
sw.js
assets/
  css/style.css
  js/app.js
  js/data.js
  fonts/
  favicon.svg
scripts/
  validate-data.js
  validate-prize-rules.js
.github/workflows/
  validate.yml
netlify.toml
```

## Run locally

Service workers require HTTP rather than a plain `file://` URL. For example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy on Netlify

No build step is required. `netlify.toml` publishes the repository root. Each push to the deployed branch triggers a new Netlify deployment.
