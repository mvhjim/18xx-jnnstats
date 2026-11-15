/*!
 * 18xx-JNNengine — a JNN game window for 18xx.games
 * Copyright (C) 2026 jimiste
 * https://github.com/mvhjim/18xx-jnnengine
 *
 * This program is free software: you can redistribute it and/or modify it under the terms of
 * the GNU General Public License as published by the Free Software Foundation, either version 3
 * of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details: <https://www.gnu.org/licenses/>.
 *
 * Runs on an 18xx.games game page (started from a bookmark) and opens its own window.
 * It contains no game logic of its own: it loads the released 18xx-JNNstats code (JNN-API)
 * and the site's own rules engine. This version only shows the game; it sends no moves.
 */
(function () {
  'use strict';
  var VERSION = '0.1.0';
  var API_MAJOR = '1';                 // the JNN-API major version this code is written for
  var API_MIN = '1.1';                 // the oldest minor version it can use
  var FALLBACK_SHA = '068c1ed';        // a JNN-stats release known to work, used if the latest is incompatible
  var STATS_CDN = 'https://cdn.jsdelivr.net/gh/mvhjim/18xx-jnnstats@';
  var REFRESH_MS = 10000;
  // Titles tested with JNN-Engine. Others are shown, but sending moves (in later versions) stays off.
  var SUPPORTED = ['1846', '1862', 'The Old Prince 1871', '1849: Kingdom of the Two Sicilies'];

  var E = window.__jnnEngine = window.__jnnEngine || {};
  if (E.timer) clearInterval(E.timer);
  var w = window.__jnnEngineTarget || E.win; window.__jnnEngineTarget = null;
  var m = /\/game\/(\d+)/.exec(location.pathname), gid = m && m[1];
  if (!gid || typeof Opal === 'undefined' || !Opal.Engine) { alert('JNN-Engine: open a game on 18xx.games first, then click the bookmark.'); return; }
  if (!w || w.closed) { alert('JNN-Engine: the window was blocked. Allow pop-ups for 18xx.games and click the bookmark again.'); return; }
  E.win = w; E.gid = gid;

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src;
      s.onload = res; s.onerror = function () { rej(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function apiOk(v) { if (!v) return false; var p = String(v).split('.'), q = API_MIN.split('.'); return p[0] === API_MAJOR && (+p[1] || 0) >= (+q[1] || 0); }
  function status(msg) { try { w.document.body.innerHTML = '<p style="font:15px system-ui;padding:24px">' + esc(msg) + '</p>'; } catch (e) {} }

  // 1. Which JNN-stats release to use: the latest, if its API fits; otherwise the known-good one
  function pickStats() {
    if (E.statsSha) return Promise.resolve(E.statsSha);
    if (window.__jnnStatsShaOverride) return Promise.resolve(E.statsSha = window.__jnnStatsShaOverride);
    return loadScript(STATS_CDN + 'main/version.js?t=' + Date.now()).then(function () {
      E.statsLatest = window.__xxLatest; E.statsApi = window.__xxApi;
      E.statsSha = apiOk(window.__xxApi) && window.__xxSha ? window.__xxSha : FALLBACK_SHA;
      E.pinned = E.statsSha === FALLBACK_SHA;
      return E.statsSha;
    }, function () { E.pinned = true; return (E.statsSha = FALLBACK_SHA); });
  }
  // 2. Load it as a library (its own state; a JNN-stats window on this page is not touched)
  function loadStats(sha) {
    if (E.J && E.J.__sha === sha) return Promise.resolve(E.J);
    return new Promise(function (res, rej) {
      var done = function (ev) { window.removeEventListener('jnnstats:ready', done); var J = ev.detail; J.__sha = sha; E.J = J; res(J); };
      window.addEventListener('jnnstats:ready', done);
      window.__jnnLibrary = true;
      loadScript(STATS_CDN + sha + '/stats.js').then(function () { window.__jnnLibrary = false; }, function (e) { window.__jnnLibrary = false; window.removeEventListener('jnnstats:ready', done); rej(e); });
    }).then(function (J) {
      if (!apiOk(J.apiVersion)) throw new Error('JNN-stats ' + J.version + ' has API ' + J.apiVersion + '; JNN-Engine ' + VERSION + ' needs ' + API_MAJOR + '.x (at least ' + API_MIN + ')');
      return J;
    });
  }
  // 3. Load and replay the game, then keep it up to date
  function load(J) {
    return J.fetchGameText(gid).then(function (text) {
      var raw = JSON.parse(text); if (!raw.actions) throw new Error('game ' + gid + ' not found');
      return J.ensureTitle(raw.title).then(function () {
        if (E.game && E.game.raw.actions.length && raw.actions.length > E.game.raw.actions.length && raw.actions[E.game.raw.actions.length - 1].id === E.game.raw.actions[E.game.raw.actions.length - 1].id) {
          if (J.applyActions(E.game.g, raw.actions.slice(E.game.raw.actions.length))) { E.game.raw = raw; return; }
        }
        if (!E.game || E.game.raw.actions.length !== raw.actions.length) E.game = { g: J.loadGame(text), raw: raw };
        else E.game.raw = raw;
      });
    });
  }

  // ---------- drawing ----------
  var CSS_EXTRA = [
    'body{margin:0}header.je{position:sticky;top:0;z-index:5;background:var(--surface-0);border-bottom:1px solid var(--grid);padding:8px 14px}',
    '.je h1{font-size:18px;margin:0 8px 0 0;display:inline}.je .kv{margin-right:12px;font-size:13px}.je .ro{display:inline-block;font-size:11px;padding:2px 8px;border-radius:10px;background:var(--grid);margin-left:6px}',
    '.jw{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(300px,1fr);gap:12px;padding:12px}@media (max-width:900px){.jw{grid-template-columns:1fr}}',
    '.jcol{display:flex;flex-direction:column;gap:12px;min-width:0}.jb svg{width:100%;height:auto}',
    '.act{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.act button{opacity:.6;cursor:not-allowed}',
    '.yt{border:2px solid var(--accent);border-radius:12px}.note{font-size:12px;color:var(--text-secondary)}',
    '.mine td{font-weight:650}.ft{padding:4px 14px 14px;font-size:11.5px;color:var(--text-muted)}'
  ].join('\n');
  var ACT = { pass: 'Pass', bid: 'Bid', par: 'Start a company', buy_shares: 'Buy shares', sell_shares: 'Sell shares', lay_tile: 'Lay a tile', place_token: 'Place a station',
    run_routes: 'Run trains', dividend: 'Pay out or withhold', buy_train: 'Buy a train', buy_company: 'Buy a private', discard_train: 'Discard a train', bankrupt: 'Go bankrupt',
    take_loan: 'Take a loan', payoff_loan: 'Repay a loan', short: 'Short', choose: 'Choose', assign: 'Assign', convert: 'Convert', merge: 'Merge', sell_company: 'Sell a private' };

  function draw(J) {
    var gm = E.game, d = J.extract(gm.g, gm.raw), doc = w.document, dark = J.isDark(w), m = d.money;
    J.setDark(dark);
    var names = d.players.map(function (p) { return p.name; }), me = J.myName(names), pal = J.palette(dark);
    var pc = {}; d.players.forEach(function (p) { pc[p.name] = pal[p.idx % pal.length]; });
    var sup = SUPPORTED.indexOf(d.title) >= 0, t = d.live && d.live.turn, acting = t ? (t.entType === 'player' ? t.entity : t.owner) : null, myTurn = !!(me && acting === me);
    var sw = function (c) { return '<i class="sw" style="background:' + esc(c) + '"></i>'; };
    var h = [];
    h.push('<header class="je"><h1>' + esc(d.title) + '</h1><span class="ro">JNN-Engine · view only</span>' + (J.privacyOn() ? '<span class="ro">🕶 private</span>' : '') + '<br>' +
      '<span class="kv">Round <b>' + esc(d.roundLabel) + '</b></span><span class="kv">Phase <b>' + esc(d.phase) + '</b></span><span class="kv">Bank <b>' + esc(d.primer && d.primer.bankUnlimited ? 'unlimited' : m(d.bank)) + '</b></span>' +
      (d.nextTrain ? '<span class="kv">Next train <b>' + esc(d.nextTrain.name) + ' ' + esc(m(d.nextTrain.price)) + '</b></span>' : '') +
      (d.finished ? '<span class="kv"><b>Game over</b></span>' : acting ? '<span class="kv">To act: ' + (pc[acting] ? sw(pc[acting]) : '') + '<b>' + esc(acting) + '</b>' + (t.entType !== 'player' ? ' for ' + esc(t.entity) : '') + (myTurn ? ' · <b style="color:var(--accent)">your turn</b>' : '') + '</span>' : '') + '</header>');
    if (J.learnLevel()) h.push(J.roundBanner(d, me));
    h.push('<div class="jw"><div class="jcol">');
    // the board
    h.push('<section class="card wide jb"><h2>Board</h2>' + J.boardSvg(d, null, [], 1400) + '</section>');
    h.push('<section class="card wide"><h2>Stock market</h2>' + J.marketHtml(d, dark, me, (d.gridHist || []).length - 1, m) + '</section>');
    h.push('</div><div class="jcol">');
    // moves now (view only in this version)
    if (!d.finished && t) {
      var real = (t.actions || []).filter(function (a) { return ['end_game', 'message', 'undo', 'redo', 'log', 'bankrupt'].indexOf(a) < 0 && !/^program_/.test(a); });
      if (!real.length && (t.actions || []).indexOf('bankrupt') >= 0) real = ['bankrupt'];
      var acts = real.map(function (a) { return '<button class="pill" disabled title="Sending moves comes in a later version">' + esc(ACT[a] || a.replace(/_/g, ' ')) + '</button>'; }).join('');
      h.push('<section class="card' + (myTurn ? ' yt' : '') + '"><h2>' + (myTurn ? 'Your turn' : 'Now') + '</h2><p class="sub">' + esc(t.entity) + (t.desc ? ': ' + esc(t.desc) : '') + '</p><div class="act">' + acts + '</div>' +
        '<p class="note">This version only shows the game. Make your move on the 18xx.games page' + (sup ? '; sending moves from here comes in a later version.' : '. This title is not tested with JNN-Engine yet, so it will stay view only.') + '</p></section>');
      if (J.learnLevel()) h.push('<section class="card">' + J.yourTurnHtml(d, me, m) + '</section>');
    }
    // you
    var P = d.players.slice().sort(function (a, b) { return b.value - a.value; });
    if (me) {
      var mp = d.players.filter(function (p) { return p.name === me; })[0], row = (d.holdings && d.holdings.rows || []).filter(function (r) { return r.name === me; })[0];
      var mine = d.corps.filter(function (c) { return c.president === me && !c.closed; });
      h.push('<section class="card"><h2>You: ' + esc(me) + '</h2><p class="sub">Cash <b>' + esc(m(mp.cash)) + '</b> · value <b>' + esc(m(mp.value)) + '</b> · certificates <b>' + mp.certs + (mp.certLimit ? ' / ' + mp.certLimit : '') + '</b> · place <b>' + (P.indexOf(mp) + 1) + ' of ' + P.length + '</b></p>' +
        (row ? '<div class="tw"><table class="tight"><thead><tr><th style="text-align:left">Company</th><th>Share</th><th>Value</th></tr></thead><tbody>' + Object.keys(row.cells).map(function (cn) { var c = row.cells[cn]; return '<tr><td style="text-align:left">' + esc(cn) + (c.pres ? ' ★' : '') + '</td><td>' + c.pct + '%</td><td>' + esc(m(c.val)) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') +
        (mine.length ? '<h3 class="rh">Companies you run</h3><div class="tw"><table class="tight"><thead><tr><th style="text-align:left">Company</th><th>Price</th><th>Cash</th><th>Trains</th></tr></thead><tbody>' + mine.map(function (c) { return '<tr><td style="text-align:left">' + sw(c.color) + esc(c.name) + '</td><td>' + esc(c.price != null ? m(c.price) : '–') + '</td><td>' + esc(m(c.cash)) + '</td><td>' + esc(c.trains.map(function (x) { return x.name; }).join(', ') || 'none') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') + '</section>');
    } else h.push('<section class="card"><h2>You</h2><p class="sub">Pick your name under <b>I am</b> in the JNN-stats ⋯ menu; JNN-Engine uses the same setting.</p></section>');
    // players
    h.push('<section class="card"><h2>Players</h2><div class="tw"><table class="tight"><thead><tr><th style="text-align:left">Player</th><th>Value</th><th>Cash</th><th>Certs</th></tr></thead><tbody>' +
      P.map(function (p) { return '<tr' + (p.name === me ? ' class="mine"' : '') + '><td style="text-align:left">' + sw(pc[p.name]) + esc(p.name) + (p.name === acting ? ' ▶' : '') + '</td><td>' + esc(m(p.value)) + '</td><td>' + esc(m(p.cash)) + '</td><td>' + p.certs + '</td></tr>'; }).join('') + '</tbody></table></div></section>');
    // companies
    var open = d.corps.filter(function (c) { return !c.closed && c.floated !== false; });
    if (open.length) h.push('<section class="card"><h2>Companies</h2><div class="tw"><table class="tight"><thead><tr><th style="text-align:left">Company</th><th>President</th><th>Price</th><th>Cash</th><th>Trains</th></tr></thead><tbody>' +
      open.map(function (c) { return '<tr><td style="text-align:left">' + sw(c.color) + esc(c.name) + '</td><td>' + esc(c.president || '–') + '</td><td>' + esc(c.price != null ? m(c.price) : '–') + '</td><td>' + esc(m(c.cash)) + '</td><td>' + esc(c.trains.map(function (x) { return x.name; }).join(', ') || 'none') + '</td></tr>'; }).join('') + '</tbody></table></div></section>');
    h.push('</div></div>');
    h.push('<div class="ft">JNN-Engine ' + VERSION + ' · built on 18xx-JNNstats ' + esc(J.version) + ' (JNN-API ' + esc(J.apiVersion) + ')' + (E.pinned ? ' · pinned to a known-good JNN-stats release because the latest one is not compatible' : '') +
      ' · ' + (sup ? 'tested title' : 'title not tested with JNN-Engine yet') + ' · updated ' + new Date().toLocaleTimeString() + ' · the 18xx.games page is always the place to play if anything here looks wrong.</div>');
    var y = w.scrollY || 0;
    if (!doc.getElementById('jcss')) { doc.head.innerHTML = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JNN-Engine</title><style id="jcss"></style><style id="jcss2"></style>'; }
    doc.title = (myTurn ? '● Your turn · ' : '') + d.title + ' · JNN-Engine';
    doc.getElementById('jcss').textContent = J.css(); doc.getElementById('jcss2').textContent = CSS_EXTRA;
    doc.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    doc.body.innerHTML = h.join('');
    w.scrollTo(0, y);
  }

  function cycle(force) {
    if (!w || w.closed) { clearInterval(E.timer); return Promise.resolve(); }
    if (E.busy) return E.busy;
    E.busy = pickStats().then(loadStats).then(function (J) {
      var before = E.game ? E.game.raw.actions.length : -1;
      return load(J).then(function () { if (force || !E.game || E.game.raw.actions.length !== before || !E.drawn) { draw(J); E.drawn = true; } });
    }).catch(function (e) { status('JNN-Engine could not show this game: ' + (e && e.message || e) + '. You can always play on the 18xx.games page.'); })
      .then(function () { E.busy = null; });
    return E.busy;
  }
  try { w.document.title = 'JNN-Engine'; } catch (e) {}
  status('JNN-Engine is loading the game…');
  E.drawn = false; E.game = null;
  cycle(true);
  E.timer = setInterval(function () { cycle(false); }, REFRESH_MS);
})();
