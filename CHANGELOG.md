# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com), and versions follow [Semantic Versioning](https://semver.org).

## [0.21.0] - 2026-11-12

### Added
- **Company profit and loss:** per company, revenue, paid out, kept, and spending on trains, tiles and tokens.
- **Cash flow per player:** money in and out for each player in each round.
- **Ownership over time:** who held how much of a company, round by round (pick the company).
- **Who holds what:** a graph joining players to the companies they own, line thickness by stake.
- **President changes:** every change of president, and when.
- **Tile-lay map:** every built hex coloured by the company that laid the latest tile, with counts and upgrades on hover.
- **Market movement:** how share prices moved in the latest round.
- **Rust and obsolescence radar:** which running trains rust or go obsolete, when, and which companies (and how much of their last run) are hit.
- **Priority deal tracker:** who had priority deal in each stock round and what they did first.
- **Game-end clock:** how close the game is to ending, by every route.
- **Game info:** a *Rules now* row with the current phase's train limit, allowed tiles and operating rounds.

## [0.20.0] - 2026-11-12

### Added
- **Replay, move by move:** *◂ move* and *move ▸* step through each round one move at a time (tiles laid, tokens placed, train buys, share trades, route runs), with the board built up as it happened and the move shown above the map.
- **Key moments → Replay:** *▶ replay* on a moment jumps the Replay to that round.
- **Route checks are kept:** results of *check best* and *check the whole game* are saved in your browser per game, so they survive a reload.
- **Better route on the map:** when a run missed money, *show on map* draws the auto-router's best routes as dashed amber lines.
- **Route mistakes:** per player, how many checked runs were below the best, the money missed and the worst miss.
- **Dividend decisions in hindsight:** an estimate for each withhold of what the president gave up against how the price moved compared with the usual move after a payout.
- **Share-sale timing:** each sale against the price six rounds later, with a net per player.
- **Post-game report:** a short summary (result, lead changes, biggest swing, badges) with a *copy as text* button for chat.

## [0.19.0] - 2026-11-12

### Added
- **Key moments** now also list big share-price crashes, companies that close or merge, and each company's first token (the list shows 14 first, with *show all*).
- **Withholds in detail:** for each withhold, what a payout would have given every shareholder, using who held shares that round.
- **Valuation:** market value, book (treasury plus trains at list price) and value ÷ book.
- **Score range:** three scenarios (cautious, current pace, best case) with the ranking in each.
- **Charts:** *normal / log scale / % change* switch for Player value and Share price.
- **Map sketch:** a *Heat* button shows which hexes were run through most over the whole game.
- **Layout switch (▯):** turn the single-column layout for narrow windows on or off.

### Changed
- **Badges:** a badge only appears when there is a clear winner (no ties), and the runner-up is shown.
- **Train timing:** trains are counted for whoever presided over the company when each was bought.

## [0.18.0] - 2026-11-12

### Added
- **Route efficiency for the whole game:** *check the whole game* in Routes & revenue runs the auto-router check over every run in turn, with a progress count and a stop button, and sums up how much was left on the table (about 15 seconds per run, so it can take a while; you can leave it running).
- **Withholding vs paying out:** per company, how often it withheld, the revenue it kept, its longest withhold streak, and how its share price moved in those rounds against the rounds it paid.
- **Train timing:** per player and per company, who bought which trains and when (as a share of the way through the game), what they spent, and what is held now.
- **Badges:** comeback, most time in the lead, dividend king, biggest seller, longest withhold streak, best single run, train baron.
- **Share view (🔗):** copies a link that opens the game with your card order and collapsed cards. It carries no names or other data.
- Pie charts: fixed size, and hovering a slice shows what it is.

## [0.17.0] - 2026-11-12

### Added
- **Compare with another game:** type a second game number (same title, same engine version) to see both games together: final or current values per player (with the same friends lined up), a value chart with both games lined up by how far through each one is, and a table of how the games ran: operating rounds, revenue, dividends, train spending, phase timing and when each train type was first bought. The second game is loaded read only and is not stored.

## [0.16.0] - 2026-11-12

### Added
- **Route efficiency** in *Routes & revenue*: press *check best* on a company's run (or *check every company in this round*). The tool replays the game to just before that run, lets the site's own auto-router find the best routes it can, and shows whether the run matched it or how much was left on the table. It takes about 15 seconds per company, runs only when you ask, and never touches the real game. The auto-router may not find the true maximum, so read "best found" as a good yardstick, not a verdict.

## [0.15.0] - 2026-11-12

