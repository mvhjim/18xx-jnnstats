/*!
 * 18xx-JNNstats — a live stats window for 18xx.games
 * Copyright (C) 2026 jimiste
 * https://github.com/mvhjim/18xx-jnnstats
 *
 * This program is free software: you can redistribute it and/or modify it under the terms of
 * the GNU General Public License as published by the Free Software Foundation, either version 3
 * of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details: <https://www.gnu.org/licenses/>.
 *
 * Runs on an 18xx.games game page (started from a bookmark). It replays the game with the
 * site's own rules engine (Opal) and renders a dashboard in a separate window that refreshes
 * every 10 seconds. It only reads public game data; it never makes moves or sends data anywhere.
 */
(function () {
  'use strict';
  var VERSION = '0.19.0';
  var REFRESH_MS = 10000;
  var REPO_URL = 'https://github.com/mvhjim/18xx-jnnstats';

  // ---------- Per-title config ----------------------------------------------------------
  // Each title can override labels/metrics. 'default' applies to every game.
  // hooks: extraPlayerCols(g, p, h) -> [{label, value}], notes(g, h) -> [string], endGame(g, h) -> [{label,value,status}]
  var CONFIG = {
    default: {},
    '1862': {
      trainClass: { E: ['🔵', 'Express'], F: ['🟠', 'Freight'], L: ['🟢', 'Local'] },
      notes: function () {
        return ['1862: train variants (E/F/L) are chosen at purchase; each level is one train “type” below.',
                'Game ends when the bank breaks or the last train is bought (finish the current OR set).'];
      }
    }
  };

  var PLAYER_COLORS = { light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
                        dark:  ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'] };

  // ---------- Opal helpers ----------------------------------------------------------------
  function nil(o) { return o == null || (typeof Opal !== 'undefined' && o === Opal.nil); }
  function s(x) { return nil(x) ? '' : String(x); }
  function bool(x) { return x === true; }
  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
  function rt(o, m) { try { return !nil(o) && o['$respond_to?'](m); } catch (e) { return false; } }
  function call(o, m, arg) { try { var v = rt(o, m) ? (arg === undefined ? o['$' + m]() : o['$' + m](arg)) : null; return nil(v) ? null : v; } catch (e) { return null; } }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------- Data extraction -------------------------------------------------------------
  function pageGameId() { var m = location.pathname.match(/\/game\/(\d+)/); return m ? m[1] : null; }
  function gameId() { return (window.__xxStats && window.__xxStats.gameId) || pageGameId(); }

  // Replays the game and, at every point where the engine records player history (end of each round),
  // takes a snapshot of share prices, holdings, cash, minors and private companies.
  var SNAP = null;
  function nameOf(o) { return o && rt(o, 'name') ? s(o.$name()) : ''; }
  // names of the companies that have a token on a tile
  function hexTokens(tl) {
    var out = [];
    try { tl.$cities().forEach(function (ct) { (ct.$tokens() || []).forEach(function (tk) { var cp = tk && !nil(tk) ? call(tk, 'corporation') : null; if (cp) out.push(s(cp.$name())); }); }); } catch (e) {}
    return out;
  }
  function takeSnapshot(g) {
    var rd = g.round, short = s(rd.$class().$short_name());
    var snap = { label: short + ' ' + s(g.$turn()) + (short === 'OR' ? '.' + s(call(rd, 'round_num')) : ''), prices: {}, hold: {}, cash: {}, priv: {}, value: {}, minors: {}, companies: {}, corpCash: {}, pos: {} };
    var corps = g.$corporations();
    snap.bank = num(call(call(g, 'bank'), 'cash'));
    try { var lg0 = g.$log(); snap.act = lg0.length ? num(call(lg0[lg0.length - 1], 'action_id')) : 0; } catch (e0a) { snap.act = 0; }
    try { var ph0 = call(g, 'phase'); snap.phase = ph0 ? s(ph0.$name()) : ''; } catch (e0) { snap.phase = ''; }
    try { var hxo = {}, hl2 = g.$hexes(); for (var h2 = 0; h2 < hl2.length; h2++) { var tl2 = hl2[h2].$tile(); hxo[s(hl2[h2].$id())] = [s(tl2.$color()), s(tl2.$name()), hexTokens(tl2)]; } snap.hx = hxo; } catch (e00) { snap.hx = null; }
    snap.certLimit = num(call(g, 'cert_limit', g.$players()[0]) || call(g, 'cert_limit'));
    corps.forEach(function (c) {
      var sp = call(c, 'share_price');
      if (sp) { snap.prices[s(c.$name())] = num(call(sp, 'price')); var co = call(sp, 'coordinates'); if (co && co.length) snap.pos[s(c.$name())] = [num(co[0]), num(co[1])]; }
      snap.corpCash[s(c.$name())] = num(call(c, 'cash'));
    });
    g.$players().forEach(function (p) {
      var pn = s(p.$name()), h = {};
      snap.cash[pn] = num(p.$cash());
      snap.value[pn] = num(call(g, 'player_value', p));
      corps.forEach(function (c) {
        var sh = call(p, 'shares_of', c) || [];
        if (!sh.length) return;
        var pct = 0, val = 0, pres = false;
        sh.forEach(function (x) { pct += num(call(x, 'percent')); val += num(call(x, 'price')); if (bool(call(x, 'president'))) pres = true; });
        h[s(c.$name())] = { pct: pct, val: val, pres: pres };
      });
      snap.hold[pn] = h;
    });
    (call(g, 'minors') || []).forEach(function (m) {
      var oh = {};
      var ohash = call(m, 'operating_history');
      if (ohash) ohash.$to_a().forEach(function (kv) {
        var div = call(kv[1], 'dividend');
        oh['OR ' + s(kv[0][0]) + '.' + s(kv[0][1])] = { t: num(kv[0][0]), r: num(kv[0][1]), revenue: num(call(kv[1], 'revenue')), kind: div && rt(div, 'kind') ? s(div.$kind()) : (div ? 'none' : '') };
      });
      snap.minors[s(m.$name())] = { full: s(call(m, 'full_name')), color: s(call(m, 'color')), owner: nameOf(call(m, 'owner')), closed: bool(call(m, 'closed?')), oh: oh };
    });
    (call(g, 'companies') || []).forEach(function (c) {
      var cc = { name: s(c.$name()), owner: nameOf(call(c, 'owner')), closed: bool(call(c, 'closed?')), value: num(call(c, 'value')), revenue: num(call(c, 'revenue')), desc: s(call(c, 'desc') || '') };
      snap.companies[s(call(c, 'sym')) || s(c.$name())] = cc;
      if (!cc.closed && snap.cash[cc.owner] != null) snap.priv[cc.owner] = (snap.priv[cc.owner] || 0) + cc.value;
    });
    return snap;
  }
  // The step that knows how a dividend moves the share price (title-specific rules).
  function findDivStep(round) {
    var steps = call(round, 'steps') || [], i;
    for (i = 0; i < steps.length; i++) if (rt(steps[i], 'share_price_change')) return steps[i];
    return null;
  }
  function installHook() {
    var B = Opal.Engine.Game.Base.prototype;
    // Each load of this script installs its own hook around the engine's original function,
    // so clicking the bookmark again (or a newer version) never leaves a stale hook in charge.
    if (B.__xxHookOwner === ST.token) return;
    var orig = B.__xxOrigSPI || B.$store_player_info;
    if (typeof orig !== 'function') return;
    B.__xxOrigSPI = orig;
    B.__xxHookOwner = ST.token;
    B.$store_player_info = function () {
      var r = orig.apply(this, arguments);
      try { var ds = findDivStep(this.round); if (ds) this.__xxDivStep = ds; } catch (e) {}
      if (SNAP && SNAP.active) {
        try { if (bool(call(this.round, 'show_in_history?'))) SNAP.list.push(takeSnapshot(this)); } catch (e) { SNAP.err = String(e); }
      }
      return r;
    };
    B.__xxHooked = true;
  }
  // Each title's rules live in /assets/<fs_name>.js and are loaded on demand (same as the site does).
  function ensureTitle(title) {
    var meta = Opal.Engine.$meta_by_title(title);
    if (nil(meta)) return Promise.reject(new Error('Unknown title ' + title));
    var fs = s(meta.$fs_name()), dep = null;
    try { if (meta['$const_defined?']('DEPENDS_ON')) dep = s(meta.$const_get('DEPENDS_ON')); } catch (e) {}
    return (dep ? ensureTitle(dep) : Promise.resolve()).then(function () {
      if (Opal.modules['engine/game/' + fs + '/game']) return;
      return new Promise(function (res, rej) {
        var sc = document.createElement('script'); sc.src = '/assets/' + fs + '.js';
        sc.onload = res; sc.onerror = function () { rej(new Error('Could not load rules for ' + title)); };
        document.head.appendChild(sc);
      });
    }).then(function () { Opal.top.$require_tree('engine/game/' + fs); });
  }
  function loadGame(text) {
    installHook();
    SNAP = { active: true, list: [] };
    try { var g = Opal.Engine.Game.$load(Opal.JSON.$parse(text)); }
    finally { SNAP.active = false; }
    g.__xxSnaps = SNAP.list;
    return g;
  }
  // Apply only the new moves to a game that is already replayed. Returns false when a full
  // replay is needed instead (undo/redo, an engine error, or the engine handing back a new game).
  function applyActions(g, actions) {
    installHook();
    SNAP = { active: true, list: g.__xxSnaps || (g.__xxSnaps = []) };
    try {
      for (var i = 0; i < actions.length; i++) {
        var a = actions[i];
        if (!a || a.type === 'undo' || a.type === 'redo') return false;
        var r = g.$process_action(Opal.JSON.$parse(JSON.stringify(a)));
        if (r !== g || !nil(call(g, 'exception'))) return false;
      }
      return true;
    } catch (e) { return false; }
    finally { SNAP.active = false; }
  }

  // Reads the engine's own log lines (and the value history) into the 0.15 data cards.
  function analyse(gameLog, routeTable, vh, players, ticker, snaps, endInfo, finished) {
    var out = { track: [], money: null, val: [], trains: null, moments: [], range: null };
    var N = function (t) { var q = String(t == null ? '' : t).replace(/,/g, '').match(/-?\d+(\.\d+)?/); return q ? parseFloat(q[0]) : 0; };
    var CUR = '[^\\d\\s]{0,3}\\s?([\\d,]+(?:\\.\\d+)?)';
    var pn = {}, pnames = players.map(function (p) { return p.name; }); pnames.forEach(function (n) { pn[n] = 1; });
    var cn = {}; ticker.forEach(function (t2) { cn[t2.name] = t2; });
    var byLab = {}; snaps.forEach(function (sn) { byLab[sn.label] = sn; });
    if (!gameLog) return out;
    // --- track spending vs revenue
    var tr = {}, getT = function (n) { return tr[n] || (tr[n] = { corp: n, tiles: 0, tileCost: 0, tokens: 0, tokenCost: 0, rev: 0, runs: 0 }); };
    var rxTile = new RegExp('^(.+?)(?: \\([^)]*\\))? (?:spends ' + CUR + ' and )?lays tile');
    var rxTok = new RegExp('^(.+?)(?: \\([^)]*\\))? places a token on \\S+(?: \\([^)]*\\))?\\s*(?:for ' + CUR + ')?\\s*$');
    var rxTokBuy = new RegExp('^(.+?) buys (\\d+) tokens? for ' + CUR);
    // --- money sources
    var ms = {}; pnames.forEach(function (n) { ms[n] = { div: 0, priv: 0, sales: 0 }; });
    var rxDiv = /^(.+?) pays out .*per share \((.*)\)\s*$/, rxPart = new RegExp('^' + CUR + ' to (.+)$');
    var rxPriv = new RegExp('^(.+?) collects ' + CUR + ' from ');
    var rxSell = new RegExp('^(.+?) (?:sells|shorts) .*? (?:and receives|for) ' + CUR + '\\s*$');
    // --- trains
    var pres = {}, firstTok = {}, rxPres = /^(.+?) becomes the president of (.+)$/, rxTokHex = /^(.+?)(?: \([^)]*\))? places a token on (\S+)/;
    var trains = [], depot = {}, rxTrain = new RegExp('^(.+?) buys an? (\\S+) train for ' + CUR + ' from (.+?)(?: \\(.*\\))?\\s*$');
    gameLog.rounds.forEach(function (rd) { rd.lines.forEach(function (ln) {
      var q = ln.msg, mm;
      if ((mm = rxPres.exec(q)) && cn[mm[2]]) { pres[mm[2]] = mm[1]; }
      if ((mm = rxTokHex.exec(q)) && cn[mm[1]] && !firstTok[mm[1]]) firstTok[mm[1]] = { hex: mm[2], round: rd.label, id: ln.id };
      if ((mm = rxTile.exec(q)) && cn[mm[1]]) { var c1 = getT(mm[1]); c1.tiles++; if (mm[2]) c1.tileCost += N(mm[2]); return; }
      if ((mm = rxTok.exec(q)) && cn[mm[1]]) { var c2 = getT(mm[1]); c2.tokens++; if (mm[2]) c2.tokenCost += N(mm[2]); return; }
      if ((mm = rxTokBuy.exec(q)) && cn[mm[1]]) { getT(mm[1]).tokenCost += N(mm[3]); return; }
      if ((mm = rxDiv.exec(q))) { mm[2].split(', ').forEach(function (part) { var pp = rxPart.exec(part); if (pp && pn[pp[2]]) ms[pp[2]].div += N(pp[1]); }); return; }
      if ((mm = rxPriv.exec(q)) && pn[mm[1]]) { ms[mm[1]].priv += N(mm[2]); return; }
      if ((mm = rxSell.exec(q)) && pn[mm[1]]) { ms[mm[1]].sales += N(mm[2]); return; }
      if ((mm = rxTrain.exec(q))) {
        var price = N(mm[3]), from = mm[4], isDepot = /depot/i.test(from);
        if (isDepot && depot[mm[2]] == null) depot[mm[2]] = price;
        trains.push({ round: rd.label, id: ln.id, buyer: mm[1], train: mm[2], price: price, from: isDepot ? 'Depot' : from, depot: isDepot, pres: pres[mm[1]] || '' });
      }
    }); });
    routeTable.forEach(function (R) { R.corps.forEach(function (c) { if (c.totalN != null && c.trains.length && cn[c.corp]) { var t3 = getT(c.corp); t3.rev += c.totalN; t3.runs++; } }); });
    out.track = Object.keys(tr).map(function (k) { return tr[k]; }).filter(function (x) { return x.tiles || x.tokens || x.tokenCost; })
      .sort(function (a, b) { return (b.tileCost + b.tokenCost) - (a.tileCost + a.tokenCost) || b.rev - a.rev; });
    if (pnames.some(function (n) { return ms[n].div || ms[n].priv || ms[n].sales; })) out.money = pnames.map(function (n) { return { name: n, div: ms[n].div, priv: ms[n].priv, sales: ms[n].sales }; });
    trains.forEach(function (t4) { t4.list = depot[t4.train] != null ? depot[t4.train] : null; });
    if (trains.length) out.trains = trains;
    // --- valuation: price against what the company has paid per share lately
    ticker.forEach(function (t5) {
      if (t5.closed || !t5.price) return;
      var pays = [];
      routeTable.forEach(function (R) { R.corps.forEach(function (c) {
        if (c.corp !== t5.name || !c.trains.length) return;
        if (/^pays out/.test(c.kind)) pays.push(N(c.kind.replace(/^pays out/, ''))); else if (/^withholds/.test(c.kind)) pays.push(0);
      }); });
      if (!pays.length) return;
      var last = pays.slice(-3), avg = last.reduce(function (a, b) { return a + b; }, 0) / last.length;
      out.val.push({ corp: t5.name, color: t5.color, price: t5.price, last: last, avg: avg, yld: avg / t5.price * 100, payback: avg > 0 ? t5.price / avg : null });
    });
    out.val.sort(function (a, b) { return b.yld - a.yld; });
    // --- key moments from the value history
    var L = vh.labels, S = vh.series, mo = [];
    var actOf = function (f) { var sn = byLab[L[f]]; return sn && sn.act > 0 ? sn.act : 0; };
    var lead = function (f) { var bi = -1, bv = -Infinity; S.forEach(function (ser, i) { var v = ser[f]; if (v != null && v > bv) { bv = v; bi = i; } }); return bi; };
    var prevL = lead(0), changes = [];
    for (var f = 1; f < L.length; f++) {
      var ld = lead(f);
      if (ld !== prevL && ld >= 0 && prevL >= 0 && S[ld][f] > S[prevL][f]) changes.push({ f: f, kind: 'lead', text: pnames[ld] + ' takes the lead from ' + pnames[prevL] + ' (' + S[ld][f] + ' to ' + S[prevL][f] + ')', act: actOf(f) });
      if (ld >= 0) prevL = ld;
    }
    var swings = [];
    for (var f2 = 1; f2 < L.length; f2++) S.forEach(function (ser, i) { if (ser[f2] != null && ser[f2 - 1] != null && /^(OR|SR)/.test(L[f2])) swings.push({ f: f2, i: i, d: ser[f2] - ser[f2 - 1] }); });
    swings.sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); });
    var picked = {};
    swings.slice(0, 4).forEach(function (w) { if (picked[w.f + '|' + w.i]) return; picked[w.f + '|' + w.i] = 1; mo.push({ f: w.f, kind: w.d > 0 ? 'gain' : 'loss', amt: w.d, who: pnames[w.i], label: L[w.f], text: pnames[w.i] + (w.d > 0 ? ' gains ' : ' loses ') + Math.abs(w.d) + ' in value in ' + L[w.f], act: actOf(w.f) }); });
    var best = null;
    routeTable.forEach(function (R) { R.corps.forEach(function (c) { if (c.trains.length && c.totalN != null && (!best || c.totalN > best.v)) best = { v: c.totalN, corp: c.corp, label: R.label, round: R.round }; }); });
    if (best) { var bl = null; gameLog.rounds[best.round].lines.forEach(function (ln) { if (!bl && ln.id > 0 && ln.msg.indexOf(best.corp + ' runs') === 0) bl = ln.id; }); mo.push({ f: 1e9, kind: 'run', text: 'Best single run: ' + best.corp + ' earns ' + best.v + ' (' + best.label.replace(/^Operating Round/, 'OR') + ')', act: bl || 0, raw: best.v }); }
    out.moments = changes.slice(-6).concat(mo).sort(function (a, b) { return a.f - b.f; });
    var mapLab = function (lab) { return String(lab).replace(/^Operating Round /, 'OR ').replace(/^Stock Round /, 'SR ').replace(/ \(of \d+\)$/, ''); };
    out.withholds = [];
    routeTable.forEach(function (R) { var lab = mapLab(R.label), sn = byLab[lab]; R.corps.forEach(function (c) {
      if (c.trains.length && /^withholds/.test(c.kind) && c.totalN > 0 && cn[c.corp]) {
        var gets = {}; if (sn) pnames.forEach(function (n) { var hh = (sn.hold[n] || {})[c.corp]; if (hh && hh.pct) gets[n] = Math.round(c.totalN * hh.pct / 100); });
        out.withholds.push({ corp: c.corp, label: lab, rev: c.totalN, gets: gets });
      }
    }); });
    // more key moments: price crashes, closures, first tokens
    var prevS = null, crashes = [], closed = {};
    snaps.forEach(function (sn) {
      if (prevS && sn.label !== 'Now') Object.keys(sn.prices).forEach(function (nm) { var a = prevS.prices[nm], b = sn.prices[nm]; if (a > 0 && b != null && b < a) crashes.push({ nm: nm, a: a, b: b, pct: (a - b) / a, label: sn.label, act: sn.act }); });
      if (prevS) Object.keys(prevS.prices).forEach(function (nm) { if (sn.prices[nm] == null && !closed[nm]) { closed[nm] = 1; var fi = L.indexOf(sn.label); if (fi >= 0) mo.push({ f: fi, kind: 'close', text: nm + ' closes or merges (' + sn.label + ')', act: sn.act > 0 ? sn.act : 0 }); } });
      prevS = sn;
    });
    crashes.sort(function (a, b) { return b.pct - a.pct; });
    crashes.filter(function (x) { return x.pct >= 0.2; }).slice(0, 3).forEach(function (x) { var fi = L.indexOf(x.label); if (fi >= 0) mo.push({ f: fi, kind: 'crash', text: x.nm + ' share price falls ' + Math.round(x.pct * 100) + '% (' + x.a + ' to ' + x.b + ') in ' + x.label, act: x.act > 0 ? x.act : 0 }); });
    Object.keys(firstTok).forEach(function (nm) { var ft = firstTok[nm], lab = mapLab(ft.round), fi = L.indexOf(lab); mo.push({ f: fi >= 0 ? fi : 0, kind: 'token', text: nm + ' places its first token on ' + ft.hex + (fi >= 0 ? ' (' + lab + ')' : ''), act: ft.id > 0 ? ft.id : 0 }); });
    out.moments = changes.slice(-6).concat(mo).sort(function (a, b) { return a.f - b.f; });
    // --- score range at the end of the game (rough, from the recent pace of each player's value)
    if (!finished && L.length >= 4) {
      var ors = []; for (var f3 = 0; f3 < L.length; f3++) if (/^OR/.test(L[f3])) ors.push(f3);
      var nOR = endInfo && endInfo.bankORs ? Math.max(1, Math.round(endInfo.bankORs)) : 3;
      if (ors.length >= 3) {
        var rows = players.map(function (p, i) {
          var gains = []; for (var z = Math.max(1, ors.length - 4); z < ors.length; z++) { var a1 = S[i][ors[z]], b1 = S[i][ors[z - 1]]; if (a1 != null && b1 != null) gains.push(a1 - b1); }
          var now = S[i][L.length - 1], lo = Math.min.apply(null, gains), hi = Math.max.apply(null, gains), av = gains.reduce(function (a, b) { return a + b; }, 0) / (gains.length || 1);
          return { name: p.name, now: now, low: now + lo * nOR, high: now + hi * nOR, mid: now + av * nOR };
        });
        var rk = function (key) { var o = rows.slice().sort(function (a, b) { return b[key] - a[key]; }); rows.forEach(function (r) { r['r_' + key] = o.indexOf(r) + 1; }); };
        rk('now'); rk('mid'); rk('low'); rk('high');
        out.range = { rows: rows, n: nOR, fromBank: !!(endInfo && endInfo.bankORs) };
      }
    }
    return out;
  }
  function extract(g, raw) {
    var cfg = Object.assign({}, CONFIG.default, CONFIG[raw.title] || {});
    var money = function (v) {
      try {
        var str = s(g.$format_currency(Math.round(Math.abs(v))));
        str = str.replace(/\d{4,}/, function (x) { return x.replace(/\B(?=(\d{3})+(?!\d))/g, ','); });
        return (v < 0 && Math.round(v) !== 0 ? '\u2212' : '') + str;
      } catch (e) { return String(Math.round(v)); }
    };
    var r = g.$round();
    var finished = bool(call(g, 'finished'));
    var roundName = s(call(r, 'name')) || s(r.$class().$name()).split('::').pop();
    var roundLabel = /Stock/i.test(roundName) ? 'SR ' + s(g.$turn())
      : /Operating/i.test(roundName) ? 'OR ' + s(g.$turn()) + '.' + s(call(r, 'round_num')) : roundName + ' ' + s(g.$turn());

    // Players
    var players = g.$players().map(function (p, i) {
      var hist = (call(p, 'history') || []).map(function (h) {
        var rn = s(call(h, 'round_name'));
        var lab = rn === 'SR' ? 'SR ' + s(call(h, 'turn')) : rn === 'OR' ? 'OR ' + s(call(h, 'turn')) + '.' + s(call(h, 'round_no')) : rn + ' ' + s(call(h, 'turn'));
        return { label: lab, value: num(call(h, 'value')) };
      });
      return {
        name: s(p.$name()), idx: i, cash: num(p.$cash()), value: num(call(g, 'player_value', p)),
        certs: num(call(g, 'num_certs', p)), certLimit: num(call(g, 'cert_limit', p) || call(g, 'cert_limit')),
        bankrupt: bool(call(p, 'bankrupt')), hist: hist
      };
    });

    // Some titles have a non-human "player" such as a bank (The Old Prince 1871): keep it out of the standings
    var humanNames = {}, botPlayers = [];
    (raw.players || []).forEach(function (p) { humanNames[p.name] = 1; });
    if (Object.keys(humanNames).length) players = players.filter(function (p) { if (humanNames[p.name]) return true; botPlayers.push(p); return false; });

    // Value history: dedupe consecutive identical labels (keep last), align by index
    var vh = { labels: [], series: players.map(function () { return []; }) };
    var n0 = players.length ? players[0].hist.length : 0;
    for (var k = 0; k < n0; k++) {
      var lab = players[0].hist[k].label;
      var vals = players.map(function (p) { return p.hist[k] ? p.hist[k].value : null; });
      if (vh.labels.length && vh.labels[vh.labels.length - 1] === lab) {
        vh.series.forEach(function (ser, i) { ser[ser.length - 1] = vals[i]; });
      } else { vh.labels.push(lab); vh.series.forEach(function (ser, i) { ser.push(vals[i]); }); }
    }
    // add "now" point if game moved on since last history entry
    var nowVals = players.map(function (p) { return p.value; });
    var lastVals = vh.series.map(function (ser) { return ser[ser.length - 1]; });
    if (!vh.labels.length || nowVals.some(function (v, i) { return v !== lastVals[i]; })) {
      vh.labels.push('Now'); vh.series.forEach(function (ser, i) { ser.push(nowVals[i]); });
    }

    // Corporations
    var corpObjs = g.$corporations().concat(call(g, 'minors') || []);
    var corps = g.$corporations().filter(function (c) { return bool(call(c, 'floated?')) || bool(call(c, 'ipoed')); }).map(function (c) {
      var sp = call(c, 'share_price');
      var owner = call(c, 'owner');
      var oh = [];
      var ohash = call(c, 'operating_history');
      if (ohash) ohash.$to_a().forEach(function (kv) {
        var key = kv[0], info = kv[1];
        var div = call(info, 'dividend');
        var kind = div && rt(div, 'kind') ? s(div.$kind()) : (div ? 'none' : '');
        oh.push({ label: 'OR ' + s(key[0]) + '.' + s(key[1]), t: num(key[0]), r: num(key[1]), revenue: num(call(info, 'revenue')), kind: kind });
      });
      return {
        name: s(c.$name()), fullName: s(call(c, 'full_name')), color: s(call(c, 'color')) || '#888', cash: num(c.$cash()),
        price: sp ? num(call(sp, 'price')) : null, president: owner && rt(owner, 'name') ? s(owner.$name()) : '',
        trains: (call(c, 'trains') || []).map(function (t) { return { name: s(t.$name()), sym: s(call(t, 'sym')), rustsOn: s(call(t, 'rusts_on')), obsoleteOn: s(call(t, 'obsolete_on')) }; }),
        operated: bool(call(c, 'operated?')), closed: bool(call(c, 'closed?')), oh: oh,
        tokensLeft: (call(c, 'tokens') || []).filter(function (t) { return !bool(call(t, 'used')); }).length,
        tokensTotal: (call(c, 'tokens') || []).length,
        loans: (call(c, 'loans') || []).length,
        maxLoans: num(call(g, 'maximum_loans', c)), interestOwed: (call(c, 'loans') || []).length ? num(call(g, 'interest_owed', c)) : 0,
        ipoShares: num(call(c, 'num_ipo_shares')), marketShares: num(call(c, 'num_market_shares')),
        totalShares: num(call(c, 'total_shares')) || 10, sharePct: num(call(c, 'share_percent')) || 10,
        trainLimit: num(call(g.$phase(), 'train_limit', c))
      };
    });
    var corpColor = {};
    corps.forEach(function (c) { corpColor[c.name] = c.color; });

    // Revenue per OR
    var orKeys = {};
    corps.forEach(function (c) { c.oh.forEach(function (o) { orKeys[o.label] = o.t * 100 + o.r; }); });
    var orLabels = Object.keys(orKeys).sort(function (a, b) { return orKeys[a] - orKeys[b]; });
    var revenue = { labels: orLabels, series: corps.map(function (c) {
      var m = {}; c.oh.forEach(function (o) { m[o.label] = o; });
      return { name: c.name, color: c.color,
               values: orLabels.map(function (l) { return m[l] ? m[l].revenue : null; }),
               kinds: orLabels.map(function (l) { return m[l] ? m[l].kind : null; }) };
    }) };

    // Share prices from the log, sampled at the end of each round
    var log = g.$log();
    var known = {}; corpObjs.forEach(function (c) { known[s(c.$name())] = 1; });
    var spLabels = [], spRows = [], cur = {}, lastCorp = null, curLabel = 'Start';
    var moveRx = /^(\S+?)'s share price (?:moves|changes|goes|drops|rises).*?from \D*([\d,.]+) to \D*([\d,.]+)/i;
    var parRx = /^(.+?) (?:pars|floats) (\S+) at \D*([\d,.]+)/i;
    var newRx = /New share price: \D*([\d,.]+)/i;
    function pushSample() { spLabels.push(curLabel); spRows.push(Object.assign({}, cur)); }
    for (var i = 0; i < log.length; i++) {
      var msg = s(log[i].$message());
      var rm = msg.match(/^-- (Stock Round|Operating Round) ([\d.]+)/);
      if (rm) { if (Object.keys(cur).length) pushSample(); curLabel = (rm[1] === 'Stock Round' ? 'SR ' : 'OR ') + rm[2]; continue; }
      var first = msg.split(/[\s']/)[0];
      if (known[first]) lastCorp = first;
      var mm = msg.match(moveRx);
      if (mm && known[mm[1]]) { cur[mm[1]] = num(mm[3].replace(/,/g, '')); lastCorp = mm[1]; continue; }
      var pm = msg.match(parRx);
      if (pm && known[pm[2]]) { cur[pm[2]] = num(pm[3].replace(/,/g, '')); lastCorp = pm[2]; continue; }
      var nm = msg.match(newRx);
      if (nm && lastCorp) cur[lastCorp] = num(nm[1].replace(/,/g, ''));
    }
    corps.forEach(function (c) { if (c.price != null) cur[c.name] = c.price; });
    curLabel = 'Now'; pushSample();
    var spCorps = {}; spRows.forEach(function (row) { Object.keys(row).forEach(function (k) { spCorps[k] = 1; }); });
    var prices = { labels: spLabels, series: Object.keys(spCorps).map(function (name) {
      return { name: name, color: corpColor[name] || '#9a9a9a', values: spRows.map(function (row) { return row[name] == null ? null : row[name]; }) };
    }) };

    // ---- Snapshot-based history (exact, per round) ----
    var snaps = (g.__xxSnaps || []).slice();
    var nowSnap = null;
    try { nowSnap = takeSnapshot(g); nowSnap.label = 'Now'; } catch (e) {}
    if (nowSnap) {
      var lastSnap = snaps[snaps.length - 1];
      var sig = function (x) { return JSON.stringify([x.prices, x.hold, x.cash, x.pos]); };
      if (!lastSnap || sig(lastSnap) !== sig(nowSnap)) snaps.push(nowSnap);
    }
    // collapse repeated labels (keep the last of each)
    var snapsU = [];
    snaps.forEach(function (sn) { if (snapsU.length && snapsU[snapsU.length - 1].label === sn.label) snapsU[snapsU.length - 1] = sn; else snapsU.push(sn); });
    snaps = snapsU;
    // Events along the time axis: phase changes and companies that disappear from the market
    var events = [];
    snaps.forEach(function (sn, k) {
      if (!k) return; var pv = snaps[k - 1];
      if (sn.phase && pv.phase && sn.phase !== pv.phase) events.push({ label: sn.label, text: 'Phase ' + sn.phase + ' begins', kind: 'phase' });
      Object.keys(pv.prices).forEach(function (n) { if (sn.prices[n] == null) events.push({ label: sn.label, text: n + ' closed or merged', kind: 'close' }); });
    });
    if (snaps.length > 1) {
      var allCorpNames = {};
      snaps.forEach(function (sn) { Object.keys(sn.prices).forEach(function (k) { allCorpNames[k] = 1; }); });
      prices = { labels: snaps.map(function (sn) { return sn.label; }), series: Object.keys(allCorpNames).map(function (name) {
        return { name: name, color: corpColor[name] || '#9a9a9a', values: snaps.map(function (sn) { return sn.prices[name] == null ? null : sn.prices[name]; }) };
      }) };
    }
    // Ticker: price now vs previous round and vs the start of the last stock round
    var ticker = prices.series.map(function (ser) {
      var v = ser.values, last = null, prev = null, li = -1;
      for (var a = v.length - 1; a >= 0; a--) if (v[a] != null) { if (last == null) { last = v[a]; li = a; } else if (prev == null) { prev = v[a]; break; } }
      var first = null; for (var b = 0; b < v.length; b++) if (v[b] != null) { first = v[b]; break; }
      var corp = corps.find(function (c) { return c.name === ser.name; });
      return { name: ser.name, color: ser.color, price: last, prev: prev, first: first, spark: v, closed: corp ? corp.closed : li < v.length - 1, into: null, how: '' };
    }).filter(function (t) { return t.price != null; })
      .sort(function (a, b) { return (a.closed ? 1 : 0) - (b.closed ? 1 : 0); }); // closed companies last

    // Portfolio per player over time: value by corp (+ cash)
    var corpOrder = prices.series.map(function (x) { return x.name; });
    corps.forEach(function (c) { if (corpOrder.indexOf(c.name) < 0) corpOrder.push(c.name); });
    // plus any company someone holds shares in, even one without a share price yet
    snaps.forEach(function (sn) { Object.keys(sn.hold).forEach(function (pn) { Object.keys(sn.hold[pn]).forEach(function (cn) { if (corpOrder.indexOf(cn) < 0) corpOrder.push(cn); }); }); });
    var portfolio = players.map(function (p) {
      return { name: p.name, labels: snaps.map(function (sn) { return sn.label; }),
        cash: snaps.map(function (sn) { return sn.cash[p.name] || 0; }),
        priv: snaps.map(function (sn) { return (sn.priv || {})[p.name] || 0; }),
        // whatever the title counts in player value beyond shares, cash and privates (bids, debts, ...)
        other: snaps.map(function (sn) {
          if (!sn.value || sn.value[p.name] == null) return 0;
          var sh = 0, hh = sn.hold[p.name] || {}; Object.keys(hh).forEach(function (k) { sh += hh[k].val; });
          var o = sn.value[p.name] - sh - (sn.cash[p.name] || 0) - ((sn.priv || {})[p.name] || 0);
          return Math.abs(o) < 0.5 ? 0 : o;
        }),
        series: corpOrder.map(function (cn) {
          return { name: cn, color: corpColor[cn] || '#9a9a9a', values: snaps.map(function (sn) { var hh = (sn.hold[p.name] || {})[cn]; return hh ? hh.val : 0; }) };
        }).filter(function (ser) { return ser.values.some(function (v) { return v !== 0; }); }) };
    });
    var curSnap = snaps.length ? snaps[snaps.length - 1] : null;
    var holdings = { corps: corpOrder.filter(function (cn) { return curSnap && players.some(function (p) { return (curSnap.hold[p.name] || {})[cn]; }); }),
                     rows: players.map(function (p) {
        var cells = curSnap ? (curSnap.hold[p.name] || {}) : {}, priv = curSnap ? ((curSnap.priv || {})[p.name] || 0) : 0, sh = 0;
        Object.keys(cells).forEach(function (k) { sh += cells[k].val; });
        var other = p.value - sh - p.cash - priv;
        return { name: p.name, idx: p.idx, cash: p.cash, priv: priv, other: Math.abs(other) < 0.5 ? 0 : other, cells: cells };
      }) };

    // Minors: merge operating history across snapshots (minors can vanish when they close or merge)
    var minorInfo = {};
    snaps.forEach(function (sn) { Object.keys(sn.minors).forEach(function (mn) {
      var m = sn.minors[mn], mi = minorInfo[mn] || (minorInfo[mn] = { name: mn, full: m.full, color: m.color, owners: [], oh: {}, lastSeen: sn.label, closed: m.closed });
      Object.assign(mi.oh, m.oh); mi.lastSeen = sn.label; mi.closed = m.closed; mi.color = m.color || mi.color;
      if (!mi.owners.length || mi.owners[mi.owners.length - 1].owner !== m.owner) mi.owners.push({ owner: m.owner, at: sn.label });
    }); });
    var minorList = Object.keys(minorInfo).map(function (k) { return minorInfo[k]; });
    var nowMinors = {}; (call(g, 'minors') || []).forEach(function (m) { nowMinors[s(m.$name())] = 1; });
    minorList.forEach(function (mi) { if (!nowMinors[mi.name]) mi.closed = true; });
    if (minorList.length) {
      minorList.forEach(function (mi) { Object.keys(mi.oh).forEach(function (l) { orKeys[l] = mi.oh[l].t * 100 + mi.oh[l].r; }); });
      var orLabels2 = Object.keys(orKeys).sort(function (a, b) { return orKeys[a] - orKeys[b]; });
      revenue = { labels: orLabels2, series: corps.map(function (c) {
        var mm = {}; c.oh.forEach(function (o) { mm[o.label] = o; });
        return { name: c.name, color: c.color, values: orLabels2.map(function (l) { return mm[l] ? mm[l].revenue : null; }), kinds: orLabels2.map(function (l) { return mm[l] ? mm[l].kind : null; }) };
      }).concat(minorList.filter(function (mi) { return Object.keys(mi.oh).length; }).map(function (mi) {
        return { name: mi.name, color: mi.color || '#9a9a9a', dashed: true, values: orLabels2.map(function (l) { return mi.oh[l] ? mi.oh[l].revenue : null; }), kinds: orLabels2.map(function (l) { return mi.oh[l] ? mi.oh[l].kind : null; }) };
      })) };
    }

    // Private companies: owner timeline from snapshots
    var compInfo = {};
    snaps.forEach(function (sn) { Object.keys(sn.companies).forEach(function (k) {
      var c = sn.companies[k];
      if (/^Pass \(\d+\)$/.test(c.name)) return; // auction pass tokens in some titles
      var ci = compInfo[k] || (compInfo[k] = { sym: k, name: c.name, value: c.value, revenue: c.revenue, timeline: [], closedAt: null });
      var state = c.closed ? 'closed' : (c.owner || 'bank');
      if (!ci.timeline.length || ci.timeline[ci.timeline.length - 1].owner !== state) ci.timeline.push({ owner: state, at: sn.label });
      if (c.closed && !ci.closedAt) ci.closedAt = sn.label;
      ci.value = c.value; ci.revenue = c.revenue; ci.desc = c.desc || ci.desc || '';
    }); });
    var companyList = Object.keys(compInfo).map(function (k) { return compInfo[k]; });

    // Trains & phases
    var depot = g.$depot();
    var all = depot.$trains();
    var upcoming = depot.$upcoming();
    var discarded = call(depot, 'discarded') || [];
    var upSet = new Set(upcoming), discSet = new Set(discarded);
    var groups = [], bySym = {};
    all.forEach(function (t) {
      var sym = s(call(t, 'sym')) || s(t.$name());
      var gr = bySym[sym];
      if (!gr) {
        var vars = call(t, 'variants');
        gr = bySym[sym] = { sym: sym, names: vars ? vars.$keys().map(s) : [s(t.$name())], price: num(t.$price()),
          rustsOn: s(call(t, 'rusts_on')), obsoleteOn: s(call(t, 'obsolete_on')),
          unlimited: false, total: 0, available: 0, pool: 0, owned: 0, rusted: 0, removed: 0, owners: {} };
        groups.push(gr);
      }
      gr.total++;
      if (bool(call(t, 'unlimited'))) gr.unlimited = true;
      var owner = call(t, 'owner');
      if (bool(call(t, 'rusted'))) gr.rusted++;
      else if (discSet.has(t)) gr.pool++;
      else if (upSet.has(t)) gr.available++;
      else if (owner && owner !== depot && rt(owner, 'name')) { gr.owned++; var on = s(owner.$name()); gr.owners[on] = (gr.owners[on] || 0) + 1; }
      else gr.removed++;
    });
    var nextTrain = upcoming.length ? upcoming[0] : null;
    var phase = g.$phase();
    var phases = (call(phase, 'phases') || []).map(function (p) {
      var on = p['$[]']('on'); on = nil(on) ? [] : (Array.isArray(on) ? on.map(s) : [s(on)]);
      return { name: s(p['$[]']('name')), on: on.filter(Boolean), trainLimit: s(p['$[]']('train_limit')), ors: s(p['$[]']('operating_rounds')) };
    });
    var curPhase = s(phase.$name());
    // purchases until each later train type/phase trigger
    function untilTrigger(names) {
      for (var j = 0; j < upcoming.length; j++) {
        var t = upcoming[j];
        if (names.indexOf(s(t.$name())) >= 0 || names.indexOf(s(call(t, 'sym'))) >= 0) return j + 1; // the triggering purchase counts as 1
      }
      return -1;
    }
    var curIdx = phases.findIndex(function (p) { return p.name === curPhase; });
    phases.forEach(function (p, j) {
      p.status = j < curIdx ? 'past' : j === curIdx ? 'current' : 'future';
      p.inPurchases = p.status === 'future' && p.on.length ? untilTrigger(p.on) : null;
    });
    groups.forEach(function (gr) { gr.rustIn = gr.rustsOn ? untilTrigger([gr.rustsOn]) : -1; gr.obsIn = gr.obsoleteOn ? untilTrigger([gr.obsoleteOn]) : -1; });
    // trains at risk: owned trains whose rust trigger is still ahead
    var risk = [];
    corps.forEach(function (c) {
      var rustIn = c.trains.map(function (t) { return t.rustsOn ? untilTrigger([t.rustsOn]) : -1; });
      var safe = rustIn.filter(function (x) { return x < 0; }).length;
      var soonest = rustIn.filter(function (x) { return x >= 0; }).sort(function (a, b) { return a - b; })[0];
      c.rustIn = rustIn;
      // obsolete is not rust: the train is on its way out under the title's own rules
      c.obsIn = c.trains.map(function (t) { return t.obsoleteOn ? untilTrigger([t.obsoleteOn]) : -1; });
      c.trainless = c.trains.length === 0;
      c.needsTrains = c.trainless && c.oh.length === 0; // new company that has not operated yet
      c.allRustAt = (safe === 0 && c.trains.length) ? Math.max.apply(null, rustIn) : null;
      if (soonest != null) risk.push({ corp: c.name, inPurchases: soonest, count: rustIn.filter(function (x) { return x === soonest; }).length, ofTotal: c.trains.length });
    });

    // ---------- Live-play helpers ----------------------------------------------------------
    var corpObj = {}; g.$corporations().forEach(function (c) { corpObj[s(c.$name())] = c; });
    var playerCash = {}; players.forEach(function (p) { playerCash[p.name] = p.cash; });
    var rShort = s(r.$class().$short_name());
    var isOR = rShort === 'OR', isSR = rShort === 'SR';

    // Cheapest train that can be bought from the bank right now (new or bank pool), and how each company could pay
    var cheapest = null;
    try {
      var mt = call(depot, 'min_depot_train'), mp = call(depot, 'min_depot_price');
      if (mt && mp != null) cheapest = { name: s(mt.$name()), price: num(mp), pool: discSet.has(mt) };
    } catch (e) {}
    if (!cheapest && nextTrain) cheapest = { name: s(nextTrain.$name()), price: num(nextTrain.$price()), pool: false };
    corps.forEach(function (c) {
      if (!cheapest) { c.buy = null; return; }
      var pc = playerCash[c.president] || 0, gap = cheapest.price - c.cash;
      var full = c.trainLimit && c.trains.length >= c.trainLimit;
      c.buy = gap <= 0 ? { kind: full ? 'full' : 'treasury' }
        : c.trainless ? (pc >= gap ? { kind: 'emergency', add: gap } : { kind: 'stuck', add: gap, shortAfter: gap - pc })
        : { kind: 'short', add: gap };
      c.buy.loanRoom = c.maxLoans > c.loans && (c.loans > 0 || rt(g, 'interest_owed')) ? c.maxLoans - c.loans : 0;
    });

    // Who acts, and the order of this round
    var acting = (call(g, 'active_players') || []).map(nameOf).filter(Boolean);
    var curEnt = nameOf(call(g, 'current_entity'));
    var eIdx = num(call(r, 'entity_index'));
    var order = (call(r, 'entities') || []).map(function (e, i) {
      var nm = nameOf(e);
      return { name: nm, color: corpColor[nm] || null, owner: corpObj[nm] ? nameOf(call(e, 'owner')) : '', state: finished ? 'done' : i < eIdx ? 'done' : i === eIdx ? 'current' : 'todo' };
    });
    var orsInSet = num(call(g, 'operating_rounds')) || num(call(phase, 'operating_rounds'));

    // Price preview: where the share price goes if the company pays out its last revenue, or withholds
    var divStep = findDivStep(r) || g.__xxDivStep || null;
    function previewSP(c, revenue) {
      try {
        var hsh = divStep.$share_price_change(c, revenue);
        if (nil(hsh)) return null;
        var dir = hsh.$fetch('share_direction', Opal.nil), times = hsh.$fetch('share_times', Opal.nil);
        var sp;
        if (nil(dir)) sp = call(c, 'share_price');
        else {
          var dd = Array.isArray(dir) ? dir : [dir], tm = Array.isArray(times) ? times : [times], dirs = [];
          dd.forEach(function (x, i) { for (var k = 0; k < (num(tm[i]) || 1); k++) dirs.push(x); });
          sp = g.$stock_market().$find_share_price(c, dirs);
        }
        if (nil(sp) || !sp) return null;
        var co = call(sp, 'coordinates');
        return { price: num(sp.$price()), pos: co && co.length ? [num(co[0]), num(co[1])] : null };
      } catch (e) { return null; }
    }
    function previewPrice(c, revenue) { var x = previewSP(c, revenue); return x ? x.price : null; }
    var market = corps.filter(function (c) { return !c.closed && c.price != null; }).map(function (c) {
      var co = corpObj[c.name];
      var ohs = c.oh.slice().sort(function (a, b) { return (a.t * 100 + a.r) - (b.t * 100 + b.r); });
      var last = ohs[ohs.length - 1], lastRun = null;
      for (var q = ohs.length - 1; q >= 0; q--) if (ohs[q].revenue > 0) { lastRun = ohs[q]; break; }
      var dps = last ? (last.kind === 'payout' ? last.revenue / c.totalShares : last.kind === 'half' ? last.revenue / 2 / c.totalShares : 0) : null;
      // presidency: how close is the nearest challenger
      var holders = players.map(function (p) { var hh = curSnap ? (curSnap.hold[p.name] || {})[c.name] : null; return { name: p.name, pct: hh ? hh.pct : 0, pres: hh ? hh.pres : false }; });
      var pres = holders.filter(function (x) { return x.pres; })[0] || null;
      var chal = holders.filter(function (x) { return !x.pres && x.pct > 0; }).sort(function (a, b) { return b.pct - a.pct; })[0] || null;
      var need = pres && chal ? Math.floor((pres.pct - chal.pct) / c.sharePct) + 1 : null;
      var done = order.filter(function (o) { return o.name === c.name; })[0];
      return { name: c.name, color: c.color, price: c.price, ipo: c.ipoShares, pool: c.marketShares, sharePct: c.sharePct,
        dps: dps, yield: dps != null && c.price ? dps / c.price * 100 : null, lastKind: last ? last.kind : null,
        estRevenue: lastRun ? lastRun.revenue : null,
        ifPay: divStep && lastRun && co ? previewPrice(co, lastRun.revenue) : null,
        ifHold: divStep && co ? previewPrice(co, 0) : null,
        ifPayPos: divStep && lastRun && co ? (previewSP(co, lastRun.revenue) || {}).pos || null : null,
        ifHoldPos: divStep && co ? (previewSP(co, 0) || {}).pos || null : null,
        orState: isOR && done ? done.state : null,
        pres: pres, chal: chal, need: need, canTake: need != null && need <= c.ipoShares + c.marketShares };
    });

    // Stock market grid: the engine's own cells, plus where each company stands (now, and at the end of each round)
    var grid = null, gridHist = [];
    try {
      var mk = g.$stock_market().$market(), gcells = [], gzones = {}, gcols = 0;
      mk.forEach(function (row) {
        var rr = [];
        row.forEach(function (c) {
          if (nil(c)) { rr.push(null); return; }
          var tys = (call(c, 'types') || []).map(s).filter(Boolean);
          tys.forEach(function (ty) { gzones[ty] = 1; });
          rr.push({ p: num(c.$price()), t: tys, c: (call(c, 'corporations') || []).map(nameOf) });
        });
        gcols = Math.max(gcols, rr.length); gcells.push(rr);
      });
      var ghost = null;
      if (isOR && !finished && market.length) {
        var gm = market.filter(function (k) { return k.name === curEnt; })[0];
        if (gm && (gm.ifPayPos || gm.ifHoldPos)) ghost = { corp: gm.name, color: gm.color, pay: gm.ifPayPos, hold: gm.ifHoldPos, rev: gm.estRevenue };
      }
      grid = { cells: gcells, cols: gcols, zones: Object.keys(gzones), ghost: ghost };
      gridHist = snaps.map(function (sn) { return { label: sn.label, pos: sn.pos || {} }; });
    } catch (e) { grid = null; }

    // Bank & depot: trains still to come (in order), trains in the bank pool, shares in the IPO and the market
    var runs = function (arr) {
      var out = [];
      arr.forEach(function (t) {
        var nm = s(t.$name()), pr = num(t.$price()), lastR = out[out.length - 1];
        if (lastR && lastR.name === nm && lastR.price === pr) lastR.n++; else out.push({ name: nm, price: pr, n: 1 });
      });
      return out;
    };
    var bankInfo = { cash: num(g.$bank().$cash()), up: runs(upcoming), pool: runs(discarded),
      ipo: corps.filter(function (c) { return !c.closed && c.ipoShares > 0; }).map(function (c) { return { name: c.name, color: c.color, n: c.ipoShares, pct: c.sharePct }; }),
      mpool: corps.filter(function (c) { return !c.closed && c.marketShares > 0; }).map(function (c) { return { name: c.name, color: c.color, n: c.marketShares, pct: c.sharePct }; }) };

    // Tile manifest: how many of each tile are left in the supply
    var tileInfo = null;
    try {
      var allT = call(g, 'all_tiles') || [], remT = call(g, 'tiles') || [];
      if (allT.length || remT.length) {
        var tt = {};
        var addT = function (arr, key) { arr.forEach(function (x) {
          var col = s(x.$color()), nm = s(x.$name()), kk = col + ':' + nm, o = tt[kk] || (tt[kk] = { color: col, name: nm, total: 0, left: 0, unl: false });
          o[key]++; if (bool(call(x, 'unlimited'))) o.unl = true;
        }); };
        addT(allT, 'total'); addT(remT, 'left');
        var phCols = (call(phase, 'tiles') || []).map(s);
        var byCol = {};
        Object.keys(tt).forEach(function (kk) { var o = tt[kk]; if (o.total < o.left) o.total = o.left; (byCol[o.color] = byCol[o.color] || []).push(o); });
        var colOrder = ['yellow', 'green', 'brown', 'gray', 'grey', 'blue', 'red', 'purple'];
        var colKeys = Object.keys(byCol).sort(function (a, b) { var ia = colOrder.indexOf(a), ib = colOrder.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (a < b ? -1 : 1); });
        tileInfo = { phaseColors: phCols, groups: colKeys.map(function (ck) {
          var items = byCol[ck].sort(function (a, b) { var na = parseInt(a.name, 10), nb = parseInt(b.name, 10); return (isNaN(na) ? 1e9 : na) - (isNaN(nb) ? 1e9 : nb) || (a.name < b.name ? -1 : 1); });
          return { color: ck, available: !phCols.length || phCols.indexOf(ck) >= 0, items: items, left: items.reduce(function (a, o) { return a + (o.unl ? 0 : o.left); }, 0) };
        }) };
      }
    } catch (e) { tileInfo = null; }

    // Since your last move: everything logged after the last action by the player chosen under "I am"
    var recap = null, lastMineId = 0;
    try {
      var meN = myName((raw.players || []).map(function (p) { return p.name; })), meRaw = meN ? (raw.players || []).filter(function (p) { return p.name === meN; })[0] : null;
      if (meRaw) {
        var lastMine = 0;
        for (var ai = raw.actions.length - 1; ai >= 0; ai--) if (raw.actions[ai].user === meRaw.id) { lastMine = raw.actions[ai].id; break; }
        lastMineId = lastMine;
        if (lastMine) {
          var rl = [];
          for (var li = log.length - 1; li >= 0 && rl.length < 120; li--) {
            var aid = num(call(log[li], 'action_id')); if (aid <= lastMine) break;
            var lm = s(call(log[li], 'message')); if (lm) rl.push({ msg: lm, head: /^-- /.test(lm) });
          }
          recap = { since: lastMine, lines: rl, total: rl.length };
        }
      }
    } catch (e) { recap = null; }

    // Game log: the whole log split into rounds at the engine's own "-- ... Round ... --" headings
    var gameLog = null;
    try {
      var glR = [{ label: 'Start', lines: [] }], glMe = -1, plName = {}, actBy = {};
      (raw.players || []).forEach(function (pp) { plName[pp.id] = pp.name; });
      var plNames = (raw.players || []).map(function (pp) { return pp.name; }).filter(Boolean), curActor = '';
      for (var gi = 0; gi < log.length; gi++) {
        var gmsg = s(call(log[gi], 'message')); if (!gmsg) continue;
        var gid = num(call(log[gi], 'action_id'));
        if (/^-- /.test(gmsg) && /(Round|Auction|Draft)/i.test(gmsg) && !/^-- Phase/i.test(gmsg)) { glR.push({ label: gmsg.replace(/^-+\s*/, '').replace(/[\s-]+$/, ''), lines: [] }); curActor = ''; continue; }
        // who the line belongs to: a line that starts with a player's name, else the player whose turn the company is in
        var lineActor = '';
        for (var pi = 0; pi < plNames.length; pi++) if (gmsg.indexOf(plNames[pi] + ' ') === 0) { lineActor = plNames[pi]; break; }
        if (lineActor) curActor = lineActor; else lineActor = /^-- /.test(gmsg) ? '' : curActor;
        glR[glR.length - 1].lines.push({ id: gid, msg: gmsg, head: /^-- /.test(gmsg), u: lineActor });
        if (lastMineId && gid > 0 && gid <= lastMineId) glMe = glR.length - 1;
      }
      if (!glR[0].lines.length && glR.length > 1) glR.shift(), glMe = glMe > 0 ? glMe - 1 : glMe;
      var glRun = 0, glCuts = glR.map(function (r3) { r3.lines.forEach(function (l3) { if (l3.id > glRun) glRun = l3.id; }); return glRun; });
      gameLog = { rounds: glR, meRound: glMe, meId: lastMineId, cuts: glCuts };
    } catch (e) { gameLog = null; }

    // Routes & revenue: read from the engine's own "runs a <train> train for <revenue>: <stops>" lines, per round
    // The board as the engine lays it out (same grid maths as 18xx.games), for the route sketch
    var hexMap = null;
    try {
      var hxs = g.$hexes(), hl = [], lay = 'flat';
      for (var hi = 0; hi < hxs.length; hi++) {
        var hx = hxs[hi], tl = hx.$tile(), cities = 0, towns = 0, offb = 0, tcolor = 'white', tname = '';
        try { cities = tl.$cities().length; towns = tl.$towns().length; offb = tl.$offboards().length; tcolor = s(tl.$color()); tname = s(tl.$name()); } catch (e5) {}
        lay = s(hx.$layout());
        hl.push({ id: s(hx.$id()), x: num(hx.$x()), y: num(hx.$y()), c: tcolor, t: tname, k: hexTokens(tl), city: cities, town: towns, off: offb, loc: s(call(hx, 'location_name') || '') });
      }
      if (hl.length) hexMap = { layout: lay, hexes: hl };
    } catch (e) { hexMap = null; }
    // Game info for the bottom card
    var info = null;
    try {
      var cfg0 = raw.settings || {}, opt = cfg0.optional_rules;
      info = { stage: '', rules: Array.isArray(opt) ? opt.map(String) : (opt ? String(opt).split(',') : []), players: (raw.players || []).length, async: !!cfg0.is_async, auto: cfg0.auto_routing ? String(cfg0.auto_routing) : '', pin: cfg0.pin ? String(cfg0.pin) : '' };
      try { info.stage = s(g.$class().$const_get('DEV_STAGE')); } catch (e6) {}
    } catch (e) { info = null; }
    // Replay frames: one per point on the value chart, with the board (tiles and tokens) at that moment
    var replay = null;
    try { var byLab = {}; snaps.forEach(function (sn2) { byLab[sn2.label] = sn2; }); replay = { labels: vh.labels.slice(), hx: vh.labels.map(function (l2) { return byLab[l2] ? byLab[l2].hx : null; }) }; if (!replay.hx.some(function (z) { return z; })) replay = null; } catch (e) { replay = null; }
    var routeTable = [];
    try {
      if (gameLog) gameLog.rounds.forEach(function (rd3, ri3) {
        var byCorp = {}, order = [];
        var get = function (n) { if (!byCorp[n]) { byCorp[n] = { corp: n, trains: [], total: null, kind: '', extra: [] }; order.push(n); } return byCorp[n]; };
        rd3.lines.forEach(function (ln) {
          var mm = /^(.+?) runs an? (.+?) train for (.+?): (.*)$/.exec(ln.msg);
          if (mm) { var cr = get(mm[1]); if (!cr.act && ln.id > 0) cr.act = ln.id; cr.trains.push({ train: mm[2], rev: mm[3], stops: mm[4] }); return; }
          mm = /^(.+?) runs for (.+?) and pays (.+)$/.exec(ln.msg);
          if (mm) { var c3 = get(mm[1]); c3.total = mm[2]; c3.kind = 'pays ' + mm[3]; return; }
          mm = /^(.+?) pays out (.+?) = (.+?) per share/.exec(ln.msg);
          if (mm) { var c4 = get(mm[1]); c4.total = mm[2]; c4.kind = 'pays out ' + mm[3] + ' per share'; return; }
          mm = /^(.+?) withholds (.+)$/.exec(ln.msg);
          if (mm) { var c5 = get(mm[1]); if (!c5.total) { c5.total = mm[2]; c5.kind = 'withholds'; } else c5.kind += ' · keeps ' + mm[2]; return; }
          mm = /^(.+?) does not run$/.exec(ln.msg);
          if (mm) { get(mm[1]).kind = 'does not run'; return; }
          mm = /^(.+?) receives (.+?) additional revenue/.exec(ln.msg);
          if (mm && byCorp[mm[1]]) byCorp[mm[1]].extra.push(mm[2]);
        });
        if (order.length) routeTable.push({ round: ri3, label: rd3.label, corps: order.map(function (n) { return byCorp[n]; }) });
      });
      // compare with the same company's previous run: same route again? more or less revenue?
      var lastRun = {}, numOf = function (t) { var m2 = String(t || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m2 ? parseFloat(m2[0]) : null; };
      routeTable.forEach(function (R2) { R2.corps.forEach(function (c) {
        c.totalN = numOf(c.total);
        if (!c.trains.length) return;
        var pv = lastRun[c.corp];
        if (pv) {
          c.delta = c.totalN != null && pv.totalN != null ? c.totalN - pv.totalN : null;
          var keys = {}; pv.trains.forEach(function (t) { keys[t.train + '|' + t.stops] = 1; });
          c.trains.forEach(function (t) { t.same = !!keys[t.train + '|' + t.stops]; });
        }
        lastRun[c.corp] = c;
      }); });
    } catch (e) { routeTable = []; }

    // Which company a closed one went into: read from the engine's own log lines
    try {
      if (gameLog) {
        var tkNames = ticker.map(function (t) { return t.name; });
        var tkBy = {}; ticker.forEach(function (t) { tkBy[t.name] = t; });
        var pickName = function (txt) { for (var q = 0; q < tkNames.length; q++) if (txt === tkNames[q]) return tkNames[q]; return null; };
        gameLog.rounds.forEach(function (rd2) { rd2.lines.forEach(function (ln) {
          var mm = /^(.+?) \(non-survivor\) will merge into (.+?) \(survivor\)/.exec(ln.msg);
          if (mm && pickName(mm[1]) && pickName(mm[2])) { tkBy[mm[1]].into = mm[2]; tkBy[mm[1]].how = 'merged into'; return; }
          mm = /^(.+?) merges with (.+?) at share price/.exec(ln.msg);
          if (mm && pickName(mm[1]) && pickName(mm[2])) { tkBy[mm[2]].into = mm[1]; tkBy[mm[2]].how = 'merged into'; return; }
          mm = /^(.+?) (?:acquires|absorbs|takes over) (.+?)(?: receiving|,| for |$)/.exec(ln.msg);
          if (mm && pickName(mm[1]) && pickName(mm[2]) && tkBy[mm[2]].closed) { tkBy[mm[2]].into = mm[1]; tkBy[mm[2]].how = 'acquired by'; }
        }); });
      }
    } catch (e) {}

    // Train rush: could the companies still to act buy enough trains to trigger the next phase?
    var rush = null;
    var nPh = phases.filter(function (p) { return p.status === 'future' && p.inPurchases > 0; })[0];
    if (nPh && !finished) {
      var costs = upcoming.slice(0, nPh.inPurchases).map(function (t) { return num(t.$price()); });
      var buyers = isOR ? order.filter(function (o) { return o.state !== 'done'; }).map(function (o) { return o.name; }) : corps.map(function (c) { return c.name; });
      var left = costs.slice(), bought = 0, cashTotal = 0, who = [];
      buyers.forEach(function (bn) {
        var c = corps.filter(function (x) { return x.name === bn; })[0]; if (!c) return;
        var cash = c.cash, room = c.trainLimit ? c.trainLimit - c.trains.length : 1, n = 0;
        cashTotal += cash;
        while (room > 0 && left.length && cash >= left[0]) { cash -= left.shift(); room--; bought++; n++; }
        if (n) who.push(bn + (n > 1 ? '×' + n : ''));
      });
      var rustHit = groups.filter(function (gr) { return gr.owned && gr.rustIn === nPh.inPurchases; }).map(function (gr) { return gr.sym; });
      var obsHit = groups.filter(function (gr) { return gr.owned && gr.obsIn === nPh.inPurchases; }).map(function (gr) { return gr.sym; });
      rush = { phase: nPh.name, need: nPh.inPurchases, cost: costs.reduce(function (a, b) { return a + b; }, 0), cash: cashTotal, bought: bought, possible: bought >= nPh.inPurchases, who: who, rust: rustHit, obsolete: obsHit, scope: isOR ? 'companies still to operate this OR' : 'all companies' };
    }

    // Game end: the title's own end conditions, plus a bank estimate from the recent pace
    var endInfo = { conditions: [], triggered: null, bankORs: null, bankDrop: null };
    try {
      var gec = g.$class().$const_get('GAME_END_CHECK');
      var reasonTxt = {}, evTxt = {};
      try { g.$class().$const_get('GAME_END_REASONS_TEXT').$to_a().forEach(function (kv) { reasonTxt[s(kv[0])] = s(kv[1]); }); } catch (e1) {}
      try { g.$class().$const_get('EVENTS_TEXT').$to_a().forEach(function (kv) { evTxt[s(kv[0])] = (kv[1] || []).map(s); }); } catch (e2) {}
      var upEv = upcoming.map(function (t3) { try { return (t3.$events() || []).map(function (h3) { return s(h3['$[]']('type')); }); } catch (e3) { return []; } });
      if (!nil(gec)) gec.$to_a().forEach(function (kv) {
        var key = s(kv[0]), cnd = { key: key, reason: key.replace(/_/g, ' '), text: reasonTxt[key] || '', timing: s(kv[1]).replace(/_/g, ' ').replace(/\bor\b/g, 'OR'), via: null };
        for (var ui = 0; ui < upcoming.length && !cnd.via; ui++) upEv[ui].forEach(function (ty) { if (!cnd.via && ty.indexOf(key + '_') === 0) cnd.via = { train: s(upcoming[ui].$name()), away: ui + 1, ev: (evTxt[ty] || [])[1] || '' }; });
        if (!cnd.via && key === 'final_train' && upcoming.length) cnd.via = { train: s(upcoming[upcoming.length - 1].$name()), away: upcoming.length, ev: '' };
        endInfo.conditions.push(cnd);
      });
      var trig = call(g, 'game_end_check');
      if (trig && trig.length) endInfo.triggered = { reason: s(trig[0]).replace(/_/g, ' '), timing: s(trig[1]).replace(/_/g, ' ').replace(/\bor\b/g, 'OR') };
    } catch (e) {}
    if (info) info.ends = endInfo.conditions.map(function (c4) { return (c4.text || c4.reason) + ' (' + c4.timing + ')'; });
    var orSnaps = snaps.filter(function (sn) { return /^OR /.test(sn.label) && sn.bank != null; });
    if (orSnaps.length >= 2 && endInfo.conditions.some(function (c) { return c.reason === 'bank'; })) {
      var k0 = Math.max(0, orSnaps.length - 3), span = orSnaps.length - 1 - k0;
      var drop = (orSnaps[k0].bank - orSnaps[orSnaps.length - 1].bank) / span;
      var bankNow = num(g.$bank().$cash());
      if (drop > 0 && bankNow > 0) { endInfo.bankDrop = drop; endInfo.bankORs = bankNow / drop; }
    }

    // Certificate limit: room per player is in the standings; note when the limit last changed
    var certNote = null;
    for (var ci2 = snaps.length - 1; ci2 > 0; ci2--) {
      if (snaps[ci2].certLimit && snaps[ci2 - 1].certLimit && snaps[ci2].certLimit !== snaps[ci2 - 1].certLimit) { certNote = { from: snaps[ci2 - 1].certLimit, to: snaps[ci2].certLimit, at: snaps[ci2].label }; break; }
    }

    // Loans and interest (1817 family)
    var loanInfo = null;
    if (corps.some(function (c) { return c.loans > 0; }) || rt(g, 'interest_owed')) {
      loanInfo = { rate: num(call(g, 'interest_rate')), future: rt(g, 'future_interest_rate') ? num(call(g, 'future_interest_rate')) : null, value: num(call(g, 'loan_value')),
        total: corps.reduce(function (a, c) { return a + c.loans; }, 0), owed: corps.reduce(function (a, c) { return a + c.interestOwed; }, 0) };
    }

    // Data cards (0.15): track spending, money sources, valuation, train purchases, key moments, score range
    var analysis = null;
    try { analysis = analyse(gameLog, routeTable, vh, players, ticker, snaps, endInfo, finished); } catch (eAn) { analysis = null; }

    // What just happened: the latest log lines
    var feed = [];
    for (var fi = log.length - 1; fi >= 0 && feed.length < 14; fi--) {
      var fm = s(call(log[fi], 'message')); if (!fm) continue;
      feed.push({ id: num(call(log[fi], 'action_id')), msg: fm, head: /^-- /.test(fm) });
    }

    var live = { isOR: isOR, isSR: isSR, acting: acting, current: curEnt, order: order, orNum: isOR ? num(call(r, 'round_num')) : null, orsInSet: orsInSet,
      priority: nameOf(call(g, 'priority_deal_player')), market: market, rush: rush, end: endInfo, hasPreview: !!divStep };

    var notes = cfg.notes ? cfg.notes(g) : [];
    botPlayers.forEach(function (bp) {
      var hh = curSnap && curSnap.hold[bp.name] ? curSnap.hold[bp.name] : {}, parts = Object.keys(hh).map(function (cn) { return cn + ' ' + hh[cn].pct + '%'; });
      notes.push(bp.name + ' is not a player and is left out of the standings (cash ' + money(bp.cash) + (parts.length ? ', holds ' + parts.join(', ') : '') + ').');
    });
    return {
      id: raw.id, title: raw.title, status: raw.status, finished: finished, description: raw.description,
      roundLabel: roundLabel, phase: curPhase, trainLimit: s(call(phase, 'train_limit', corpObjs[0])) || '',
      bank: num(g.$bank().$cash()), money: money, actions: raw.actions.length,
      players: players, valueHistory: vh, corps: corps, revenue: revenue, prices: prices,
      trainGroups: groups, phases: phases, risk: risk,
      ticker: ticker, portfolio: portfolio, holdings: holdings, minors: minorList, companies: companyList, snapErr: SNAP && SNAP.err,
      nextTrain: nextTrain ? { name: s(nextTrain.$name()), sym: s(call(nextTrain, 'sym')), price: num(nextTrain.$price()) } : null,
      upcomingCount: upcoming.length, notes: notes, updated: new Date(), live: live, feed: feed, certNote: certNote, loanInfo: loanInfo, cheapest: cheapest,
      events: events, info: info, replay: replay, grid: grid, gridHist: gridHist, bank2: bankInfo, tiles: tileInfo, recap: recap, gameLog: gameLog, routes: routeTable, analysis: analysis, hexMap: hexMap, pin: (raw.settings && raw.settings.pin) ? String(raw.settings.pin) : ''
    };
  }

  // ---------- Rendering -------------------------------------------------------------------
  var DARKVARS = '--surface-0:#121211;--surface-1:#1a1a19;--text-primary:#f0efec;--text-secondary:#c3c2b7;--text-muted:#8f8e86;--grid:#2c2c2a;--border:#33332f;--good:#4cc36b;--warn:#e0a020;--crit:#ef6b6b;--accent:#3987e5;color-scheme:dark';
  var CSS = [
    ':root{--surface-0:#e7e6dc;--surface-1:#f1f0e7;--text-primary:#0b0b0b;--text-secondary:#4d4d46;--text-muted:#74746b;--grid:#d9d8cc;--border:#cdccbf;--good:#1a7f37;--warn:#b26b00;--crit:#c62828;--accent:#2a78d6;color-scheme:light}',
    '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){' + DARKVARS + '}}',
    ':root[data-theme="dark"]{' + DARKVARS + '}',
    '*{box-sizing:border-box}body{margin:0;background:var(--surface-0);color:var(--text-primary);font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '.hr3{display:flex;align-items:center;gap:8px;margin-top:6px;padding:4px 8px;border-radius:8px;font-size:12px;color:var(--text-secondary);border:1px solid var(--grid)}.hr3 input{flex:1;min-width:80px}.hr3.on{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--text)}.hr3 b{white-space:nowrap}.tt-note{color:var(--text-muted)}',
    'header{position:sticky;top:0;z-index:5;background:var(--surface-1);border-bottom:1px solid var(--border);padding:7px 14px}',
    '.hr1{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center}.hr1 .grow{flex:1}.hr2{color:var(--text-muted);font-size:11.5px;margin-top:3px}header.compact .hr2{display:none}',
    'header h1{font-size:15px;margin:0;font-weight:650}header .kv{color:var(--text-secondary)}header .kv b{color:var(--text-primary);font-weight:600}',
    '.tb{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.ib{font:inherit;font-size:14px;line-height:1;padding:4px 8px;border:1px solid var(--border);background:var(--surface-0);color:var(--text-primary);border-radius:6px;cursor:pointer;list-style:none}.ib:hover{border-color:var(--accent)}summary.ib::-webkit-details-marker{display:none}',
    '.menu{position:relative}.mp2{position:absolute;right:0;top:calc(100% + 6px);z-index:10;min-width:240px;background:var(--surface-1);border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.3);padding:8px;display:flex;flex-direction:column;gap:8px;font-size:12px}',
    '.mp2 button{font:inherit;font-size:12px;padding:4px 9px;border:1px solid var(--border);background:var(--surface-0);color:var(--text-primary);border-radius:6px;cursor:pointer}.mp2 input{font:inherit;font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:6px;background:var(--surface-0);color:var(--text-primary)}',
    '.upd{color:var(--warn);font-weight:600}@media (max-width:1000px){.kv.opt{display:none}}',
    'main{padding:10px 12px;display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(min(440px,100%),1fr));align-items:stretch}.card.collapsed{align-self:start}',
    '.card{background:var(--surface-1);border:1px solid var(--border);border-radius:10px;padding:12px 14px;min-width:0}.card.wide{grid-column:1/-1}',
    '.tw{overflow-x:auto}.card h2{font-size:13px;margin:0 0 2px;font-weight:650}.card .sub{color:var(--text-muted);font-size:12px;margin:0 0 8px}',
    'table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{padding:4px 8px;text-align:right;border-bottom:1px solid var(--grid);white-space:nowrap}th{font-weight:600;color:var(--text-secondary);font-size:12px}th:first-child,td:first-child{text-align:left}',
    '.sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px;box-shadow:0 0 0 1px rgba(0,0,0,.25)}',
    '.legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:0 0 6px;color:var(--text-secondary);font-size:12px}.legend span{cursor:default}',
    '.chart{position:relative}.chart svg{display:block;width:100%;height:auto;overflow:visible}',
    '.tip{position:absolute;pointer-events:none;background:var(--surface-1);border:1px solid var(--border);border-radius:8px;padding:6px 9px;font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.18);display:none;z-index:3;min-width:130px}',
    '.tip .t{font-weight:650;margin-bottom:3px}.tip .r{display:flex;justify-content:space-between;gap:12px}.tip .r span:last-child{font-variant-numeric:tabular-nums}',
    '.bar{height:8px;border-radius:4px;background:var(--grid);overflow:hidden;display:flex;gap:2px}.bar i{display:block;height:100%}',
    '.pill{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600;border:1px solid var(--border);color:var(--text-secondary)}',
    '.pill.cur{background:var(--accent);border-color:var(--accent);color:#fff}.pill.past{opacity:.5}',
    '.st-good{color:var(--good)}.st-warn{color:var(--warn)}.st-crit{color:var(--crit)}',
    '.phases{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 10px}.phase{border:1px solid var(--border);border-radius:8px;padding:5px 9px;min-width:72px}',
    '.phase.current{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}.phase.past{opacity:.45}.phase .n{font-weight:700}.phase .d{font-size:11px;color:var(--text-muted)}',
    '.tiles{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:6px}.tile{flex:1 1 120px;border:1px solid var(--grid);border-radius:8px;padding:8px 10px}.tile .l{font-size:11px;color:var(--text-muted)}.tile .v{font-size:20px;font-weight:650;font-variant-numeric:tabular-nums}',
    '.notes{color:var(--text-muted);font-size:12px;margin:6px 0 0;padding-left:16px}',
    '.err{color:var(--crit);padding:20px}',
    '#xx-paused{position:fixed;left:0;right:0;bottom:0;z-index:20;background:#c62828;color:#fff;padding:10px 16px;font-weight:600;font-size:14px}',
    '.nowline{margin:0 0 8px;font-size:14px}.pill.yours{background:var(--good);border-color:var(--good);color:#fff}.mename{background:color-mix(in srgb,var(--accent) 22%,transparent);border-radius:4px;padding:0 3px}',
    '.chips{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 10px}.chip{border:1px solid var(--border);border-radius:999px;padding:1px 9px;font-size:12px}.chip.done{opacity:.5}.chip.current{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);font-weight:650}',
    '.tile .d2{font-size:12px;color:var(--text-secondary);margin-top:2px}.sm{font-size:13px;color:var(--text-muted);font-weight:400}.tile .v.sm2{font-size:15px;color:var(--text-muted)}',
    '.feed{list-style:none;margin:0;padding:0;max-height:260px;overflow:auto}.feed li{padding:3px 0 3px 14px;border-bottom:1px solid var(--grid);position:relative;font-size:12.5px}.feed li.head{color:var(--text-muted);font-size:11.5px}',
    '.feed li.new{font-weight:600}.feed li.new:before,.newdot{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--accent)}.feed li.new:before{position:absolute;left:1px;top:8px}',
    'button.lnk{font:inherit;font-size:12px;border:0;background:none;color:var(--accent);cursor:pointer;padding:0;text-decoration:underline}',
    'tr.merow{background:color-mix(in srgb,var(--accent) 12%,transparent)}tr.merow td:first-child{box-shadow:inset 3px 0 0 var(--accent)}',
    '.mesel{font-size:12px}.mesel select{font:inherit;font-size:12px;padding:2px 4px;border:1px solid var(--border);border-radius:6px;background:var(--surface-0);color:var(--text-primary)}',
    '@keyframes fl{0%{background:color-mix(in srgb,var(--accent) 55%,transparent)}100%{background:transparent}}.fl{animation:fl 3s ease-out;border-radius:4px}@media (prefers-reduced-motion:reduce){.fl{animation:none;outline:2px solid var(--accent)}}',
    'h2.sh{display:flex;align-items:center;gap:6px;margin:-4px -6px 6px !important;padding:2px 4px;border-radius:6px}h2.sh .st{flex:1}',
    'h2.sh button{font:inherit;font-size:11px;line-height:1;padding:3px 5px;border:1px solid transparent;border-radius:5px;background:none;color:var(--text-muted);cursor:pointer}h2.sh button:hover{border-color:var(--border);color:var(--text-primary)}',
    'h2.sh .tg{font-size:13px;width:22px}.grip{cursor:grab;color:var(--text-muted);user-select:none;padding:0 2px}.mv{opacity:0;transition:opacity .15s}.card:hover .mv,.card:focus-within .mv{opacity:1}',
    'section.collapsed>*:not(.sh){display:none!important}section.collapsed h2.sh{margin-bottom:-4px!important}section.dragging{opacity:.4}',
    '.cdesc{white-space:normal;max-width:420px;color:var(--text-muted);font-size:11.5px;line-height:1.35;margin-top:2px}',
    '@media (max-width:1100px){.card{padding:10px 12px}th,td{padding:3px 6px}.tile .v{font-size:17px}}',
    '.ticker{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px}.tk{flex:0 0 auto;border:1px solid var(--grid);border-radius:8px;padding:6px 10px;min-width:150px;display:grid;grid-template-columns:auto auto;gap:0 10px;align-items:center}',
    '.tk .nm{font-weight:700}.tk .px{font-size:18px;font-weight:650;font-variant-numeric:tabular-nums}.tk .ch{font-size:12px;font-variant-numeric:tabular-nums}.tk svg{grid-row:1/3;grid-column:2}.tk.closed{opacity:.5}',
    '.up{color:var(--good)}.down{color:var(--crit)}.flat{color:var(--text-muted)}',
    '.tabs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}.tabs button{font:inherit;font-size:12px;padding:4px 10px;border-radius:999px;border:1px solid var(--border);background:var(--surface-0);color:var(--text-secondary);cursor:pointer}.tabs button.on{background:var(--accent);border-color:var(--accent);color:#fff}',
    '.pres{color:var(--warn);font-weight:700}.short{color:var(--crit);font-weight:600}.cellv{display:block;font-size:11px;color:var(--text-muted)}',
    '.mk{display:grid;grid-template-columns:repeat(var(--cols),minmax(34px,1fr));gap:2px;overflow-x:auto}',
    '.mc{border:1px solid var(--grid);border-radius:5px;padding:2px 3px;min-height:40px;font-size:11px;min-width:0}.mc.empty{border-color:transparent}.mp{color:var(--text-secondary);font-variant-numeric:tabular-nums;font-size:10.5px}',
    '.cp{display:block;border-radius:4px;padding:0 3px;margin-top:2px;font-size:10.5px;font-weight:700;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:default}.cp.mine{outline:2px solid var(--accent);outline-offset:1px}.cp.gh{background:transparent!important;border:1.5px dashed;font-weight:600}',
    '.bankrow{display:flex;flex-wrap:wrap;gap:6px 22px;margin:0 0 10px}.bankrow .bb{flex:1 1 200px;min-width:0}.bankrow .bb:first-child{flex:2 1 260px}.bankrow .bl{margin-top:0}.feed.gl{max-height:420px}.feed li.gl{display:grid;grid-template-columns:92px 1fr;gap:8px;padding-left:0;border-left:4px solid var(--pc,transparent)}.feed li.gl .gu{padding-left:6px;color:var(--text-secondary);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.feed li.gl.me{background:color-mix(in srgb,var(--pc) 14%,transparent)}.feed li.gl.me .gu{color:var(--text);font-weight:700}.feed li.gl.head{border-left-color:transparent}.feed li.mine .gm{font-weight:600;color:var(--accent)}.glr{color:var(--text-muted);font-size:10.5px}.gla{color:var(--text-muted);text-decoration:none;font-size:11px;margin-left:4px;opacity:.55}.gla:hover{opacity:1;color:var(--accent)}.rt td,.rt th{padding:3px 8px;text-align:left;vertical-align:top;white-space:normal}.rt td.n{text-align:right;white-space:nowrap}.rt .stp{color:var(--text-secondary);font-size:11.5px;word-break:break-word}#rt-map svg{width:100%;height:auto;display:block}#rt-map .tabs{margin:0 0 6px}.chart.iso .ser,.chart.iso .enl{opacity:.12}.chart.iso .ser.on,.chart.iso .enl.on{opacity:1}.legend span{cursor:pointer}.legend span.off{opacity:.4}.st-same{color:var(--text-muted)}.rpb{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}.rpm{flex:1 1 360px;min-width:0}.rps{flex:1 1 280px;min-width:0}.rph{font-size:12px;margin:6px 0 3px;color:var(--text-secondary)}.rpp{display:flex;flex-wrap:wrap;gap:3px 12px;font-size:12px}.rtsel{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:12px;color:var(--text-secondary)}.rt tr.tot td{border-top:1px solid var(--border);font-weight:600}.gltools{display:flex;gap:8px;align-items:center;margin:0 0 8px}.gltools input{flex:1;min-width:80px}',
    '.gslide{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:12px;color:var(--text-secondary)}.gslide input{flex:1;min-width:80px}',
    '.zl{display:flex;flex-wrap:wrap;gap:4px 12px;margin:8px 0 0;font-size:11.5px;color:var(--text-secondary)}.zl i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:5px;vertical-align:-1px;border:1px solid var(--border)}',
    '.dq{display:flex;flex-wrap:wrap;gap:5px;margin:2px 0 10px}.dq .chip{font-variant-numeric:tabular-nums}.dq .chip.next{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);font-weight:650}.bl{font-size:12px;color:var(--text-muted);margin:6px 0 2px}',
    '.cmt{margin-left:8px;font-size:12px}.cmt .cm.on{font-weight:700;text-decoration:none;color:var(--text-primary)}',
    '.badges{display:flex;flex-wrap:wrap;gap:10px}.bdg{display:flex;gap:10px;align-items:center;border:1px solid var(--border);border-radius:10px;padding:8px 12px;min-width:200px;font-size:13px}.bdg .bi{font-size:26px}.bdg .bn{font-weight:650}',
    '.pies{display:flex;flex-wrap:wrap;gap:14px 26px}.pie1{display:flex;flex-direction:column;gap:4px;min-width:150px;font-size:12px}.pie1 svg{width:110px;height:110px;flex:none}.pie1 .pl{display:flex;flex-direction:column;gap:2px}.kml{list-style:none;margin:0;padding:0}.kml li{padding:4px 0;border-bottom:1px solid var(--grid);font-size:13px}.kmi{display:inline-block;width:1.5em}',
    '.tg2{margin:0 0 10px}.tg2 .tcs{display:flex;flex-wrap:wrap;gap:4px}.tcp{border:1px solid var(--border);border-radius:6px;padding:1px 7px;font-size:12px;font-variant-numeric:tabular-nums}.tcp.z{opacity:.4;text-decoration:line-through}.tg2.na{opacity:.55}',
    'tr.actrow{background:color-mix(in srgb,var(--good) 14%,transparent)}.act{color:var(--good);font-weight:700}',
    '.tw table th:first-child,.tw table td:first-child{position:sticky;left:0;z-index:1;background:var(--surface-1)}',
    '.tw tr.merow td:first-child{background:color-mix(in srgb,var(--accent) 12%,var(--surface-1))}.tw tr.actrow td:first-child{background:color-mix(in srgb,var(--good) 14%,var(--surface-1))}.tw tr[data-corp].hl td:first-child{background:color-mix(in srgb,var(--accent) 22%,var(--surface-1))}',
    '[data-corp].hl{background-image:linear-gradient(color-mix(in srgb,var(--accent) 22%,transparent),color-mix(in srgb,var(--accent) 22%,transparent));outline:2px solid var(--accent);outline-offset:-2px;animation:hlp 1.1s ease-in-out infinite}@keyframes hlp{50%{outline-color:color-mix(in srgb,var(--accent) 35%,transparent)}}@media (prefers-reduced-motion:reduce){[data-corp].hl{animation:none}}',
    'html.myturn::after{content:"";position:fixed;inset:0;pointer-events:none;box-shadow:inset 0 0 0 5px var(--good);z-index:30;animation:glow 2.4s ease-in-out infinite}@keyframes glow{50%{box-shadow:inset 0 0 0 5px color-mix(in srgb,var(--good) 30%,transparent)}}@media (prefers-reduced-motion:reduce){html.myturn::after{animation:none}}',
    '.glide{position:fixed;left:0;top:0;z-index:40;padding:1px 8px;border-radius:999px;font-weight:700;font-size:12px;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.3);margin:-10px 0 0 -24px;white-space:nowrap}',
    '.tl{display:flex;flex-wrap:wrap;gap:4px;align-items:center}.tl span.o{border:1px solid var(--border);border-radius:6px;padding:0 6px}.tl small{color:var(--text-muted)}'
  ].join('\n');
  // the narrow-window layout lives in its own style element so it can be switched off
  var NARROW = '@media (max-width:720px){main{padding:8px;gap:8px}header{padding:6px 8px}.card{padding:9px 10px}.hr1 h1{font-size:15px}.hr3{flex-wrap:wrap}.rtsel,.gltools,.gslide{flex-wrap:wrap}.tabs{flex-wrap:nowrap;overflow-x:auto}.feed li.gl{grid-template-columns:64px 1fr}.tile{flex-basis:46%}.cdesc{max-width:260px}}';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  // Two short tones, played in the stats window (the sound toggle click unlocks audio there).
  function beep(w) {
    try {
      var ac = w.__xxAudio; if (!ac) return;
      [[880, 0], [1175, 0.18]].forEach(function (n) {
        var o = ac.createOscillator(), gn = ac.createGain(), t0 = ac.currentTime + n[1];
        o.type = 'sine'; o.frequency.value = n[0];
        gn.gain.setValueAtTime(0.0001, t0); gn.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
        o.connect(gn); gn.connect(ac.destination); o.start(t0); o.stop(t0 + 0.18);
      });
      ST.beeps = (ST.beeps || 0) + 1;
    } catch (e) {}
  }
  function themePref() { var v = lsGet('xxStats.theme'); return v === 'dark' || v === 'light' ? v : null; }
  function isDark(w) { var p = themePref(); return p ? p === 'dark' : true; }
  // "I am": the player chosen in the window, else the one recognised from the page's own header (never any login data)
  function myName(names) {
    var v = lsGet('xxStats.me');
    if (v !== null) return v && names.indexOf(v) >= 0 ? v : null;
    return ST.autoMe && names.indexOf(ST.autoMe) >= 0 ? ST.autoMe : null;
  }
  function detectMe(names) {
    try {
      var nav = document.querySelector('nav, #header, .nav'), txt = nav ? nav.textContent : '';
      var hits = names.filter(function (n) { return n && new RegExp('(^|[^A-Za-z0-9_])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Za-z0-9_])').test(txt); });
      return hits.length === 1 ? hits[0] : null;
    } catch (e) { return null; }
  }
  function cmpVer(a, b) { var x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (var i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1; } return 0; }
  function checkLatest() {
    if (ST.latestAt && Date.now() - ST.latestAt < 6 * 3600 * 1000) return;
    ST.latestAt = Date.now();
    try {
      window.__xxLatest = null; window.__xxSha = null;
      var sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/gh/mvhjim/18xx-jnnstats@main/version.js?t=' + Date.now();
      sc.onload = function () { ST.latest = String(window.__xxLatest || ''); ST.latestSha = /^[0-9a-f]{7,40}$/.test(String(window.__xxSha || '')) ? String(window.__xxSha) : ''; sc.remove(); rerender(); };
      sc.onerror = function () { sc.remove(); };
      document.head.appendChild(sc);
    } catch (e) {}
  }
  // One-click update: load the newest build by its commit hash (a hash is never cached stale, unlike @main). Lasts until the game page is reloaded; the bookmark itself is not changed.
  function updateNow(el) {
    if (!ST.latestSha) return;
    el.textContent = 'updating…';
    var sc = document.createElement('script');
    sc.src = 'https://cdn.jsdelivr.net/gh/mvhjim/18xx-jnnstats@' + ST.latestSha + '/stats.js';
    sc.onload = function () { sc.remove(); };
    sc.onerror = function () { sc.remove(); el.textContent = 'update failed, click the bookmark again'; };
    document.head.appendChild(sc);
  }
  function loadBounds() { try { var b = JSON.parse(lsGet('xxStats.bounds') || 'null'); if (b && b.w > 300 && b.h > 300) return b; } catch (e) {} return null; }
  function applyBounds(w, b) {
    try {
      var sc = w.screen || screen, al = sc.availLeft || 0, at = sc.availTop || 0, wd = Math.min(b.w, sc.availWidth), ht = Math.min(b.h, sc.availHeight);
      w.resizeTo(wd, ht); w.moveTo(Math.max(al, Math.min(b.x, al + sc.availWidth - wd)), Math.max(at, Math.min(b.y, at + sc.availHeight - ht)));
    } catch (e) {}
  }
  function copyText(w, txt, btn) {
    var done = function (ok) { try { btn.textContent = ok ? 'copied \u2713' : 'copy failed'; setTimeout(function () { try { btn.textContent = 'copy as text'; } catch (e) {} }, 1600); } catch (e) {} };
    var fallback = function () {
      try { var ta = w.document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;left:-9999px'; w.document.body.appendChild(ta); ta.select(); var ok = w.document.execCommand('copy'); ta.remove(); return ok; } catch (e) { return false; }
    };
    try { w.navigator.clipboard.writeText(txt).then(function () { done(true); }, function () { done(fallback()); }); } catch (e) { done(fallback()); }
  }
  // Standings + value chart as a PNG (drawn on a canvas so it does not depend on the page's styles)
  function shareImage(d, ranked, pal, dark, m, me) {
    var th = dark ? { bg: '#14181d', tx: '#e8eaed', t2: '#a9b0b8', gr: '#2a3038' } : { bg: '#f1f0e7', tx: '#1b1f24', t2: '#5b636c', gr: '#d9d8cc' };
    var W = 900, rowH = 28, n = ranked.length, topH = 64, listH = 26 + n * rowH, chartTop = topH + listH + 34, chartH = 300, H = chartTop + chartH + 50, S = 2;
    var c = document.createElement('canvas'); c.width = W * S; c.height = H * S; var x = c.getContext('2d'); x.scale(S, S);
    var F = function (sz, wt) { x.font = (wt || '400') + ' ' + sz + 'px system-ui,-apple-system,Segoe UI,Roboto,sans-serif'; };
    x.fillStyle = th.bg; x.fillRect(0, 0, W, H);
    x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    F(22, '700'); x.fillStyle = th.tx; x.fillText(d.title + ' \u00b7 ' + d.roundLabel + (d.finished ? ' (final)' : ''), 24, 36);
    F(12.5); x.fillStyle = th.t2; x.fillText('Player value = cash + shares at market price + private companies', 24, 56);
    var y = topH + 18; F(12, '600'); x.fillStyle = th.t2;
    x.fillText('#', 24, y); x.fillText('Player', 52, y); x.textAlign = 'right'; x.fillText('Value', 420, y); x.fillText('Cash', 520, y); x.textAlign = 'left';
    var maxV = Math.max.apply(null, ranked.map(function (p) { return p.value; }).concat([1]));
    ranked.forEach(function (p, i) {
      var yy = topH + 26 + i * rowH + 19, col = pal[p.idx % pal.length];
      x.fillStyle = col; x.fillRect(52, yy - 12, 12, 12);
      F(15, i === 0 ? '700' : '400'); x.fillStyle = th.tx; x.fillText(String(i + 1), 24, yy); x.fillText(p.name + (p.name === me ? ' (me)' : ''), 72, yy);
      x.textAlign = 'right'; x.fillText(m(p.value), 420, yy); F(14); x.fillStyle = th.t2; x.fillText(m(p.cash), 520, yy); x.textAlign = 'left';
      x.fillStyle = col; x.globalAlpha = 0.85; x.fillRect(560, yy - 13, 316 * p.value / maxV, 13); x.globalAlpha = 1;
    });
    // chart
    var vh = d.valueHistory, L = 70, R = 110, T = chartTop, B = chartTop + chartH - 26, pw = W - L - R, ph = B - T;
    F(14, '700'); x.fillStyle = th.tx; x.fillText('Player value over time', 24, chartTop - 12);
    var all = []; vh.series.forEach(function (sr) { sr.forEach(function (v) { if (v != null) all.push(v); }); });
    var mx = all.length ? Math.max.apply(null, all) : 1, mn = Math.min(0, all.length ? Math.min.apply(null, all) : 0), st = niceStep((mx - mn) / 4) || 1;
    mx = Math.ceil(mx / st) * st || st; mn = Math.floor(mn / st) * st;
    var N = vh.labels.length, X = function (i) { return L + (N <= 1 ? pw / 2 : i * pw / (N - 1)); }, Y = function (v) { return B - (v - mn) / (mx - mn || 1) * ph; };
    F(11); x.textAlign = 'right';
    for (var gv = mn; gv <= mx + st / 1000; gv += st) { x.strokeStyle = th.gr; x.lineWidth = 1; x.beginPath(); x.moveTo(L, Y(gv)); x.lineTo(W - R, Y(gv)); x.stroke(); x.fillStyle = th.t2; x.fillText(m(gv), L - 8, Y(gv) + 4); }
    x.textAlign = 'center'; var every = Math.max(1, Math.ceil(N / 9));
    for (var li = 0; li < N; li += every) { x.fillStyle = th.t2; x.fillText(vh.labels[li], X(li), B + 16); }
    x.textAlign = 'left';
    var ends = [];
    d.players.forEach(function (p, i) {
      var col = pal[p.idx % pal.length], vals = vh.series[i], started = false;
      x.strokeStyle = col; x.lineWidth = p.name === me ? 3.5 : 2.5; x.lineJoin = 'round'; x.beginPath();
      vals.forEach(function (v, k) { if (v == null) return; if (!started) { x.moveTo(X(k), Y(v)); started = true; } else x.lineTo(X(k), Y(v)); });
      x.stroke();
      var lastK = -1; vals.forEach(function (v, k) { if (v != null) lastK = k; });
      if (lastK >= 0) { x.fillStyle = col; x.beginPath(); x.arc(X(lastK), Y(vals[lastK]), 3.5, 0, 6.3); x.fill(); ends.push({ y: Y(vals[lastK]), name: p.name, col: col }); }
    });
    ends.sort(function (a, b) { return a.y - b.y; });
    for (var e = 1; e < ends.length; e++) if (ends[e].y - ends[e - 1].y < 15) ends[e].y = ends[e - 1].y + 15;
    F(12.5, '600'); ends.forEach(function (o) { x.fillStyle = o.col; x.fillRect(W - R + 10, o.y - 5, 9, 9); x.fillStyle = th.tx; x.fillText(o.name, W - R + 24, o.y + 4); });
    F(11); x.fillStyle = th.t2; x.fillText('18xx-JNNstats by jimiste', 24, H - 14);
    return c;
  }
  function luminance(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 0.5;
    var n = parseInt(m[1], 16); var c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function mix(hex, to, amt) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex;
    var n = parseInt(m[1], 16), tn = parseInt(to.slice(1), 16);
    var c = [16, 8, 0].map(function (sh) { var a = (n >> sh) & 255, b = (tn >> sh) & 255; return Math.round(a + (b - a) * amt); });
    return '#' + c.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
  }
  // corp colors are the game's own; only near-black ones get lifted on a dark surface so they stay visible
  function displayColor(hex, dark) { return dark && luminance(hex) < 0.03 ? mix(hex, '#ffffff', 0.55) : hex; }

  // Generic line chart: model = {labels, series:[{name,color,values,kinds?}], fmt}
  // Small pie chart: parts = [{v, c}]
  function pieSvg(parts, size) {
    var tot = parts.reduce(function (a, p) { return a + p.v; }, 0), r = size / 2 - 2, cx = size / 2, cy = size / 2, a0 = -Math.PI / 2, out = '';
    if (!tot) return '';
    var live = parts.filter(function (p) { return p.v > 0; });
    if (live.length === 1) return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '"><circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + live[0].c + '"><title>' + esc(live[0].t || '') + '</title></circle></svg>';
    live.forEach(function (p) {
      var a1 = a0 + p.v / tot * Math.PI * 2, lg = a1 - a0 > Math.PI ? 1 : 0;
      out += '<path d="M' + cx + ' ' + cy + ' L' + (cx + r * Math.cos(a0)).toFixed(2) + ' ' + (cy + r * Math.sin(a0)).toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + lg + ' 1 ' + (cx + r * Math.cos(a1)).toFixed(2) + ' ' + (cy + r * Math.sin(a1)).toFixed(2) + ' Z" fill="' + p.c + '" stroke="var(--surface-1)" stroke-width="2"><title>' + esc(p.t || '') + '</title></path>';
      a0 = a1;
    });
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '">' + out + '</svg>';
  }
  // Value and price charts can be shown as they are, on a log scale, or as the % change from the first value
  function modeModel(model) {
    if ((ST.chartMode || 'abs') !== 'pct') return model;
    var o = {}; Object.keys(model).forEach(function (k) { o[k] = model[k]; });
    o.fmt = function (v) { return (v >= 0 ? '+' : '−') + Math.abs(Math.round(v)) + '%'; };
    o.series = model.series.map(function (s) {
      var f = null; s.values.some(function (v) { if (v != null && v > 0) { f = v; return true; } return false; });
      var c = {}; Object.keys(s).forEach(function (k) { c[k] = s[k]; });
      c.values = s.values.map(function (v) { return v == null || !f ? null : (v / f - 1) * 100; }); return c;
    });
    return o;
  }
  function modeBar() {
    var md = ST.chartMode || 'abs';
    return '<span class="cmt">' + [['abs', 'normal'], ['log', 'log scale'], ['pct', '% change']].map(function (x) { return '<button class="lnk cm' + (md === x[0] ? ' on' : '') + '" data-cm="' + x[0] + '">' + x[1] + '</button>'; }).join(' · ') + '</span>';
  }
  function lineChart(model, opts) {
    opts = opts || {};
    var W = 640, H = opts.height || 269, L = 60, R = 84, T = 10, B = 30;
    var pw = W - L - R, ph = H - T - B;
    var all = []; model.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null) all.push(v); }); });
    var max = all.length ? Math.max.apply(null, all) : 1, min = Math.min(0, all.length ? Math.min.apply(null, all) : 0);
    var rawMin = min, step = niceStep((max - min) / 4); max = Math.ceil(max / step) * step || step; min = Math.floor(min / step) * step;
    if (opts.snap && rawMin < 0 && rawMin > -0.12 * step) min = 0;
    var ticks = [], lg = !!opts.log, lmin = 1, lmax = 10;
    if (lg) {
      var posv = all.filter(function (v) { return v > 0; });
      lmin = Math.pow(10, Math.floor(Math.log(Math.max(Math.min.apply(null, posv.length ? posv : [1]), 1e-9)) / Math.LN10 + 1e-9)); lmax = Math.pow(10, Math.ceil(Math.log(Math.max.apply(null, posv.length ? posv : [10])) / Math.LN10 - 1e-9));
      if (lmax <= lmin) lmax = lmin * 10;
      for (var pw10 = lmin; pw10 <= lmax * 1.0001; pw10 *= 10) { ticks.push(pw10); if (pw10 * 3 < lmax) ticks.push(pw10 * 3); }
    } else for (var tv = min; tv <= max + 1e-9; tv += step) ticks.push(tv);
    var n = model.labels.length;
    var x = function (i) { return L + (n <= 1 ? pw / 2 : i * pw / (n - 1)); };
    var y = function (v) { if (lg) { if (!(v > 0)) return T + ph; return T + ph - (Math.log(v / lmin) / Math.log(lmax / lmin)) * ph; } return T + ph - (v - min) / (max - min || 1) * ph; };
    var out = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.title || '') + '">'];
    ticks.forEach(function (v) {
      out.push('<line x1="' + L + '" x2="' + (L + pw) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--grid)" stroke-width="1"/>');
      out.push('<text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="13" fill="var(--text-muted)">' + esc(model.fmt(v)) + '</text>');
    });
    var every = Math.max(1, Math.ceil(n / 12));
    model.labels.forEach(function (lab, i) {
      if ((i % every === 0 && (n - 1 - i >= every || i === n - 1)) || i === n - 1) out.push('<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="13" fill="var(--text-muted)">' + esc(lab) + '</text>');
    });
    var ends = [];
    model.series.forEach(function (ser, si) {
      var d = '', pen = false;
      ser.values.forEach(function (val, i) { if (val == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(val).toFixed(1); pen = true; });
      var col = displayColor(ser.color, opts.dark);
      var halo = !opts.dark && luminance(col) > 0.6;
      out.push('<g class="ser" data-si="' + si + '">');
      if (halo) out.push('<path d="' + d + '" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>');
      out.push('<path data-s="' + si + '" d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + (ser.bold ? 4 : 2) + '" stroke-linejoin="round" stroke-linecap="round"' + (ser.dashed ? ' stroke-dasharray="5 4"' : '') + '/>');
      if (ser.kinds) ser.values.forEach(function (val, i) {
        if (val == null) return; var k = ser.kinds[i];
        var ring = halo ? 'rgba(0,0,0,.55)' : col;
        if (k === 'half') { // ring with a dot: half payout
          out.push('<circle cx="' + x(i) + '" cy="' + y(val) + '" r="4" fill="var(--surface-1)" stroke="' + ring + '" stroke-width="1.6"/><circle cx="' + x(i) + '" cy="' + y(val) + '" r="1.8" fill="' + ring + '"/>');
        } else {
          var hollow = k === 'withhold' || k === 'none';
          out.push('<circle cx="' + x(i) + '" cy="' + y(val) + '" r="3.5" fill="' + (hollow ? 'var(--surface-1)' : col) + '" stroke="' + ring + '" stroke-width="1.6"/>');
        }
      });
      out.push('</g>');
      for (var li = ser.values.length - 1; li >= 0; li--) if (ser.values[li] != null) { ends.push({ y: y(ser.values[li]), x: x(li), name: ser.name, color: ser.color, si: si }); break; }
    });
    // direct labels at line ends, de-collided
    if (model.series.length <= 8) {
      ends.sort(function (a, b) { return a.y - b.y; });
      for (var e = 1; e < ends.length; e++) if (ends[e].y - ends[e - 1].y < 13) ends[e].y = ends[e - 1].y + 13;
      ends.forEach(function (en) { out.push('<text class="enl" data-si="' + en.si + '" x="' + (en.x + 7) + '" y="' + (en.y + 4) + '" font-size="13" fill="var(--text-secondary)" font-weight="600">' + esc(en.name) + '</text>'); });
    }
    out.push('<line class="xh" x1="0" x2="0" y1="' + T + '" y2="' + (T + ph) + '" stroke="var(--text-muted)" stroke-dasharray="3 3" visibility="hidden"/>');
    out.push('<rect class="hit" x="' + L + '" y="' + T + '" width="' + pw + '" height="' + ph + '" fill="transparent"/>');
    if (opts.cursor != null && opts.cursor >= 0 && opts.cursor < n) {
      out.push('<line x1="' + x(opts.cursor) + '" x2="' + x(opts.cursor) + '" y1="' + T + '" y2="' + (T + ph) + '" stroke="var(--accent)" stroke-width="1.5"/>');
      model.series.forEach(function (ser) { var vv = ser.values[opts.cursor]; if (vv != null) out.push('<circle cx="' + x(opts.cursor) + '" cy="' + y(vv) + '" r="4.5" fill="' + displayColor(ser.color, opts.dark) + '" stroke="var(--surface-1)" stroke-width="1.5"/>'); });
    }
    // events on the time axis (drawn last so their tooltips work): phase changes and closures
    var evAt = {};
    (opts.events || []).forEach(function (ev) { var ix = model.labels.indexOf(ev.label); if (ix >= 0) (evAt[ix] = evAt[ix] || []).push(ev); });
    Object.keys(evAt).forEach(function (ix) {
      var xx = x(+ix), evs = evAt[ix], bad = evs.some(function (e) { return e.kind === 'close'; });
      out.push('<g class="ev"><line x1="' + xx + '" x2="' + xx + '" y1="' + T + '" y2="' + (T + ph) + '" stroke="' + (bad ? 'var(--crit)' : 'var(--accent)') + '" stroke-opacity=".28" stroke-dasharray="2 3"/>' +
        '<path d="M' + (xx - 5) + ' ' + (T + ph) + 'L' + (xx + 5) + ' ' + (T + ph) + 'L' + xx + ' ' + (T + ph - 9) + 'Z" fill="' + (bad ? 'var(--crit)' : 'var(--accent)') + '"><title>' + esc(evs.map(function (e) { return e.text; }).join(' · ')) + '</title></path></g>');
    });
    out.push('</svg>');
    return { svg: out.join(''), geom: { W: W, L: L, pw: pw, n: n, x: x } };
  }
  function sparkline(values, color, dark) {
    var pts = []; values.forEach(function (v, i) { if (v != null) pts.push([i, v]); });
    if (pts.length < 2) return '';
    var W = 96, H = 26, mn = Math.min.apply(null, pts.map(function (p) { return p[1]; })), mx = Math.max.apply(null, pts.map(function (p) { return p[1]; }));
    var n = values.length - 1 || 1;
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + (p[0] / n * (W - 4) + 2).toFixed(1) + ' ' + (H - 3 - (p[1] - mn) / ((mx - mn) || 1) * (H - 6)).toFixed(1); }).join('');
    var col = displayColor(color, dark);
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true">' +
      (!dark && luminance(col) > 0.6 ? '<path d="' + d + '" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="3.5"/>' : '') +
      '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  }
  // Stacked area: positives stack up from 0, negatives (short positions) stack down. model: {labels, series:[{name,color,values}], fmt}
  // The widest value range over all players, so every player's portfolio is drawn on the same scale
  function pfExtent(d) {
    var mx = 0, mn = 0;
    d.portfolio.forEach(function (pf) {
      var n = pf.labels.length;
      for (var i = 0; i < n; i++) {
        var up = 0, dn = 0, add = function (v) { v = v || 0; if (v >= 0) up += v; else dn += v; };
        add(pf.cash[i]); add(pf.priv && pf.priv[i]); add(pf.other && pf.other[i]);
        pf.series.forEach(function (sr) { add(sr.values[i]); });
        if (up > mx) mx = up; if (dn < mn) mn = dn;
      }
    });
    return { max: mx, min: mn };
  }
  function stackedArea(model, opts) {
    opts = opts || {};
    var W = 640, H = opts.height || 225, L = 60, R = 54, T = 10, B = 30, pw = W - L - R, ph = H - T - B;
    var n = model.labels.length;
    var up = new Array(n).fill(0), down = new Array(n).fill(0);
    var layers = model.series.map(function (ser) {
      var lo = [], hi = [];
      ser.values.forEach(function (v, i) { v = v || 0; if (v >= 0) { lo.push(up[i]); up[i] += v; hi.push(up[i]); } else { hi.push(down[i]); down[i] += v; lo.push(down[i]); } });
      return { ser: ser, lo: lo, hi: hi };
    });
    var max = Math.max.apply(null, up.concat([1, opts.yMax || 0])), min = Math.min.apply(null, down.concat([0, opts.yMin || 0]));
    var step = niceStep((max - min) / 4); max = Math.ceil(max / step) * step; min = Math.floor(min / step) * step;
    var x = function (i) { return L + (n <= 1 ? pw / 2 : i * pw / (n - 1)); };
    var y = function (v) { return T + ph - (v - min) / (max - min || 1) * ph; };
    var out = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.title || '') + '">'];
    for (var v = min; v <= max + 1e-9; v += step) {
      out.push('<line x1="' + L + '" x2="' + (L + pw) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--grid)"/>');
      out.push('<text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="13" fill="var(--text-muted)">' + esc(model.fmt(v)) + '</text>');
    }
    var every = Math.max(1, Math.ceil(n / 12));
    model.labels.forEach(function (lab, i) {
      if ((i % every === 0 && (n - 1 - i >= every || i === n - 1)) || i === n - 1) out.push('<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="13" fill="var(--text-muted)">' + esc(lab) + '</text>');
    });
    layers.forEach(function (ly) {
      var top = ly.hi.map(function (v, i) { return x(i).toFixed(1) + ' ' + y(v).toFixed(1); });
      var bot = ly.lo.map(function (v, i) { return x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).reverse();
      var col = displayColor(ly.ser.color, opts.dark);
      // 2px surface-colored seam between layers
      out.push('<path d="M' + top.join('L') + 'L' + bot.join('L') + 'Z" fill="' + col + '" fill-opacity="' + (ly.ser.muted ? 0.35 : 0.85) + '" stroke="var(--surface-1)" stroke-width="1.5" stroke-linejoin="round"/>');
    });
    if (min < 0) out.push('<line x1="' + L + '" x2="' + (L + pw) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="var(--text-muted)"/>');
    // direct labels for the largest layers at the right edge
    var li = n - 1, lab = [];
    layers.forEach(function (ly) { var hgt = Math.abs(ly.hi[li] - ly.lo[li]); if (hgt > (max - min) * 0.06) lab.push({ y: y((ly.hi[li] + ly.lo[li]) / 2), name: ly.ser.name }); });
    lab.sort(function (a, b) { return a.y - b.y; }); for (var e = 1; e < lab.length; e++) if (lab[e].y - lab[e - 1].y < 13) lab[e].y = lab[e - 1].y + 13;
    lab.forEach(function (lb) { out.push('<text x="' + (x(li) + 7) + '" y="' + (lb.y + 4) + '" font-size="13" font-weight="600" fill="var(--text-secondary)">' + esc(lb.name) + '</text>'); });
    out.push('<line class="xh" x1="0" x2="0" y1="' + T + '" y2="' + (T + ph) + '" stroke="var(--text-muted)" stroke-dasharray="3 3" visibility="hidden"/>');
    out.push('<rect class="hit" x="' + L + '" y="' + T + '" width="' + pw + '" height="' + ph + '" fill="transparent"/></svg>');
    return { svg: out.join(''), geom: { W: W, L: L, pw: pw, n: n, x: x } };
  }
  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function legend(series, dark) {
    return '<div class="legend">' + series.map(function (s, si) { return '<span data-si="' + si + '" title="Click to show only this one"><i class="sw" style="background:' + displayColor(s.color, dark) + '"></i>' + esc(s.name) + '</span>'; }).join('') + '</div>';
  }
  function attachHover(doc, el, model, chart, extra, skipZero) {
    var svg = el.querySelector('svg'), tip = el.querySelector('.tip'), xh = svg.querySelector('.xh'), hit = svg.querySelector('.hit');
    function move(ev) {
      var rect = svg.getBoundingClientRect(); var scale = chart.geom.W / rect.width;
      var px = (ev.clientX - rect.left) * scale;
      var n = chart.geom.n; var i = n <= 1 ? 0 : Math.round((px - chart.geom.L) / chart.geom.pw * (n - 1)); i = Math.max(0, Math.min(n - 1, i));
      var xx = chart.geom.x(i); xh.setAttribute('x1', xx); xh.setAttribute('x2', xx); xh.setAttribute('visibility', 'visible');
      var rows = model.series.map(function (s) { return { s: s, v: s.values[i], k: s.kinds ? s.kinds[i] : null }; }).filter(function (r) { return r.v != null && !(skipZero && r.v === 0); })
        .sort(function (a, b) { return b.v - a.v; });
      tip.innerHTML = '<div class="t">' + esc(model.labels[i]) + '</div>' + rows.map(function (r) {
        return '<div class="r"><span><i class="sw" style="background:' + displayColor(r.s.color, isDark(doc.defaultView)) + '"></i>' + esc(r.s.name) + (r.k && r.k !== 'payout' ? ' <small>(' + esc(r.k) + ')</small>' : '') + '</span><span>' + esc(model.fmt(r.v)) + '</span></div>';
      }).join('') + (extra ? extra(i) : '');
      tip.style.display = 'block';
      var left = xx / scale + 12; var tw = tip.offsetWidth;
      if (left + tw > rect.width) left = xx / scale - tw - 12;
      tip.style.left = left + 'px'; tip.style.top = '6px';
    }
    hit.addEventListener('mousemove', move);
    hit.addEventListener('mouseleave', function () { tip.style.display = 'none'; xh.setAttribute('visibility', 'hidden'); });
  }

  var ZONES = { par: ['#1a7f37', 'par price'], close: ['#c62828', 'company closes'], endgame: ['#7b1fa2', 'ends the game'], unlimited: ['#2a78d6', 'no limit on shares'],
    no_cert_limit: ['#00897b', 'no certificate limit'], multiple_buy: ['#8e24aa', 'buy several at once'], liquidation: ['#e65100', 'liquidation'], acquisition: ['#ef6c00', 'acquisition'],
    convert_range: ['#f9a825', 'conversion range'], safe_par: ['#2e7d32', 'safe par'], repar: ['#558b2f', 'repar'], ignore_one_sale: ['#78909c', 'one sale ignored'] };
  var ZFALL = ['#6d4c41', '#00838f', '#ad1457', '#4e342e', '#455a64'];
  function zoneInfo(ty, all) { if (ZONES[ty]) return ZONES[ty]; return [ZFALL[Math.max(0, all.indexOf(ty)) % ZFALL.length], ty.replace(/_/g, ' ')]; }
  function chipTxt(col) { return luminance(col) > 0.45 ? '#111' : '#fff'; }
  // Body of the stock market section: slider label, the grid itself, and the legend
  function gridBody(d, dark, me, idx, m) {
    var G = d.grid, hist = d.gridHist, last = hist.length - 1, i = Math.min(Math.max(idx, 0), Math.max(last, 0)), isNow = i === last;
    var pos = hist.length ? hist[i].pos : {}, byCell = {}, pres = {}, colr = {};
    d.corps.forEach(function (c) { pres[c.name] = c.president; colr[c.name] = c.color; });
    d.ticker.forEach(function (tk) { if (!colr[tk.name]) colr[tk.name] = tk.color; });
    Object.keys(pos).forEach(function (cn) { var k = pos[cn][0] + ',' + pos[cn][1]; (byCell[k] = byCell[k] || []).push(cn); });
    if (isNow) G.cells.forEach(function (row, ri) { row.forEach(function (c, ci) { if (c && c.c.length) byCell[ri + ',' + ci] = c.c.slice(); }); });
    var ghosts = {};
    if (isNow && G.ghost) {
      [['pay', '▲', 'pays out'], ['hold', '■', 'withholds']].forEach(function (g2) {
        var p2 = G.ghost[g2[0]]; if (!p2) return;
        (ghosts[p2[0] + ',' + p2[1]] = ghosts[p2[0] + ',' + p2[1]] || []).push({ sym: g2[1], what: g2[2] });
      });
    }
    var oneD = G.cells.length === 1, h = [];
    var gcols = G.cols;
    if (oneD) { var grows = Math.ceil(G.cols / 16); gcols = Math.ceil(G.cols / grows); }
    h.push('<div class="mk' + (oneD ? ' one' : '') + '" style="--cols:' + gcols + '">');
    G.cells.forEach(function (row, ri) {
      for (var ci = 0; ci < G.cols; ci++) {
        var c = row[ci];
        if (!c) { h.push('<div class="mc empty"></div>'); continue; }
        var zi = c.t.length ? zoneInfo(c.t[0], G.zones) : null, here = byCell[ri + ',' + ci] || [];
        var bg = zi ? 'color-mix(in srgb,' + zi[0] + ' ' + (dark ? 30 : 22) + '%,var(--surface-1))' : 'var(--surface-1)';
        h.push('<div class="mc" style="background:' + bg + '" title="' + esc(m(c.p) + (c.t.length ? ' · ' + c.t.map(function (x) { return zoneInfo(x, G.zones)[1]; }).join(', ') : '') + (here.length ? ' · ' + here.join(', ') : '')) + '"><div class="mp">' + c.p + '</div>');
        here.forEach(function (cn) {
          var col = displayColor(colr[cn] || '#9a9a9a', dark);
          h.push('<span class="cp' + (me && pres[cn] === me ? ' mine' : '') + '" data-corp="' + esc(cn) + '" style="background:' + col + ';color:' + chipTxt(col) + '">' + esc(cn) + '</span>');
        });
        (ghosts[ri + ',' + ci] || []).forEach(function (gh) {
          var col = displayColor(G.ghost.color || '#9a9a9a', dark);
          h.push('<span class="cp gh" data-corp="' + esc(G.ghost.corp) + '" style="border-color:' + col + ';color:' + col + '" title="' + esc(G.ghost.corp + ' ' + gh.what + (G.ghost.rev != null ? ' (' + m(G.ghost.rev) + ', its last run)' : '')) + '">' + gh.sym + esc(G.ghost.corp) + '</span>');
        });
        h.push('</div>');
      }
    });
    h.push('</div><div class="zl">' + G.zones.map(function (z) { var zi2 = zoneInfo(z, G.zones); return '<span><i style="background:color-mix(in srgb,' + zi2[0] + ' ' + (dark ? 30 : 22) + '%,var(--surface-1))"></i>' + esc(zi2[1]) + '</span>'; }).join('') +
      (isNow && G.ghost ? '<span><span class="cp gh" style="display:inline;border-color:var(--text-muted);color:var(--text-secondary)">▲ ■</span> where <b>' + esc(G.ghost.corp) + '</b> goes if it pays out (▲) or withholds (■), if it earns its last revenue again</span>' : '') + '</div>');
    return h.join('');
  }
  // Short animated chips that glide from the old holder to the new one when shares or trains change hands
  function glideChip(w, from, to, text, color) {
    try {
      var a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
      if (!a.width || !b.width) return;
      var el = w.document.createElement('div'); el.className = 'glide'; el.textContent = text;
      el.style.background = color; el.style.color = chipTxt(color);
      w.document.body.appendChild(el);
      if (typeof el.animate !== 'function') { el.remove(); return; }
      var x0 = a.left + Math.min(a.width, 200) / 2, y0 = a.top + a.height / 2, x1 = b.left + Math.min(b.width, 200) / 2, y1 = b.top + b.height / 2;
      var an = el.animate([{ transform: 'translate(' + x0 + 'px,' + y0 + 'px)', opacity: 0 }, { transform: 'translate(' + x0 + 'px,' + y0 + 'px)', opacity: 1, offset: 0.12 },
        { transform: 'translate(' + x1 + 'px,' + y1 + 'px)', opacity: 1, offset: 0.85 }, { transform: 'translate(' + x1 + 'px,' + y1 + 'px)', opacity: 0 }], { duration: 1500, easing: 'ease-in-out' });
      an.onfinish = function () { el.remove(); };
    } catch (e) {}
  }
  function glideChanges(w, d, dark) {
    var doc = w.document, cur = { game: d.id, hold: {}, ipo: {}, pool: {}, trains: {}, depot: {}, pct: {} };
    d.holdings.rows.forEach(function (r2) { cur.hold[r2.name] = {}; Object.keys(r2.cells).forEach(function (cn) { cur.hold[r2.name][cn] = r2.cells[cn].pct; }); });
    d.bank2.ipo.forEach(function (x) { cur.ipo[x.name] = x.n * x.pct; cur.pct[x.name] = x.pct; });
    d.bank2.mpool.forEach(function (x) { cur.pool[x.name] = x.n * x.pct; cur.pct[x.name] = x.pct; });
    d.corps.forEach(function (c) { cur.trains[c.name] = c.trains.map(function (t) { return t.name; }); });
    d.trainGroups.forEach(function (g2) { cur.depot[g2.sym] = g2.available; });
    var prev = ST.prevMove; ST.prevMove = cur;
    var reduced = false; try { reduced = w.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (!prev || prev.game !== d.id || reduced || d.finished) return;
    var colr = {}; d.corps.forEach(function (c) { colr[c.name] = c.color; });
    var q = function (sel) { return doc.querySelector(sel); }, n = 0;
    var elOf = function (k) { return k.indexOf('p:') === 0 ? q('tr[data-prow="' + k.slice(2) + '"]') : q('tr[data-mrow="' + k.slice(2) + '"]') || q('tr[data-crow="' + k.slice(2) + '"]') || q('[data-bank="' + (k.indexOf('i:') === 0 ? 'ipo' : 'pool') + '"]'); };
    // shares: pair every place that lost a share with one that gained it
    d.corps.map(function (c) { return c.name; }).forEach(function (cn) {
      var delta = {};
      Object.keys(cur.hold).forEach(function (pn) { var dv = (cur.hold[pn][cn] || 0) - (((prev.hold[pn] || {})[cn]) || 0); if (dv) delta['p:' + pn] = dv; });
      var di = (cur.ipo[cn] || 0) - (prev.ipo[cn] || 0), dp = (cur.pool[cn] || 0) - (prev.pool[cn] || 0);
      if (di) delta['i:' + cn] = di; if (dp) delta['m:' + cn] = dp;
      var src = Object.keys(delta).filter(function (k) { return delta[k] < 0; }), dst = Object.keys(delta).filter(function (k) { return delta[k] > 0; });
      src.forEach(function (sk, i) { var dk = dst[i] || dst[0]; if (!dk || n >= 8) return; var a3 = elOf(sk), b3 = elOf(dk); if (a3 && b3) { glideChip(w, a3, b3, '+' + Math.abs(delta[sk]) + '% ' + cn, displayColor(colr[cn] || '#9a9a9a', dark)); n++; } });
    });
    // trains: from the depot or another company to the buyer; a train that disappears has rusted
    var gone = [], got = [];
    Object.keys(cur.trains).forEach(function (cn) {
      var before = (prev.trains[cn] || []).slice();
      cur.trains[cn].forEach(function (nm) { var ix = before.indexOf(nm); if (ix >= 0) before.splice(ix, 1); else got.push({ corp: cn, name: nm }); });
      before.forEach(function (nm) { gone.push({ corp: cn, name: nm }); });
    });
    got.forEach(function (g3) {
      if (n >= 8) return;
      var gi = gone.findIndex(function (x) { return x.name === g3.name; }), from;
      if (gi >= 0) { from = q('tr[data-crow="' + gone[gi].corp + '"]'); gone.splice(gi, 1); } else from = q('[data-bank="depot"]');
      var to = q('tr[data-crow="' + g3.corp + '"]'); if (from && to) { glideChip(w, from, to, g3.name + '-train', '#2a78d6'); n++; }
    });
    gone.forEach(function (g3) { if (n >= 8) return; var el = q('tr[data-crow="' + g3.corp + '"]'); if (el) { glideChip(w, el, el, g3.name + ' rusted', '#c62828'); n++; } });
  }
  // Game log filters: what kind of line, and which company
  var GL_KIND = { stock: [/\b(buys|sells|pars|shares?|presidency|short|shorts|certificates?|exchanges)\b/i, /\btrains?\b/i], revenue: [/\b(runs|pays out|withholds|receives|earns|collects|share price moves)\b/i], track: [/\b(lays|upgrades|token|tile)\b/i], trains: [/\b(trains?|phase|rusts?|obsolete)\b/i], auction: [/\b(bids?|auction|wins)\b/i] };
  var GL_NAMES = { stock: 'Stock', revenue: 'Revenue', track: 'Track', trains: 'Trains', auction: 'Auctions' };
  function glOk(d, f) {
    var k = ST.glGame === d.id ? ST.glKind : null, co = ST.glGame === d.id ? ST.glCo : null;
    if (!k && !co) return true;
    if (f.head) return false;
    if (k) { var kk = GL_KIND[k]; if (!kk[0].test(f.msg) || (kk[1] && kk[1].test(f.msg))) return false; }
    if (co) { try { if (!new RegExp('(^|[^A-Za-z0-9])' + co.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Za-z0-9]|$)').test(f.msg)) return false; } catch (e) { return false; } }
    return true;
  }
  // Body of the Game log section: one round's lines, or search hits across the whole log
  function glBody(d, idx, q, col, me) {
    var G = d.gameLog; if (!G) return '';
    var prev = null;
    var li = function (f, pre, runs) {
      var who = f.u && !f.head ? f.u : '', first = !runs || who !== prev; prev = who;
      return '<li class="gl' + (f.head ? ' head' : '') + (G.meId && f.id === G.meId ? ' mine' : '') + (who && who === me ? ' me' : '') + '"' + (who && col[who] ? ' style="--pc:' + col[who] + '"' : '') + '>' +
        '<span class="gu">' + (who && first ? esc(who) : '') + '</span><span class="gm">' + (pre ? '<small class="glr">' + esc(pre) + '</small> ' : '') + esc(f.msg) + (f.id > 0 && ST.origin ? ' <a class="gla" target="_blank" rel="noopener" href="' + esc(ST.origin + '/game/' + d.id + '?action=' + f.id) + '" title="Open the game on 18xx.games as it stood after this move">↗</a>' : '') + '</span></li>';
    };
    q = (q || '').trim().toLowerCase();
    if (q) {
      var out = [], total = 0;
      G.rounds.forEach(function (r) { r.lines.forEach(function (f) { if (f.msg.toLowerCase().indexOf(q) >= 0 && glOk(d, f)) { total++; if (out.length < 300) out.push(li(f, r.label, false)); } }); });
      return (out.length ? out.join('') : '<li class="head">No lines match.</li>') + (total > 300 ? '<li class="head">… and ' + (total - 300) + ' more, narrow the search</li>' : '');
    }
    var rr = G.rounds[Math.min(Math.max(idx, 0), G.rounds.length - 1)];
    var shown = rr.lines.filter(function (f) { return glOk(d, f); });
    return shown.length ? shown.map(function (f) { return li(f, '', true); }).join('') : '<li class="head">' + (shown.length === rr.lines.length ? 'Nothing logged in this round.' : 'No lines match the filter in this round.') + '</li>';
  }
  // 1862 train classes (and any later title that sets trainClass in CONFIG): a coloured glyph before the train name
  function trainGlyph(title, name) {
    var tc = CONFIG[title] && CONFIG[title].trainClass, m = tc && /([A-Z])\*?$/.exec(name);
    return m && tc[m[1]] ? '<span title="' + tc[m[1]][1] + '">' + tc[m[1]][0] + '</span> ' : '';
  }
  // Route sketch: the engine's hex grid, laid tiles as colours, one company's routes drawn through the hexes in order
  var RT_PAL = ['#3b82f6', '#f59e0b', '#22c55e', '#ef4444', '#a855f7', '#14b8a6'], RT_CLS = { E: '#3b82f6', F: '#f59e0b', L: '#22c55e' };
  var TILE_FILL = { white: '#c9c8bc', yellow: '#e8d44d', green: '#5aa65a', brown: '#a47852', gray: '#8a8a8a', red: '#c0504d', blue: '#5b8fc7' };
  // Which stops each train of the chosen company (or all companies, '*') visited, as hex ids, with a colour per train (or per company)
  function rtPaths(d, R, corp, pos) {
    var out = [], colOf = {}; d.ticker.forEach(function (t) { colOf[t.name] = t.color; });
    var runners = R ? R.corps.filter(function (c) { return corp === '*' ? c.trains.length : c.corp === corp; }) : [];
    runners.forEach(function (C) {
      C.trains.forEach(function (t, i) {
        var ids = t.stops.split('-').map(function (x) { return { id: x.replace(/[\[\]()]/g, '').split(' + ')[0].trim(), skip: /^\[/.test(x) }; }).filter(function (x) { return pos[x.id]; });
        var cm = CONFIG[d.title] && CONFIG[d.title].trainClass ? /([A-Z])\*?$/.exec(t.train) : null;
        out.push({ corp: C.corp, t: t, ids: ids, col: corp === '*' ? (colOf[C.corp] || RT_PAL[out.length % RT_PAL.length]) : (cm && RT_CLS[cm[1]] ? RT_CLS[cm[1]] : RT_PAL[i % RT_PAL.length]) });
      });
    });
    return out;
  }
  function hexPos(d, u) {
    var M = d.hexMap, flat = M.layout !== 'pointy', tx = flat ? 1.5 * u : Math.sqrt(3) / 2 * u, ty = flat ? Math.sqrt(3) / 2 * u : 1.5 * u;
    var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9, pos = {};
    M.hexes.forEach(function (h) { minx = Math.min(minx, h.x); miny = Math.min(miny, h.y); maxx = Math.max(maxx, h.x); maxy = Math.max(maxy, h.y); });
    M.hexes.forEach(function (h) { pos[h.id] = [tx * (h.x - minx) + u, ty * (h.y - miny) + u]; });
    return { flat: flat, pos: pos, W: tx * (maxx - minx) + 2 * u, H: ty * (maxy - miny) + 2 * u };
  }
  // The board: tiles as colours (with tile numbers), cities, towns, off-boards, company tokens, and any routes to draw on top.
  // hx = tile/token state of one moment (a replay frame), or null for the board as it is now.
  function heatCounts(d) {
    var G = hexPos(d, 26), cnt = {}, mx = 0;
    d.routes.forEach(function (R) { rtPaths(d, R, '*', G.pos).forEach(function (p) { var seen = {}; p.ids.forEach(function (x) { if (!x.skip && !seen[x.id]) { seen[x.id] = 1; cnt[x.id] = (cnt[x.id] || 0) + 1; if (cnt[x.id] > mx) mx = cnt[x.id]; } }); }); });
    return { cnt: cnt, max: mx };
  }
  function boardSvg(d, hx, paths, maxW, heat) {
    var M = d.hexMap, u = 26, G = hexPos(d, u), flat = G.flat, pos = G.pos, W = G.W, H = G.H, on = {}, tokCol = {};
    d.ticker.forEach(function (t) { tokCol[t.name] = t.color; });
    var o = ['<svg viewBox="0 0 ' + W.toFixed(0) + ' ' + H.toFixed(0) + '" role="img" aria-label="The board" style="max-width:' + Math.round(Math.min(W * 1.5, maxW || 760)) + 'px">'];
    var poly = function (cx, cy, r) { var pts = []; for (var a = 0; a < 6; a++) { var ang = (flat ? 0 : 30) + a * 60, rad = ang * Math.PI / 180; pts.push((cx + r * Math.cos(rad)).toFixed(1) + ',' + (cy + r * Math.sin(rad)).toFixed(1)); } return pts.join(' '); };
    paths.forEach(function (p) { p.ids.forEach(function (x) { on[x.id] = 1; }); });
    M.hexes.forEach(function (h) {
      var c = pos[h.id], lit = on[h.id], st = hx && hx[h.id] ? { c: hx[h.id][0], t: hx[h.id][1], k: hx[h.id][2] } : { c: h.c, t: h.t, k: h.k || [] };
      o.push('<polygon points="' + poly(c[0], c[1], u - 1) + '" fill="' + (TILE_FILL[st.c] || TILE_FILL.white) + '" fill-opacity="' + (st.c === 'white' ? '.22' : '.6') + '" stroke="var(--border)" stroke-width="1"><title>' + esc(h.id + (h.loc ? ' ' + h.loc : '') + (st.t ? ' · tile ' + st.t : '') + ' · ' + st.c + (st.k.length ? ' · tokens: ' + st.k.join(', ') : '')) + '</title></polygon>');
      if (heat && heat.cnt[h.id]) o.push('<polygon points="' + poly(c[0], c[1], u - 1) + '" fill="var(--accent)" fill-opacity="' + (0.15 + 0.7 * heat.cnt[h.id] / heat.max).toFixed(2) + '" stroke="none"><title>' + esc(h.id + ': run through ' + heat.cnt[h.id] + ' times') + '</title></polygon>');
      var cx = c[0].toFixed(1), cy = c[1].toFixed(1);
      if (h.city) o.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (7 + (h.city > 1 ? 2 : 0)) + '" fill="var(--surface-1)" stroke="var(--text-muted)" stroke-width="1"/>');
      else if (h.off) o.push('<rect x="' + (c[0] - 5).toFixed(1) + '" y="' + (c[1] - 5).toFixed(1) + '" width="10" height="10" transform="rotate(45 ' + cx + ' ' + cy + ')" fill="var(--surface-1)" stroke="var(--text-muted)" stroke-width="1"/>');
      else if (h.town) o.push('<circle cx="' + cx + '" cy="' + cy + '" r="3" fill="var(--text-muted)"/>');
      st.k.forEach(function (kn, ki) {
        var ang = ki * 2 * Math.PI / st.k.length, rr = st.k.length > 1 ? 4.2 : 0;
        o.push('<circle cx="' + (c[0] + rr * Math.cos(ang)).toFixed(1) + '" cy="' + (c[1] + rr * Math.sin(ang)).toFixed(1) + '" r="3.6" fill="' + (tokCol[kn] || '#999') + '" stroke="var(--surface-1)" stroke-width="1"><title>' + esc(kn) + '</title></circle>');
      });
      if (st.t && st.c !== 'white') o.push('<text x="' + cx + '" y="' + (c[1] - u * 0.5).toFixed(1) + '" text-anchor="middle" font-size="6.5" fill="var(--text-secondary)">#' + esc(st.t) + '</text>');
      o.push('<text x="' + cx + '" y="' + (c[1] + u * 0.68).toFixed(1) + '" text-anchor="middle" font-size="' + (lit ? 9 : 7.5) + '" fill="var(--text-' + (lit ? 'primary' : 'muted') + ')"' + (lit ? ' font-weight="700"' : '') + '>' + esc(h.id) + '</text>');
    });
    paths.forEach(function (p, i) {
      var off = (i - (paths.length - 1) / 2) * 3.2, pts = p.ids.map(function (x) { return (pos[x.id][0] + off).toFixed(1) + ',' + (pos[x.id][1] + off).toFixed(1); });
      if (pts.length > 1) o.push('<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + p.col + '" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/>');
      p.ids.forEach(function (x, k) {
        var e = k === 0 || k === p.ids.length - 1;
        o.push('<circle cx="' + (pos[x.id][0] + off).toFixed(1) + '" cy="' + (pos[x.id][1] + off).toFixed(1) + '" r="' + (e ? 4.6 : 2.8) + '" fill="' + (x.skip ? 'var(--surface-1)' : p.col) + '" stroke="' + p.col + '" stroke-width="1.5"/>');
      });
    });
    o.push('</svg>');
    return o.join('');
  }
  function rtMapSvg(d, R, corp) { return boardSvg(d, null, rtPaths(d, R, corp, hexPos(d, 26).pos), 760); }
  function rtMapHtml(d, k, corp) {
    var R = d.routes[Math.min(Math.max(k, 0), d.routes.length - 1)], runners = R.corps.filter(function (c) { return c.trains.length; });
    var heat = corp === '#';
    if (!runners.length && !heat) return '<p class="sub">Nobody ran trains in this round.</p>';
    if (corp !== '*' && !heat && !runners.some(function (c) { return c.corp === corp; })) corp = runners[0].corp;
    var chips = ['<button class="pill rtc' + (corp === '*' ? ' cur' : '') + '" data-c="*">All</button>', '<button class="pill rtc' + (heat ? ' cur' : '') + '" data-c="#" title="Which hexes the trains ran through most, over the whole game">Heat</button>'].concat(runners.map(function (c) { return '<button class="pill rtc' + (c.corp === corp ? ' cur' : '') + '" data-c="' + esc(c.corp) + '">' + esc(c.corp) + '</button>'; })).join(' ');
    if (heat) return '<div class="tabs">' + chips + '</div>' + boardSvg(d, null, [], 760, heatCounts(d)) + '<p class="sub" style="margin-top:6px">Darker hexes were run through more often, over the whole game (each route counts a hex once). Hover a hex for the number.</p>';
    return '<div class="tabs">' + chips + ' <button id="rt-ci" class="lnk" title="Copy this map and the routes as a picture, to paste into chat">copy as image</button></div>' + rtMapSvg(d, R, corp) +
      '<p class="sub" style="margin-top:6px">Each line joins the stops the engine logs, in order, so it shows where the train went but not the exact track. One colour per train; a hollow dot is a stop the train skips. Hex colours show the tiles on the board in the game state you are viewing, not necessarily when the route ran. ◯ city &nbsp;◆ off-board &nbsp;• town</p>';
  }
  // One frame of the replay: the board at that moment (with that round's routes), standings and prices
  function rpFrame(d, k, dark, pal, me) {
    var G = hexPos(d, 26), R = null, lab = d.replay.labels[k], mm = /^OR (\d+\.\d+)$/.exec(lab);
    if (mm) d.routes.forEach(function (r) { if (r.label.indexOf('Operating Round ' + mm[1] + ' ') >= 0 || r.label.indexOf('Operating Round ' + mm[1] + ')') >= 0) R = r; });
    var paths = R ? rtPaths(d, R, '*', G.pos) : [];
    var rows = d.players.map(function (p, i) { return { name: p.name, v: d.valueHistory.series[i][k], col: pal[p.idx % pal.length] }; }).filter(function (r) { return r.v != null; }).sort(function (a, b) { return b.v - a.v; });
    var mx = 0; d.valueHistory.series.forEach(function (ser) { ser.forEach(function (v) { if (v != null && v > mx) mx = v; }); });
    var stand = '<table><tbody>' + rows.map(function (r, i) { return '<tr><td>' + (i + 1) + '</td><td style="text-align:left"><i class="sw" style="background:' + r.col + '"></i>' + (r.name === me ? '<b>' + esc(r.name) + '</b>' : esc(r.name)) + '</td><td>' + esc(d.money(r.v)) + '</td><td style="width:34%"><div class="bar"><i style="width:' + Math.max(2, Math.round(100 * r.v / (mx || 1))) + '%;background:' + r.col + '"></i></div></td></tr>'; }).join('') + '</tbody></table>';
    var pk = d.prices.labels.indexOf(lab), pr = pk < 0 ? [] : d.prices.series.map(function (sr) { return { name: sr.name, v: sr.values[pk], col: sr.color }; }).filter(function (r) { return r.v != null; }).sort(function (a, b) { return b.v - a.v; });
    var prices = pr.length ? '<div class="rpp">' + pr.map(function (r) { return '<span><i class="sw" style="background:' + displayColor(r.col, dark) + '"></i>' + esc(r.name) + ' ' + esc(d.money(r.v)) + '</span>'; }).join('') + '</div>' : '';
    var vm = { labels: d.valueHistory.labels, fmt: d.money, series: d.players.map(function (p, i) { return { name: p.name, color: pal[p.idx % pal.length], values: d.valueHistory.series[i] }; }) };
    var ch = lineChart(vm, { title: 'Player value', dark: dark, height: 170, cursor: k });
    return { map: boardSvg(d, d.replay.hx[k], paths, 600), side: '<h3 class="rph">Standings</h3>' + stand + '<h3 class="rph">Share prices</h3>' + prices + '<div class="chart" style="margin-top:8px">' + ch.svg + '</div>', routes: paths.length };
  }
  // Picture of one company's routes in one round (map + list) for pasting into chat
  function routeImage(d, k, corp, dark) {
    var R = d.routes[k], C = corp === '*' ? { total: '', kind: '' } : R.corps.filter(function (c) { return c.corp === corp; })[0], M = d.hexMap;
    var th = dark ? { bg: '#14181d', tx: '#e8eaed', t2: '#a9b0b8', gr: '#3a424c' } : { bg: '#f1f0e7', tx: '#1b1f24', t2: '#5b636c', gr: '#b9b8ac' };
    var u = 26, flat = M.layout !== 'pointy', tx = flat ? 1.5 * u : Math.sqrt(3) / 2 * u, ty = flat ? Math.sqrt(3) / 2 * u : 1.5 * u, minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9, pos = {};
    M.hexes.forEach(function (h) { minx = Math.min(minx, h.x); miny = Math.min(miny, h.y); maxx = Math.max(maxx, h.x); maxy = Math.max(maxy, h.y); });
    M.hexes.forEach(function (h) { pos[h.id] = [tx * (h.x - minx) + u, ty * (h.y - miny) + u]; });
    var mw = tx * (maxx - minx) + 2 * u, mh = ty * (maxy - miny) + 2 * u, sc = 560 / mw, S = 2, W = 900, top = 56, H = Math.max(mh * sc, 40 + paths.length * 46 + 60) + top + 16;
    var cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S; var x = cv.getContext('2d'); x.scale(S, S);
    var F = function (sz, wt) { x.font = (wt || '400') + ' ' + sz + 'px system-ui,-apple-system,Segoe UI,Roboto,sans-serif'; };
    x.fillStyle = th.bg; x.fillRect(0, 0, W, H); x.textBaseline = 'alphabetic';
    F(17, '700'); x.fillStyle = th.tx; x.fillText(d.title + ' · ' + R.label + ' · ' + (corp === '*' ? 'all companies' : corp), 16, 30);
    F(12); x.fillStyle = th.t2; x.fillText('Routes as the engine logs them · 18xx-JNNstats', 16, 47);
    var ox = 16, oy = top;
    var hexPath = function (cx, cy, r) { x.beginPath(); for (var a = 0; a < 6; a++) { var rad = ((flat ? 0 : 30) + a * 60) * Math.PI / 180, px = ox + (cx + r * Math.cos(rad)) * sc, py = oy + (cy + r * Math.sin(rad)) * sc; if (a) x.lineTo(px, py); else x.moveTo(px, py); } x.closePath(); };
    var on = {}, paths = rtPaths(d, R, corp, pos); paths.forEach(function (p) { p.ids.forEach(function (q) { on[q.id] = 1; }); });
    M.hexes.forEach(function (h) {
      var c = pos[h.id]; hexPath(c[0], c[1], u - 1);
      x.globalAlpha = h.c === 'white' ? 0.22 : 0.65; x.fillStyle = TILE_FILL[h.c] || TILE_FILL.white; x.fill(); x.globalAlpha = 1; x.strokeStyle = th.gr; x.lineWidth = 1; x.stroke();
      if (h.city || h.off || h.town) { x.beginPath(); x.arc(ox + c[0] * sc, oy + c[1] * sc, (h.town && !h.city && !h.off ? 3 : 6) * sc, 0, 7); x.fillStyle = h.town && !h.city && !h.off ? th.t2 : th.bg; x.fill(); if (!h.town || h.city || h.off) { x.strokeStyle = th.t2; x.stroke(); } }
      F(on[h.id] ? 10 : 8, on[h.id] ? '700' : '400'); x.fillStyle = on[h.id] ? th.tx : th.t2; x.textAlign = 'center'; x.fillText(h.id, ox + c[0] * sc, oy + (c[1] + u * 0.66) * sc); x.textAlign = 'left';
    });
    paths.forEach(function (p, i) {
      var off = (i - (paths.length - 1) / 2) * 4; x.strokeStyle = p.col; x.lineWidth = 3.5; x.lineJoin = 'round'; x.lineCap = 'round'; x.beginPath();
      p.ids.forEach(function (q, j) { var px = ox + (pos[q.id][0] + off) * sc, py = oy + (pos[q.id][1] + off) * sc; if (j) x.lineTo(px, py); else x.moveTo(px, py); }); x.stroke();
      p.ids.forEach(function (q, j) { var e = j === 0 || j === p.ids.length - 1; x.beginPath(); x.arc(ox + (pos[q.id][0] + off) * sc, oy + (pos[q.id][1] + off) * sc, e ? 5 : 3, 0, 7); x.fillStyle = q.skip ? th.bg : p.col; x.fill(); x.strokeStyle = p.col; x.lineWidth = 1.5; x.stroke(); });
    });
    var lx = 16 + 560 + 24, ly = top + 14;
    paths.forEach(function (p) {
      x.fillStyle = p.col; x.beginPath(); x.arc(lx + 6, ly - 4, 6, 0, 7); x.fill();
      F(14, '700'); x.fillStyle = th.tx; x.fillText((corp === '*' ? p.corp + ' ' : '') + p.t.train + '   ' + p.t.rev, lx + 20, ly);
      F(11); x.fillStyle = th.t2; var words = p.t.stops.split('-'), line = '', yy = ly + 16;
      words.forEach(function (wd) { var t2 = line ? line + '-' + wd : wd; if (x.measureText(t2).width > W - lx - 20 - 16) { x.fillText(line, lx + 20, yy); yy += 14; line = wd; } else line = t2; });
      x.fillText(line, lx + 20, yy); ly = yy + 30;
    });
    F(14, '700'); x.fillStyle = th.tx; if (corp !== '*') x.fillText('Total ' + (C.total || '') + (C.kind ? ' · ' + C.kind : ''), lx, ly + 4);
    return cv;
  }
  // Body of the Routes & revenue card: one operating round, a row per train
  // Compare mode: facts about when things happened, as a share of the way through the game
  function cmpFacts(d) {
    var L = d.valueHistory.labels, n = Math.max(L.length - 1, 1), pct = function (lab) { var i = L.indexOf(lab); return i < 0 ? null : Math.round(i / n * 100); };
    var f = { phases: [], trains: {}, trainOrder: [] };
    (d.events || []).forEach(function (e) { if (e.kind === 'phase') f.phases.push({ name: e.text.replace(/^Phase /, '').replace(/ begins$/, ''), label: e.label, pct: pct(e.label) }); });
    var an = d.analysis;
    if (an && an.trains) an.trains.forEach(function (x) {
      if (f.trains[x.train]) return;
      var lab = String(x.round).replace(/^Operating Round /, 'OR ').replace(/^Stock Round /, 'SR ').replace(/ \(of \d+\)$/, '');
      f.trains[x.train] = { label: lab, pct: pct(lab), price: x.price }; f.trainOrder.push(x.train);
    });
    f.ors = L.filter(function (l) { return /^OR /.test(l); }).length;
    f.runRev = 0; (d.routes || []).forEach(function (R) { R.corps.forEach(function (c) { if (c.trains.length && c.totalN != null) f.runRev += c.totalN; }); });
    f.trainSpend = an && an.trains ? an.trains.reduce(function (a, x) { return a + x.price; }, 0) : 0;
    f.inter = an && an.trains ? an.trains.filter(function (x) { return !x.depot; }).length : 0;
    f.tileSpend = an ? an.track.reduce(function (a, x) { return a + x.tileCost; }, 0) : 0;
    f.tokens = an ? an.track.reduce(function (a, x) { return a + x.tokens; }, 0) : 0;
    f.divs = an && an.money ? an.money.reduce(function (a, x) { return a + x.div; }, 0) : 0;
    f.companies = d.ticker.length;
    return f;
  }
  function loadCompare(w, d, id) {
    ST.cmp = { gid: d.id, id: id, busy: true, msg: 'Loading game ' + id + ' and replaying it, this takes a few seconds…' };
    rerender();
    return fetch('/api/game/' + id, { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (text) {
      var raw = JSON.parse(text);
      if (!raw.actions || !raw.actions.length) throw new Error('Game ' + id + ' was not found, or has no moves (archived games cannot be replayed).');
      if (raw.title !== d.title) throw new Error('Game ' + id + ' is ' + raw.title + ', this game is ' + d.title + '. Only games of the same title can be compared.');
      var p1 = String(d.pin || ''), p2 = String(raw.settings && raw.settings.pin || '');
      if (p1 !== p2) throw new Error('The two games use different engine versions (' + (p1 || 'latest') + ' and ' + (p2 || 'latest') + '), so their numbers are not comparable.');
      return new Promise(function (res) { setTimeout(function () { res([text, raw]); }, 40); });
    }).then(function (a) {
      var g2 = loadGame(a[0]); var d2 = extract(g2, a[1]);
      ST.cmp = { gid: d.id, id: id, d2: d2, facts: cmpFacts(d2) }; rerender();
    }).catch(function (e) { ST.cmp = { gid: d.id, id: id, msg: String(e && e.message || e) }; rerender(); });
  }
  // Route efficiency: replay the game to just before a company's run, let the engine's own auto-router
  // find routes there, and compare. Read only; the game copy is thrown away. One run at a time.
  function bestRun(raw, corp, act) {
    return new Promise(function (resolve, reject) {
      var done = false, to = setTimeout(function () { if (!done) { done = true; reject(new Error('timed out')); } }, 60000);
      setTimeout(function () {
        try {
          var j = {}; Object.keys(raw).forEach(function (k) { j[k] = raw[k]; });
          j.actions = raw.actions.filter(function (x) { return x.id < act; }); j.status = 'active'; delete j.result;
          var g = Opal.Engine.Game.$load(Opal.JSON.$parse(JSON.stringify(j)));
          var ent = g.$current_entity();
          if (!ent || s(ent.$name()) !== corp) throw new Error('state mismatch');
          var router = Opal.Engine.AutoRouter.$new(g);
          router.$compute(ent, Opal.hash({ route_timeout: 6, path_timeout: 12, callback: function (routes) {
            if (done) return; done = true; clearTimeout(to);
            try { resolve({ best: num(g.$routes_revenue(routes)), n: routes.length }); } catch (e) { reject(e); }
          } }));
        } catch (e) { if (!done) { done = true; clearTimeout(to); reject(e); } }
      }, 30);
    });
  }
  function runActual(c) { return c.trains.reduce(function (a, x) { return a + (parseFloat(String(x.rev).replace(/[^\d.]/g, '')) || 0); }, 0); }
  function rtSummary(d) {
    var o = { tot: 0, n: 0, gap: 0, short: 0 };
    d.routes.forEach(function (R) { R.corps.forEach(function (c) {
      if (!c.act || !c.trains.length) return; o.tot++;
      var r = ST.rtBest && ST.rtBest[d.id + '|' + c.corp + '|' + c.act];
      if (r && r.s === 'ok') { o.n++; var a2 = runActual(c); if (r.best > a2) { o.gap += r.best - a2; o.short++; } }
    }); });
    return o;
  }
  function bestCell(d, c) {
    if (!c.act || !d.id) return '';
    var key = d.id + '|' + c.corp + '|' + c.act, r = ST.rtBest && ST.rtBest[key];
    if (!r) return ' <button class="lnk rt-chk" data-c="' + esc(c.corp) + '" data-a="' + c.act + '" title="Replays the game to just before this run and lets the site\'s own auto-router find the best routes it can (about 15 seconds)">check best</button>';
    if (r.s === 'run') return ' <small class="st-same">checking…</small>';
    if (r.s === 'err') return ' <small class="st-same" title="' + esc(r.msg || '') + '">could not check</small>';
    var actual = runActual(c);
    return r.best > actual ? ' <small class="st-warn" title="The auto-router\'s best routes at that moment. It may not be the true maximum, and it ignores what you might have wanted to leave for other trains.">best found ' + r.best + ' (+' + (r.best - actual) + ', ran ' + Math.round(actual / r.best * 100) + '%)</small>' : ' <small class="st-good">✓ matched the best found (' + r.best + ')</small>';
  }
  function rtBody(d, k, col) {
    var R = d.routes[Math.min(Math.max(k, 0), d.routes.length - 1)], rows = '';
    R.corps.forEach(function (c) {
      var sw = col[c.corp] ? '<i class="sw" style="background:' + col[c.corp] + '"></i>' : '';
      if (!c.trains.length) { rows += '<tr class="tot"><td>' + sw + esc(c.corp) + '</td><td colspan="3">' + esc(c.kind || 'did not run') + '</td></tr>'; return; }
      c.trains.forEach(function (t, i) {
        rows += '<tr><td>' + (i === 0 ? sw + '<b>' + esc(c.corp) + '</b>' : '') + '</td><td>' + trainGlyph(d.title, t.train) + esc(t.train) + '</td><td class="n">' + esc(t.rev) + '</td><td class="stp">' + esc(t.stops) + (t.same ? ' <small class="st-same" title="The same train ran the same stops as in this company\'s previous run">= same</small>' : '') + '</td></tr>';
      });
      rows += '<tr class="tot"><td></td><td>total' + (c.extra.length ? ' (+ ' + esc(c.extra.join(', ')) + ' extra)' : '') + '</td><td class="n">' + esc(c.total || '') + (c.delta ? ' <small class="' + (c.delta < 0 ? 'st-warn' : 'st-good') + '" title="Compared with this company\'s previous run">' + (c.delta < 0 ? '▼ ' : '▲ ') + esc(String(Math.abs(c.delta))) + '</small>' : '') + '</td><td>' + esc(c.kind || '') + bestCell(d, c) + '</td></tr>';
    });
    var anyChk = R.corps.some(function (c) { return c.act && c.trains.length && !(ST.rtBest && ST.rtBest[d.id + '|' + c.corp + '|' + c.act]); });
    var SM = rtSummary(d), ra = ST.rtAll && ST.rtAll.gid === d.id && ST.rtAll.running ? ST.rtAll : null;
    var gameBar = ra ? '<p class="sub" style="margin:0 0 6px">Checking the whole game: ' + SM.n + ' of ' + SM.tot + ' runs <button class="lnk rt-stop">stop</button></p>'
      : (SM.tot > SM.n ? '<p class="sub" style="margin:0 0 6px"><button class="lnk rt-game">check the whole game</button> <small style="color:var(--text-muted)">' + (SM.tot - SM.n) + ' runs left to check, roughly ' + Math.ceil((SM.tot - SM.n) * 15 / 60) + ' minutes; you can stop at any time</small></p>' : '');
    var sumBar = SM.n ? '<p class="sub" style="margin:0 0 6px"><b>' + SM.n + ' of ' + SM.tot + ' runs checked:</b> ' + (SM.short ? SM.short + ' left money on the table, <span class="st-warn">' + esc(d.money(SM.gap)) + ' in total</span>' : '<span class="st-good">all matched the best found</span>') + '</p>' : '';
    return gameBar + sumBar + (anyChk ? '<p class="sub" style="margin:0 0 6px"><button class="lnk rt-all">check every company in this round</button> <small style="color:var(--text-muted)">replays to just before each run and asks the site\'s own auto-router for the best routes it can find; about 15 seconds each</small></p>' : '') + '<table class="rt"><thead><tr><th>Company</th><th>Train</th><th>Revenue</th><th>Stops (as the engine logs them)</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  function render(w, d) {
    var doc = w.document, dark = isDark(w), pal = PLAYER_COLORS[dark ? 'dark' : 'light'];
    var m = d.money;
    var me = myName(d.players.map(function (p) { return p.name; }));
    var myTurn = !!me && !d.finished && !d.tt && !!d.live && d.live.acting.indexOf(me) >= 0;
    var soundOn = lsGet('xxStats.sound') === '1', armed = !!w.__xxAudio;
    doc.title = (myTurn ? '● Your turn · ' : '') + d.roundLabel + ' · ' + d.title + ' · ' + d.id + ' · 18xx-JNNstats';
    doc.documentElement.setAttribute('data-theme', themePref() || 'dark');
    try { var nst = doc.getElementById('xxn'); if (nst) nst.disabled = lsGet('xxStats.wide') === '1'; } catch (eN) {}
    if (ST.lookGame !== d.id && !d.tt) { ST.lookGame = d.id; ST.lookId = d.feed.length ? d.feed[0].id : 0; }
    if (!d.tt) ST.maxFeedId = d.feed.length ? d.feed[0].id : 0;
    var leader = Math.max.apply(null, d.players.map(function (p) { return p.value; }));
    var ranked = d.players.slice().sort(function (a, b) { return b.value - a.value; });
    var maxVal = leader || 1;

    var h = [];
    var newer = ST.latest && cmpVer(ST.latest, VERSION) > 0;
    h.push('<header><div class="hr1"><h1>' + esc(d.title) + ' <span style="color:var(--text-muted);font-weight:400">#' + esc(d.id) + '</span></h1>');
    h.push('<span class="kv">Round <b>' + esc(d.roundLabel) + '</b></span><span class="kv">Phase <b>' + esc(d.phase) + '</b></span>');
    h.push('<span class="kv">Bank <b data-f="bank" class="' + (d.bank <= 0 ? 'st-crit' : '') + '">' + esc(m(d.bank)) + '</b>' + (d.bank < 0 ? ' <small class="st-crit">broken</small>' : '') + '</span>');
    if (d.nextTrain) h.push('<span class="kv opt">Next train <b>' + esc(d.nextTrain.name) + '</b> ' + esc(m(d.nextTrain.price)) + '</span>');
    if (d.finished) h.push('<span class="pill" style="border-color:var(--crit);color:var(--crit)">Game over</span>');
    h.push('<span class="grow"></span><span class="tb">' +
      '<label class="mesel">I am <select id="me"><option value="">…</option>' + d.players.map(function (p) { return '<option' + (p.name === me ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label>' +
      '<button class="ib" id="snd" title="' + (soundOn ? (armed ? 'Sound on: plays when it becomes your turn. Click to switch off.' : 'Click once to arm the sound (browsers need a click)') : 'Sound off. Click to play a sound when it becomes your turn.') + '">' + (soundOn ? (armed ? '🔔' : '🔔?') : '🔕') + '</button>' +
      '<button class="ib" id="rf" title="Refresh now">⟳</button>' +
      '<button class="ib" id="sn" title="Move this window to the right half of the screen">◨</button>' +
      '<button class="ib" id="tt" title="History: step back through the game round by round">⏱</button>' +
      '<button class="ib" id="th" title="Switch between dark and light">' + (dark ? '🌙' : '☀') + '</button>' +
      '<details class="menu" id="mn"' + (ST.menuOpen ? ' open' : '') + '><summary class="ib" title="More">⋯</summary><div class="mp2">' +
        '<button id="lr" title="Restore the default order and expand all sections">Reset <span id="lm">layout</span></button>' +
        '<span style="display:flex;gap:6px;align-items:center">Text size <button id="zo" title="Smaller text">A−</button><button id="zi" title="Larger text">A+</button></span> <button id="sh-v" class="ib" title="Copy a link that opens this game with your card layout (no names or other data are in it)">🔗</button> <button id="nw" class="ib" title="Switch between the single-column layout used in narrow windows and the normal layout">▯</button>' +
        '<form id="gf" style="display:flex;gap:6px"><input id="gi" placeholder="game # or link" size="14" value="' + esc(ST.giVal || '') + '"><button>Open</button></form>' +
        '<div style="color:var(--text-muted)">Look at another game, old or live.</div></div></details></span></div>');
    h.push('<div class="hr2"><a href="' + REPO_URL + '" target="_blank" rel="noopener" style="color:inherit">18xx-JNNstats v' + VERSION + ' by jimiste</a>' +
      (newer ? (ST.latestSha ? ' · <a class="upd" id="upd" href="#" title="Load the newest version now. It lasts until you reload the game page; the bookmark itself is not changed.">⬆ v' + esc(ST.latest) + ' available, click to update</a> <a class="upd" style="font-weight:400" href="' + REPO_URL + '/blob/main/CHANGELOG.md" target="_blank" rel="noopener">what is new</a>'
        : ' · <a class="upd" href="' + REPO_URL + '/blob/main/CHANGELOG.md" target="_blank" rel="noopener" title="A newer version exists. If you pinned a version, read the changelog, then update your bookmark.">⬆ v' + esc(ST.latest) + ' available</a>') : '') +
      ' · ' + d.actions + ' actions · updated ' + d.updated.toLocaleTimeString() + ' · ' + esc(d.tt ? 'viewing history' : ST.statusText || '') +
      (d.pin ? ' · <span class="st-warn" title="The site froze this game to an older version of the rules after a design change. The numbers here are replayed with that older version.">📌 pinned to version ' + esc(d.pin) + '</span>' : '') +
      (ST.verify ? ' · <span class="' + (ST.verify.ok ? 'st-good' : 'st-warn') + '" title="After each round the whole game is replayed from scratch and compared with the live numbers">' + (ST.verify.ok ? '✓ verified' : '⚠ corrected') + ' at ' + esc(ST.verify.at) + '</span>' : '') +
      (ST.ttOpen && ST.rounds && ST.rounds.length > 1 ? (function () {
        var tl = ST.rounds.length - 1, ti = d.tt ? d.tt.idx : tl;
        return '<div class="hr3' + (d.tt ? ' on' : '') + '"><span>⏱ History</span><button class="ib" id="tt-p" title="Previous round">◀</button><input type="range" id="tt-i" min="0" max="' + tl + '" value="' + ti + '"><button class="ib" id="tt-n" title="Next round">▶</button><b id="tt-l">' + (d.tt ? 'the game after ' + esc(d.tt.label) : 'Now') + '</b>' + (d.tt ? ' <span class="tt-note">paused, read only</span> <button class="lnk" id="tt-x">back to now</button>' : '') + '</div>';
      })() : '') +
      '</header><main>');

    // ---------- Live sections: Now, What just happened, Stock round helper -----------------
    var L = d.live;
    var buysTxt = function (n) { return n === 1 ? 'on the next buy' : 'in ' + n + ' buys'; };
    if (!d.finished && L) {
      h.push('<section class="card"><h2>Now</h2>');
      h.push('<p class="nowline">' + (myTurn ? '<span class="pill yours">● Your turn</span> ' : '') + 'To act: <b>' + (L.acting.length ? L.acting.map(function (a) { return a === me ? '<span class="mename">' + esc(a) + '</span>' : esc(a); }).join(', ') : '—') + '</b>' +
        (L.current && L.acting.indexOf(L.current) < 0 ? ' for <b>' + esc(L.current) + '</b>' : '') +
        ' · ' + esc(d.roundLabel) + (L.isOR && L.orsInSet ? ' <span style="color:var(--text-muted)">(operating round ' + L.orNum + ' of ' + L.orsInSet + ' in this set' + (L.orsInSet - L.orNum > 0 ? ', ' + (L.orsInSet - L.orNum) + ' more to come' : ', then a stock round') + ')</span>' : '') +
        (L.priority ? ' · Priority deal: <b>' + esc(L.priority) + '</b>' : '') + '</p>');
      if (L.order.length) h.push('<div class="chips">' + L.order.map(function (o) {
        return '<span class="chip ' + o.state + '"' + (o.color ? ' data-corp="' + esc(o.name) + '"' : '') + ' title="' + (o.state === 'done' ? 'has acted' : o.state === 'current' ? 'acting now' : 'still to act') + (o.owner ? ' · president ' + esc(o.owner) : '') + '">' + (o.color ? '<i class="sw" style="background:' + displayColor(o.color, dark) + '"></i>' : '') + (o.state === 'done' ? '✓ ' : o.state === 'current' ? '▶ ' : '') + esc(o.name) + '</span>';
      }).join('') + '</div>');
      h.push('<div class="tiles">');
      // Me
      if (me) {
        var mp = d.players.filter(function (p) { return p.name === me; })[0], mr = ranked.indexOf(mp) + 1;
        h.push('<div class="tile"><div class="l">Me · ' + esc(me) + '</div><div class="v" data-f="me:v">' + esc(m(mp.value)) + ' <small class="sm">#' + mr + ' of ' + ranked.length + '</small></div>' +
          '<div class="d2">' + (mr === 1 ? 'leading by ' + esc(m(mp.value - (ranked[1] ? ranked[1].value : 0))) : esc(m(leader - mp.value)) + ' behind ' + esc(ranked[0].name)) + '</div>' +
          '<div class="d2">Cash <b data-f="me:c">' + esc(m(mp.cash)) + '</b>' + (mp.certLimit ? ' · room for <b>' + Math.max(0, mp.certLimit - mp.certs) + '</b> more certificate' + (mp.certLimit - mp.certs === 1 ? '' : 's') : '') + '</div>' +
          (L.priority ? '<div class="d2">' + (L.priority === me ? 'You hold the priority deal' : 'Priority deal: ' + esc(L.priority)) + '</div>' : '') + '</div>');
      } else {
        h.push('<div class="tile"><div class="l">Me</div><div class="d2">Pick your name under <b>I am…</b> at the top to highlight yourself everywhere and get a turn signal.</div></div>');
      }
      // Train rush
      if (L.rush) {
        var ru = L.rush;
        h.push('<div class="tile"><div class="l">Train rush · phase ' + esc(ru.phase) + '</div><div class="v ' + (ru.possible ? 'st-warn' : '') + '">' + (ru.possible ? '⚠ possible now' : 'not yet') + '</div>' +
          '<div class="d2">Phase ' + esc(ru.phase) + ' starts ' + buysTxt(ru.need) + ' (' + esc(m(ru.cost)) + ' of trains).</div>' +
          '<div class="d2">The ' + esc(ru.scope) + ' hold ' + esc(m(ru.cash)) + ' and could buy <b>' + ru.bought + ' of ' + ru.need + '</b> from their treasuries' + (ru.who.length ? ' (' + esc(ru.who.join(', ')) + ')' : '') + '.</div>' +
          (ru.rust.length ? '<div class="d2 st-crit">Rusts: ' + esc(ru.rust.join(', ')) + '</div>' : '') + (ru.obsolete.length ? '<div class="d2 st-warn">Becomes obsolete: ' + esc(ru.obsolete.join(', ')) + '</div>' : '') + '</div>');
      }
      // Game end
      var en = L.end;
      var endList = en.conditions.map(function (c) {
        return '<div class="d2">• ' + esc(c.text || c.reason) + ' <span style="color:var(--text-muted)">(' + esc(c.timing) + ')</span>' +
          (c.via ? ' — trigger train <b>' + esc(c.via.train) + '</b> is ' + (c.via.away === 1 ? 'the next one bought' : c.via.away + ' trains away') + (c.via.ev ? '. ' + esc(c.via.ev) : '') : '') + '</div>';
      }).join('');
      h.push('<div class="tile"><div class="l">Game end</div>' +
        (en.triggered ? '<div class="v st-crit">Triggered</div><div class="d2">' + esc(en.triggered.reason) + ' → ends ' + esc(en.triggered.timing) + '</div>'
          : en.bankORs != null ? '<div class="v">≈ ' + (en.bankORs < 10 ? en.bankORs.toFixed(1) : Math.round(en.bankORs)) + ' <small class="sm">ORs of bank left at this pace</small></div><div class="d2">Bank ' + esc(m(d.bank)) + ', falling about ' + esc(m(en.bankDrop)) + ' per OR lately (a guess: payouts grow, so it is shorter in practice).</div>'
          : '<div class="v sm2">not triggered</div>') +
        (endList ? '<details class="d2" style="margin-top:6px"><summary style="cursor:pointer"><b>How the game can end</b></summary>' + endList + '</details>' : '') + '</div>');
      h.push('</div></section>');

      // What just happened: latest moves, plus everything since your own last move
      var rc = me && d.recap && d.recap.lines.length ? d.recap : null;
      var fTab = ST.feedTab || (myTurn && rc ? 'since' : 'latest'); if (fTab === 'since' && !rc) fTab = 'latest';
      h.push('<section class="card"><h2>What just happened</h2>' +
        (rc ? '<div class="tabs" id="fd-tabs"><button data-t="latest"' + (fTab === 'latest' ? ' class="on"' : '') + '>Latest moves</button><button data-t="since"' + (fTab === 'since' ? ' class="on"' : '') + '>Since your last turn (' + rc.total + (rc.total >= 120 ? '+' : '') + ')</button></div>' : '') +
        '<div id="fd-latest"' + (fTab === 'latest' ? '' : ' hidden') + '><p class="sub">Latest moves, newest first. <span class="newdot"></span> = since you last looked here <button id="seen" class="lnk">mark all as seen</button></p><ul class="feed">' +
        d.feed.map(function (f) { return '<li class="' + (f.head ? 'head' : '') + (ST.lookId != null && f.id > ST.lookId ? ' new' : '') + '">' + esc(f.msg) + '</li>'; }).join('') + '</ul></div>' +
        (rc ? '<div id="fd-since"' + (fTab === 'since' ? '' : ' hidden') + '><p class="sub">Everything logged after your own last move, newest first.</p><ul class="feed">' + rc.lines.map(function (f) { return '<li class="' + (f.head ? 'head' : '') + '">' + esc(f.msg) + '</li>'; }).join('') + '</ul></div>' : '') +
        '</section>');

      // Stock round helper
      if (L.market.length) {
        h.push('<section class="card wide"><h2>Stock round helper</h2><p class="sub">Shares still available, what a share pays, and where the price goes next. ' + (L.hasPreview ? 'Price preview assumes the company earns the same as its last run.' : 'Price preview appears once the first operating round has been played.') + '</p><div class="tw"><table><thead><tr><th>Corp</th><th>Price</th><th title="Shares left in the initial offering">IPO</th><th title="Shares in the bank pool / market">Market</th><th title="Dividend per share at the last operating turn">Last div / share</th><th title="Last dividend per share as % of the share price">Yield</th><th>If it pays →</th><th>If it withholds →</th><th style="text-align:left">Presidency</th></tr></thead><tbody>');
        L.market.forEach(function (k) {
          var arrow = function (v) { if (v == null) return '<span style="color:var(--text-muted)">—</span>'; var dl = v - k.price; return '<b>' + esc(m(v)) + '</b> <span class="' + (dl > 0 ? 'up' : dl < 0 ? 'down' : 'flat') + '">' + (dl > 0 ? '▲' : dl < 0 ? '▼' : '■') + (dl ? ' ' + esc(m(Math.abs(dl))) : '') + '</span>'; };
          var prs = !k.pres ? '<span style="color:var(--text-muted)">—</span>'
            : '<span' + (k.pres.name === me ? ' class="mename"' : '') + '>' + esc(k.pres.name) + '</span> ' + k.pres.pct + '%' +
              (k.chal ? (k.need <= 1 ? ' <span class="st-crit">⚠ ' + esc(k.chal.name) + ' (' + k.chal.pct + '%) takes it with 1 more share' + (k.canTake ? '' : ', none available now') + '</span>'
                : k.need === 2 ? ' <span class="st-warn">' + esc(k.chal.name) + ' (' + k.chal.pct + '%) needs 2 more</span>'
                : ' <span style="color:var(--text-muted)">next: ' + esc(k.chal.name) + ' ' + k.chal.pct + '%</span>') : '');
          h.push('<tr data-corp="' + esc(k.name) + '" data-mrow="' + esc(k.name) + '"><td><i class="sw" style="background:' + displayColor(k.color, dark) + '"></i><b>' + esc(k.name) + '</b>' + (k.orState === 'done' ? ' <small style="color:var(--text-muted)">ran</small>' : k.orState === 'current' ? ' <small class="st-warn">▶ now</small>' : '') + '</td><td data-f="mk:' + esc(k.name) + '">' + esc(m(k.price)) + '</td><td>' + (k.ipo ? k.ipo + ' × ' + k.sharePct + '%' : '<span style="color:var(--text-muted)">0</span>') + '</td><td>' + (k.pool ? k.pool + ' × ' + k.sharePct + '%' : '<span style="color:var(--text-muted)">0</span>') + '</td>' +
            '<td>' + (k.dps == null ? '—' : esc(m(k.dps)) + (k.lastKind && k.lastKind !== 'payout' ? ' <small style="color:var(--text-muted)">' + esc(k.lastKind) + '</small>' : '')) + '</td><td>' + (k.yield == null ? '—' : k.yield.toFixed(1) + '%') + '</td>' +
            '<td title="' + (k.estRevenue != null ? 'if it pays out ' + esc(m(k.estRevenue)) : '') + '">' + arrow(k.ifPay) + '</td><td>' + arrow(k.ifHold) + '</td><td style="text-align:left">' + prs + '</td></tr>');
        });
        h.push('</tbody></table></div></section>');
      }
    }

    // Stock market grid
    if (d.grid && d.grid.cells.length) {
      var gLast = d.gridHist.length - 1, gIdx = ST.gridIdx != null && ST.gridIdx < gLast ? ST.gridIdx : gLast;
      h.push('<section class="card wide"><h2>Stock market</h2><p class="sub">Where every company stands on the market. Your own companies are outlined' + (me ? '' : ' once you pick your name under <b>I am…</b>') + '. Hover a company to find it everywhere.</p>');
      if (gLast > 0) h.push('<div class="gslide"><span>Round</span><input type="range" id="gr-i" min="0" max="' + gLast + '" value="' + gIdx + '"><b id="gr-l">' + esc(gIdx === gLast ? 'Now' : d.gridHist[gIdx].label) + '</b></div>');
      h.push('<div id="gr-b">' + gridBody(d, dark, me, gIdx, m) + '</div></section>');
    }

    // Game log with a round slider
    if (d.gameLog && d.gameLog.rounds.length) {
      var glCol = {}; d.players.forEach(function (p) { glCol[p.name] = pal[p.idx % pal.length]; });
      var GL = d.gameLog, glLast = GL.rounds.length - 1, glIdx = ST.glIdx != null && ST.glGame === d.id && ST.glIdx <= glLast ? ST.glIdx : glLast;
      h.push('<section class="card wide"><h2>Game log</h2><p class="sub">Drag the slider (or use ◀ ▶ and the arrow keys) to read the game round by round. Search looks through the whole game.</p>' +
        '<div class="gslide"><span>Round</span><button id="gl-p" title="Previous round">◀</button><input type="range" id="gl-i" min="0" max="' + glLast + '" value="' + glIdx + '"><button id="gl-n" title="Next round">▶</button><b id="gl-l">' + esc(GL.rounds[glIdx].label) + '</b></div>' +
        '<div class="gltools"><input type="search" id="gl-q" placeholder="Search the whole log…" value="' + esc(ST.glQ || '') + '">' + (me && GL.meRound >= 0 ? ' <button id="gl-me" class="lnk">jump to my last move</button>' : '') + '</div>' +
        '<div class="tabs" id="gl-k">' + Object.keys(GL_NAMES).map(function (k) { return '<button class="pill' + (ST.glGame === d.id && ST.glKind === k ? ' cur' : '') + '" data-k="' + k + '">' + GL_NAMES[k] + '</button>'; }).join(' ') +
        ' <select id="gl-c"><option value="">All companies</option>' + d.ticker.map(function (t) { return '<option' + (ST.glGame === d.id && ST.glCo === t.name ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select></div>' +
        '<ul class="feed gl" id="gl-b">' + glBody(d, glIdx, ST.glQ, glCol, me) + '</ul></section>');
    }

    // Stock ticker
    if (d.ticker && d.ticker.length) {
      h.push('<section class="card wide"><h2>Stock ticker</h2><p class="sub">Share price now · change since the previous round · trend over the game</p><div class="ticker">');
      d.ticker.forEach(function (tk) {
        var dlt = tk.prev != null ? tk.price - tk.prev : 0, pct = tk.prev ? dlt / tk.prev * 100 : 0;
        var cls = dlt > 0 ? 'up' : dlt < 0 ? 'down' : 'flat', arrow = dlt > 0 ? '▲' : dlt < 0 ? '▼' : '■';
        var tot = tk.first ? (tk.price - tk.first) / tk.first * 100 : 0;
        h.push('<div class="tk' + (tk.closed ? ' closed' : '') + '" data-corp="' + esc(tk.name) + '" title="' + esc(tk.name) + ': ' + esc(m(tk.first)) + ' → ' + esc(m(tk.price)) + ' over the game (' + (tot >= 0 ? '+' : '') + tot.toFixed(0) + '%)"><div><span class="nm"><i class="sw" style="background:' + displayColor(tk.color, dark) + '"></i>' + esc(tk.name) + '</span>' + (tk.closed ? ' <small>' + (tk.into ? esc(tk.how) + ' <b data-corp="' + esc(tk.into) + '">' + esc(tk.into) + '</b>' : 'closed') + '</small>' : '') +
          '<div class="px" data-f="tp:' + esc(tk.name) + '">' + esc(m(tk.price)) + '</div><div class="ch ' + cls + '">' + arrow + ' ' + (dlt ? (dlt > 0 ? '+' : '−') + esc(m(Math.abs(dlt))) + ' (' + Math.abs(pct).toFixed(1) + '%)' : 'unchanged') + '</div></div>' + sparkline(tk.spark, tk.color, dark) + '</div>');
      });
      h.push('</div></section>');
    }

    // Standings
    h.push('<section class="card"><h2>Standings</h2><p class="sub">Player value = cash + shares at market price' + (d.finished ? ' (final)' : '') + ' <button id="cp" class="lnk" title="Copy the standings and share prices as plain text, to paste into chat">copy as text</button> <button id="cpi" class="lnk" title="Copy the standings and the Player value chart as a picture, to paste into chat">copy as image</button></p><div class="tw"><table><thead><tr><th>#</th><th style="text-align:left">Player</th><th>Value</th><th style="width:30%"></th><th>Gap</th><th>Cash</th><th>Certs</th></tr></thead><tbody>');
    ranked.forEach(function (p, i) {
      var c = pal[p.idx % pal.length];
      var certCls = p.certLimit && p.certs >= p.certLimit ? 'st-crit' : p.certLimit && p.certs >= p.certLimit - 1 ? 'st-warn' : '';
      var isAct = !d.finished && L && L.acting.indexOf(p.name) >= 0;
      h.push('<tr data-prow="' + esc(p.name) + '" class="' + (p.name === me ? 'merow' : '') + (isAct ? ' actrow' : '') + '"><td>' + (i + 1) + '</td><td style="text-align:left">' + (isAct ? '<span class="act" title="to act now">▶</span> ' : '') + '<i class="sw" style="background:' + c + '"></i>' + esc(p.name) + (p.name === me ? ' <small>(me)</small>' : '') + (p.bankrupt ? ' <span class="pill">bankrupt</span>' : '') + '</td><td><b data-f="pv:' + esc(p.name) + '">' + esc(m(p.value)) + '</b></td>');
      h.push('<td><div class="bar"><i style="width:' + (p.value / maxVal * 100).toFixed(1) + '%;background:' + c + '"></i></div></td>');
      h.push('<td>' + (i === 0 ? '—' : '−' + esc(m(leader - p.value))) + '</td><td data-f="pc:' + esc(p.name) + '">' + esc(m(p.cash)) + '</td><td class="' + certCls + '" title="' + (p.certLimit ? 'room for ' + Math.max(0, p.certLimit - p.certs) + ' more' : '') + '">' + p.certs + (p.certLimit ? '/' + p.certLimit + ' <small style="color:var(--text-muted)">(' + Math.max(0, p.certLimit - p.certs) + ' free)</small>' : '') + '</td></tr>');
    });
    h.push('</tbody></table></div>' + (d.certNote ? '<p class="sub" style="margin:6px 0 0"><span class="st-warn">Certificate limit changed from ' + d.certNote.from + ' to ' + d.certNote.to + ' at ' + esc(d.certNote.at) + '.</span> In some titles it changes again with phases or the number of companies.</p>' : '') + '</section>');

    // Value history
    var vModel = modeModel({ labels: d.valueHistory.labels, fmt: m, series: d.players.map(function (p, i) { return { name: p.name, color: pal[p.idx % pal.length], values: d.valueHistory.series[i], bold: p.name === me }; }) });
    var vChart = lineChart(vModel, { title: 'Player value over time', dark: dark, events: d.events, log: ST.chartMode === 'log', snap: ST.chartMode === 'pct' });
    h.push('<section class="card"><h2>Player value over time</h2><p class="sub">Value at the end of each round ' + modeBar() + '</p>' + legend(vModel.series) + '<div class="chart" id="c-value">' + vChart.svg + '<div class="tip"></div></div></section>');

    // Revenue
    var rModel = { labels: d.revenue.labels, fmt: m, series: d.revenue.series };
    var rChart = lineChart(rModel, { title: 'Company revenue per OR', dark: dark, events: d.events });
    h.push('<section class="card"><h2>Company revenue per operating round</h2><p class="sub">● paid out &nbsp;◉ half &nbsp;○ withheld / no run &nbsp;┄ minor</p>' + legend(rModel.series, dark) + '<div class="chart" id="c-rev">' + rChart.svg + '<div class="tip"></div></div></section>');
    if (d.routes && d.routes.length) {
      var rtCol = {}; d.ticker.forEach(function (t) { rtCol[t.name] = displayColor(t.color, dark); });
      var rtLast = d.routes.length - 1, rtIdx = ST.rtIdx != null && ST.rtGame === d.id && ST.rtIdx <= rtLast ? ST.rtIdx : rtLast;
      h.push('<section class="card wide"><h2>Routes &amp; revenue</h2><p class="sub">What each company ran in an operating round: train, revenue and stops, as the engine logs them.' + (CONFIG[d.title] && CONFIG[d.title].trainClass ? ' ' + Object.keys(CONFIG[d.title].trainClass).map(function (k) { var c = CONFIG[d.title].trainClass[k]; return c[0] + ' ' + c[1]; }).join(' &nbsp; ') : '') + '</p>' +
        '<div class="rtsel"><button id="rt-p" title="Earlier round">◀</button><select id="rt-s">' + d.routes.map(function (r, i) { return '<option value="' + i + '"' + (i === rtIdx ? ' selected' : '') + '>' + esc(r.label) + '</option>'; }).join('') + '</select><button id="rt-n" title="Later round">▶</button></div>' +
        '<div class="tw" id="rt-b">' + rtBody(d, rtIdx, rtCol) + '</div>' +
        (d.hexMap ? '<p class="sub" style="margin:8px 0 4px"><button id="rt-mb" class="lnk">' + (ST.rtMap ? '▾ Hide the map sketch' : '🗺 Show the routes on a map sketch') + '</button></p><div id="rt-map">' + (ST.rtMap ? rtMapHtml(d, rtIdx, ST.rtCorp) : '') + '</div>' : '') + '</section>');
    }

    // Share prices
    var pModel = modeModel({ labels: d.prices.labels, fmt: m, series: d.prices.series });
    var pChart = lineChart(pModel, { title: 'Share price', dark: dark, events: d.events, log: ST.chartMode === 'log', snap: ST.chartMode === 'pct' });
    h.push('<section class="card"><h2>Share price</h2><p class="sub">Market price at the end of each round ' + modeBar() + '</p>' + legend(pModel.series, dark) + '<div class="chart" id="c-price">' + pChart.svg + '<div class="tip"></div></div></section>');

    // Portfolio
    var meIdx = d.players.map(function (p) { return p.name; }).indexOf(me);
    var pfSel = Math.min(ST.pfPlayer != null ? ST.pfPlayer : Math.max(0, meIdx), d.portfolio.length - 1);
    if (d.portfolio.length && d.portfolio[0].labels.length > 1) {
      h.push('<section class="card wide"><h2>Portfolios</h2><p class="sub">What each player holds, valued at the market price at the end of each round. Grey is cash, sand is private companies, blue-grey is anything else the title counts in player value (such as bids or debts); layers below zero are short positions or debts.</p>');
      h.push('<div class="tabs" id="pf-tabs">' + d.portfolio.map(function (p, i) { return '<button data-i="' + i + '"' + (i === pfSel ? ' class="on"' : '') + '><i class="sw" style="background:' + pal[d.players[i].idx % pal.length] + '"></i>' + esc(p.name) + '</button>'; }).join('') + '</div>');
      h.push('<div class="chart" id="c-pf"></div>');
      // holdings matrix
      var hc = d.holdings.corps;
      var anyPriv = d.holdings.rows.some(function (r) { return r.priv; });
      var anyOther = d.holdings.rows.some(function (r) { return r.other; });
      h.push('<h2 style="margin-top:12px">Holdings now</h2><p class="sub"><span class="pres">★</span> president · value at current market price</p><div class="tw"><table><thead><tr><th>Player</th>' + hc.map(function (cn) { var col = (d.ticker.find(function (t) { return t.name === cn; }) || {}).color || '#999'; return '<th data-corp="' + esc(cn) + '"><i class="sw" style="background:' + displayColor(col, dark) + '"></i>' + esc(cn) + '</th>'; }).join('') + '<th>Shares total</th>' + (anyPriv ? '<th>Privates</th>' : '') + (anyOther ? '<th title="Other parts of player value, such as bids or debts">Other</th>' : '') + '<th>Cash</th></tr></thead><tbody>');
      d.holdings.rows.forEach(function (row) {
        var tot = 0;
        h.push('<tr><td><i class="sw" style="background:' + pal[row.idx % pal.length] + '"></i>' + esc(row.name) + '</td>' + hc.map(function (cn) {
          var c = row.cells[cn]; if (!c) return '<td data-corp="' + esc(cn) + '" style="color:var(--text-muted)">·</td>';
          tot += c.val;
          return '<td data-corp="' + esc(cn) + '"><span class="' + (c.pct < 0 ? 'short' : '') + '">' + (c.pres ? '<span class="pres">★</span> ' : '') + c.pct + '%' + (c.pct < 0 ? ' short' : '') + '</span><span class="cellv">' + esc(m(c.val)) + '</span></td>';
        }).join('') + '<td><b>' + esc(m(tot)) + '</b></td>' + (anyPriv ? '<td>' + (row.priv ? esc(m(row.priv)) : '') + '</td>' : '') + (anyOther ? '<td>' + (row.other ? esc(m(row.other)) : '') + '</td>' : '') + '<td>' + esc(m(row.cash)) + '</td></tr>');
      });
      h.push('</tbody></table></div></section>');
    }

    // Trains
    var totalLeft = d.trainGroups.reduce(function (a, g) { return a + (g.unlimited ? 0 : g.available); }, 0);
    var unlimitedLeft = d.trainGroups.some(function (g) { return g.unlimited && g.available; });
    var B = d.bank2, bankHtml = '', bankCashTile = '';
    if (B) {
      var trChip = function (r2, i2) { return '<span class="chip' + (i2 === 0 ? ' next' : '') + '">' + (i2 === 0 ? '▶ ' : '') + esc(r2.name) + (r2.n > 1 ? ' × ' + r2.n : '') + ' · ' + esc(m(r2.price)) + '</span>'; };
      var shChip = function (x) { return '<span class="chip" data-corp="' + esc(x.name) + '"><i class="sw" style="background:' + displayColor(x.color || '#999', dark) + '"></i>' + esc(x.name) + ' ' + x.n + ' × ' + x.pct + '%</span>'; };
      bankCashTile = '<div class="tile"><div class="l">Bank cash</div><div class="v">' + esc(m(B.cash)) + '</div></div>';
      var none = '<span style="color:var(--text-muted)">none</span>';
      bankHtml = '<div class="bankrow">' +
        '<div class="bb"><div class="bl">Trains still to come, in order (first = next bought)</div><div class="dq" data-bank="depot">' + (B.up.length ? B.up.map(trChip).join('') : '<span style="color:var(--text-muted)">none left</span>') + '</div>' +
        (B.pool.length ? '<div class="bl">In the bank pool (discarded, can be bought)</div><div class="dq" data-bank="trainpool">' + B.pool.map(function (r2) { return '<span class="chip">' + esc(r2.name) + (r2.n > 1 ? ' × ' + r2.n : '') + ' · ' + esc(m(r2.price)) + '</span>'; }).join('') + '</div>' : '') + '</div>' +
        '<div class="bb"><div class="bl">Shares in the initial offering</div><div class="dq" data-bank="ipo">' + (B.ipo.length ? B.ipo.map(shChip).join('') : none) + '</div></div>' +
        '<div class="bb"><div class="bl">Shares in the market (bank pool)</div><div class="dq" data-bank="pool">' + (B.mpool.length ? B.mpool.map(shChip).join('') : none) + '</div></div></div>';
    }


    h.push('<section class="card wide"><h2>Trains, phases &amp; Bank</h2><p class="sub">What is left in the bank, what is running, and what rusts next</p>');
    h.push('<div class="tiles">' + bankCashTile + '<div class="tile"><div class="l">Trains left in bank</div><div class="v">' + totalLeft + (unlimitedLeft ? ' <small style="font-size:13px;color:var(--text-muted)">+ unlimited</small>' : '') + '</div></div>');
    h.push('<div class="tile"><div class="l">Next train</div><div class="v">' + (d.nextTrain ? esc(d.nextTrain.name) + ' <small style="font-size:13px;color:var(--text-muted)">' + esc(m(d.nextTrain.price)) + '</small>' : '—') + '</div></div>');
    var nextPhase = d.phases.find(function (p) { return p.status === 'future'; });
    h.push('<div class="tile"><div class="l">Next phase</div><div class="v">' + (nextPhase ? esc(nextPhase.name) + ' <small style="font-size:13px;color:var(--text-muted)">' + (nextPhase.inPurchases > 0 ? (nextPhase.inPurchases === 1 ? 'on next buy' : 'in ' + nextPhase.inPurchases + ' buys') : '') + '</small>' : '—') + '</div></div>');
    var rg = d.trainGroups.filter(function (g) { return g.owned && g.rustIn > 0; }).sort(function (a, b) { return a.rustIn - b.rustIn; })[0];
    var hit = rg ? d.trainGroups.filter(function (g) { return g.owned && g.rustIn === rg.rustIn; }) : [];
    var hitCorps = {}; hit.forEach(function (g) { Object.keys(g.owners).forEach(function (o) { hitCorps[o] = 1; }); });
    h.push('<div class="tile"><div class="l">Next rust</div><div class="v">' + (rg ? esc(hit.map(function (g) { return g.sym; }).join(' + ')) + ' <small style="font-size:13px;color:var(--text-muted)">' + (rg.rustIn === 1 ? 'on next buy' : 'in ' + rg.rustIn + ' buys') + '</small><div style="font-size:11px;font-weight:400;color:var(--text-muted)">hits ' + esc(Object.keys(hitCorps).join(', ')) + '</div>' : '<span style="font-size:14px;color:var(--text-muted)">no rust ahead</span>') + '</div></div></div>');
    h.push(bankHtml);

    h.push('<div class="phases">' + d.phases.map(function (p) {
      return '<div class="phase ' + p.status + '"><div class="n">' + esc(p.name) + '</div><div class="d">limit ' + esc(p.trainLimit) + (p.ors ? ' · ' + esc(p.ors) + ' OR' : '') + '</div>' +
        (p.status === 'future' && p.inPurchases > 0 ? '<div class="d">' + (p.inPurchases === 1 ? 'next buy' : 'in ' + p.inPurchases + ' buys') + '</div>' : p.status === 'current' ? '<div class="d">now</div>' : '') + '</div>';
    }).join('') + '</div>');

    h.push('<div class="tw"><table><thead><tr><th>Train</th><th>Variants</th><th>Price</th><th>In bank</th><th>Pool</th><th>Running</th><th>Rusted / gone</th><th style="width:22%">Supply</th><th title="Rusted trains are removed">Rusts when</th><th title="Obsolete is not rusted: the train is on its way out under the rules of this title">Obsolete when</th><th>Held by</th></tr></thead><tbody>');
    d.trainGroups.forEach(function (g) {
      var tot = g.total || 1;
      var isNext = d.nextTrain && d.nextTrain.sym === g.sym;
      h.push('<tr' + (isNext ? ' style="background:color-mix(in srgb,var(--accent) 10%,transparent)"' : '') + '><td><b>' + esc(g.sym) + '</b>' + (isNext ? ' <span class="pill cur">next</span>' : '') + '</td><td>' + esc(g.names.filter(function (n) { return n !== g.sym; }).join(', ') || g.names.join(', ')) + '</td><td>' + esc(m(g.price)) + '</td>');
      h.push('<td><b>' + (g.unlimited && g.available ? '∞' : g.available ? g.available : '<span style="color:var(--text-muted)">0</span>') + '</b></td><td>' + (g.pool || '') + '</td><td>' + (g.owned || '') + '</td><td>' + ((g.rusted + g.removed) || '') + '</td>');
      h.push('<td><div class="bar" title="bank / running / rusted">' +
        (g.available ? '<i style="width:' + (g.available / tot * 100) + '%;background:var(--accent)"></i>' : '') +
        (g.pool ? '<i style="width:' + (g.pool / tot * 100) + '%;background:var(--warn)"></i>' : '') +
        (g.owned ? '<i style="width:' + (g.owned / tot * 100) + '%;background:var(--good)"></i>' : '') +
        ((g.rusted + g.removed) ? '<i style="width:' + ((g.rusted + g.removed) / tot * 100) + '%;background:var(--text-muted);opacity:.45"></i>' : '') + '</div></td>');
      h.push('<td>' + (g.rustsOn ? esc(g.rustsOn) + (g.owned && g.rustIn > 0 ? ' <small class="st-crit">' + buysTxt(g.rustIn) + '</small>' : '') : '—') + '</td><td>' + (g.obsoleteOn ? esc(g.obsoleteOn) + (g.owned && g.obsIn > 0 ? ' <small class="st-warn">' + buysTxt(g.obsIn) + '</small>' : '') : '—') + '</td><td>' + Object.keys(g.owners).map(function (o) { var cc = d.corps.filter(function (x) { return x.name === o; })[0]; return (cc && cc.color ? '<i class="sw" style="background:' + displayColor(cc.color, dark) + '"></i>' : '') + esc(o + (g.owners[o] > 1 ? '×' + g.owners[o] : '')); }).join(', ') + '</td></tr>');
    });
    h.push('</tbody></table></div><p class="sub" style="margin-top:6px"><i class="sw" style="background:var(--accent)"></i>in bank <i class="sw" style="background:var(--warn);margin-left:10px"></i>bank pool <i class="sw" style="background:var(--good);margin-left:10px"></i>running <i class="sw" style="background:var(--text-muted);opacity:.45;margin-left:10px"></i>rusted / removed</p></section>');

    // Corporations
    var anyLoans = d.corps.some(function (c) { return c.loans > 0; });
    h.push('<section class="card wide"><h2>Corporations</h2><p class="sub">Treasury vs next train, train health, recent results</p><div class="tw"><table><thead><tr><th>Corp</th><th>President</th><th>Price</th><th>Treasury</th><th>' + (d.cheapest ? 'Buy cheapest train (' + esc(d.cheapest.name) + (d.cheapest.pool ? ', bank pool' : '') + ' ' + esc(m(d.cheapest.price)) + ')' : 'Buy a train') + '</th><th>Trains</th><th>Train status</th><th title="Station tokens not yet placed / total">Tokens left</th>' + (anyLoans ? '<th>Loans</th><th title="Interest this company owes at its next operating turn">Interest due</th>' : '') + '<th>Last revenue</th><th>Avg last 3</th></tr></thead><tbody>');
    d.corps.forEach(function (c) {
      var ohs = c.oh.slice().sort(function (a, b) { return (a.t * 100 + a.r) - (b.t * 100 + b.r); });
      var last = ohs[ohs.length - 1];
      var l3 = ohs.slice(-3); var avg = l3.length ? l3.reduce(function (a, o) { return a + o.revenue; }, 0) / l3.length : null;
      var b = c.buy, can = !b ? '—'
        : b.kind === 'full' ? '<span style="color:var(--text-muted)">at train limit</span>'
        : b.kind === 'treasury' ? '<span class="st-good">✓ from treasury</span>'
        : b.kind === 'emergency' ? '<span class="st-warn" title="Not a normal purchase: the company cannot pay, so the president must add personal cash (emergency buy)">⚠ emergency buy: ' + esc(c.president) + ' adds ' + esc(m(b.add)) + '</span>'
        : b.kind === 'stuck' ? '<span class="st-crit" title="Not a normal purchase: treasury plus the president\'s cash is not enough, so shares must be sold or the president goes bankrupt">⚠ emergency buy: ' + esc(m(b.shortAfter)) + ' short even with ' + esc(c.president) + '\'s cash</span>'
        : '<span style="color:var(--text-muted)">short ' + esc(m(b.add)) + '</span>';
      if (b && b.loanRoom && b.kind !== 'treasury' && b.kind !== 'full') can += ' <small style="color:var(--text-muted)">or take a loan (' + b.loanRoom + ' left)</small>';
      var obsSoon = c.obsIn.filter(function (x) { return x > 0 && x <= 3; });
      var status = c.needsTrains ? '<span class="st-warn" title="New company that has not operated yet">⚠ needs trains</span>'
        : c.trainless ? '<span class="st-crit">⚠ no trains</span>'
        : c.allRustAt != null ? '<span class="st-crit">⚠ trainless ' + (c.allRustAt === 1 ? 'on next buy' : 'in ' + c.allRustAt + ' buys') + '</span>'
        : c.rustIn.some(function (x) { return x >= 0; }) ? '<span class="st-warn">◐ ' + c.rustIn.filter(function (x) { return x >= 0; }).length + ' will rust</span>'
        : '<span class="st-good">✓ safe</span>';
      if (obsSoon.length) status += ' <span class="st-warn" title="Obsolete is not rusted: the train is on its way out under this title\'s rules">◔ ' + obsSoon.length + ' obsolete ' + buysTxt(Math.min.apply(null, obsSoon)) + '</span>';
      h.push('<tr data-corp="' + esc(c.name) + '" data-crow="' + esc(c.name) + '"' + (!d.finished && L && L.current === c.name && L.isOR ? ' class="actrow"' : '') + '><td>' + (!d.finished && L && L.current === c.name && L.isOR ? '<span class="act" title="operating now">▶</span> ' : '') + '<i class="sw" style="background:' + displayColor(c.color, dark) + '"></i><b>' + esc(c.name) + '</b></td><td>' + esc(c.president) + '</td><td>' + (c.price != null ? esc(m(c.price)) : '—') + '</td><td data-f="ct:' + esc(c.name) + '">' + esc(m(c.cash)) + '</td><td>' + can + '</td>');
      h.push('<td>' + esc(c.trains.map(function (t) { return t.name; }).join(', ') || '—') + '</td><td>' + status + '</td><td>' + (c.tokensTotal ? c.tokensLeft + '/' + c.tokensTotal : '—') + '</td>' + (anyLoans ? '<td>' + (c.loans ? c.loans + (c.maxLoans ? '/' + c.maxLoans : '') : '') + '</td><td>' + (c.interestOwed ? esc(m(c.interestOwed)) : '') + '</td>' : ''));
      h.push('<td>' + (last ? esc(m(last.revenue)) + (last.kind && last.kind !== 'payout' ? ' <small style="color:var(--text-muted)">' + esc(last.kind) + '</small>' : '') : '—') + '</td><td>' + (avg != null ? esc(m(avg)) : '—') + '</td></tr>');
    });
    h.push('</tbody></table></div>');
    if (d.loanInfo) h.push('<p class="sub" style="margin:6px 0 0">Loans: ' + d.loanInfo.total + ' outstanding' + (d.loanInfo.value ? ' at ' + esc(m(d.loanInfo.value)) + ' each' : '') + ' · interest rate <b>' + d.loanInfo.rate + '%</b>' + (d.loanInfo.future != null && d.loanInfo.future !== d.loanInfo.rate ? ' now, <b>' + d.loanInfo.future + '%</b> next' : '') + ' · total interest due next operating round <b>' + esc(m(d.loanInfo.owed)) + '</b></p>');
    if (d.notes.length) h.push('<ul class="notes">' + d.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>');
    h.push('</section>');

    // Minors & private companies
    if ((d.minors && d.minors.length) || (d.companies && d.companies.length)) {
      h.push('<section class="card wide"><h2>Minors &amp; private companies</h2><p class="sub">Who owned what, and when it changed hands or closed</p><div class="tw"><table><thead><tr><th>Company</th><th>Type</th><th>Value</th><th>Revenue</th><th style="text-align:left">Ownership timeline</th><th>Status</th></tr></thead><tbody>');
      var tl = function (items) { return '<div class="tl">' + items.map(function (it, i) { return (i ? '<small>→</small>' : '') + '<span class="o">' + esc(it.owner || 'bank') + '</span><small>' + esc(it.at) + '</small>'; }).join('') + '</div>'; };
      (d.minors || []).forEach(function (mi) {
        var ohs = Object.keys(mi.oh).map(function (k) { return mi.oh[k]; }), tr = ohs.reduce(function (a, o) { return a + o.revenue; }, 0);
        h.push('<tr><td><i class="sw" style="background:' + displayColor(mi.color || '#999', dark) + '"></i><b>' + esc(mi.name) + '</b> <small style="color:var(--text-muted)">' + esc(mi.full) + '</small></td><td>minor</td><td>—</td><td>' + (ohs.length ? esc(m(tr)) + ' <small style="color:var(--text-muted)">over ' + ohs.length + ' ORs</small>' : '—') + '</td><td style="text-align:left">' + tl(mi.owners) + '</td><td>' + (mi.closed ? '<span class="flat">closed after ' + esc(mi.lastSeen) + '</span>' : '<span class="st-good">active</span>') + '</td></tr>');
      });
      (d.companies || []).forEach(function (c) {
        h.push('<tr><td><b>' + esc(c.sym) + '</b> <small style="color:var(--text-muted)">' + esc(c.name) + '</small>' + (c.desc ? '<div class="cdesc">' + esc(c.desc.length > 260 ? c.desc.slice(0, 257) + '…' : c.desc) + '</div>' : '') + '</td><td>private</td><td>' + esc(m(c.value)) + '</td><td>' + (c.revenue ? esc(m(c.revenue)) + '/OR' : '—') + '</td><td style="text-align:left">' + tl(c.timeline.filter(function (x) { return x.owner !== 'closed'; })) + '</td><td>' + (c.closedAt ? '<span class="flat">closed ' + esc(c.closedAt) + '</span>' : '<span class="st-good">open</span>') + '</td></tr>');
      });
      h.push('</tbody></table></div><p class="sub" style="margin-top:6px">Minors also appear as dashed lines in the revenue chart.</p></section>');
    }
    // Bank & depot
    // Tile manifest
    if (d.tiles && d.tiles.groups.length) {
      var TC = { yellow: '#f2d12e', green: '#5cae4a', brown: '#9b6b3d', gray: '#8c8c8c', grey: '#8c8c8c' };
      h.push('<section class="card wide"><h2>Tile manifest</h2><p class="sub">Tiles left in the supply (left / total). ∞ = unlimited. Colours not yet allowed by the current phase are dimmed.</p>' + d.tiles.groups.map(function (gr) {
        return '<div class="tg2' + (gr.available ? '' : ' na') + '"><div class="bl"><i class="sw" style="background:' + (TC[gr.color] || '#999') + '"></i><b>' + esc(gr.color) + '</b> · ' + gr.left + ' left' + (gr.available ? '' : ' · not yet available') + '</div><div class="tcs">' +
          gr.items.map(function (o) { return '<span class="tcp' + (!o.unl && o.left === 0 ? ' z' : '') + '" title="' + esc('tile ' + o.name + ': ' + (o.unl ? 'unlimited' : o.left + ' of ' + o.total + ' left')) + '">#' + esc(o.name) + ' <small style="color:var(--text-muted)">' + (o.unl ? '∞' : o.left + '/' + o.total) + '</small></span>'; }).join('') + '</div></div>';
      }).join('') + '</section>');
    }
    // Data cards (0.15)
    var cModel = null, cChart = null;
    var AN = d.analysis, tkCol = {}; (d.ticker || []).forEach(function (t9) { tkCol[t9.name] = t9.color; });
    if (AN) {
      var lnk = function (act) { return act > 0 && ST.origin ? ' <a class="gla" target="_blank" rel="noopener" href="' + esc(ST.origin + '/game/' + d.id + '?action=' + act) + '" title="Open the game on 18xx.games as it stood at this moment">↗</a>' : ''; };
      var cs = function (c) { return '<i class="sw" style="background:' + displayColor(c || '#999', dark) + '"></i>'; };
      if (AN.track.length) {
        h.push('<section class="card wide"><h2>Track spending vs revenue</h2><p class="sub">What each company paid for tile lays and tokens, against the revenue it has run so far.</p><div class="tw"><table><thead><tr><th>Company</th><th>Tiles</th><th>Tile cost</th><th>Tokens</th><th>Token cost</th><th>Total spent</th><th>Revenue run</th><th>Revenue per 1 spent</th></tr></thead><tbody>' +
          AN.track.map(function (x) {
            var sp = x.tileCost + x.tokenCost, col = tkCol[x.corp];
            return '<tr><td>' + cs(col) + '<b>' + esc(x.corp) + '</b></td><td>' + x.tiles + '</td><td>' + (x.tileCost ? esc(m(x.tileCost)) : '—') + '</td><td>' + x.tokens + '</td><td>' + (x.tokenCost ? esc(m(x.tokenCost)) : '—') + '</td><td>' + (sp ? esc(m(sp)) : '—') + '</td><td>' + (x.rev ? esc(m(x.rev)) + ' <small style="color:var(--text-muted)">in ' + x.runs + ' runs</small>' : '—') + '</td><td>' + (sp && x.rev ? (x.rev / sp).toFixed(1) : '—') + '</td></tr>';
          }).join('') + '</tbody></table></div><p class="sub" style="margin-top:6px">Costs come from the log lines; titles that do not print a cost for some placements show “—”.</p></section>');
      }
      if (AN.money) {
        var SRC = [['div', 'Dividends', '#3987e5'], ['priv', 'Private companies', '#e0a020'], ['sales', 'Share sales', '#4cc36b']];
        h.push('<section class="card wide"><h2>Where the money came from</h2><p class="sub">Cash each player has taken in so far, by source (cash paid for shares is not counted).</p><div class="pies">' +
          AN.money.map(function (pl) {
            var tot = pl.div + pl.priv + pl.sales;
            return '<div class="pie1"><b>' + esc(pl.name) + '</b>' + (tot ? pieSvg(SRC.map(function (sc) { return { v: pl[sc[0]], c: sc[2], t: pl.name + ': ' + sc[1] + ' ' + m(pl[sc[0]]) }; }), 110) : '') +
              '<div class="pl">' + SRC.map(function (sc) { return pl[sc[0]] ? '<span><i class="sw" style="background:' + sc[2] + '"></i>' + sc[1] + ' ' + esc(m(pl[sc[0]])) + ' <small style="color:var(--text-muted)">' + Math.round(pl[sc[0]] / tot * 100) + '%</small></span>' : ''; }).join('') + '</div><small style="color:var(--text-muted)">total ' + esc(m(tot)) + '</small></div>';
          }).join('') + '</div></section>');
      }
      if (AN.val.length) {
        var trPrice = {}; (d.trainGroups || []).forEach(function (gr) { (gr.names || []).forEach(function (nm) { trPrice[nm] = gr.price; }); });
        var corpBy = {}; d.corps.forEach(function (c) { corpBy[c.name] = c; });
        var bookOf = function (v) { var c = corpBy[v.corp]; if (!c || c.closed) return null; var b = c.cash || 0; (c.trains || []).forEach(function (tr2) { b += trPrice[tr2.name] || 0; }); var cap = v.price * (100 / (c.sharePct || 10)); return { cap: cap, book: b, ratio: b > 0 ? cap / b : null }; };
        h.push('<section class="card wide"><h2>Valuation</h2><p class="sub">Share price against what each company paid per share in its last three runs. Payback = how many ORs of that payout it takes to earn the price back. Book = treasury cash plus its trains at list price; market value = price of all its shares.</p><div class="tw"><table><thead><tr><th>Company</th><th>Price</th><th>Last payouts per share</th><th>Yield per OR</th><th>Payback</th><th>Market value</th><th>Book</th><th>Value ÷ book</th></tr></thead><tbody>' +
          AN.val.map(function (v) {
            var bk = bookOf(v);
            return '<tr><td>' + cs(v.color) + '<b>' + esc(v.corp) + '</b></td><td>' + esc(m(v.price)) + '</td><td>' + v.last.map(function (x) { return esc(m(x)); }).join(' · ') + '</td><td>' + v.yld.toFixed(1) + '%</td><td>' + (v.payback ? v.payback.toFixed(1) + ' ORs' : '—') + '</td><td>' + (bk ? esc(m(Math.round(bk.cap))) : '—') + '</td><td>' + (bk ? esc(m(Math.round(bk.book))) : '—') + '</td><td>' + (bk && bk.ratio ? bk.ratio.toFixed(1) + '×' : '—') + '</td></tr>';
          }).join('') + '</tbody></table></div></section>');
      }
      if (AN.trains) {
        var spent = AN.trains.reduce(function (a, x) { return a + x.price; }, 0), inter = AN.trains.filter(function (x) { return !x.depot; });
        h.push('<section class="card wide"><h2>Train purchases</h2><p class="sub">' + AN.trains.length + ' purchases, ' + esc(m(spent)) + ' in total' + (inter.length ? ', ' + inter.length + ' between companies' : '') + '. “vs depot” compares with the first depot price paid for the same train.</p><div class="tw" style="max-height:340px;overflow-y:auto"><table><thead><tr><th>When</th><th>Buyer</th><th>Train</th><th>Paid</th><th>From</th><th>vs depot</th></tr></thead><tbody>' +
          AN.trains.slice().reverse().map(function (x) {
            var dl = x.list != null ? x.price - x.list : null;
            return '<tr><td style="text-align:left">' + esc(x.round.replace(/^Operating Round/, 'OR').replace(/^Stock Round/, 'SR')) + lnk(x.id) + '</td><td><b>' + esc(x.buyer) + '</b></td><td>' + esc(x.train) + '</td><td>' + esc(m(x.price)) + '</td><td>' + esc(x.from) + '</td><td>' + (dl == null ? '—' : dl === 0 ? 'list price' : '<span class="' + (dl > 0 ? 'st-warn' : 'st-good') + '">' + (dl > 0 ? '+' : '−') + esc(m(Math.abs(dl))) + '</span>') + '</td></tr>';
          }).join('') + '</tbody></table></div></section>');
      }
      if (AN.moments.length) {
        h.push('<section class="card wide"><h2>Key moments</h2><p class="sub">Lead changes, the biggest swings in player value, price crashes, closures, each company’s first token and the best single run. ↗ opens the game at that moment.</p><ul class="kml">' +
          AN.moments.slice(0, ST.kmAll ? 999 : 14).map(function (x) { return '<li><span class="kmi">' + ({ lead: '👑', gain: '📈', loss: '📉', run: '🚂', crash: '💥', close: '🔚', token: '🔘' }[x.kind] || '•') + '</span> ' + esc(x.text) + lnk(x.act) + '</li>'; }).join('') + '</ul>' + (AN.moments.length > 14 ? '<button class="lnk" id="km-all">' + (ST.kmAll ? 'show fewer' : 'show all ' + AN.moments.length) + '</button>' : '') + '</section>');
      }
      if (AN.range) {
        var RG = AN.range, cellR = function (v, r) { return esc(m(Math.round(v))) + ' <small style="color:var(--text-muted)">#' + r + '</small>'; };
        h.push('<section class="card wide"><h2>Score range</h2><p class="sub">Player value if the game ended now, and three rough scenarios after ' + RG.n + ' more ORs' + (RG.fromBank ? ' (the bank estimate)' : '') + ': cautious (each player’s smallest recent gain per OR), current pace (the average) and best case (the largest). Not a forecast.</p><div class="tw"><table><thead><tr><th>Player</th><th>Now</th><th>Cautious</th><th>Current pace</th><th>Best case</th></tr></thead><tbody>' +
          RG.rows.slice().sort(function (a, b) { return b.now - a.now; }).map(function (r) {
            return '<tr' + (me && r.name === me ? ' class="merow"' : '') + '><td><b>' + esc(r.name) + '</b></td><td>' + cellR(r.now, r.r_now) + '</td><td>' + cellR(r.low, r.r_low) + '</td><td>' + cellR(r.mid, r.r_mid) + '</td><td>' + cellR(r.high, r.r_high) + '</td></tr>';
          }).join('') + '</tbody></table></div></section>');
      }
    }
    // 0.18 cards: withholding, train timing, badges
    if (d.corps && d.corps.length && d.valueHistory.labels.length > 2) {
      var avg = function (a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; };
      var sgn = function (v) { return v == null ? '—' : (v >= 0 ? '+' : '−') + esc(m(Math.abs(Math.round(v)))); };
      var whRows = [];
      d.corps.forEach(function (c) {
        if (!c.oh || !c.oh.length) return;
        var ps = null; d.prices.series.forEach(function (sx) { if (sx.name === c.name) ps = sx; });
        var Wn = { n: 0, rev: 0, mv: [], run: 0, best: 0 }, Pn = { n: 0, mv: [] };
        c.oh.forEach(function (o) {
          var i = d.prices.labels.indexOf(o.label), mv = ps && i > 0 && ps.values[i] != null && ps.values[i - 1] != null ? ps.values[i] - ps.values[i - 1] : null;
          if (o.kind === 'withhold' && o.revenue > 0) { Wn.n++; Wn.rev += o.revenue; if (mv != null) Wn.mv.push(mv); Wn.run++; if (Wn.run > Wn.best) Wn.best = Wn.run; }
          else if (o.kind === 'payout' || o.kind === 'half') { Pn.n++; if (mv != null) Pn.mv.push(mv); Wn.run = 0; } else Wn.run = 0;
        });
        if (Wn.n) whRows.push({ corp: c.name, pres: c.president, color: c.color, W: Wn, P: Pn });
      });
      if (whRows.length) {
        h.push('<section class="card wide"><h2>Withholding vs paying out</h2><p class="sub">Each time a company kept its revenue instead of paying it out, and how its share price moved in those rounds compared with the rounds it paid. Price moves include everything that happened that round, not only the dividend.</p><div class="tw"><table><thead><tr><th>Company</th><th>President</th><th>Withheld</th><th>Revenue kept</th><th>Longest streak</th><th>Avg price move when withholding</th><th>Avg price move when paying</th></tr></thead><tbody>' +
          whRows.sort(function (a, b) { return b.W.rev - a.W.rev; }).map(function (x) {
            return '<tr><td>' + cs(x.color) + '<b>' + esc(x.corp) + '</b></td><td>' + esc(x.pres || '') + '</td><td>' + x.W.n + ' of ' + (x.W.n + x.P.n) + ' ORs</td><td>' + esc(m(x.W.rev)) + '</td><td>' + x.W.best + '</td><td>' + sgn(avg(x.W.mv)) + '</td><td>' + sgn(avg(x.P.mv)) + '</td></tr>';
          }).join('') + '</tbody></table></div></section>');
      }
      // withholds in detail: what a payout would have given each shareholder
      if (AN && AN.withholds && AN.withholds.length) {
        var wdIdx = h.length; // placed right after the withholding card
        var wdHtml = '<section class="card wide"><h2>Withholds in detail</h2><p class="sub">Each time revenue was kept, what paying it out would have given each shareholder, using who held shares in that round. Shares in the company’s own treasury would have paid the company.</p><div class="tw" style="max-height:340px;overflow-y:auto"><table><thead><tr><th>When</th><th>Company</th><th>Revenue kept</th><th style="text-align:left">A payout would have given</th></tr></thead><tbody>' +
          AN.withholds.slice().reverse().map(function (x) {
            return '<tr><td style="text-align:left">' + esc(x.label) + '</td><td>' + cs(tkCol[x.corp]) + '<b>' + esc(x.corp) + '</b></td><td>' + esc(m(x.rev)) + '</td><td style="text-align:left;white-space:normal"><small>' + Object.keys(x.gets).sort(function (a, b) { return x.gets[b] - x.gets[a]; }).map(function (n) { return '<span' + (me && n === me ? ' class="mename"' : '') + '>' + esc(n) + ' ' + esc(m(x.gets[n])) + '</span>'; }).join(' · ') + '</small></td></tr>';
          }).join('') + '</tbody></table></div></section>';
        h.push(wdHtml);
      }
      // train timing
      var AN2 = d.analysis, corpPres = {}, mapLab = function (lab) { return String(lab).replace(/^Operating Round /, 'OR ').replace(/^Stock Round /, 'SR ').replace(/ \(of \d+\)$/, ''); };
      d.corps.forEach(function (c) { corpPres[c.name] = c; });
      var noRun = {}; (d.routes || []).forEach(function (R) { R.corps.forEach(function (c) { if (!c.trains.length && /does not run/.test(c.kind || '')) noRun[c.corp] = (noRun[c.corp] || 0) + 1; }); });
      if (AN2 && AN2.trains && AN2.trains.length) {
        var byCo = {}, nLab = Math.max(d.valueHistory.labels.length - 1, 1), pl = {};
        d.players.forEach(function (p) { pl[p.name] = { name: p.name, cos: {}, bought: 0, spent: 0, first: null }; });
        AN2.trains.forEach(function (x) {
          var lab = mapLab(x.round), li = d.valueHistory.labels.indexOf(lab), pc = li < 0 ? null : Math.round(li / nLab * 100), who = x.pres || (corpPres[x.buyer] && corpPres[x.buyer].president) || '';
          var o = byCo[x.buyer] || (byCo[x.buyer] = { buys: [], spent: 0 }); o.buys.push({ lab: lab, train: x.train, price: x.price, pc: pc, who: who }); o.spent += x.price;
          var pr = pl[who]; if (pr) { pr.cos[x.buyer] = 1; pr.bought++; pr.spent += x.price; if (pc != null && (pr.first == null || pc < pr.first)) pr.first = pc; }
        });
        var heldBy = {}; d.corps.forEach(function (c) { if (c.president) heldBy[c.president] = (heldBy[c.president] || 0) + c.trains.length; });
        var coRows = Object.keys(byCo).filter(function (n) { return corpPres[n]; }).map(function (n) { var c = corpPres[n]; return { name: n, color: c.color, pres: c.president, o: byCo[n], held: c.trains.length, norun: noRun[n] || 0 }; });
        h.push('<section class="card wide"><h2>Train timing</h2><p class="sub">Who bought trains and when, counted for whoever presided over the company at the time of each purchase. Percentages show how far through the game each first purchase happened' + (d.trainLimit ? '; the current limit is ' + esc(String(d.trainLimit)) + ' trains per company' : '') + '.</p><div class="tw"><table><thead><tr><th>Player</th><th>Companies</th><th>Trains bought</th><th>Spent</th><th>First train at</th><th>Trains held now</th></tr></thead><tbody>' +
          Object.keys(pl).map(function (k) { return pl[k]; }).filter(function (x) { return x.bought; }).sort(function (a, b) { return b.spent - a.spent; }).map(function (x) { return '<tr' + (me && x.name === me ? ' class="merow"' : '') + '><td><b>' + esc(x.name) + '</b></td><td>' + Object.keys(x.cos).length + '</td><td>' + x.bought + '</td><td>' + esc(m(x.spent)) + '</td><td>' + (x.first != null ? x.first + '%' : '—') + '</td><td>' + (heldBy[x.name] || 0) + '</td></tr>'; }).join('') +
          '</tbody></table></div><div class="tw" style="margin-top:10px"><table><thead><tr><th>Company</th><th>President now</th><th style="text-align:left">Purchases (round, train, price, bought under)</th><th>Held now</th><th>ORs with no run</th></tr></thead><tbody>' +
          coRows.sort(function (a, b) { return b.o.spent - a.o.spent; }).map(function (x) { return '<tr><td>' + cs(x.color) + '<b>' + esc(x.name) + '</b></td><td>' + esc(x.pres || '') + '</td><td style="text-align:left;white-space:normal"><small>' + x.o.buys.map(function (b2) { return esc(b2.lab) + ' · ' + esc(b2.train) + ' · ' + esc(m(b2.price)) + (b2.who && b2.who !== x.pres ? ' · ' + esc(b2.who) : ''); }).join('<br>') + '</small></td><td>' + x.held + '</td><td>' + (x.norun || '—') + '</td></tr>'; }).join('') + '</tbody></table></div></section>');
      }
      // badges: only where there is a clear winner; the runner-up is shown too
      var badges = [], VH = d.valueHistory, nf = VH.labels.length, fmtM = function (v) { return m(v); };
      var metricBadge = function (emoji, title, map, fmt, detail) {
        var ks = Object.keys(map).filter(function (k) { return map[k] > 0; }).sort(function (a, b) { return map[b] - map[a]; });
        if (!ks.length || (ks.length > 1 && map[ks[1]] === map[ks[0]])) return;
        badges.push([emoji, title, ks[0], detail(map[ks[0]]), ks.length > 1 ? 'runner-up: ' + ks[1] + ' (' + fmt(map[ks[1]]) + ')' : '']);
      };
      var finalRank = d.players.slice().sort(function (a, b) { return b.value - a.value; });
      var deficit = d.players.map(function (p, i) { var mx = 0; for (var f4 = 0; f4 < nf; f4++) { var best4 = -Infinity; VH.series.forEach(function (sx) { if (sx[f4] != null && sx[f4] > best4) best4 = sx[f4]; }); if (VH.series[i][f4] != null) mx = Math.max(mx, best4 - VH.series[i][f4]); } return mx; });
      var leader0 = finalRank[0], li0 = d.players.indexOf(leader0);
      if (leader0 && deficit[li0] > 0) badges.push(['🧗', 'Biggest comeback', leader0.name, 'was ' + m(deficit[li0]) + ' behind the leader at the lowest point and is now first', '']);
      var lead = {}; for (var f5 = 1; f5 < nf; f5++) { var bi = -1, bv = -Infinity; VH.series.forEach(function (sx, i) { if (sx[f5] != null && sx[f5] > bv) { bv = sx[f5]; bi = i; } }); if (bi >= 0) lead[d.players[bi].name] = (lead[d.players[bi].name] || 0) + 1; }
      metricBadge('👑', 'Most time in the lead', lead, String, function (v) { return 'led in ' + v + ' of ' + (nf - 1) + ' rounds'; });
      if (AN2 && AN2.money) {
        var dv = {}, sl = {}; AN2.money.forEach(function (x) { dv[x.name] = x.div; sl[x.name] = x.sales; });
        metricBadge('💰', 'Dividend king', dv, fmtM, function (v) { return 'took in ' + m(v) + ' in dividends'; });
        metricBadge('🏦', 'Biggest seller', sl, fmtM, function (v) { return 'raised ' + m(v) + ' from selling shares'; });
      }
      var wk = {}; whRows.forEach(function (x) { if (x.pres) wk[x.pres] = Math.max(wk[x.pres] || 0, x.W.best); });
      metricBadge('🛑', 'Longest withhold streak', wk, String, function (v) { return 'kept a company’s revenue ' + v + ' ORs in a row'; });
      var br = {}; (d.routes || []).forEach(function (R) { R.corps.forEach(function (c) { var pr = corpPres[c.corp] && corpPres[c.corp].president; if (pr && c.trains.length && c.totalN != null) br[pr] = Math.max(br[pr] || 0, c.totalN); }); });
      metricBadge('🚂', 'Best single run', br, fmtM, function (v) { return 'one company run earned ' + m(v); });
      var sp2 = {}; if (AN2 && AN2.trains) AN2.trains.forEach(function (x) { var nm = x.pres || (corpPres[x.buyer] && corpPres[x.buyer].president); if (nm) sp2[nm] = (sp2[nm] || 0) + x.price; });
      metricBadge('🔧', 'Train baron', sp2, fmtM, function (v) { return 'spent ' + m(v) + ' on trains as a president'; });
      if (badges.length) h.push('<section class="card wide"><h2>Badges</h2><p class="sub">Just for fun, worked out from this game’s data. A badge only appears when there is a clear winner.</p><div class="badges">' + badges.map(function (b3) { return '<div class="bdg"><span class="bi">' + b3[0] + '</span><div><b>' + esc(b3[1]) + '</b><br><span class="bn">' + esc(b3[2]) + '</span><br><small style="color:var(--text-muted)">' + esc(b3[3]) + (b3[4] ? '<br>' + esc(b3[4]) : '') + '</small></div></div>'; }).join('') + '</div></section>');
    }
    // Compare with another game of the same title
    if (d.valueHistory.labels.length > 1 && !d.tt) {
      var CM = ST.cmp && ST.cmp.gid === d.id ? ST.cmp : null, cmBody = '';
      if (CM && CM.d2) {
        var d2 = CM.d2, f1 = cmpFacts(d), f2 = CM.facts, pts = []; for (var pq = 0; pq <= 20; pq++) pts.push(pq / 20);
        var colOf = {}; d.players.forEach(function (p) { colOf[p.name] = pal[p.idx % pal.length]; });
        var ser = [];
        d.players.forEach(function (p, i) { ser.push({ name: p.name + ' · #' + d.id, color: colOf[p.name], values: pts.map(function (q) { var v = d.valueHistory.series[i]; return v[Math.round(q * (v.length - 1))]; }) }); });
        d2.players.forEach(function (p, i) { var c2 = colOf[p.name] || pal[(p.idx + d.players.length) % pal.length]; ser.push({ name: p.name + ' · #' + d2.id, color: c2, dashed: true, values: pts.map(function (q) { var v = d2.valueHistory.series[i]; return v[Math.round(q * (v.length - 1))]; }) }); });
        var cModel = { labels: pts.map(function (q) { return Math.round(q * 100) + '%'; }), fmt: m, series: ser };
        var cChart = lineChart(cModel, { title: 'Player value, both games', dark: dark });
        var r1 = d.players.slice().sort(function (a, b) { return b.value - a.value; }), r2 = d2.players.slice().sort(function (a, b) { return b.value - a.value; });
        var rank = function (arr, nm) { for (var z = 0; z < arr.length; z++) if (arr[z].name === nm) return z + 1; return null; };
        var names = []; d.players.forEach(function (p) { names.push(p.name); }); d2.players.forEach(function (p) { if (names.indexOf(p.name) < 0) names.push(p.name); });
        var val = function (arr, nm) { for (var z = 0; z < arr.length; z++) if (arr[z].name === nm) return arr[z].value; return null; };
        var cell = function (arr, nm, big) { var v = val(arr, nm); return v == null ? '<span style="color:var(--text-muted)">did not play</span>' : esc(m(v)) + ' <small style="color:var(--text-muted)">#' + rank(arr, nm) + '</small>'; };
        var playRows = names.map(function (nm) { var a1 = val(d.players, nm), b1 = val(d2.players, nm); return '<tr><td><b>' + esc(nm) + '</b></td><td>' + cell(d.players, nm) + '</td><td>' + cell(d2.players, nm) + '</td><td>' + (a1 != null && b1 != null ? '<span class="' + (a1 - b1 >= 0 ? 'st-good' : 'st-warn') + '">' + (a1 - b1 >= 0 ? '+' : '−') + esc(m(Math.abs(a1 - b1))) + '</span>' : '—') + '</td></tr>'; }).join('');
        var fm = function (o) { return o ? esc(o.label) + (o.pct != null ? ' <small style="color:var(--text-muted)">' + o.pct + '%</small>' : '') : '—'; };
        var mrow = function (k, a, b) { return '<tr><td style="text-align:left">' + esc(k) + '</td><td>' + a + '</td><td>' + b + '</td></tr>'; };
        var tn = f1.trainOrder.slice(); f2.trainOrder.forEach(function (x) { if (tn.indexOf(x) < 0) tn.push(x); });
        var pn = f1.phases.map(function (x) { return x.name; }); f2.phases.forEach(function (x) { if (pn.indexOf(x.name) < 0) pn.push(x.name); });
        var ph = function (f, nm) { for (var z = 0; z < f.phases.length; z++) if (f.phases[z].name === nm) return f.phases[z]; return null; };
        var st = function (dd) { return dd.finished ? 'finished' : esc(dd.roundLabel); };
        cmBody = '<p class="sub">This game <b>#' + esc(d.id) + '</b> (solid lines) against <b>#' + esc(d2.id) + '</b> (dashed). Lines are lined up by how far through each game they are.</p>' +
          '<div class="tw"><table><thead><tr><th>Player</th><th>#' + esc(d.id) + ' (' + st(d) + ')</th><th>#' + esc(d2.id) + ' (' + st(d2) + ')</th><th>Difference</th></tr></thead><tbody>' + playRows + '</tbody></table></div>' +
          legend(cModel.series, dark) + '<div class="chart" id="c-cmp">' + cChart.svg + '<div class="tip"></div></div>' +
          '<h3 style="font-size:12px;margin:12px 0 4px">How the two games ran</h3><div class="tw"><table><thead><tr><th>&nbsp;</th><th>#' + esc(d.id) + '</th><th>#' + esc(d2.id) + '</th></tr></thead><tbody>' +
          mrow('Operating rounds', f1.ors, f2.ors) + mrow('Companies', f1.companies, f2.companies) + mrow('Revenue run, all companies', esc(m(f1.runRev)), esc(m(f2.runRev))) +
          mrow('Paid out to players as dividends', esc(m(f1.divs)), esc(m(f2.divs))) + mrow('Spent on trains', esc(m(f1.trainSpend)), esc(m(f2.trainSpend))) + mrow('Trains bought between companies', f1.inter, f2.inter) +
          (f1.tileSpend || f2.tileSpend ? mrow('Spent on tile lays', esc(m(f1.tileSpend)), esc(m(f2.tileSpend))) : '') + mrow('Tokens placed', f1.tokens, f2.tokens) +
          pn.map(function (nm) { return mrow('Phase ' + nm + ' begins', fm(ph(f1, nm)), fm(ph(f2, nm))); }).join('') +
          tn.map(function (nm) { return mrow('First ' + nm + ' train bought', fm(f1.trains[nm]), fm(f2.trains[nm])); }).join('') +
          '</tbody></table></div><p class="sub" style="margin-top:6px">Percentages show how far through the game it happened. A game that is still running is compared as far as it has got.</p>';
      }
      h.push('<section class="card wide"><h2>Compare with another game</h2><p class="sub">Type the number of another game of the same title (and engine version) to see how the two went, for example to follow your progress against the same friends.</p>' +
        '<div class="tb"><input id="cmp-id" inputmode="numeric" placeholder="game number" value="' + esc(ST.cmpTxt || (CM && CM.id) || '') + '" style="font:inherit;font-size:13px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface-0);color:var(--text-primary);width:130px"><button id="cmp-go" class="ib">Compare</button>' + (CM && CM.d2 ? '<button id="cmp-x" class="ib" title="Remove the comparison">✕</button>' : '') + '</div>' +
        (CM && CM.msg ? '<p class="sub" style="margin:8px 0 0">' + esc(CM.msg) + '</p>' : '') + cmBody + '</section>');
    }
    // Replay
    if (d.replay && d.replay.labels.length > 1) {
      var rpLast = d.replay.labels.length - 1, rpK = ST.rpIdx != null && ST.rpGame === d.id && ST.rpIdx <= rpLast ? ST.rpIdx : rpLast, rf = rpFrame(d, rpK, dark, pal, me);
      h.push('<section class="card wide"><h2>Replay</h2><p class="sub">Watch the game unfold round by round: tiles and tokens on the board, who runs where in operating rounds, standings, prices.</p>' +
        '<div class="gslide"><button id="rp-play" title="Play or pause">' + (ST.rpPlay ? '⏸' : '▶') + '</button><button id="rp-p" title="Previous">◀</button><input type="range" id="rp-i" min="0" max="' + rpLast + '" value="' + rpK + '"><button id="rp-n" title="Next">▶</button>' +
        '<b id="rp-l">' + esc(d.replay.labels[rpK]) + '</b><select id="rp-sp" title="Speed"><option value="0.5">slow</option><option value="1" selected>normal</option><option value="2">fast</option></select></div>' +
        '<div class="rpb"><div id="rp-map" class="rpm">' + rf.map + '</div><div id="rp-side" class="rps">' + rf.side + '</div></div></section>');
    }
    // Game info
    if (d.info) {
      var I = d.info, row = function (k, v) { return v ? '<tr><td style="color:var(--text-secondary)">' + esc(k) + '</td><td style="text-align:left;white-space:normal">' + v + '</td></tr>' : ''; };
      h.push('<section class="card wide"><h2>Game info</h2><p class="sub">How this game is set up</p><div class="tw"><table><tbody>' +
        row('Title', esc(d.title)) + row('Players', String(I.players)) +
        row('Development stage', I.stage ? esc(I.stage) + (/alpha|beta/i.test(I.stage) ? ' <small class="st-warn">still in development on 18xx.games, rules may change</small>' : '') : '') +
        row('Optional rules', I.rules.length ? esc(I.rules.join(', ')) : 'none') + row('Play style', I.async ? 'asynchronous (correspondence)' : 'live') +
        row('Auto routing', esc(I.auto)) + row('Pinned version', esc(I.pin)) +
        row('The game ends when', I.ends && I.ends.length ? I.ends.map(esc).join('<br>') : '') + '</tbody></table></div></section>');
    }
    h.push('</main>');

    var scrollY = w.scrollY || 0;
    doc.body.innerHTML = h.join('');
    applyLayout(w, d.finished ? 'review' : 'live');
    w.scrollTo(0, scrollY);
    attachHover(doc, doc.getElementById('c-value'), vModel, vChart, function (i) {
      var vals = vModel.series.map(function (s) { return s.values[i]; }).filter(function (v) { return v != null; });
      return vals.length > 1 ? '<div class="r" style="margin-top:3px;color:var(--text-muted)"><span>spread</span><span>' + esc(m(Math.max.apply(null, vals) - Math.min.apply(null, vals))) + '</span></div>' : '';
    });
    attachHover(doc, doc.getElementById('c-rev'), rModel, rChart);
    attachHover(doc, doc.getElementById('c-price'), pModel, pChart);
    // flash numbers that changed since the last update
    var vals = {};
    Array.prototype.forEach.call(doc.querySelectorAll('[data-f]'), function (el) {
      var k = el.getAttribute('data-f'), v = el.textContent; vals[k] = v;
      if (ST.prevGame === d.id && ST.prevVals && ST.prevVals[k] !== undefined && ST.prevVals[k] !== v) el.classList.add('fl');
    });
    ST.prevVals = vals; ST.prevGame = d.id;
    // glow around the window on your turn
    doc.documentElement.className = myTurn ? 'myturn' : '';
    // hover a company anywhere to light it up everywhere
    var hlSet = function (cn) { Array.prototype.forEach.call(doc.querySelectorAll('[data-corp]'), function (e) { e.classList.toggle('hl', cn != null && e.getAttribute('data-corp') === cn); }); };
    doc.body.onmouseover = function (ev) { var tg = ev.target.closest ? ev.target.closest('[data-corp]') : null, cn = tg ? tg.getAttribute('data-corp') : null; if (cn !== ST.hlCorp) { ST.hlCorp = cn; hlSet(cn); } };
    if (ST.hlCorp) hlSet(ST.hlCorp);
    // stock market round slider (only the grid is redrawn so dragging stays smooth)
    var gr = doc.getElementById('gr-i');
    if (gr) gr.oninput = function () {
      var iv = +gr.value, gl = d.gridHist.length - 1; ST.gridIdx = iv >= gl ? null : iv;
      doc.getElementById('gr-l').textContent = iv >= gl ? 'Now' : d.gridHist[iv].label;
      doc.getElementById('gr-b').innerHTML = gridBody(d, dark, me, iv, m);
      if (ST.hlCorp) hlSet(ST.hlCorp);
    };
    // chart legends: click a name to show only that line (click again to show all)
    Array.prototype.forEach.call(doc.querySelectorAll('.legend'), function (lg) {
      var card = lg.closest('section'), ch = card && card.querySelector('.chart'); if (!ch || !ch.querySelector('.ser')) return;
      var key = (card.querySelector('h2') || {}).textContent || '';
      var apply = function (sel) {
        ST.iso = ST.iso || {}; ST.iso[key] = sel;
        ch.classList.toggle('iso', sel != null);
        Array.prototype.forEach.call(ch.querySelectorAll('.ser,.enl'), function (e) { e.classList.toggle('on', sel != null && e.getAttribute('data-si') === String(sel)); });
        Array.prototype.forEach.call(lg.querySelectorAll('span'), function (sp) { sp.classList.toggle('off', sel != null && sp.getAttribute('data-si') !== String(sel)); });
      };
      Array.prototype.forEach.call(lg.querySelectorAll('span'), function (sp) { sp.onclick = function () { var si = sp.getAttribute('data-si'); apply(ST.iso && ST.iso[key] === si ? null : si); }; });
      if (ST.iso && ST.iso[key] != null) apply(ST.iso[key]);
    });
    // replay: slider, play, speed
    if (ST.rpTimer) { clearInterval(ST.rpTimer); ST.rpTimer = null; }
    var rpi = doc.getElementById('rp-i');
    if (rpi && d.replay) {
      var rpSet = function (v) {
        v = Math.min(Math.max(v, 0), d.replay.labels.length - 1); rpi.value = v; ST.rpIdx = v; ST.rpGame = d.id;
        var fr = rpFrame(d, v, dark, pal, me); doc.getElementById('rp-l').textContent = d.replay.labels[v];
        doc.getElementById('rp-map').innerHTML = fr.map; doc.getElementById('rp-side').innerHTML = fr.side;
      };
      var rpStart = function () {
        if (ST.rpTimer) clearInterval(ST.rpTimer);
        ST.rpTimer = setInterval(function () {
          if (!doc.getElementById('rp-i')) { clearInterval(ST.rpTimer); ST.rpTimer = null; return; }
          if (+rpi.value >= d.replay.labels.length - 1) { ST.rpPlay = false; clearInterval(ST.rpTimer); ST.rpTimer = null; doc.getElementById('rp-play').textContent = '▶'; return; }
          rpSet(+rpi.value + 1);
        }, 1400 / (parseFloat(doc.getElementById('rp-sp').value) || 1));
      };
      rpi.oninput = function () { rpSet(+rpi.value); };
      doc.getElementById('rp-p').onclick = function () { rpSet(+rpi.value - 1); };
      doc.getElementById('rp-n').onclick = function () { rpSet(+rpi.value + 1); };
      doc.getElementById('rp-sp').onchange = function () { if (ST.rpPlay) rpStart(); };
      doc.getElementById('rp-play').onclick = function () {
        ST.rpPlay = !ST.rpPlay; this.textContent = ST.rpPlay ? '⏸' : '▶';
        if (ST.rpPlay) { if (+rpi.value >= d.replay.labels.length - 1) rpSet(0); rpStart(); } else if (ST.rpTimer) { clearInterval(ST.rpTimer); ST.rpTimer = null; }
      };
      if (ST.rpPlay) rpStart();
    }
    Array.prototype.forEach.call(doc.querySelectorAll('.cm'), function (b) { b.onclick = function () { ST.chartMode = b.getAttribute('data-cm'); rerender(); }; });
    var kma = doc.getElementById('km-all'); if (kma) kma.onclick = function () { ST.kmAll = !ST.kmAll; rerender(); };
    // compare card
    var cmpGo = doc.getElementById('cmp-go');
    if (cmpGo) {
      var cmpIn = doc.getElementById('cmp-id');
      cmpIn.oninput = function () { ST.cmpTxt = cmpIn.value; };
      var cmpRun = function () { var id = String(cmpIn.value).replace(/\D/g, ''); ST.cmpTxt = id; if (!id) return; if (id === String(d.id)) { ST.cmp = { gid: d.id, id: id, msg: 'That is this game. Enter another game number.' }; rerender(); return; } loadCompare(w, d, id); };
      cmpGo.onclick = cmpRun; cmpIn.onkeydown = function (e) { if (e.key === 'Enter') cmpRun(); };
      var cmpX = doc.getElementById('cmp-x'); if (cmpX) cmpX.onclick = function () { ST.cmp = null; ST.cmpTxt = ''; rerender(); };
      var cc = doc.getElementById('c-cmp'); if (cc && cModel) attachHover(doc, cc, cModel, cChart);
    }
    // routes card: round picker
    var rts = doc.getElementById('rt-s');
    if (rts && d.routes) {
      var rtCol2 = {}; d.ticker.forEach(function (t) { rtCol2[t.name] = displayColor(t.color, dark); });
      var rtMapDraw = function () {
        var box = doc.getElementById('rt-map'); if (!box) return;
        box.innerHTML = ST.rtMap ? rtMapHtml(d, +rts.value, ST.rtCorp) : '';
        Array.prototype.forEach.call(box.querySelectorAll('.rtc'), function (b) { b.onclick = function () { ST.rtCorp = b.getAttribute('data-c'); rtMapDraw(); }; });
        var rci = doc.getElementById('rt-ci'), cur = box.querySelector('.rtc.cur');
        if (rci && cur) rci.onclick = function () {
          var lbl = function (t) { try { rci.textContent = t; setTimeout(function () { try { rci.textContent = 'copy as image'; } catch (e) {} }, 1800); } catch (e) {} };
          try {
            routeImage(d, Math.min(Math.max(+rts.value, 0), d.routes.length - 1), cur.getAttribute('data-c'), dark).toBlob(function (b) {
              var save = function () { try { var a = w.document.createElement('a'); a.href = w.URL.createObjectURL(b); a.download = '18xx-routes.png'; w.document.body.appendChild(a); a.click(); a.remove(); lbl('saved as a file'); } catch (e) { lbl('copy failed'); } };
              try { w.navigator.clipboard.write([new w.ClipboardItem({ 'image/png': b })]).then(function () { lbl('copied \u2713'); }, save); } catch (e) { save(); }
            }, 'image/png');
          } catch (e) { lbl('copy failed'); }
        };
      };
      var rtSet = function (v) { v = Math.min(Math.max(v, 0), d.routes.length - 1); rts.value = v; ST.rtIdx = v; ST.rtGame = d.id; doc.getElementById('rt-b').innerHTML = rtBody(d, v, rtCol2); rtMapDraw(); };
      var rtmb = doc.getElementById('rt-mb');
      if (rtmb) rtmb.onclick = function () { ST.rtMap = !ST.rtMap; rtmb.textContent = ST.rtMap ? '▾ Hide the map sketch' : '🗺 Show the routes on a map sketch'; rtMapDraw(); };
      var rtb = doc.getElementById('rt-b');
      if (rtb) rtb.onclick = function (e) {
        var stopB = e.target && e.target.closest ? e.target.closest('.rt-stop') : null;
        if (stopB) { if (ST.rtAll) ST.rtAll.stop = true; return; }
        var gameB = e.target && e.target.closest ? e.target.closest('.rt-game') : null;
        if (gameB) {
          var q2 = []; d.routes.forEach(function (R) { R.corps.forEach(function (c) { if (c.act && c.trains.length) q2.push([c.corp, c.act]); }); });
          ST.rtBest = ST.rtBest || {}; ST.rtAll = { gid: d.id, running: true, stop: false };
          var st2 = function (i) {
            if (i >= q2.length || ST.rtAll.stop || !ST.game || !ST.game.raw) { ST.rtAll.running = false; try { rtSet(+rts.value); } catch (e6) {} return; }
            var k3 = d.id + '|' + q2[i][0] + '|' + q2[i][1]; if (ST.rtBest[k3] && ST.rtBest[k3].s !== 'err') return st2(i + 1);
            ST.rtBest[k3] = { s: 'run' };
            bestRun(ST.game.raw, q2[i][0], q2[i][1]).then(function (r) { ST.rtBest[k3] = { s: 'ok', best: r.best }; }, function (err) { ST.rtBest[k3] = { s: 'err', msg: String(err && err.message || err) }; })
              .then(function () { try { rtSet(+rts.value); } catch (e7) {} setTimeout(function () { st2(i + 1); }, 20); });
          };
          try { rtSet(+rts.value); } catch (e8) {} st2(0); return;
        }
        var all = e.target && e.target.closest ? e.target.closest('.rt-all') : null;
        if (all) { var qs = Array.prototype.map.call(rtb.querySelectorAll('.rt-chk'), function (x) { return [x.getAttribute('data-c'), +x.getAttribute('data-a')]; }); ST.rtBest = ST.rtBest || {};
          var step = function (i) { if (i >= qs.length || !ST.game || !ST.game.raw) return; var k2 = d.id + '|' + qs[i][0] + '|' + qs[i][1]; if (ST.rtBest[k2]) return step(i + 1); ST.rtBest[k2] = { s: 'run' }; try { rtSet(+rts.value); } catch (e3) {}
            bestRun(ST.game.raw, qs[i][0], qs[i][1]).then(function (r) { ST.rtBest[k2] = { s: 'ok', best: r.best }; }, function (err) { ST.rtBest[k2] = { s: 'err', msg: String(err && err.message || err) }; }).then(function () { try { rtSet(+rts.value); } catch (e4) {} step(i + 1); }); };
          step(0); return; }
        var b = e.target && e.target.closest ? e.target.closest('.rt-chk') : null; if (!b) return;
        var corp = b.getAttribute('data-c'), act = +b.getAttribute('data-a'), key = d.id + '|' + corp + '|' + act;
        ST.rtBest = ST.rtBest || {}; if (ST.rtBest[key] || !ST.game || !ST.game.raw) return;
        ST.rtBest[key] = { s: 'run' }; rtSet(+rts.value);
        bestRun(ST.game.raw, corp, act).then(function (r) { ST.rtBest[key] = { s: 'ok', best: r.best }; }, function (err) { ST.rtBest[key] = { s: 'err', msg: String(err && err.message || err) }; })
          .then(function () { try { rtSet(+rts.value); } catch (e2) {} });
      };
      rtMapDraw();
      rts.onchange = function () { rtSet(+rts.value); };
      doc.getElementById('rt-p').onclick = function () { rtSet(+rts.value - 1); };
      doc.getElementById('rt-n').onclick = function () { rtSet(+rts.value + 1); };
    }
    // game log slider, search and jump (only the list is redrawn)
    var gli = doc.getElementById('gl-i');
    if (gli && d.gameLog) {
      var glSet = function (v) {
        var mx = d.gameLog.rounds.length - 1; v = Math.min(Math.max(v, 0), mx); gli.value = v; ST.glIdx = v; ST.glGame = d.id;
        doc.getElementById('gl-l').textContent = d.gameLog.rounds[v].label;
        doc.getElementById('gl-b').innerHTML = glBody(d, v, ST.glQ, glCol, me); doc.getElementById('gl-b').scrollTop = 0;
      };
      var glAgain = function () { ST.glGame = d.id; glSet(+gli.value); };
      Array.prototype.forEach.call(doc.querySelectorAll('#gl-k .pill'), function (b) { b.onclick = function () { var k = b.getAttribute('data-k'); ST.glGame = d.id; ST.glKind = ST.glKind === k ? null : k; Array.prototype.forEach.call(doc.querySelectorAll('#gl-k .pill'), function (o) { o.classList.toggle('cur', o.getAttribute('data-k') === ST.glKind); }); glAgain(); }; });
      var glc = doc.getElementById('gl-c'); if (glc) glc.onchange = function () { ST.glGame = d.id; ST.glCo = glc.value || null; glAgain(); };
      gli.oninput = function () { glSet(+gli.value); };
      doc.getElementById('gl-p').onclick = function () { glSet(+gli.value - 1); };
      doc.getElementById('gl-n').onclick = function () { glSet(+gli.value + 1); };
      doc.getElementById('gl-q').oninput = function () { ST.glQ = this.value; ST.glGame = d.id; doc.getElementById('gl-b').innerHTML = glBody(d, +gli.value, ST.glQ, glCol, me); };
      var glm = doc.getElementById('gl-me');
      if (glm) glm.onclick = function () { ST.glQ = ''; doc.getElementById('gl-q').value = ''; glSet(d.gameLog.meRound); var mn = doc.querySelector('#gl-b li.mine'); if (mn && mn.scrollIntoView) mn.scrollIntoView({ block: 'center' }); };
    }
    if (!d.tt) {
      glideChanges(w, d, dark);
      // your-turn sound, once per turn
      var turnKey = d.id + ':' + myTurn;
      if (myTurn && ST.turnKey !== turnKey && ST.turnKey != null && soundOn) beep(w);
      ST.turnKey = turnKey;
    }
    doc.getElementById('me').onchange = function () { lsSet('xxStats.me', this.value); ST.pfPlayer = null; ST.feedTab = null; rerender(); };
    doc.getElementById('th').onclick = function () { lsSet('xxStats.theme', dark ? 'light' : 'dark'); rerender(); };
    var mn = doc.getElementById('mn'); if (mn) mn.ontoggle = function () { ST.menuOpen = mn.open; };
    doc.onclick = function (ev) { if (ST.menuOpen && mn && !ev.target.closest('#mn')) { mn.open = false; ST.menuOpen = false; } };
    var giEl = doc.getElementById('gi'); if (giEl) giEl.oninput = function () { ST.giVal = giEl.value; };
    var cpi = doc.getElementById('cpi');
    if (cpi) cpi.onclick = function () {
      var lbl = function (t) { try { cpi.textContent = t; setTimeout(function () { try { cpi.textContent = 'copy as image'; } catch (e) {} }, 1800); } catch (e) {} };
      try {
        shareImage(d, ranked, pal, dark, m, me).toBlob(function (b) {
          var save = function () { try { var a = w.document.createElement('a'); a.href = w.URL.createObjectURL(b); a.download = '18xx-standings.png'; w.document.body.appendChild(a); a.click(); a.remove(); lbl('saved as a file'); } catch (e) { lbl('copy failed'); } };
          try { w.navigator.clipboard.write([new w.ClipboardItem({ 'image/png': b })]).then(function () { lbl('copied \u2713'); }, save); } catch (e) { save(); }
        }, 'image/png');
      } catch (e) { lbl('copy failed'); }
    };
    var cpb = doc.getElementById('cp');
    if (cpb) cpb.onclick = function () {
      var lines = [d.title + ' #' + d.id + ' · ' + d.roundLabel + ' · phase ' + d.phase];
      ranked.forEach(function (p, i) { lines.push((i + 1) + '. ' + p.name + ' ' + m(p.value) + ' (cash ' + m(p.cash) + ')'); });
      var px = d.ticker.filter(function (tk) { return !tk.closed; }).map(function (tk) { return tk.name + ' ' + m(tk.price); });
      if (px.length) lines.push('Share prices: ' + px.join(', '));
      copyText(w, lines.join('\n'), cpb);
    };
    var fdt = doc.getElementById('fd-tabs');
    if (fdt) fdt.onclick = function (ev) {
      var b2 = ev.target.closest('button'); if (!b2) return;
      ST.feedTab = b2.getAttribute('data-t');
      ['latest', 'since'].forEach(function (k) { var el = doc.getElementById('fd-' + k); if (el) el.hidden = k !== ST.feedTab; });
      Array.prototype.forEach.call(fdt.querySelectorAll('button'), function (x) { x.className = x === b2 ? 'on' : ''; });
    };
    // the header shrinks to one line once you scroll
    var hdr = doc.querySelector('header');
    w.onscroll = function () { var hd = doc.querySelector('header'); if (hd) hd.classList.toggle('compact', (w.scrollY || 0) > 30); };
    if (hdr && (w.scrollY || 0) > 30) hdr.classList.add('compact');
    doc.getElementById('snd').onclick = function () {
      if (soundOn && armed) { lsSet('xxStats.sound', '0'); }
      else { lsSet('xxStats.sound', '1'); try { if (!w.__xxAudio) w.__xxAudio = new (w.AudioContext || w.webkitAudioContext)(); w.__xxAudio.resume(); beep(w); } catch (e) {} }
      rerender();
    };
    var seenBtn = doc.getElementById('seen');
    var markSeen = function () { ST.lookId = ST.maxFeedId; };
    if (seenBtn) seenBtn.onclick = function () { markSeen(); rerender(); };
    doc.documentElement.onmouseleave = markSeen; // leaving the window counts as having looked
    doc.getElementById('rf').onclick = function () { refresh(true); };
    var ttb = doc.getElementById('tt');
    if (ttb) ttb.onclick = function () { if (ST.ttOpen) { if (ST.tt) { ttExit(); } else { ST.ttOpen = false; rerender(); } } else { ST.ttOpen = true; rerender(); } };
    var tti = doc.getElementById('tt-i');
    if (tti) {
      var ttLast = ST.rounds.length - 1, ttCur = function () { return ST.tt ? ST.tt.idx : ttLast; };
      tti.oninput = function () { var v = +tti.value; doc.getElementById('tt-l').textContent = v >= ttLast ? 'Now' : 'the game after ' + ST.rounds[v].label; };
      tti.onchange = function () { doc.getElementById('tt-l').textContent = 'loading…'; ttGo(+tti.value); };
      doc.getElementById('tt-p').onclick = function () { doc.getElementById('tt-l').textContent = 'loading…'; ttGo(ttCur() - 1); };
      doc.getElementById('tt-n').onclick = function () { doc.getElementById('tt-l').textContent = 'loading…'; ttGo(ttCur() + 1); };
      var ttx = doc.getElementById('tt-x'); if (ttx) ttx.onclick = function () { ttExit(); };
    }
    doc.getElementById('sn').onclick = function () { snapRight(w); };
    var zoomBy = function (dz) { var z = Math.min(1.5, Math.max(0.8, (parseFloat(lsGet('xxStats.zoom')) || 1) + dz)); lsSet('xxStats.zoom', String(Math.round(z * 100) / 100)); doc.body.style.zoom = String(z); };
    var nwb = doc.getElementById('nw'); if (nwb) nwb.onclick = function () { try { localStorage.setItem('xxStats.wide', lsGet('xxStats.wide') === '1' ? '0' : '1'); } catch (e12) {} rerender(); };
    var shv = doc.getElementById('sh-v');
    if (shv) shv.onclick = function () {
      var lab = function (x) { shv.textContent = x; setTimeout(function () { shv.textContent = '🔗'; }, 1800); };
      try {
        var pay = { l: loadLayout('live'), r: loadLayout('review') };
        var url = ST.origin + '/game/' + d.id + '#xxv=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify({ l: { o: pay.l.order, c: pay.l.collapsed }, r: { o: pay.r.order, c: pay.r.collapsed } })))));
        var done = function () { lab('copied ✓'); };
        try { w.navigator.clipboard.writeText(url).then(done, function () { w.prompt('Copy this link', url); }); } catch (e9) { w.prompt('Copy this link', url); }
      } catch (e10) { lab('failed'); }
    };
    doc.getElementById('zo').onclick = function () { zoomBy(-0.1); }; doc.getElementById('zi').onclick = function () { zoomBy(0.1); };
    doc.body.style.zoom = String(parseFloat(lsGet('xxStats.zoom')) || 1);
    var updA = doc.getElementById('upd'); if (updA) updA.onclick = function (ev) { ev.preventDefault(); updateNow(updA); };
    doc.getElementById('gf').onsubmit = function (ev) { ev.preventDefault(); ST.giVal = ''; ST.menuOpen = false; var mm = String(doc.getElementById('gi').value).match(/(\d{3,})/); if (mm) { ST.gameId = mm[1]; ST.pfPlayer = null; w.document.body.innerHTML = '<p style="padding:20px">Loading game ' + mm[1] + '…</p>'; refresh(true); } };
    function drawPf(i) {
      ST.pfPlayer = i;
      var el = doc.getElementById('c-pf'); if (!el) return;
      var pf = d.portfolio[i];
      var model = { labels: pf.labels, fmt: m, series: [{ name: 'Cash', color: dark ? '#6b6a64' : '#b9b8b2', muted: true, values: pf.cash }].concat(pf.priv.some(function (v) { return v; }) ? [{ name: 'Privates', color: dark ? '#8a7d5c' : '#c9b98f', muted: true, values: pf.priv }] : [])
        .concat(pf.other.some(function (v) { return v; }) ? [{ name: 'Other', color: dark ? '#5f7d8a' : '#9fb8c4', muted: true, values: pf.other }] : []).concat(pf.series) };
      var ext = pfExtent(d);
      var ch = stackedArea(model, { dark: dark, title: pf.name + ' portfolio', yMax: ext.max, yMin: ext.min });
      el.innerHTML = legend(model.series, dark) + ch.svg + '<div class="tip"></div>';
      attachHover(doc, el, model, ch, function (k) {
        var tot = model.series.reduce(function (a, s) { return a + (s.values[k] || 0); }, 0);
        return '<div class="r" style="margin-top:3px;border-top:1px solid var(--grid);padding-top:3px"><span>Total</span><span><b>' + esc(m(tot)) + '</b></span></div>';
      }, true);
      Array.prototype.forEach.call(doc.querySelectorAll('#pf-tabs button'), function (b) { b.className = +b.getAttribute('data-i') === i ? 'on' : ''; });
    }
    var tabs = doc.getElementById('pf-tabs');
    if (tabs) { tabs.onclick = function (ev) { var b = ev.target.closest('button'); if (b) drawPf(+b.getAttribute('data-i')); }; drawPf(pfSel); }
  }

  // ---------- Window + refresh loop -------------------------------------------------------
  // ---------- Layout: collapse and reorder sections, remembered per mode ----------------
  // Two layouts are kept in this browser: 'live' (game in progress) and 'review' (finished game).
  var DEFAULT_ORDER = {
    live: ['now', 'what-just-happened', 'trains-phases-bank', 'routes-revenue', 'track-spending-vs-revenue', 'train-timing', 'train-purchases', 'stock-round-helper', 'stock-market', 'standings', 'score-range', 'player-value-over-time', 'key-moments', 'badges', 'compare-with-another-game', 'replay', 'stock-ticker', 'where-the-money-came-from', 'valuation', 'withholding-vs-paying-out', 'withholds-in-detail', 'portfolios', 'corporations', 'company-revenue-per-operating-round', 'share-price', 'game-log', 'minors-private-companies', 'tile-manifest', 'game-info'],
    review: ['stock-ticker', 'stock-market', 'standings', 'player-value-over-time', 'key-moments', 'badges', 'compare-with-another-game', 'replay', 'game-log', 'company-revenue-per-operating-round', 'share-price', 'where-the-money-came-from', 'valuation', 'withholding-vs-paying-out', 'withholds-in-detail', 'portfolios', 'corporations', 'trains-phases-bank', 'train-timing', 'train-purchases', 'routes-revenue', 'track-spending-vs-revenue', 'minors-private-companies', 'tile-manifest', 'game-info']
  };
  function slug(txt) { return String(txt).toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function loadLayout(mode) {
    try {
      var v = JSON.parse(localStorage.getItem('xxStats.layout.' + mode) || 'null');
      if (v && v.order) { // sections added in newer versions slot in at their default place
        ['order', 'collapsed'].forEach(function (kk) { if (v[kk]) v[kk] = v[kk].map(function (x) { return x === 'trains-phases' ? 'trains-phases-bank' : x; }); });
        if (!v.m11 && v.order.indexOf('routes-revenue') >= 0 && v.order.indexOf('trains-phases-bank') >= 0) { // 0.11.1: Routes & revenue moved to sit right after Trains, phases & Bank (once)
          v.order.splice(v.order.indexOf('routes-revenue'), 1); v.order.splice(v.order.indexOf('trains-phases-bank') + 1, 0, 'routes-revenue'); v.m11 = 1;
        }
        DEFAULT_ORDER[mode].forEach(function (k, i) { if (v.order.indexOf(k) < 0) { v.order.splice(Math.min(i, v.order.length), 0, k); if (k === 'tile-manifest' || k === 'minors-private-companies' || k === 'game-info') (v.collapsed = v.collapsed || []).push(k); } });
        return v;
      }
    } catch (e) {}
    return { order: DEFAULT_ORDER[mode].slice(), collapsed: ['minors-private-companies', 'tile-manifest', 'game-info'] };
  }
  function saveLayout(mode, lay) { try { localStorage.setItem('xxStats.layout.' + mode, JSON.stringify(lay)); } catch (e) {} }
  function applyLayout(w, mode) {
    var doc = w.document, main = doc.querySelector('main'); if (!main) return;
    var lay = loadLayout(mode);
    var secs = Array.prototype.slice.call(main.children).filter(function (el) { return el.tagName === 'SECTION'; });
    secs.forEach(function (sec) {
      var h2 = sec.querySelector('h2'); if (!h2) return;
      var key = slug(h2.textContent); sec.setAttribute('data-key', key);
      var stEl = h2.querySelector('.st'), title = stEl ? stEl.innerHTML : h2.innerHTML;
      h2.className = 'sh';
      h2.innerHTML = '<span class="grip" title="Drag to move">⠿</span><button class="tg" title="Collapse / expand" aria-expanded="true">▾</button><span class="st">' + title + '</span>' +
        '<span class="mv"><button data-mv="-1" title="Move up">▲</button><button data-mv="1" title="Move down">▼</button></span>';
      if (lay.collapsed.indexOf(key) >= 0) { sec.classList.add('collapsed'); h2.querySelector('.tg').textContent = '▸'; h2.querySelector('.tg').setAttribute('aria-expanded', 'false'); }
    });
    // order: known keys in saved order, unknown (new) sections keep their place at the end
    var rank = function (k) { var i = lay.order.indexOf(k); return i < 0 ? 999 : i; };
    secs.slice().sort(function (a, b) { return rank(a.getAttribute('data-key')) - rank(b.getAttribute('data-key')); }).forEach(function (sec) { main.appendChild(sec); });
    function persist() {
      var cur = Array.prototype.map.call(main.querySelectorAll('section[data-key]'), function (s) { return s.getAttribute('data-key'); });
      lay.order = cur.concat(lay.order.filter(function (k) { return cur.indexOf(k) < 0; }));
      lay.collapsed = Array.prototype.filter.call(main.querySelectorAll('section.collapsed'), function () { return true; }).map(function (s) { return s.getAttribute('data-key'); });
      saveLayout(mode, lay);
    }
    main.onclick = function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      var sec = b.closest('section'); if (!sec || !b.closest('h2.sh')) return;
      if (b.classList.contains('tg')) {
        var c = sec.classList.toggle('collapsed'); b.textContent = c ? '▸' : '▾'; b.setAttribute('aria-expanded', String(!c));
      } else if (b.getAttribute('data-mv')) {
        var dir = +b.getAttribute('data-mv'), sib = dir < 0 ? sec.previousElementSibling : sec.nextElementSibling;
        if (sib) { if (dir < 0) main.insertBefore(sec, sib); else main.insertBefore(sib, sec); }
      }
      persist();
    };
    // drag and drop by the grip
    var dragging = null;
    secs.forEach(function (sec) {
      var grip = sec.querySelector('.grip'); if (!grip) return;
      grip.onmousedown = function () { sec.draggable = true; };
      grip.onmouseup = function () { sec.draggable = false; };
      sec.ondragstart = function (ev) { dragging = sec; sec.classList.add('dragging'); try { ev.dataTransfer.setData('text/plain', sec.getAttribute('data-key')); ev.dataTransfer.effectAllowed = 'move'; } catch (e) {} };
      sec.ondragend = function () { sec.draggable = false; sec.classList.remove('dragging'); dragging = null; persist(); };
      sec.ondragover = function (ev) {
        if (!dragging || dragging === sec) return; ev.preventDefault();
        var r = sec.getBoundingClientRect(), after = ev.clientY > r.top + r.height / 2;
        main.insertBefore(dragging, after ? sec.nextSibling : sec);
      };
    });
    var reset = doc.getElementById('lr');
    if (reset) reset.onclick = function () { try { localStorage.removeItem('xxStats.layout.' + mode); } catch (e) {} applyLayout(w, mode); };
    var ml = doc.getElementById('lm'); if (ml) ml.textContent = mode === 'live' ? 'live-game layout' : 'review layout';
  }

  // Put the stats window on the right half of the screen (the game keeps the left half).
  function snapRight(w) {
    try {
      var sc = w.screen || screen, aw = sc.availWidth, ah = sc.availHeight, al = sc.availLeft || 0, at = sc.availTop || 0;
      w.resizeTo(Math.round(aw / 2), ah); w.moveTo(al + Math.round(aw / 2), at);
    } catch (e) {}
  }

  // Archived games: 18xx.games deletes the move history and keeps only the final result.
  function renderArchived(w, raw) {
    var names = {}; (raw.players || []).forEach(function (p) { names[p.id] = p.name; });
    var res = Object.keys(raw.result || {}).map(function (k) { return { name: names[k] || k, score: raw.result[k] }; }).sort(function (a, b) { return b.score - a.score; });
    var top = res.length ? res[0].score : 1;
    w.document.title = raw.title + ' · ' + raw.id + ' · Stats';
    w.document.documentElement.setAttribute('data-theme', themePref() || 'dark');
    w.document.body.innerHTML = '<header><div class="hr1"><h1>' + esc(raw.title) + ' <span style="color:var(--text-muted);font-weight:400">#' + esc(raw.id) + '</span></h1><span class="kv">' + esc(raw.description || '') + '</span>' +
      '<span class="grow"></span><span class="tb"><form id="gf" style="display:inline"><input id="gi" placeholder="game # or link" size="12" style="font:inherit;font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:6px;background:var(--surface-0);color:var(--text-primary)"> <button class="ib" style="font-size:12px">Open</button></form></span></div></header>' +
      '<main><section class="card wide"><h2>Archived game: only the final result is kept</h2><p class="sub">18xx.games deletes the moves of archived games, so there is no history to replay or chart. This is the final result as the site stored it.</p>' +
      '<div class="tw"><table><thead><tr><th>#</th><th style="text-align:left">Player</th><th>Final score</th><th style="width:40%"></th></tr></thead><tbody>' +
      res.map(function (r, i) { return '<tr><td>' + (i + 1) + '</td><td style="text-align:left">' + esc(r.name) + '</td><td><b>' + esc(r.score) + '</b></td><td><div class="bar"><i style="width:' + (r.score / top * 100).toFixed(1) + '%;background:var(--accent)"></i></div></td></tr>'; }).join('') +
      '</tbody></table></div></section></main>';
    w.document.getElementById('gf').onsubmit = function (ev) { ev.preventDefault(); var mm = String(w.document.getElementById('gi').value).match(/(\d{3,})/); if (mm) { ST.gameId = mm[1]; refresh(true); } };
  }

  // ---------- Window + update loop ------------------------------------------------------------
  // A second click on the bookmark (or a newer version of this script) replaces the running one.
  var OLD = window.__xxStats;
  if (OLD) { try { clearInterval(OLD.timer); clearInterval(OLD.bTimer); } catch (e) {} try { if (OLD.unsub) OLD.unsub(); } catch (e) {} }
  var ST = window.__xxStats = { token: Date.now() + '-' + Math.random(), win: OLD && OLD.win, version: VERSION, origin: window.location.origin };
  ST.api = { extract: extract, loadGame: loadGame, applyActions: applyActions, ensureTitle: ensureTitle, render: render, shareImage: shareImage };

  // Runs inside the stats window itself, so it keeps working when the game page is reloaded or
  // closed: it then shows that updates have stopped instead of silently showing old numbers.
  var WATCHDOG = 'if(!window.__xxWd)window.__xxWd=setInterval(function(){var ok=false;try{var o=window.opener||(window.parent!==window?window.parent:null);ok=!!o&&!o.closed&&!!o.__xxStats&&o.__xxStats.token===window.__xxToken&&!!o.__xxStats.timer;}catch(e){}' +
    'var b=document.getElementById("xx-paused");if(!ok&&!b&&document.body){b=document.createElement("div");b.id="xx-paused";b.textContent="\\u26a0 Updates paused: the game page was reloaded or closed. Go back to the game on 18xx.games and click the 18xx-JNNstats bookmark again.";document.body.appendChild(b);if(document.title.indexOf("\\u23f8")!==0)document.title="\\u23f8 paused \\u00b7 "+document.title;}else if(ok&&b){b.parentNode.removeChild(b);document.title=document.title.replace(/^\\u23f8 paused \\u00b7 /,"");}},2000);';

  function openWin() {
    // The bookmark opens the window itself (window.__xxStatsTarget), during the click, so pop-up
    // blockers allow it; this script arrives a moment later from GitHub via jsDelivr.
    var w = window.__xxStatsTarget, fresh = true;
    window.__xxStatsTarget = null;
    if (!w || w.closed) { if (ST.win && !ST.win.closed) { w = ST.win; fresh = false; } else w = window.open('', 'xx-stats', 'width=1280,height=900'); }
    if (!w) { alert('18xx-JNNstats: the popup was blocked. Allow popups for 18xx.games and click the bookmark again.'); return null; }
    w.document.open();
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>18xx-JNNstats v' + VERSION + '</title><style>' + CSS + '</style><style id="xxn">' + NARROW + '</style></head><body><p style="padding:20px">Loading game…</p><script>' + WATCHDOG + '<\/script></body></html>');
    w.document.close();
    w.__xxToken = ST.token;
    if (fresh) { var bnd = loadBounds(); if (bnd) applyBounds(w, bnd); else snapRight(w); }
    ST.win = w;
    // remember where you put the window
    try { clearInterval(ST.bTimer); } catch (e) {}
    var lastB = '';
    ST.bTimer = setInterval(function () {
      try {
        if (!ST.win || ST.win.closed) { clearInterval(ST.bTimer); return; }
        var ww = ST.win, bb = { x: ww.screenX, y: ww.screenY, w: ww.outerWidth, h: ww.outerHeight }, key = JSON.stringify(bb);
        if (key !== lastB && bb.w > 300 && bb.h > 300) { lastB = key; lsSet('xxStats.bounds', key); }
      } catch (e) {}
    }, 2500);
    return w;
  }

  function lastId(raw) { var a = raw.actions; return a.length ? a[a.length - 1].id : 0; }
  function rerender() {
    var gm = ST.game, w = ST.win; if (!gm || !w || w.closed) return;
    var fin = gm.raw.status === 'finished';
    ST.statusText = fin ? 'finished game' : ST.unsub ? 'live: updates as moves are made' : 'checks every ' + (REFRESH_MS / 1000) + ' s';
    var d;
    if (ST.tt && ST.tt.game) { d = extract(ST.tt.game.g, ST.tt.game.raw); d.tt = { idx: ST.tt.idx, label: ST.tt.label }; }
    else {
      d = extract(gm.g, gm.raw);
      ST.rounds = d.gameLog ? d.gameLog.rounds.map(function (r, i) { return { label: r.label, cut: d.gameLog.cuts[i] }; }) : [];
    }
    window.__xxLast = d;
    render(w, d);
  }
  // History mode: replay the game up to the end of a chosen round and draw every tile from that state
  function ttGo(idx) {
    var gm = ST.game; if (!gm || !ST.rounds || ST.rounds.length < 2) return;
    var last = ST.rounds.length - 1; idx = Math.max(0, Math.min(idx, last));
    if (idx >= last) { ttExit(); return; }
    var key = gm.id + ':' + idx;
    if (!ST.ttCache || ST.ttCacheGame !== gm.id) { ST.ttCache = {}; ST.ttCacheGame = gm.id; }
    var apply = function (tg) { ST.ttOpen = true; ST.tt = { idx: idx, label: ST.rounds[idx].label, game: tg }; rerender(); };
    if (ST.ttCache[key]) { apply(ST.ttCache[key]); return; }
    setTimeout(function () {
      try {
        var cut = ST.rounds[idx].cut, j = {}; Object.keys(gm.raw).forEach(function (k) { j[k] = gm.raw[k]; });
        j.actions = gm.raw.actions.filter(function (a) { return a.id <= cut; }); j.status = 'active';
        var tg = { g: loadGame(JSON.stringify(j)), raw: j };
        var ks = Object.keys(ST.ttCache); if (ks.length >= 12) delete ST.ttCache[ks[0]];
        ST.ttCache[key] = tg; apply(tg);
      } catch (e) { ST.tt = null; showError(e); }
    }, 30);
  }
  function ttExit() { ST.tt = null; ST.ttOpen = false; refresh(true); }
  function showError(e) {
    console.error('18xx-JNNstats', e);
    try { ST.win.document.body.innerHTML = '<div class="err"><b>Could not build stats.</b><br>' + esc(e && e.message || e) + '</div>'; } catch (_) {}
  }
  function fullLoad(text, raw) {
    return ensureTitle(raw.title).then(function () {
      var g = loadGame(text), id = String(raw.id);
      if (!ST.game || ST.game.id !== id) ST.verify = null;
      ST.game = { id: id, g: g, raw: raw };
      ST.autoMe = detectMe((raw.players || []).map(function (p) { return p.name; }));
      ST.fullLoads = (ST.fullLoads || 0) + 1;
      rerender();
    });
  }
  // Apply new moves to the game in memory. At the end of every round, replay the whole game
  // from scratch in the background and compare, as a check on the incremental numbers.
  function advance(newActions, rawNew) {
    var gm = ST.game, before = gm.g.__xxSnaps.length;
    if (!applyActions(gm.g, newActions)) return false;
    if (rawNew) gm.raw = rawNew; else Array.prototype.push.apply(gm.raw.actions, newActions);
    ST.increments = (ST.increments || 0) + 1;
    rerender();
    var sn = gm.g.__xxSnaps;
    if (sn.length > before) { var lab = sn[sn.length - 1].label; setTimeout(function () { verify(lab); }, 300); }
    return true;
  }
  function fingerprint(g) {
    return JSON.stringify([g.$players().map(function (p) { return [s(p.$name()), num(p.$cash()), num(call(g, 'player_value', p))]; }),
      g.$corporations().map(function (c) { var sp = call(c, 'share_price'); return [s(c.$name()), num(call(c, 'cash')), sp ? num(call(sp, 'price')) : null, (call(c, 'trains') || []).length]; }),
      num(g.$bank().$cash())]);
  }
  function verify(label) {
    var gm = ST.game; if (!gm) return Promise.resolve();
    return fetch('/api/game/' + gm.id, { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (text) {
      var raw = JSON.parse(text);
      if (!raw.actions || ST.game !== gm) return;
      var same = raw.actions.length === gm.raw.actions.length && lastId(raw) === lastId(gm.raw);
      var before = same ? fingerprint(gm.g) : null;
      var g2 = loadGame(text);
      var ok = !same || fingerprint(g2) === before;
      ST.game = { id: gm.id, g: g2, raw: raw };
      ST.verify = { ok: ok, at: label, checked: same };
      ST.verifies = (ST.verifies || 0) + 1;
      rerender();
    }).catch(function (e) { console.error('18xx-JNNstats verify', e); });
  }

  // Live push: 18xx.games already has a message channel per game; listen on it too.
  function subscribe(id) {
    var MB = window.MessageBus;
    if (!MB || !MB.subscribe) return;
    if (ST.subId === id && ST.subFn && (MB.callbacks || []).some(function (c) { return c.func === ST.subFn; })) return;
    if (ST.unsub) ST.unsub();
    try {
      var ch = '/game/' + id, last = -1;
      (MB.callbacks || []).forEach(function (c) { if (c.channel === ch && c.last_id != null) last = c.last_id; });
      var fn = function (msg) { onBus(msg); };
      MB.subscribe(ch, fn, last);
      ST.subFn = fn; ST.subId = id;
      ST.unsub = function () { try { MB.unsubscribe(ch, fn); } catch (e) {} ST.unsub = null; ST.subFn = null; };
    } catch (e) { ST.unsub = null; }
  }
  function onBus(msg) {
    ST.busMsgs = (ST.busMsgs || 0) + 1;
    try {
      var gm = ST.game;
      if (gm && !ST.busy && msg && msg.type && msg.type !== 'undo' && msg.type !== 'redo' && msg.id === lastId(gm.raw) + 1 && String(gameId()) === gm.id) {
        var a = {}; Object.keys(msg).forEach(function (k) { if (k.charAt(0) !== '_') a[k] = msg[k]; });
        if (!advance([a], null)) refresh(true);
        return;
      }
    } catch (e) {}
    refresh(false);
  }

  function refresh(force) {
    var w = ST.win; if (!w || w.closed) { clearInterval(ST.timer); ST.timer = null; if (ST.unsub) ST.unsub(); return Promise.resolve(); }
    if (ST.tt) { if (!force) return Promise.resolve(); ST.tt = null; ST.ttOpen = false; }
    if (ST.busy) { ST.pending = true; ST.pendingForce = ST.pendingForce || !!force; return ST.busy; }
    var id = String(gameId());
    subscribe(id);
    ST.busy = fetch('/api/game/' + id, { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (text) {
      var raw = JSON.parse(text);
      if (!raw.actions) throw new Error('Game ' + id + ' not found (' + (raw.error || 'no data') + ')');
      if (!raw.actions.length && (raw.status === 'archived' || (raw.result && Object.keys(raw.result).length))) { ST.game = null; renderArchived(w, raw); return; }
      var gm = ST.game;
      if (!force && gm && gm.id === id) {
        var n0 = gm.raw.actions.length, n1 = raw.actions.length;
        if (n1 === n0 && lastId(raw) === lastId(gm.raw)) {
          if (raw.status !== gm.raw.status) { gm.raw.status = raw.status; gm.raw.result = raw.result; rerender(); }
          return;
        }
        if (n1 > n0 && n0 > 0 && raw.actions[n0 - 1].id === lastId(gm.raw) && advance(raw.actions.slice(n0), raw)) return;
      }
      return fullLoad(text, raw);
    }).catch(showError).then(function () {
      ST.busy = null;
      if (ST.pending) { var f = ST.pendingForce; ST.pending = false; ST.pendingForce = false; return refresh(f); }
    });
    return ST.busy;
  }

  if (!pageGameId() || typeof Opal === 'undefined' || !Opal.Engine) { alert('18xx-JNNstats: open a game on 18xx.games first, then click the bookmark.'); return; }
  if (!openWin()) return;
  try { ST.win.focus(); } catch (e) {}
  // A shared view link carries only the card order and which cards are collapsed
  try {
    var xm = /[#&]xxv=([^&]+)/.exec(location.hash);
    if (xm) {
      var sv = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(xm[1])))));
      var okKeys = function (a) { return Array.isArray(a) && a.length < 80 && a.every(function (k) { return typeof k === 'string' && /^[a-z0-9-]{1,60}$/.test(k); }); };
      ['l', 'r'].forEach(function (k) { var v = sv[k]; if (v && okKeys(v.o) && okKeys(v.c)) saveLayout(k === 'l' ? 'live' : 'review', { order: v.o, collapsed: v.c, m11: 1 }); });
    }
  } catch (e11) {}
  ST.gameId = null;
  ST.ticks = 0;
  refresh(true);
  checkLatest();
  // Backup check: every 10 s without the push channel, every 30 s with it; finished games are left alone.
  ST.timer = setInterval(function () {
    ST.ticks++;
    checkLatest();
    if (ST.game && ST.game.raw.status === 'finished') return;
    if (ST.unsub && ST.ticks % 3) return;
    refresh(false);
  }, REFRESH_MS);
})();
