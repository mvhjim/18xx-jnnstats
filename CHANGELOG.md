# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com), and versions follow [Semantic Versioning](https://semver.org).

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