### Added
Six new cards, all read from the engine's own log and the value history (no extra requests):
- **Track spending vs revenue:** per company, tiles laid, tokens placed, what they cost, and the revenue the company has run against it.
- **Where the money came from:** a pie per player: dividends, private companies' income and share sales.
- **Valuation:** share price against the last three payouts per share, with yield per OR and payback in ORs.
- **Train purchases:** who bought which train, from the depot or another company, and the price against the first depot price.
- **Key moments:** lead changes, the biggest value swings and the best single run, each with a ↗ link to the game at that moment.
- **Score range** (live games): value now, and a rough low to high range after the expected number of remaining ORs, with the likely ranking.

## [0.14.0] - 2026-11-12

### Added
- **Replay** card: play or scrub through the whole game. The board shows the tiles (with tile numbers) and company tokens as they stood after each round, every company's routes in operating rounds, the standings, share prices, and a value chart with a moving marker. Speed: slow, normal, fast.
- **Map sketch:** tile numbers, company tokens in cities, and an *All* button that draws every company's routes at once (in company colours). *Copy as image* works for both.

## [0.13.0] - 2026-11-12

### Added
- **Charts:** click a name in a chart legend to show only that line (click again for all). Phase changes (blue ▲) and companies that close or merge (red ▲) are marked along the time axis; hover for the text.
- **Routes & revenue:** "= same" marks a train that ran the same stops as in the company's previous run, and ▲/▼ shows the change in the company's revenue. A *copy as image* button under the map sketch copies the map and routes as a picture.
- **Game log:** filter by kind of line (Stock, Revenue, Track, Trains, Auctions) and by company.
- **Minors & private companies:** each private shows its ability text from the engine.
- **Game info** card at the very bottom (collapsed): development stage, optional rules, play style, pinned version and how the game ends.
- **Text size:** A− / A+ in the ⋯ menu.
- **Narrow windows:** tighter single-column layout under about 720 px wide (new, may be revised).

## [0.12.2] - 2026-11-12

### Changed
- The Player value, Company revenue and Share price charts are 25% taller (Standings grows with Player value, which sits beside it).
- The Portfolios chart has less empty space on its right side.

## [0.12.1] - 2026-11-12

### Added
- **One-click update:** when a newer version exists, the note in the header reads "⬆ vX available, click to update". Clicking loads that version into the same window straight away, without waiting for the 12-hour cache. It lasts until you reload the game page; the bookmark itself is not changed. (The click only works from this version on; older versions still link to the changelog.)

## [0.12.0] - 2026-11-12

### Added
- **Routes & revenue:** *Show the routes on a map sketch* draws the board's hex grid (laid tiles as colours, cities, towns and off-board hexes marked) and joins the stops of a chosen company's trains, one colour per train, so a route is easy to match against the real map. It uses the same hex positions as 18xx.games, so it works for every title the engine supports.

### Changed
- Chart axis labels (Player value over time, Company revenue per operating round, Share price, portfolios) are larger and easier to read.
- The window opens in the dark theme by default. The ☾/☀ button still switches, and your choice is remembered.

### Tests
- `tests/regression.js` also reports how many route stops are found on the map sketch.

## [0.11.1] - 2026-11-12

### Changed
- **Routes & revenue** sits right below *Trains, phases & Bank* by default. A layout saved in 0.11.0 is moved once; after that your own order is kept.
- **Routes & revenue** (1862): a coloured glyph before each train shows its class: 🔵 express, 🟠 freight, 🟢 local.
- **Light theme** is a notch softer, in a neutral cream with a slight green-brown tint, instead of near-white.

## [0.11.0] - 2026-11-12

### Added
- **Routes & revenue** card: pick an operating round and see every company's trains, the revenue of each, the stops it ran (as the engine logs them) and whether the company paid out or withheld. It follows the history slider.
- **Game log:** every line has a small ↗ link that opens 18xx.games at that exact move.
- **Pinned games:** the header shows "pinned to version …" when the site has frozen the game to an older version of the rules.

### Tests
- `tests/regression.js` now also compares bank cash, phase and the game-end trigger with the engine itself at six points in each game, and checks that the Routes table matches the log.

## [0.10.2] - 2026-11-12

### Changed
- **Game end** tile: the list of ways the game can end is folded away under *How the game can end*, so the narrower Now tile stays compact.

## [0.10.1] - 2026-11-12

### Changed
- **Now** is half width and shares the top row with **What just happened**, both the same size.
- **Game end:** the bank estimate is now labelled as a pace-based guess, and the tile lists every way the game can end, in the engine's own words, with how many trains away a trigger train is (for example the train that makes LNER form in 1862).
- **Trains & phases** is now **Trains, phases & Bank**, and the *Held by* column shows each company's colour. (A saved layout keeps its place for the renamed section.)
- **Portfolios:** every player is drawn on the same value scale, so portfolios can be compared by flicking between players.

## [0.10.0] - 2026-11-12

