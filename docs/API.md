# JNN-API

18xx-JNNstats exposes its game reading and analysis as a small, versioned programming interface, so that other tools (first of all **JNN-Engine**) can build on the released code instead of keeping a copy of it. Everything in the API is **read only**: nothing in it makes a move or sends data anywhere.

Current version: **1.1**

## Versioning

- `version.js` in this repository holds three values:
  - `window.__xxLatest`: the latest release, e.g. `0.37.0`
  - `window.__xxSha`: the commit of that release
  - `window.__xxApi`: the API version of that release, e.g. `1.0`
- **Minor** API versions (1.0 → 1.1) only add things. A tool written for 1.0 keeps working.
- A new **major** version (1.x → 2.0) may change or remove something. A tool should check the major number and, if it does not match, stay on the last release it knows instead of breaking.

## Loading it as a library

```js
// on an 18xx.games game page
window.__jnnLibrary = true;                 // expose the API only: no window, no timers
var s = document.createElement('script');
s.src = 'https://cdn.jsdelivr.net/gh/mvhjim/18xx-jnnstats@' + window.__xxSha + '/stats.js';
document.head.appendChild(s);
window.addEventListener('jnnstats:ready', function (ev) { var J = ev.detail; /* window.JNNStats */ });
```

Load `version.js` first (it sets `__xxSha` and `__xxApi`), check `__xxApi`, then load `stats.js` at that commit. In library mode the script keeps its own state, so a JNN-stats window running from the same page is not affected. When JNN-stats is started normally, `window.JNNStats` is set as well.

## What is in it

| Member | What it does |
|---|---|
| `apiVersion`, `version`, `repo` | API version, JNN-stats version, repository URL |
| `fetchGameText(id)` | Promise of the game's JSON text from 18xx.games (names anonymised in privacy mode) |
| `ensureTitle(title)` | Promise; loads the title's rules code from 18xx.games if needed |
| `loadGame(text)` | replays the game with the site's rules engine; returns the engine game |
| `applyActions(game, actions)` | applies new moves to a replayed game; `false` means "reload from scratch" |
| `effectiveActions(raw)` | the game's moves after undo/redo are taken into account |
| `extract(game, raw)` | the data model all JNN-stats cards are drawn from (players, companies, market, trains, routes, log, analysis…) |
| `whyLine(d, line)` | a plain-words explanation of one log line, or `null` |
| `routeWhy(d, stops, revenue, train)` | HTML: a run broken down stop by stop |
| `explainSquare(d, row, col)` | HTML: what a stock market square means |
| `glossary(d)` | the glossary terms with this game's numbers |
| `nextBuyEffects(d)` | what buying the next train changes (phase, rust, obsolete trains) |
| `dumpRisks(d)` | presidencies that could be passed on by selling |
| `teachMoments(d)` | the decisions and events that shaped the game |
| `decisionScores(d)`, `styleVectors(d)` | decision score and style fingerprint per player |
| `whatIf(raw, effectiveActions, index, change)` | Promise; replays the rest of the game on a copy with one decision changed |
| `css()` | the JNN-stats stylesheet as text, for a matching look |
| `palette(dark)` | the player colours (respects the colour-blind setting) |
| `render(window, d)` | draws the full JNN-stats dashboard into a window |
| `shareImage(...)` | the share card canvas |
| `privacyOn()`, `learnLevel()`, `myName(names)` | the user's JNN-stats settings, stored in the browser |
| `boardSvg(d, hx, paths, maxWidth)` *(1.1)* | the board as SVG: tiles, cities, stations, optional route lines |
| `routePaths(d, round, corp, positions)` *(1.1)* | route lines of one operating round for `boardSvg` |
| `hexPositions(d, unit)` *(1.1)* | hex centres on the board |
| `marketHtml(d, dark, me, roundIndex, money)` *(1.1)* | the stock market grid |
| `roundBanner(d, me)`, `yourTurnHtml(d, me, money)` *(1.1)* | Learning-mode explanations of the round and of what the rules allow now |
| `isDark(window)`, `setDark(bool)`, `esc(text)` *(1.1)* | the theme setting (read it, and tell the library which theme you draw in), and HTML escaping |

The data model returned by `extract` is the same one the dashboard uses. Fields may be added in minor versions; fields are only removed or renamed in a new major version.
