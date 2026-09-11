# Jain Word Housie: caller board

A small static website for the person calling a game of Jain Word Housie. It draws the 90 words at random, strikes each one off the board, and lets you check a player's ticket when they claim a win.

## What it does

- **Draw next word** picks a random word that hasn't been called yet. The spacebar works too.
- **Board** shows all 90 words in numbered order. Called words are struck off and the latest one is highlighted.
- **Undo last draw** puts back a word drawn by mistake.
- **New game** clears the board after asking for confirmation.
- **Check a ticket** shows any of the 40 printed tickets with the called words marked and a count for each line.

The game state is saved in the browser, so refreshing the page mid-game is safe. It is saved per device, so call the whole game from one device.

## Files

```
index.html
assets/
  css/style.css
  js/app.js       game logic
  js/data.js      the 90 words and the 40 ticket layouts
  fonts/          Instrument Sans, Tiro Devanagari Hindi, Mukta (SIL Open Font License)
  favicon.svg
netlify.toml
```

`assets/js/data.js` matches the printed PDF tickets. If you change a word there, reprint the tickets as well.

## Run it locally

Open `index.html` in a browser. No build step or install is needed.

## Deploy on Netlify from GitHub

1. Push this folder to a new GitHub repository.
2. In Netlify, choose **Add new project**, then **Import an existing project**, and pick the repository.
3. Leave the build command empty. The publish directory is already set to the repository root in `netlify.toml`.
4. Deploy. Every push to the main branch redeploys the site.
