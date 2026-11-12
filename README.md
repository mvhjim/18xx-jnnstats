# 18xx-JNNstats

*By jimiste.*

A live stats window for [18xx.games](https://18xx.games). Click a bookmark while a game is open, and a second window shows charts, standings, portfolios and which trains are left. It updates every 10 seconds while you play and works just as well for reviewing finished games.

It replays the game with **18xx.games' own rules engine**, so the numbers follow each title's real rules and match the site exactly. In testing, every finished game's replayed final scores matched the official result to the dollar.

## Install (once, about a minute)

You add a bookmark by hand. No browser extension, nothing to download.

1. Show the bookmarks bar if it is hidden: **Ctrl+Shift+B** (Windows) or **⌘+Shift+B** (Mac).
2. Right-click the bookmarks bar and choose **Add page…** (Chrome, Edge) or **Add Bookmark…** (Firefox).
3. Name: `18xx-JNNstats`
4. URL: copy and paste this whole line:

```
javascript:(function(){if(!/18xx\.games\/game\/\d+/.test(location.href)){alert('18xx-JNNstats: open a game on 18xx.games first.');return;}window.__xxStatsTarget=window.open('','xx-stats','width=1280,height=900');var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/gh/mvhjim/18xx-jnnstats@main/stats.js?t='+Date.now();s.onerror=function(){alert('18xx-JNNstats: could not load the script from GitHub.');};document.head.appendChild(s);})();
```

5. Save.

The bookmark is only a loader: it fetches the newest `stats.js` from this repository each time. When the code is improved here, everyone gets the new version on their next click.

## Use

1. Open any game on 18xx.games (its address looks like `https://18xx.games/game/` followed by a number).
2. Click **18xx-JNNstats** in the bookmarks bar. A stats window opens.
3. The first time, your browser may block the pop-up. Allow pop-ups for 18xx.games and click again.
4. Leave the window open. It updates the moment a move is made. If you reload or leave the game page, the stats window shows *Updates paused*; click the bookmark again on the game page.
5. To look at another game, old or live, type its number or link into the box at the top of the stats window and press **Open**. Any title works.
6. **Half screen:** the window opens on the right half of your screen, so the game keeps the left half. Press **Half screen** to put it back if it moves.
7. **Arrange it your way:** collapse a section with ▾, and move it by dragging the ⠿ handle or with ▲ ▼. The arrangement is saved separately for live games and for reviews of finished games. Live games start with *Trains & phases* at the top. **Reset layout** restores the defaults.

## What the window shows

While a game is in progress:

- **Now:** who is to act, the order of the round, operating rounds left in the set, priority deal, a personal tile once you pick your name under *I am…*, a train rush warning and a game-end estimate.
- **Your-turn signal:** ● in the window title, and a sound if you switch on 🔔.
- **What just happened:** the latest moves, with new ones marked.
- **Stock round helper:** shares available, dividend per share, yield, presidency warnings, and where the price goes if a company pays or withholds.

Always:

- **Stock ticker:** each company's share price, the change since the previous round, and a trend line.
- **Standings:** player value (cash + shares at market + private companies), gap to the leader, cash, certificates against the limit.
- **Player value over time:** the score race, round by round.
- **Company revenue per OR:** ● paid out, ◉ half payout, ○ withheld; minors as dashed lines.
- **Share price** history.
- **Portfolios:** pick a player and see what they held over the game, stacked by company, with private companies and cash. Short positions (1817 family) go below zero.
- **Holdings now:** who owns what percentage of each company; ★ is president, shorts in red.
- **Trains & phases:** trains left in the bank per type, the next train, purchases until each phase change, what rusts next and which companies it hits.
- **Corporations:** whether the treasury covers the cheapest train or an emergency buy is needed, train health (*safe*, *will rust*, *obsolete*, *trainless in N buys*), tokens, loans and interest.
- **Minors & private companies:** owners over time and when each closed.

## Tested titles

Tested on **46 games across 19 titles**: 1817, 1822, 1822PNW, 1830, 1846, 1849, 1856, 1861, 1862, 1864: Forty-Niner, 1866, 1867, 1870, The Old Prince 1871, 1889, 18Chesapeake, 18Ireland, 18MEX and 18USA. They include short selling, loans, mergers and acquisitions, bankruptcies, minors, private companies, train variants and optional rules.

For all **31 finished games** with a recorded result, the replayed final scores match the site's official result exactly.

Limits: 1822 and some newer titles were only tested on early-game positions. **Archived games** keep only their final result on 18xx.games, so the window shows that result and no history.

## Privacy

The script runs only in your own browser, on the 18xx.games page you have open. It reads the same public game data the site shows anyone. It never makes moves, never logs in on your behalf, and sends nothing anywhere. The only outside request is downloading `stats.js` itself from GitHub through [jsDelivr](https://www.jsdelivr.com), which 18xx.games allows.

## Contributing

Ideas and fixes are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Licence

Copyright (C) 2026 jimiste.

18xx-JNNstats is free software under the **GNU General Public License v3.0 or later** (see [LICENSE](LICENSE)). You may use, study, share and change it. If you distribute a changed version, it must also be released under the GPL with its source code, and must keep this copyright notice.

Not affiliated with 18xx.games; thanks to its authors for an open, well-structured engine.
