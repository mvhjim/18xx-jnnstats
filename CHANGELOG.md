# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com), and versions follow [Semantic Versioning](https://semver.org).

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
