# Contributing

Thanks for helping. Suggestions are welcome as GitHub issues; code changes as pull requests.

By contributing you agree that your contribution is licensed under the project's licence, the GNU General Public License v3.0 or later. Please keep the copyright header at the top of `stats.js`.

## How it works

`stats.js` is one plain JavaScript file with no build step and no dependencies.

1. The bookmark opens an empty window and loads `stats.js` from this repository (via jsDelivr).
2. `stats.js` fetches the game from `https://18xx.games/api/game/<id>`, loads that title's rules from `/assets/<title>.js` (the same way the site does), and replays the game with the site's own engine (`Opal.Engine.Game.load`).
3. During the replay it hooks the engine's end-of-round bookkeeping (`store_player_info`) to take a snapshot of share prices, holdings, cash, minors and private companies each round.
4. `extract()` turns the engine state and snapshots into plain data; `render()` draws the dashboard as HTML and SVG in the stats window.

## Title-specific settings

Titles differ a lot. The `CONFIG` object near the top of `stats.js` holds per-title settings, keyed by the title name as 18xx.games spells it (for example `'1862'`, `'1817'`). Add notes or extra metrics for a title there. Prefer reading values from the engine over hard-coding rules, so the dashboard stays correct when the site's rules change.

## Testing a change

1. Open any game on 18xx.games.
2. Open the browser console (F12), paste the contents of your edited `stats.js`, and press Enter. The stats window opens with your version.
3. Check a few finished games of the titles you touched. For a finished game, the **Standings** values must equal the final result shown on 18xx.games.

Good test games are recent finished games of the titles you touched; the 18xx.games front page lists some under *Finished Games*.

## Releasing

1. Update `VERSION` at the top of `stats.js`.
2. Add an entry to `CHANGELOG.md`.
3. Push to `main`.
4. jsDelivr caches files for up to 12 hours. To publish at once, **wait about 5 minutes after pushing** (jsDelivr needs that long to see the new commit), then open
   `https://purge.jsdelivr.net/gh/mvhjim/18xx-jnnstats@main/stats.js` in a browser.
5. Check it: open `https://cdn.jsdelivr.net/gh/mvhjim/18xx-jnnstats@main/stats.js` and look for the new `VERSION`. If it still shows the old one, purge again.
   jsDelivr limits how often one file can be purged. If the purge page says `"throttled": true`, wait the number of seconds in `throttlingReset` and try again, or simply wait: the update arrives on its own within 12 hours.
