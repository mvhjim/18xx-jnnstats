# Contributing

Thanks for helping. Suggestions are welcome as GitHub issues; code changes as pull requests.

By contributing you agree that your contribution is licensed under the project's licence, the GNU General Public License v3.0 or later. Please keep the copyright header at the top of `stats.js`.

## How it works

`stats.js` is one plain JavaScript file with no build step and no dependencies.

1. The bookmark opens an empty window and loads `stats.js` from this repository (via jsDelivr).
2. `stats.js` fetches the game from `https://18xx.games/api/game/<id>`, loads that title's rules from `/assets/<title>.js` (the same way the site does), and replays the game with the site's own engine (`Opal.Engine.Game.load`).
3. During the replay it hooks the engine's end-of-round bookkeeping (`store_player_info`) to take a snapshot of share prices, holdings, cash, minors and private companies each round.
   After that it listens on the site's MessageBus channel for the game and applies each new move to the game in memory (`applyActions`). At the end of every round, and after any undo, it replays the whole game again and compares (`verify`).
4. `extract()` turns the engine state and snapshots into plain data; `render()` draws the dashboard as HTML and SVG in the stats window.

## Title-specific settings

Titles differ a lot. The `CONFIG` object near the top of `stats.js` holds per-title settings, keyed by the title name as 18xx.games spells it (for example `'1862'`, `'1817'`). Add notes or extra metrics for a title there. Prefer reading values from the engine over hard-coding rules, so the dashboard stays correct when the site's rules change.

## Testing a change

1. Open any game on 18xx.games.
2. Open the browser console (F12), paste the contents of your edited `stats.js`, and press Enter. The stats window opens with your version.
3. Check a few finished games of the titles you touched. For a finished game, the **Standings** values must equal the final result shown on 18xx.games.

Good test games are recent finished games of the titles you touched; the 18xx.games front page lists some under *Finished Games*.

The [tests/](tests/) folder has two console scripts that automate this: `regression.js` checks the scores, market grid and rendering for a list of finished games, and `live-simulation.js` replays a game as if it were live. Please keep game numbers and player names out of the repository.

## Releasing

1. Update `VERSION` at the top of `stats.js`, and the same number in `version.js` (the stats window reads it to tell people when a newer version exists).
2. Add an entry to `CHANGELOG.md`.
3. Push to `main`.
4. Expect the update to reach bookmarks within about 12 hours. jsDelivr remembers which commit `main` points to for up to 12 hours, and its servers do not all refresh at the same moment, so for a while different people can get different versions (even an older one than before).
   Purging (`https://purge.jsdelivr.net/gh/mvhjim/18xx-jnnstats@main/stats.js`) sometimes speeds this up but is not reliable, and is rate-limited.
5. To use or test a new version straight away, pin the bookmark to the commit: replace `@main` in the bookmark's URL with `@` followed by the short commit hash from GitHub (for example `@a4b8b56`). A pinned address never changes, so switch back to `@main` afterwards to keep getting updates.
