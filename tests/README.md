# Tests

These are plain scripts you paste into the browser console on an 18xx.games game page; there is nothing to install.

Both scripts need the stats window code loaded first: click the bookmark once (or paste `stats.js` into the console) so that `window.__xxStats.api` exists.

## `regression.js` - are the numbers right?

Checks finished games against the site's official results.

1. Open any game on 18xx.games and load the stats window.
2. Set the games to test, then paste the contents of `regression.js`:
   ```js
   window.__XX_TEST_IDS = [123456, 234567];  // numbers of finished games
   ```
3. Wait for `window.__xxTestDone` to become `true`, then read `window.__xxTestRows` (or the table in the console).

For each game it checks that:
- the replayed final scores equal the official result (`exact`),
- every company with a share price stands on the market square with that price,
- every section of the dashboard renders without an error.
- at six points in the game, bank cash, phase and the game-end trigger match the engine itself (`engine` column),
- the Routes & revenue table holds as many trains as the log has "runs a ... train" lines.

## `live-simulation.js` - does live play work?

Replays a finished game as if it were being played right now, in steps, and checks that new moves are applied one by one and that the end-of-round "✓ verified" check passes.

```js
window.__XX_SIM = { id: 123456, from: 300, to: 360 };  // pick a stretch without undo moves
```

Then paste the contents of `live-simulation.js`. Read `window.__xxSimResult` after about 40 seconds. Stretches that contain an undo move are skipped by design: the window then replays the whole game instead.

Please do not commit game numbers or player names to the repository; keep your list of test games to yourself and report only counts.
