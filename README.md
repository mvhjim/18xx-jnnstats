# 18xx-JNNstats

*By jimiste.*

A live stats window for [18xx.games](https://18xx.games). Click a bookmark while a game is open, and a second window shows charts, standings, portfolios and which trains are left. It updates every 10 seconds while you play and works just as well for reviewing finished games.

It replays the game with **18xx.games' own rules engine**, so the numbers follow each title's real rules and match the site exactly. In testing, every finished game's replayed final scores matched the official result to the dollar.


![Slideshow: live game, history slider, overview and game log](docs/slideshow.gif)

*The slideshow cycles through the four views below (GitHub has no carousel). Players are shown as Player 1–4.*

**During a live game**: who is to act, the train rush, the bank, and what just happened.

![Live game view](docs/screenshot-live.png)

**History mode**: drag the slider to see the game as it stood after any round.

![History mode](docs/screenshot-history.png)

**Finished game**: stock market, standings and player value over time.

![Overview of a finished game](docs/screenshot-overview.png)

**Game log**: one colour per player.

![The game log](docs/screenshot-game-log.png)

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

The bookmark is only a loader: it fetches `stats.js` from this repository each time. When the code is improved here, the new version reaches everyone without reinstalling, usually within about 12 hours (the delivery network caches which version is newest). The version number is shown at the top of the stats window. To get a new version at once, see *Releasing* in [CONTRIBUTING.md](CONTRIBUTING.md).

## Use

1. Open any game on 18xx.games (its address looks like `https://18xx.games/game/` followed by a number).
2. Click **18xx-JNNstats** in the bookmarks bar. A stats window opens.
3. The first time, your browser may block the pop-up. Allow pop-ups for 18xx.games and click again.
4. Leave the window open. It updates the moment a move is made. If you reload or leave the game page, the stats window shows *Updates paused*; click the bookmark again on the game page.
5. To look at another game, old or live, open the **⋯** menu at the top of the stats window, type its number or link and press **Open**. Any title works.
6. **Half screen:** the window opens on the right half of your screen, so the game keeps the left half. Move or resize it and it remembers that next time; press **◨** to snap it back to the right half.
7. **Light or dark:** press ☀ / 🌙 at the top. By default it follows your system.
8. **Arrange it your way:** collapse a section with ▾, and move it by dragging the ⠿ handle or with ▲ ▼. The arrangement is saved separately for live games and for reviews of finished games. Live games start with *Now* and *What just happened* side by side at the top. **Reset layout** (in the **⋯** menu) restores the defaults.

## What the window shows

While a game is in progress:

- **Now:** who is to act, the order of the round, operating rounds left in the set, priority deal, a personal tile once you pick your name under *I am…*, a train rush warning and a game-end estimate that lists every way the game can end, with how many trains away a trigger train is.
- **What just happened:** the latest moves, with new ones marked. A second tab, *Since your last turn*, lists everything logged after your own last move (shown when there is something, and once you are picked under *I am…*; the page's logged-in name is picked automatically when it matches a player).
- **Stock round helper:** shares available, dividend per share, yield, presidency warnings, and where the price goes if a company pays or withholds.
- **Your turn:** a green frame around the window, ● in the title, and an optional sound.
- **Live movement:** when shares or trains change hands, a small chip glides from the old holder to the new one, and a rusted train fades out.

Always:

- **Stock market:** the title's own market grid with every company on its square, the price zones, your own companies outlined, and in a live game a dashed marker for where the acting company goes if it pays out or withholds. A slider steps the grid back through earlier rounds.
- **Stock ticker:** each company's share price, the change since the previous round, and a trend line.
- **Standings:** player value (cash + shares at market + private companies), gap to the leader, cash, certificates against the limit. **copy as text** puts the ranking and share prices on your clipboard; **copy as image** copies the ranking together with the Player value chart as a picture, for Discord or the forum.
- **Player value over time:** the score race, round by round.
- **Company revenue per OR:** ● paid out, ◉ half payout, ○ withheld; minors as dashed lines.
- **Share price** history.
- **Portfolios:** pick a player and see what they held over the game (all players use the same scale, so they are easy to compare), stacked by company, with private companies and cash. Short positions (1817 family) go below zero.
- **Holdings now:** who owns what percentage of each company; ★ is president, shorts in red.
- **Trains, phases & Bank:** starts with the bank (cash, the trains still to come in order, trains in the bank pool, shares left in the initial offering and the market), then trains left per type, the next train, purchases until each phase change, what rusts next and which companies it hits, and in the *Held by* column each company's colour.
- **Tile manifest** (collapsed by default): how many of each tile are left, by colour; colours the current phase does not allow yet are dimmed.
- **Routes & revenue:** pick an operating round to see what each company ran: train, revenue, the stops of every route, and pay out or withhold. It follows the history slider. A map sketch can draw each company's routes on the board's hex grid, to match them against the real map.
- **Replay move by move**, plus a post-game report, route mistakes, share-sale timing and dividend hindsight cards.
- **Company profit and loss, cash flow per player, ownership over time, who holds what, president changes, tile-lay map, market movement, rust radar, priority deal tracker and game-end clock** cards, plus a *Rules now* row in Game info.
- **Compare up to four games** and **Friends over time** (head-to-head, same-players history, progress chart and pace benchmark, from the public profile pages).
- **Sections and tabs:** cards are grouped into sections with a sticky scoreboard and jump bar, and related cards share one card with tabs.
- **Charts and map:** log or % change on the value and price charts, and a heat map of the hexes trains ran through most.
- **More cards:** withholding vs paying out, train timing, and a few just-for-fun badges. The 🔗 button copies a link that reopens the game with your card layout.
- **Route efficiency, whole game:** check every run against the engine's auto-router, with a summary of what was left on the table.
- **Compare:** load a second game of the same title and see both side by side, to follow your progress against the same players.
- **Route efficiency:** in Routes & revenue, press *check best* to compare a run with the best routes the site's own auto-router can find at that moment.
- **Data cards:** track spending vs revenue, where each player's money came from (pies), valuation (price vs payouts), train purchases, key moments with links, and a score range for live games.
- **Replay:** press play and watch the game unfold: tiles, tokens, routes, standings and prices round by round.
- **Charts you can read:** click a legend name to show only that line; phase changes and closures are marked on the time axis.
- **Game log:** the whole log of the game, one round at a time. Drag the slider (or press ◀ ▶) to walk through the game, search the whole log for a company or player, or jump to your own last move once you pick your name under *I am…*. Every line has the acting player's colour and name on the left, and your own lines are highlighted. Works in finished and live games. Each line has a ↗ link that opens the site's own view of the game at that move.
- **History (⏱):** press ⏱ at the top and a slider appears. Drag it, or press ◀ ▶, and the whole window shows the game as it was at the end of that round: standings, corporations, trains, bank, market and log. It is paused and read only; **back to now** returns to the current state. Each step replays the game, so it takes a second or two the first time (visited rounds are remembered).
- **Hover linking:** hover a company anywhere and it lights up in every table and chart on screen.
- **Corporations:** whether the treasury covers the cheapest train or an emergency buy is needed, train health (*safe*, *will rust*, *obsolete*, *trainless in N buys*), tokens, loans and interest.
- **Minors & private companies** (collapsed by default): owners over time and when each closed.

## Tested titles

Tested on **82 games across 20 titles**. For all **67 finished games** with a recorded result, the replayed final scores match the site's official result exactly, including The Old Prince 1871, 1877: Stockholm Tramways and 1849: Kingdom of the Two Sicilies (12 games each).

The stock market grid was additionally checked on live and finished games of these titles: every company with a share price stands on the square with that price.

| Title | Market grid |
|---|---|
| 1830, 1856, 1870, 1889 | grid (11 rows) |
| 1849: Kingdom of the Two Sicilies | grid (10 rows) |
| 1861 | grid (10 rows) |
| 18Ireland, 18MEX | grid (8 rows) |
| The Old Prince 1871 | grid (7 rows) |
| 1866 | grid (4 rows) |
| 1817 | single row |
| 1846 | single row |
| 1862, 1864: Forty-Niner, 1822PNW, 18USA, 1877: Stockholm Tramways | single row |

Titles with no moves played yet when this was written (1822, 1824, 1844, 1850, 1860, 1880, 18NY, 18VA, 18Chesapeake, 18SJ, Harzbahn 1873, Rolling Stock Stars) load their rules from the site in the same way but are untested here. Reports are welcome.

Limits: 1822 and some newer titles were only tested on early-game positions. **Archived games** keep only their final result on 18xx.games, so the window shows that result and no history.

## Security

You are asked to run code from the internet on a page where you are logged in, so here is exactly what it does and how to keep control of it.

- **It reads, it never acts.** It replays the game with the site's own engine and draws numbers. It cannot make a move, change a setting or sign you in.
- **It only talks to 18xx.games.** The only network requests in the code are to the site's own game data (`/api/game/<number>`, the same data the page shows) and the site's own rules files. Nothing is sent to anyone else, there is no analytics, and no cookies or passwords are read.
- **Your settings stay in your browser.** Only a few small preferences are stored locally (your name selection, the sound switch, light/dark choice, window position and the section layout).
- **The "I am" auto-pick** only reads the display name in the page's header and compares it with the players of the game. It never touches passwords, cookies or tokens.
- **Update note:** once every six hours the window loads a one-line script, `version.js`, from this repository (through jsDelivr) to see if a newer version exists, and shows a link if so. It sends nothing about you or your game.
- **One chart library.** From 0.24 the charts use [Apache ECharts](https://echarts.apache.org) (Apache-2.0), loaded from jsDelivr at a fixed version (5.5.1) with a Subresource Integrity hash, so the browser refuses it if a single byte differs. If it cannot load, the earlier plain charts are used.
- **Names from games are escaped** before being shown, so a hostile player name cannot inject code into the stats window.
- **The one trust point is the loader.** The bookmark downloads `stats.js` from this GitHub repository through the jsDelivr CDN. Code running on a page can in principle see everything on that page, so you are trusting this repository and that CDN, as with any bookmarklet. An extension bundled in your browser does not update itself from the web; this does, unless you pin it.
- **How to stay in control:** read [stats.js](stats.js) (it is one readable file, GPL-licensed), read the [changelog](CHANGELOG.md) before updating, and **pin the bookmark to a commit** you have reviewed by replacing `@main` in the bookmark's address with `@` and the short commit hash from GitHub. A pinned address never changes, so nothing can be swapped in later. Switch back to `@main` when you want updates.

## Support

If 18xx-JNNstats is useful to you, you can buy me a coffee on [Ko-fi](https://ko-fi.com/jimiste). It is entirely optional; the tool stays free.

## Contributing

Ideas and fixes are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Licence

Copyright (C) 2026 jimiste.

18xx-JNNstats is free software under the **GNU General Public License v3.0 or later** (see [LICENSE](LICENSE)). You may use, study, share and change it. If you distribute a changed version, it must also be released under the GPL with its source code, and must keep this copyright notice.

Not affiliated with 18xx.games; thanks to its authors for an open, well-structured engine.

## Views

Every card and tab in the window, one picture each. They were taken from two finished games (1846 and 1862) with version 0.25.1 in dark mode; players are shown as Player 1–4. The live-game cards come from the 1846 game in History mode (after OR 5.1), with *I am* set to Player 1. Click a section to open it.

<details>
<summary><b>Top bar, menu and History</b></summary>

**Top bar.** Title, round, phase, bank, and a sticky scoreboard with every player's value and change since the last round. The section bar jumps to each section. ⟳ refreshes, ⏱ opens History, ⋯ opens the menu.

![Top bar and first cards, 1846](docs/views/1846-overview.jpg)

**History (⏱).** A slider and ◀ ▶ step the whole window back to the end of any round. It is read only; *back to now* returns to the present.

![History slider](docs/views/1846-history-header.jpg)

**Menu (⋯).** *I am*, sound, Half / Third size, dark/light, reset layout, text size, the 🔗 layout link, *Auto size*, *Layout code…*, open another game by number, *Compare games…*, and the version line.

![The ⋯ menu](docs/views/1846-menu.jpg)

**Compare: Another game.** Type up to three other games of the same title to see them side by side.

![Compare, another game](docs/views/1846-compare-game.jpg)

**Compare: Friends.** *Load history* reads the players' public profile pages for head-to-head records, progress game after game and a pace benchmark.

![Compare, friends](docs/views/1846-compare-friends.jpg)

</details>

<details>
<summary><b>Now (live games)</b></summary>

**Now.** Who is to act and for which company, the round and how many ORs are left in the set, priority deal, the order of the round, your own tile (value, rank, gap, cash, certificate room) and a game-end estimate.

![Now](docs/views/1846-live-now.jpg)

**What just happened: Latest moves.** The latest log lines, newest first; ● marks lines you have not seen yet.

![What just happened, latest moves](docs/views/1846-live-latest-moves.jpg)

**What just happened: Since your last turn.** Everything logged after your own last move.

![What just happened, since your last turn](docs/views/1846-live-since-last-turn.jpg)

**Standings: Score range.** Player value now, and three rough scenarios for the end of the game (cautious, current pace, best case).

![Score range](docs/views/1846-live-score-range.jpg)

**Stock round helper.** Shares left in the IPO and the market, last dividend and yield, where the price goes if the company pays or withholds, and who is president and who is next in line. Your own presidencies are highlighted.

![Stock round helper](docs/views/1846-live-stock-round-helper.jpg)

**Game-end clock.** How close the game is to ending, by every route the rules allow.

![Game-end clock](docs/views/1846-live-game-end-clock.jpg)

**Stock market in a live game.** Your own companies are outlined, and dashed markers show where the acting company lands if it pays out (▲) or withholds (■).

![Stock market during a live game](docs/views/1846-live-market.jpg)

</details>

<details>
<summary><b>Result</b></summary>

**Standings.** Final ranking by player value, gap to the leader, cash and certificates. *copy as text* and *copy as image* share it in chat. In a live game this card is called Standings.

![Standings](docs/views/1846-result-standings.jpg)

**Badges.** Just-for-fun awards such as biggest comeback, most time in the lead, dividend king and best single run, each with a runner-up.

![Badges](docs/views/1846-result-badges.jpg)

**Report.** A short summary of the game to paste into chat.

![Report](docs/views/1846-result-report.jpg)

**Player value over time.** The score race round by round, with phases shaded, lead changes marked and a log scale or % change view.

![Player value over time](docs/views/1846-player-value.jpg)

**Key moments.** Lead changes, big swings, price crashes, closures, each company's first token and the best run, each with a link to replay that moment.

![Key moments](docs/views/1846-key-moments.jpg)

</details>

<details>
<summary><b>Players & history</b></summary>

**Board and replay: Replay.** Play the game back round by round or move by move: tiles, tokens and routes on the board, with standings and share prices beside it.

![Replay](docs/views/1846-board-replay.jpg)

**Board and replay: Tile-lay map.** Every hex a company has built on, coloured by the company that laid the latest tile there.

![Tile-lay map](docs/views/1846-board-tilelay.jpg)

**Game log.** The whole log one round at a time, with a slider, search, filters (stock, revenue, track, trains, auctions) and a company picker. Each line carries the acting player's colour.

![Game log](docs/views/1846-game-log.jpg)

**Priority deal tracker.** Who had priority deal at the start of each stock round and what they did with it.

![Priority deal tracker](docs/views/1846-priority-deal.jpg)

</details>

<details>
<summary><b>Analysis: Decisions review</b></summary>

**Payout or withhold.** Each company's withholds, revenue kept, and the average price move when withholding versus paying.

![Payout or withhold](docs/views/1846-decisions-payout.jpg)

**Withholds in detail.** Each withheld run and what a payout would have given each shareholder.

![Withholds in detail](docs/views/1846-decisions-withholds.jpg)

**Hindsight.** An estimate of what each withhold cost or earned the president.

![Hindsight](docs/views/1846-decisions-hindsight.jpg)

**Share sales.** Every sale, the price per share, and the price six rounds later, with a net result per player.

![Share sales](docs/views/1846-decisions-sharesales.jpg)

**Route mistakes.** Runs that earned less than the best route the site's auto-router finds. It fills in after *check the whole game* in Routes & revenue.

![Route mistakes](docs/views/1846-decisions-routes.jpg)

</details>

<details>
<summary><b>Money</b></summary>

**Company profit and loss.** What each company spent on trains, tiles and tokens over the game, with ◆ for its revenue. *Table* shows the numbers.

![Company profit and loss](docs/views/1846-pnl-chart.jpg)

**Track spending.** Tile and token costs against revenue run, and revenue per 1 spent.

![Track spending](docs/views/1846-pnl-track.jpg)

**Cash flow per player.** A heat grid of money in (blue) and out (orange) per player and round. Hover a cell for the breakdown.

![Cash flow per player](docs/views/1846-cash-flow.jpg)

**Where the money came from.** Each player's cash income split into dividends, private companies and share sales.

![Where the money came from](docs/views/1846-money-from.jpg)

**Portfolios.** Pick a player to see what they held over the game, stacked by company with cash and privates. All players use the same scale. Below it, **Holdings now** shows who owns what percentage of each company (★ = president).

<table>
<tr><td><img src="docs/views/1846-portfolios-p1.jpg" alt="Portfolios, Player 1"><br>Player 1</td><td><img src="docs/views/1846-portfolios-p2.jpg" alt="Portfolios, Player 2"><br>Player 2</td></tr>
<tr><td><img src="docs/views/1846-portfolios-p3.jpg" alt="Portfolios, Player 3"><br>Player 3</td><td><img src="docs/views/1846-portfolios-p4.jpg" alt="Portfolios, Player 4"><br>Player 4</td></tr>
</table>

**Valuation.** Share price against recent payouts: yield per OR, payback time, market value against book value.

![Valuation](docs/views/1846-valuation.jpg)

</details>

<details>
<summary><b>Companies</b></summary>

**Stock ticker.** Each company's price, change since the previous round and a trend line.

![Stock ticker](docs/views/1846-stock-ticker.jpg)

**Stock market: Price grid.** The title's own market with every company on its square and the price zones; the slider steps back through earlier rounds. Both 1846 and 1862 have single-row markets, wrapped here to fit the window.

![Stock market, 1846](docs/views/1846-market-grid.jpg)

![Stock market, 1862](docs/views/1862-market-grid.jpg)

**Stock market: Last round.** How each share price moved in the last round.

![Last round](docs/views/1846-market-lastround.jpg)

**Corporations.** President, price, treasury against the cheapest train, trains held, train health, tokens left and recent revenue.

![Corporations](docs/views/1846-corporations.jpg)

**Share price.** Price history for every company, with phases shaded and log scale or % change.

![Share price](docs/views/1846-share-price.jpg)

**Company revenue per operating round.** ● paid out, ◉ half, ○ withheld; minors as dashed lines.

![Company revenue per operating round](docs/views/1846-revenue.jpg)

**Ownership over time.** Pick a company to see who held how much of it, round by round.

![Ownership over time](docs/views/1846-ownership.jpg)

**Who holds what.** Lines join each player to the companies they hold; the thicker the line, the bigger the stake. Hover to highlight.

![Who holds what](docs/views/1846-who-holds-what.jpg)

**Minors & private companies.** Each minor and private, its value and income, owners over time and when it closed.

![Minors and private companies](docs/views/1846-minors-privates.jpg)

</details>

<details>
<summary><b>Trains & board</b></summary>

**Trains, phases & Bank.** Bank cash, trains still to come, shares in the IPO and the pool, the phases, and per train type the number left, running and rusted, and when it rusts. 1862 shown second, with its train variants.

![Trains, phases and Bank, 1846](docs/views/1846-trains-bank.jpg)

![Trains, phases and Bank, 1862](docs/views/1862-trains-bank.jpg)

**Routes & revenue.** Pick an operating round to see each company's trains, revenue and stops, and whether it paid out. *check best* and *check every company in this round* compare each run with the site's auto-router. In 1862 the train class (Express, Freight, Local) is shown by colour.

![Routes and revenue, 1846](docs/views/1846-routes.jpg)

![Routes and revenue, 1862](docs/views/1862-routes.jpg)

**Map sketch.** Draws the routes of one company or all of them on the board's hex grid; *Heat* shows the hexes run through most.

![Map sketch](docs/views/1846-routes-map.jpg)

**Train history: Timing.** Trains bought per player and company, money spent and when.

![Train timing](docs/views/1846-train-timing.jpg)

**Train history: Purchases.** Every train purchase with buyer, price, seller and the difference from list price.

![Train purchases, 1846](docs/views/1846-train-purchases.jpg)

![Train purchases, 1862](docs/views/1862-train-purchases.jpg)

**Tile manifest.** Tiles left per colour; colours the phase does not allow yet are dimmed.

![Tile manifest](docs/views/1846-tile-manifest.jpg)

**Game info.** Title, players, optional rules, the rules of the current phase and every way the game can end.

![Game info](docs/views/1846-game-info.jpg)

</details>

**1862 at a glance.** The top of the window for the finished 1862 game.

![Top of the window, 1862](docs/views/1862-overview.jpg)