### Added
- **History mode (⏱):** a slider in the header that takes the whole window back in time. Pick a round and every tile shows the game as it was at the end of that round (standings, corporations, trains and phases, bank, market grid, game log and so on). Paused and read only; *back to now* returns. The numbers at a chosen round are the same as the Player value chart's for that round (checked on a finished 1862 game).

## [0.9.3] - 2026-11-12

### Changed
- **Stock ticker:** a closed company now says what became of it: "merged into X" (X is the survivor) or "acquired by X", read from the game's own log. Plain "closed" stays when nothing absorbed it. Checked on 1862 and 1817 games.
- **Standings** and **Player value over time** have the same height when side by side (and grow together if there are many players). The same goes for any two sections in a row.
- **Trains & phases:** bank cash joins the row of tiles (bank cash, trains left, next train, next phase, next rust), and the trains still to come, the initial offering and the market shares sit side by side below it.

## [0.9.2] - 2026-11-12

### Changed
- **Bank & depot** is now the top of *Trains & phases* instead of a section of its own.
- *Corporations* sits directly under *Portfolios*; *Minors & private companies* and *Tile manifest* stay at the bottom and start collapsed. (If you saved your own layout, press ⋯ → Reset layout once to get the new order.)

## [0.9.1] - 2026-11-12

### Added
- **copy as image** in Standings: the ranking and the Player value chart as a picture, to paste into Discord or similar (saves a PNG file instead if the browser blocks the clipboard).
- **Game log** lines carry the acting player's colour and name in a column on the left; your own lines are highlighted.

### Changed
- *Player value over time* now sits beside *Standings* by default, and sections wrap two to a row on narrower windows too.

### Fixed
- **Reset layout** no longer doubles the ▾ and ⠿ icons on the section headers.

## [0.9.0] - 2026-11-12

### Added
- **Game log** section with a round slider: read the whole game round by round, search the full log, and jump to your own last move. Available in finished games (where the live log was never shown) and in live games.

## [0.8.0] - 2026-11-12

### Added
- **Light/dark toggle** (☀ / 🌙) at the top; the choice is remembered. Light mode checked on all sections.
- **Compact header:** icon toolbar, a **⋯** menu for opening another game and resetting the layout, and the header shrinks when you scroll.
- **Sticky first column** in wide tables so names stay visible when scrolling sideways.
- **copy as text** in Standings.
- **Window position and size are remembered**; the round is in the window title.
- **"New version available"** note, via `version.js`.
- **"I am" is picked automatically** from the logged-in name in the page header when it matches exactly one player.
- `tests/` folder with a regression script (exact scores against official results) and a live-play simulation.

### Changed
- *Since your last turn* is now a tab inside *What just happened* and hidden when empty.
- Thousands separators everywhere; a negative bank shows as "−$2,139" with a *broken* label.
- Single-row market grids wrap into even rows. "Player" column header is left-aligned.

## [0.7.1] - 2026-11-12

### Fixed
- Titles with a non-human "player" (the Union Bank in The Old Prince 1871) no longer show it as a ranked player; a note says what it holds.

### Added
- Ko-fi link in the README and the GitHub sponsor button.
- Tested on 36 more finished games (The Old Prince 1871, 1877: Stockholm Tramways, 1849: Kingdom of the Two Sicilies): all final scores match the official results.

## [0.7.0] - 2026-11-12

### Added
- **Stock market** section: the title's own market grid (single-row or multi-row), every company on its square, price zones with a legend, your own companies outlined, and in a live operating round a dashed marker for where the acting company goes if it pays out or withholds. A slider steps through earlier rounds. Checked against the engine on live and finished games of 15 titles.
- **Bank & depot** section: bank cash, the trains still to come in order, trains in the bank pool, shares left in the initial offering and the market.
- **Tile manifest** section (collapsed by default): tiles left by colour, with colours the phase does not allow yet dimmed.
- **Since your last turn** section: the log lines after your own last move.
- **Hover linking:** hover a company anywhere and it is highlighted in every table, chip and the market grid.
- **Live movement:** chips glide from the old holder to the new one when shares or trains change hands; rusted trains fade out.
- **Your turn:** a green frame around the stats window, in addition to the title marker and sound.
- The player and company that are to act now are highlighted in Standings and Corporations.

### Changed
- README: security section, tested-titles table, the new sections.

## [0.6.0] - 2026-11-12

### Added
- **Now** section for games in progress: who is to act and for which company, the order of the round with who has gone, operating rounds left in the set, and the priority deal.
- **I am…** selector: your row, name and line are highlighted everywhere, with a personal tile (value, rank, gap, cash, certificate room).
- **Your-turn signal:** the window title shows ● when it is your turn, with an optional sound (🔔 button).
- **What just happened:** the latest moves in plain words, with new ones marked since you last looked.
- **Stock round helper:** shares left in the IPO and market, last dividend per share, yield, presidency warnings, and a **price preview** of where the share price goes if a company pays or withholds (from the engine's own stock market rules).
- **Train rush** tile: whether the companies still to act could buy enough trains to trigger the next phase, and what would rust or become obsolete.
- **Game end** tile: the title's end conditions, whether one has triggered, and an estimate of operating rounds left before the bank breaks.
- Certificate room per player, and a note when the certificate limit has changed.
- Loans per company against the maximum, interest due, and the current and next interest rate (1817 family).
- Numbers that changed since the last update flash briefly.
- "Updates paused" banner in the stats window when the game page is reloaded or closed.

### Changed
- **Instant updates:** the window listens on the site's own live channel instead of downloading the game every 10 seconds, and applies only the new moves instead of replaying the whole game. A typical update takes about 30 ms instead of 1–5 seconds. Undo and redo trigger a full replay.
- **Verified every round:** at the end of each round the whole game is replayed from scratch and compared with the live numbers; the header shows "✓ verified at …".
- "Buy cheapest train" replaces "Can buy next?": it considers the bank pool, and says when a purchase would be an **emergency buy** with the president's cash, or when a loan is possible.
- Obsolete trains get their own column and warning, separate from rusting.
- A new company that has not operated yet shows "⚠ needs trains" instead of the red "⚠ no trains".

### Documentation
- Updates through the bookmark can take about 12 hours to reach everyone; the README and CONTRIBUTING now say so, with a way to pin a version for immediate use.

### Fixed
- Clicking the bookmark a second time left the old copy running and could empty the history charts.

## [0.5.0] - 2026-11-12

### Added
- **Other** layer in portfolios and an *Other* column in the holdings table, for anything a title counts in player value beyond shares, cash and private companies (such as auction bids or debts). Portfolio totals now always equal player value.

### Changed
- Renamed to **18xx-JNNstats** everywhere, including the window header and messages.
- The README lists how many games and titles were tested instead of individual game numbers, so players' nicknames aren't exposed.
- Compatibility tested on 46 games across 19 titles; all 31 finished games replay with exact final scores.

## [0.4.0] - 2026-11-12

### Added
- Made for half a screen: the stats window opens on the right half of the screen, so the game keeps the left half. A **Half screen** button puts it back there if it has been moved.
- Every section can be collapsed (▾) and moved: drag it by the ⠿ handle, or use ▲ ▼.
- The layout is remembered in your browser, separately for **live games** and **reviews** of finished games. Live games start with Trains & phases and Corporations at the top. **Reset layout** restores the defaults.

### Changed
- Tighter spacing and shorter charts, so more fits in a half-screen window.
- Your scroll position is kept when the window refreshes.

## [0.3.1] - 2026-11-12

### Fixed
- The layout no longer overflows sideways in narrow windows.
- Closed companies are listed last in the stock ticker.
- The bookmark always asks for a fresh copy of the script, so the browser's cache can't hold back updates. If you added the bookmark before this change, replace its URL with the new line from the README.

## [0.3.0] - 2026-11-12

### Added
- Moved to GitHub. The bookmark is now a short loader you add by hand; it fetches the newest `stats.js` from this repository through jsDelivr, so updates reach everyone automatically.
- Version number, author credit (jimiste) and a link to this repository in the stats window's header.
- Licensed under the GNU General Public License v3.0 or later.

### Changed
- The bookmark opens the stats window during the click, so pop-up blockers allow it even though the script arrives a moment later.

## [0.2.1] - 2026-11-12

### Added
- Archived games: 18xx.games deletes their moves, so the window now explains this and shows the stored final result instead of an empty game.

### Fixed
- Private companies held at the end of a game (for example 1817's Major Mail Contract) were missing from portfolio totals.

## [0.2.0] - 2026-11-12

### Added
- Stock ticker with price change since the previous round and a trend line per company.
- Portfolios: each player's holdings over the game as a stacked chart, including private companies and cash; short positions shown below zero.
- Holdings table with president markers and short positions.
- Minors (e.g. 1846's Big 4 and Michigan Southern) in the revenue chart and an ownership timeline for minors and private companies.
- Loans column for titles with company loans (1817 family).
- Box in the header to open any game by number or link; each title's rules are loaded on demand.
- Exact per-round share prices and holdings, recorded while the game is replayed.

## [0.1.1] - 2026-11-12

### Added
- Separate marker for half payouts in the revenue chart.

### Fixed
- Near-black company colours (e.g. 1846's NYC) were invisible on a dark background.

## [0.1.0] - 2026-11-12

### Added
- First version: standings, player value over time, revenue per OR, share prices, trains and phases, rust warnings, corporations table, live refresh every 10 seconds.
- Per-title settings, starting with 1862.
