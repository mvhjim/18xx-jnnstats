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
  var VERSION = '0.9.2';
  var REFRESH_MS = 10000;
  var REPO_URL = 'https://github.com/mvhjim/18xx-jnnstats';

  // ---------- Per-title config ----------------------------------------------------------
  // Each title can override labels/metrics. 'default' applies to every game.
  // hooks: extraPlayerCols(g, p, h) -> [{label, value}], notes(g, h) -> [string], endGame(g, h) -> [{label,value,status}]
  var CONFIG = {
    default: {},
    '1862': {
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
  function takeSnapshot(g) {
    var rd = g.round, short = s(rd.$class().$short_name());
    var snap = { label: short + ' ' + s(g.$turn()) + (short === 'OR' ? '.' + s(call(rd, 'round_num')) : ''), prices: {}, hold: {}, cash: {}, priv: {}, value: {}, minors: {}, companies: {}, corpCash: {}, pos: {} };
    var corps = g.$corporations();
    snap.bank = num(call(call(g, 'bank'), 'cash'));
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
      var cc = { name: s(c.$name()), owner: nameOf(call(c, 'owner')), closed: bool(call(c, 'closed?')), value: num(call(c, 'value')), revenue: num(call(c, 'revenue')) };
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
      return { name: ser.name, color: ser.color, price: last, prev: prev, first: first, spark: v, closed: corp ? corp.closed : li < v.length - 1 };
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
      ci.value = c.value; ci.revenue = c.revenue;
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
      gameLog = { rounds: glR, meRound: glMe, meId: lastMineId };
    } catch (e) { gameLog = null; }

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
      if (!nil(gec)) gec.$to_a().forEach(function (kv) { endInfo.conditions.push({ reason: s(kv[0]).replace(/_/g, ' '), timing: s(kv[1]).replace(/_/g, ' ').replace(/\bor\b/g, 'OR') }); });
      var trig = call(g, 'game_end_check');
      if (trig && trig.length) endInfo.triggered = { reason: s(trig[0]).replace(/_/g, ' '), timing: s(trig[1]).replace(/_/g, ' ').replace(/\bor\b/g, 'OR') };
    } catch (e) {}
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
      grid: grid, gridHist: gridHist, bank2: bankInfo, tiles: tileInfo, recap: recap, gameLog: gameLog
    };
  }

  // ---------- Rendering -------------------------------------------------------------------
  var DARKVARS = '--surface-0:#121211;--surface-1:#1a1a19;--text-primary:#f0efec;--text-secondary:#c3c2b7;--text-muted:#8f8e86;--grid:#2c2c2a;--border:#33332f;--good:#4cc36b;--warn:#e0a020;--crit:#ef6b6b;--accent:#3987e5;color-scheme:dark';
  var CSS = [
    ':root{--surface-0:#f4f4f2;--surface-1:#fcfcfb;--text-primary:#0b0b0b;--text-secondary:#52514e;--text-muted:#7a7974;--grid:#e6e5e1;--border:#dddcd7;--good:#1a7f37;--warn:#b26b00;--crit:#c62828;--accent:#2a78d6;color-scheme:light}',
    '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){' + DARKVARS + '}}',
    ':root[data-theme="dark"]{' + DARKVARS + '}',
    '*{box-sizing:border-box}body{margin:0;background:var(--surface-0);color:var(--text-primary);font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    'header{position:sticky;top:0;z-index:5;background:var(--surface-1);border-bottom:1px solid var(--border);padding:7px 14px}',
    '.hr1{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center}.hr1 .grow{flex:1}.hr2{color:var(--text-muted);font-size:11.5px;margin-top:3px}header.compact .hr2{display:none}',
    'header h1{font-size:15px;margin:0;font-weight:650}header .kv{color:var(--text-secondary)}header .kv b{color:var(--text-primary);font-weight:600}',
    '.tb{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.ib{font:inherit;font-size:14px;line-height:1;padding:4px 8px;border:1px solid var(--border);background:var(--surface-0);color:var(--text-primary);border-radius:6px;cursor:pointer;list-style:none}.ib:hover{border-color:var(--accent)}summary.ib::-webkit-details-marker{display:none}',
    '.menu{position:relative}.mp2{position:absolute;right:0;top:calc(100% + 6px);z-index:10;min-width:240px;background:var(--surface-1);border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.3);padding:8px;display:flex;flex-direction:column;gap:8px;font-size:12px}',
    '.mp2 button{font:inherit;font-size:12px;padding:4px 9px;border:1px solid var(--border);background:var(--surface-0);color:var(--text-primary);border-radius:6px;cursor:pointer}.mp2 input{font:inherit;font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:6px;background:var(--surface-0);color:var(--text-primary)}',
    '.upd{color:var(--warn);font-weight:600}@media (max-width:1000px){.kv.opt{display:none}}',
    'main{padding:10px 12px;display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(min(440px,100%),1fr));align-items:start}',
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
    '@media (max-width:1100px){.card{padding:10px 12px}th,td{padding:3px 6px}.tile .v{font-size:17px}}',
    '.ticker{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px}.tk{flex:0 0 auto;border:1px solid var(--grid);border-radius:8px;padding:6px 10px;min-width:150px;display:grid;grid-template-columns:auto auto;gap:0 10px;align-items:center}',
    '.tk .nm{font-weight:700}.tk .px{font-size:18px;font-weight:650;font-variant-numeric:tabular-nums}.tk .ch{font-size:12px;font-variant-numeric:tabular-nums}.tk svg{grid-row:1/3;grid-column:2}.tk.closed{opacity:.5}',
    '.up{color:var(--good)}.down{color:var(--crit)}.flat{color:var(--text-muted)}',
    '.tabs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}.tabs button{font:inherit;font-size:12px;padding:4px 10px;border-radius:999px;border:1px solid var(--border);background:var(--surface-0);color:var(--text-secondary);cursor:pointer}.tabs button.on{background:var(--accent);border-color:var(--accent);color:#fff}',
    '.pres{color:var(--warn);font-weight:700}.short{color:var(--crit);font-weight:600}.cellv{display:block;font-size:11px;color:var(--text-muted)}',
    '.mk{display:grid;grid-template-columns:repeat(var(--cols),minmax(34px,1fr));gap:2px;overflow-x:auto}',
    '.mc{border:1px solid var(--grid);border-radius:5px;padding:2px 3px;min-height:40px;font-size:11px;min-width:0}.mc.empty{border-color:transparent}.mp{color:var(--text-secondary);font-variant-numeric:tabular-nums;font-size:10.5px}',
    '.cp{display:block;border-radius:4px;padding:0 3px;margin-top:2px;font-size:10.5px;font-weight:700;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:default}.cp.mine{outline:2px solid var(--accent);outline-offset:1px}.cp.gh{background:transparent!important;border:1.5px dashed;font-weight:600}',
    '.bankbox{margin:0 0 12px;padding:0 0 4px;border-bottom:1px solid var(--grid)}.feed.gl{max-height:420px}.feed li.gl{display:grid;grid-template-columns:92px 1fr;gap:8px;padding-left:0;border-left:4px solid var(--pc,transparent)}.feed li.gl .gu{padding-left:6px;color:var(--text-secondary);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.feed li.gl.me{background:color-mix(in srgb,var(--pc) 14%,transparent)}.feed li.gl.me .gu{color:var(--text);font-weight:700}.feed li.gl.head{border-left-color:transparent}.feed li.mine .gm{font-weight:600;color:var(--accent)}.glr{color:var(--text-muted);font-size:10.5px}.gltools{display:flex;gap:8px;align-items:center;margin:0 0 8px}.gltools input{flex:1;min-width:80px}',
    '.gslide{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:12px;color:var(--text-secondary)}.gslide input{flex:1;min-width:80px}',
    '.zl{display:flex;flex-wrap:wrap;gap:4px 12px;margin:8px 0 0;font-size:11.5px;color:var(--text-secondary)}.zl i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:5px;vertical-align:-1px;border:1px solid var(--border)}',
    '.dq{display:flex;flex-wrap:wrap;gap:5px;margin:2px 0 10px}.dq .chip{font-variant-numeric:tabular-nums}.dq .chip.next{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);font-weight:650}.bl{font-size:12px;color:var(--text-muted);margin:6px 0 2px}',
    '.tg2{margin:0 0 10px}.tg2 .tcs{display:flex;flex-wrap:wrap;gap:4px}.tcp{border:1px solid var(--border);border-radius:6px;padding:1px 7px;font-size:12px;font-variant-numeric:tabular-nums}.tcp.z{opacity:.4;text-decoration:line-through}.tg2.na{opacity:.55}',
    'tr.actrow{background:color-mix(in srgb,var(--good) 14%,transparent)}.act{color:var(--good);font-weight:700}',
    '.tw table th:first-child,.tw table td:first-child{position:sticky;left:0;z-index:1;background:var(--surface-1)}',
    '.tw tr.merow td:first-child{background:color-mix(in srgb,var(--accent) 12%,var(--surface-1))}.tw tr.actrow td:first-child{background:color-mix(in srgb,var(--good) 14%,var(--surface-1))}.tw tr[data-corp].hl td:first-child{background:color-mix(in srgb,var(--accent) 22%,var(--surface-1))}',
    '[data-corp].hl{background-image:linear-gradient(color-mix(in srgb,var(--accent) 22%,transparent),color-mix(in srgb,var(--accent) 22%,transparent));outline:2px solid var(--accent);outline-offset:-2px;animation:hlp 1.1s ease-in-out infinite}@keyframes hlp{50%{outline-color:color-mix(in srgb,var(--accent) 35%,transparent)}}@media (prefers-reduced-motion:reduce){[data-corp].hl{animation:none}}',
    'html.myturn::after{content:"";position:fixed;inset:0;pointer-events:none;box-shadow:inset 0 0 0 5px var(--good);z-index:30;animation:glow 2.4s ease-in-out infinite}@keyframes glow{50%{box-shadow:inset 0 0 0 5px color-mix(in srgb,var(--good) 30%,transparent)}}@media (prefers-reduced-motion:reduce){html.myturn::after{animation:none}}',
    '.glide{position:fixed;left:0;top:0;z-index:40;padding:1px 8px;border-radius:999px;font-weight:700;font-size:12px;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.3);margin:-10px 0 0 -24px;white-space:nowrap}',
    '.tl{display:flex;flex-wrap:wrap;gap:4px;align-items:center}.tl span.o{border:1px solid var(--border);border-radius:6px;padding:0 6px}.tl small{color:var(--text-muted)}'
  ].join('\n');

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
  function isDark(w) { var p = themePref(); if (p) return p === 'dark'; try { return w.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; } }
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
      window.__xxLatest = null;
      var sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/gh/mvhjim/18xx-jnnstats@main/version.js?t=' + Date.now();
      sc.onload = function () { ST.latest = String(window.__xxLatest || ''); sc.remove(); rerender(); };
      sc.onerror = function () { sc.remove(); };
      document.head.appendChild(sc);
    } catch (e) {}
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
    var th = dark ? { bg: '#14181d', tx: '#e8eaed', t2: '#a9b0b8', gr: '#2a3038' } : { bg: '#ffffff', tx: '#1b1f24', t2: '#5b636c', gr: '#e1e4e8' };
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
  function lineChart(model, opts) {
    opts = opts || {};
    var W = 640, H = opts.height || 215, L = 54, R = 74, T = 10, B = 26;
    var pw = W - L - R, ph = H - T - B;
    var all = []; model.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null) all.push(v); }); });
    var max = all.length ? Math.max.apply(null, all) : 1, min = Math.min(0, all.length ? Math.min.apply(null, all) : 0);
    var step = niceStep((max - min) / 4); max = Math.ceil(max / step) * step || step; min = Math.floor(min / step) * step;
    var n = model.labels.length;
    var x = function (i) { return L + (n <= 1 ? pw / 2 : i * pw / (n - 1)); };
    var y = function (v) { return T + ph - (v - min) / (max - min || 1) * ph; };
    var out = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.title || '') + '">'];
    for (var v = min; v <= max + 1e-9; v += step) {
      out.push('<line x1="' + L + '" x2="' + (L + pw) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--grid)" stroke-width="1"/>');
      out.push('<text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="11" fill="var(--text-muted)">' + esc(model.fmt(v)) + '</text>');
    }
    var every = Math.max(1, Math.ceil(n / 12));
    model.labels.forEach(function (lab, i) {
      if ((i % every === 0 && (n - 1 - i >= every || i === n - 1)) || i === n - 1) out.push('<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11" fill="var(--text-muted)">' + esc(lab) + '</text>');
    });
    var ends = [];
    model.series.forEach(function (ser, si) {
      var d = '', pen = false;
      ser.values.forEach(function (val, i) { if (val == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(val).toFixed(1); pen = true; });
      var col = displayColor(ser.color, opts.dark);
      var halo = !opts.dark && luminance(col) > 0.6;
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
      for (var li = ser.values.length - 1; li >= 0; li--) if (ser.values[li] != null) { ends.push({ y: y(ser.values[li]), x: x(li), name: ser.name, color: ser.color }); break; }
    });
    // direct labels at line ends, de-collided
    if (model.series.length <= 8) {
      ends.sort(function (a, b) { return a.y - b.y; });
      for (var e = 1; e < ends.length; e++) if (ends[e].y - ends[e - 1].y < 13) ends[e].y = ends[e - 1].y + 13;
      ends.forEach(function (en) { out.push('<text x="' + (en.x + 7) + '" y="' + (en.y + 4) + '" font-size="11" fill="var(--text-secondary)" font-weight="600">' + esc(en.name) + '</text>'); });
    }
    out.push('<line class="xh" x1="0" x2="0" y1="' + T + '" y2="' + (T + ph) + '" stroke="var(--text-muted)" stroke-dasharray="3 3" visibility="hidden"/>');
    out.push('<rect class="hit" x="' + L + '" y="' + T + '" width="' + pw + '" height="' + ph + '" fill="transparent"/>');
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
  function stackedArea(model, opts) {
    opts = opts || {};
    var W = 640, H = opts.height || 225, L = 54, R = 74, T = 10, B = 26, pw = W - L - R, ph = H - T - B;
    var n = model.labels.length;
    var up = new Array(n).fill(0), down = new Array(n).fill(0);
    var layers = model.series.map(function (ser) {
      var lo = [], hi = [];
      ser.values.forEach(function (v, i) { v = v || 0; if (v >= 0) { lo.push(up[i]); up[i] += v; hi.push(up[i]); } else { hi.push(down[i]); down[i] += v; lo.push(down[i]); } });
      return { ser: ser, lo: lo, hi: hi };
    });
    var max = Math.max.apply(null, up.concat([1])), min = Math.min.apply(null, down.concat([0]));
    var step = niceStep((max - min) / 4); max = Math.ceil(max / step) * step; min = Math.floor(min / step) * step;
    var x = function (i) { return L + (n <= 1 ? pw / 2 : i * pw / (n - 1)); };
    var y = function (v) { return T + ph - (v - min) / (max - min || 1) * ph; };
    var out = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.title || '') + '">'];
    for (var v = min; v <= max + 1e-9; v += step) {
      out.push('<line x1="' + L + '" x2="' + (L + pw) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--grid)"/>');
      out.push('<text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="11" fill="var(--text-muted)">' + esc(model.fmt(v)) + '</text>');
    }
    var every = Math.max(1, Math.ceil(n / 12));
    model.labels.forEach(function (lab, i) {
      if ((i % every === 0 && (n - 1 - i >= every || i === n - 1)) || i === n - 1) out.push('<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11" fill="var(--text-muted)">' + esc(lab) + '</text>');
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
    lab.forEach(function (lb) { out.push('<text x="' + (x(li) + 7) + '" y="' + (lb.y + 4) + '" font-size="11" font-weight="600" fill="var(--text-secondary)">' + esc(lb.name) + '</text>'); });
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
    return '<div class="legend">' + series.map(function (s) { return '<span><i class="sw" style="background:' + displayColor(s.color, dark) + '"></i>' + esc(s.name) + '</span>'; }).join('') + '</div>';
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
  // Body of the Game log section: one round's lines, or search hits across the whole log
  function glBody(d, idx, q, col, me) {
    var G = d.gameLog; if (!G) return '';
    var prev = null;
    var li = function (f, pre, runs) {
      var who = f.u && !f.head ? f.u : '', first = !runs || who !== prev; prev = who;
      return '<li class="gl' + (f.head ? ' head' : '') + (G.meId && f.id === G.meId ? ' mine' : '') + (who && who === me ? ' me' : '') + '"' + (who && col[who] ? ' style="--pc:' + col[who] + '"' : '') + '>' +
        '<span class="gu">' + (who && first ? esc(who) : '') + '</span><span class="gm">' + (pre ? '<small class="glr">' + esc(pre) + '</small> ' : '') + esc(f.msg) + '</span></li>';
    };
    q = (q || '').trim().toLowerCase();
    if (q) {
      var out = [], total = 0;
      G.rounds.forEach(function (r) { r.lines.forEach(function (f) { if (f.msg.toLowerCase().indexOf(q) >= 0) { total++; if (out.length < 300) out.push(li(f, r.label, false)); } }); });
      return (out.length ? out.join('') : '<li class="head">No lines match.</li>') + (total > 300 ? '<li class="head">… and ' + (total - 300) + ' more, narrow the search</li>' : '');
    }
    var rr = G.rounds[Math.min(Math.max(idx, 0), G.rounds.length - 1)];
    return rr.lines.length ? rr.lines.map(function (f) { return li(f, '', true); }).join('') : '<li class="head">Nothing logged in this round.</li>';
  }
  function render(w, d) {
    var doc = w.document, dark = isDark(w), pal = PLAYER_COLORS[dark ? 'dark' : 'light'];
    var m = d.money;
    var me = myName(d.players.map(function (p) { return p.name; }));
    var myTurn = !!me && !d.finished && !!d.live && d.live.acting.indexOf(me) >= 0;
    var soundOn = lsGet('xxStats.sound') === '1', armed = !!w.__xxAudio;
    doc.title = (myTurn ? '● Your turn · ' : '') + d.roundLabel + ' · ' + d.title + ' · ' + d.id + ' · 18xx-JNNstats';
    var th = themePref(); if (th) doc.documentElement.setAttribute('data-theme', th); else doc.documentElement.removeAttribute('data-theme');
    if (ST.lookGame !== d.id) { ST.lookGame = d.id; ST.lookId = d.feed.length ? d.feed[0].id : 0; }
    ST.maxFeedId = d.feed.length ? d.feed[0].id : 0;
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
      '<button class="ib" id="th" title="Switch between dark and light">' + (dark ? '🌙' : '☀') + '</button>' +
      '<details class="menu" id="mn"' + (ST.menuOpen ? ' open' : '') + '><summary class="ib" title="More">⋯</summary><div class="mp2">' +
        '<button id="lr" title="Restore the default order and expand all sections">Reset <span id="lm">layout</span></button>' +
        '<form id="gf" style="display:flex;gap:6px"><input id="gi" placeholder="game # or link" size="14" value="' + esc(ST.giVal || '') + '"><button>Open</button></form>' +
        '<div style="color:var(--text-muted)">Look at another game, old or live.</div></div></details></span></div>');
    h.push('<div class="hr2"><a href="' + REPO_URL + '" target="_blank" rel="noopener" style="color:inherit">18xx-JNNstats v' + VERSION + ' by jimiste</a>' +
      (newer ? ' · <a class="upd" href="' + REPO_URL + '/blob/main/CHANGELOG.md" target="_blank" rel="noopener" title="A newer version exists. If you pinned a version, read the changelog, then update your bookmark.">⬆ v' + esc(ST.latest) + ' available</a>' : '') +
      ' · ' + d.actions + ' actions · updated ' + d.updated.toLocaleTimeString() + ' · ' + esc(ST.statusText || '') +
      (ST.verify ? ' · <span class="' + (ST.verify.ok ? 'st-good' : 'st-warn') + '" title="After each round the whole game is replayed from scratch and compared with the live numbers">' + (ST.verify.ok ? '✓ verified' : '⚠ corrected') + ' at ' + esc(ST.verify.at) + '</span>' : '') +
      '</div></header><main>');

    // ---------- Live sections: Now, What just happened, Stock round helper -----------------
    var L = d.live;
    var buysTxt = function (n) { return n === 1 ? 'on the next buy' : 'in ' + n + ' buys'; };
    if (!d.finished && L) {
      h.push('<section class="card wide"><h2>Now</h2>');
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
      h.push('<div class="tile"><div class="l">Game end</div>' +
        (en.triggered ? '<div class="v st-crit">Triggered</div><div class="d2">' + esc(en.triggered.reason) + ' → ends ' + esc(en.triggered.timing) + '</div>'
          : en.bankORs != null ? '<div class="v">≈ ' + (en.bankORs < 10 ? en.bankORs.toFixed(1) : Math.round(en.bankORs)) + ' <small class="sm">ORs of bank left</small></div><div class="d2">Bank ' + esc(m(d.bank)) + ', falling about ' + esc(m(en.bankDrop)) + ' per OR lately.</div>'
          : '<div class="v sm2">not triggered</div>') +
        (en.conditions.length ? '<div class="d2">Ends on: ' + en.conditions.map(function (c) { return esc(c.reason) + ' <span style="color:var(--text-muted)">(' + esc(c.timing) + ')</span>'; }).join(', ') + '</div>' : '') + '</div>');
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
        '<ul class="feed gl" id="gl-b">' + glBody(d, glIdx, ST.glQ, glCol, me) + '</ul></section>');
    }

    // Stock ticker
    if (d.ticker && d.ticker.length) {
      h.push('<section class="card wide"><h2>Stock ticker</h2><p class="sub">Share price now · change since the previous round · trend over the game</p><div class="ticker">');
      d.ticker.forEach(function (tk) {
        var dlt = tk.prev != null ? tk.price - tk.prev : 0, pct = tk.prev ? dlt / tk.prev * 100 : 0;
        var cls = dlt > 0 ? 'up' : dlt < 0 ? 'down' : 'flat', arrow = dlt > 0 ? '▲' : dlt < 0 ? '▼' : '■';
        var tot = tk.first ? (tk.price - tk.first) / tk.first * 100 : 0;
        h.push('<div class="tk' + (tk.closed ? ' closed' : '') + '" data-corp="' + esc(tk.name) + '" title="' + esc(tk.name) + ': ' + esc(m(tk.first)) + ' → ' + esc(m(tk.price)) + ' over the game (' + (tot >= 0 ? '+' : '') + tot.toFixed(0) + '%)"><div><span class="nm"><i class="sw" style="background:' + displayColor(tk.color, dark) + '"></i>' + esc(tk.name) + '</span>' + (tk.closed ? ' <small>closed</small>' : '') +
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
    var vModel = { labels: d.valueHistory.labels, fmt: m, series: d.players.map(function (p, i) { return { name: p.name, color: pal[p.idx % pal.length], values: d.valueHistory.series[i], bold: p.name === me }; }) };
    var vChart = lineChart(vModel, { title: 'Player value over time', dark: dark });
    h.push('<section class="card"><h2>Player value over time</h2><p class="sub">Value at the end of each round</p>' + legend(vModel.series) + '<div class="chart" id="c-value">' + vChart.svg + '<div class="tip"></div></div></section>');

    // Revenue
    var rModel = { labels: d.revenue.labels, fmt: m, series: d.revenue.series };
    var rChart = lineChart(rModel, { title: 'Company revenue per OR', dark: dark });
    h.push('<section class="card"><h2>Company revenue per operating round</h2><p class="sub">● paid out &nbsp;◉ half &nbsp;○ withheld / no run &nbsp;┄ minor</p>' + legend(rModel.series, dark) + '<div class="chart" id="c-rev">' + rChart.svg + '<div class="tip"></div></div></section>');

    // Share prices
    var pModel = { labels: d.prices.labels, fmt: m, series: d.prices.series };
    var pChart = lineChart(pModel, { title: 'Share price', dark: dark });
    h.push('<section class="card"><h2>Share price</h2><p class="sub">Market price at the end of each round</p>' + legend(pModel.series, dark) + '<div class="chart" id="c-price">' + pChart.svg + '<div class="tip"></div></div></section>');

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
    var B = d.bank2, bankHtml = '';
    if (B) {
      var trChip = function (r2, i2) { return '<span class="chip' + (i2 === 0 ? ' next' : '') + '">' + (i2 === 0 ? '▶ ' : '') + esc(r2.name) + (r2.n > 1 ? ' × ' + r2.n : '') + ' · ' + esc(m(r2.price)) + '</span>'; };
      var shChip = function (x) { return '<span class="chip" data-corp="' + esc(x.name) + '"><i class="sw" style="background:' + displayColor(x.color || '#999', dark) + '"></i>' + esc(x.name) + ' ' + x.n + ' × ' + x.pct + '%</span>'; };
      bankHtml = ('<div class="bankbox"><div class="tiles"><div class="tile"><div class="l">Bank cash</div><div class="v">' + esc(m(B.cash)) + '</div></div></div>' +
        '<div class="bl">Trains still to come, in order (the first is the next one bought)</div><div class="dq" data-bank="depot">' + (B.up.length ? B.up.map(trChip).join('') : '<span style="color:var(--text-muted)">none left</span>') + '</div>' +
        (B.pool.length ? '<div class="bl">Trains in the bank pool (discarded, can be bought)</div><div class="dq" data-bank="trainpool">' + B.pool.map(function (r2) { return '<span class="chip">' + esc(r2.name) + (r2.n > 1 ? ' × ' + r2.n : '') + ' · ' + esc(m(r2.price)) + '</span>'; }).join('') + '</div>' : '') +
        '<div class="bl">Shares in the initial offering</div><div class="dq" data-bank="ipo">' + (B.ipo.length ? B.ipo.map(shChip).join('') : '<span style="color:var(--text-muted)">none</span>') + '</div>' +
        '<div class="bl">Shares in the market (bank pool)</div><div class="dq" data-bank="pool">' + (B.mpool.length ? B.mpool.map(shChip).join('') : '<span style="color:var(--text-muted)">none</span>') + '</div></div>');
    }


    h.push('<section class="card wide"><h2>Trains &amp; phases</h2><p class="sub">What is left in the bank, what is running, and what rusts next</p>' + bankHtml);
    h.push('<div class="tiles"><div class="tile"><div class="l">Trains left in bank</div><div class="v">' + totalLeft + (unlimitedLeft ? ' <small style="font-size:13px;color:var(--text-muted)">+ unlimited</small>' : '') + '</div></div>');
    h.push('<div class="tile"><div class="l">Next train</div><div class="v">' + (d.nextTrain ? esc(d.nextTrain.name) + ' <small style="font-size:13px;color:var(--text-muted)">' + esc(m(d.nextTrain.price)) + '</small>' : '—') + '</div></div>');
    var nextPhase = d.phases.find(function (p) { return p.status === 'future'; });
    h.push('<div class="tile"><div class="l">Next phase</div><div class="v">' + (nextPhase ? esc(nextPhase.name) + ' <small style="font-size:13px;color:var(--text-muted)">' + (nextPhase.inPurchases > 0 ? (nextPhase.inPurchases === 1 ? 'on next buy' : 'in ' + nextPhase.inPurchases + ' buys') : '') + '</small>' : '—') + '</div></div>');
    var rg = d.trainGroups.filter(function (g) { return g.owned && g.rustIn > 0; }).sort(function (a, b) { return a.rustIn - b.rustIn; })[0];
    var hit = rg ? d.trainGroups.filter(function (g) { return g.owned && g.rustIn === rg.rustIn; }) : [];
    var hitCorps = {}; hit.forEach(function (g) { Object.keys(g.owners).forEach(function (o) { hitCorps[o] = 1; }); });
    h.push('<div class="tile"><div class="l">Next rust</div><div class="v">' + (rg ? esc(hit.map(function (g) { return g.sym; }).join(' + ')) + ' <small style="font-size:13px;color:var(--text-muted)">' + (rg.rustIn === 1 ? 'on next buy' : 'in ' + rg.rustIn + ' buys') + '</small><div style="font-size:11px;font-weight:400;color:var(--text-muted)">hits ' + esc(Object.keys(hitCorps).join(', ')) + '</div>' : '<span style="font-size:14px;color:var(--text-muted)">no rust ahead</span>') + '</div></div></div>');

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
      h.push('<td>' + (g.rustsOn ? esc(g.rustsOn) + (g.owned && g.rustIn > 0 ? ' <small class="st-crit">' + buysTxt(g.rustIn) + '</small>' : '') : '—') + '</td><td>' + (g.obsoleteOn ? esc(g.obsoleteOn) + (g.owned && g.obsIn > 0 ? ' <small class="st-warn">' + buysTxt(g.obsIn) + '</small>' : '') : '—') + '</td><td>' + esc(Object.keys(g.owners).map(function (o) { return o + (g.owners[o] > 1 ? '×' + g.owners[o] : ''); }).join(', ')) + '</td></tr>');
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
        h.push('<tr><td><b>' + esc(c.sym) + '</b> <small style="color:var(--text-muted)">' + esc(c.name) + '</small></td><td>private</td><td>' + esc(m(c.value)) + '</td><td>' + (c.revenue ? esc(m(c.revenue)) + '/OR' : '—') + '</td><td style="text-align:left">' + tl(c.timeline.filter(function (x) { return x.owner !== 'closed'; })) + '</td><td>' + (c.closedAt ? '<span class="flat">closed ' + esc(c.closedAt) + '</span>' : '<span class="st-good">open</span>') + '</td></tr>');
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
    // game log slider, search and jump (only the list is redrawn)
    var gli = doc.getElementById('gl-i');
    if (gli && d.gameLog) {
      var glSet = function (v) {
        var mx = d.gameLog.rounds.length - 1; v = Math.min(Math.max(v, 0), mx); gli.value = v; ST.glIdx = v; ST.glGame = d.id;
        doc.getElementById('gl-l').textContent = d.gameLog.rounds[v].label;
        doc.getElementById('gl-b').innerHTML = glBody(d, v, ST.glQ, glCol, me); doc.getElementById('gl-b').scrollTop = 0;
      };
      gli.oninput = function () { glSet(+gli.value); };
      doc.getElementById('gl-p').onclick = function () { glSet(+gli.value - 1); };
      doc.getElementById('gl-n').onclick = function () { glSet(+gli.value + 1); };
      doc.getElementById('gl-q').oninput = function () { ST.glQ = this.value; ST.glGame = d.id; doc.getElementById('gl-b').innerHTML = glBody(d, +gli.value, ST.glQ, glCol, me); };
      var glm = doc.getElementById('gl-me');
      if (glm) glm.onclick = function () { ST.glQ = ''; doc.getElementById('gl-q').value = ''; glSet(d.gameLog.meRound); var mn = doc.querySelector('#gl-b li.mine'); if (mn && mn.scrollIntoView) mn.scrollIntoView({ block: 'center' }); };
    }
    glideChanges(w, d, dark);
    // your-turn sound, once per turn
    var turnKey = d.id + ':' + myTurn;
    if (myTurn && ST.turnKey !== turnKey && ST.turnKey != null && soundOn) beep(w);
    ST.turnKey = turnKey;
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
    doc.getElementById('sn').onclick = function () { snapRight(w); };
    doc.getElementById('gf').onsubmit = function (ev) { ev.preventDefault(); ST.giVal = ''; ST.menuOpen = false; var mm = String(doc.getElementById('gi').value).match(/(\d{3,})/); if (mm) { ST.gameId = mm[1]; ST.pfPlayer = null; w.document.body.innerHTML = '<p style="padding:20px">Loading game ' + mm[1] + '…</p>'; refresh(true); } };
    function drawPf(i) {
      ST.pfPlayer = i;
      var el = doc.getElementById('c-pf'); if (!el) return;
      var pf = d.portfolio[i];
      var model = { labels: pf.labels, fmt: m, series: [{ name: 'Cash', color: dark ? '#6b6a64' : '#b9b8b2', muted: true, values: pf.cash }].concat(pf.priv.some(function (v) { return v; }) ? [{ name: 'Privates', color: dark ? '#8a7d5c' : '#c9b98f', muted: true, values: pf.priv }] : [])
        .concat(pf.other.some(function (v) { return v; }) ? [{ name: 'Other', color: dark ? '#5f7d8a' : '#9fb8c4', muted: true, values: pf.other }] : []).concat(pf.series) };
      var ch = stackedArea(model, { dark: dark, title: pf.name + ' portfolio' });
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
    live: ['now', 'what-just-happened', 'trains-phases', 'stock-round-helper', 'stock-market', 'standings', 'player-value-over-time', 'stock-ticker', 'portfolios', 'corporations', 'company-revenue-per-operating-round', 'share-price', 'game-log', 'minors-private-companies', 'tile-manifest'],
    review: ['stock-ticker', 'stock-market', 'standings', 'player-value-over-time', 'game-log', 'company-revenue-per-operating-round', 'share-price', 'portfolios', 'corporations', 'trains-phases', 'minors-private-companies', 'tile-manifest']
  };
  function slug(txt) { return String(txt).toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function loadLayout(mode) {
    try {
      var v = JSON.parse(localStorage.getItem('xxStats.layout.' + mode) || 'null');
      if (v && v.order) { // sections added in newer versions slot in at their default place
        DEFAULT_ORDER[mode].forEach(function (k, i) { if (v.order.indexOf(k) < 0) { v.order.splice(Math.min(i, v.order.length), 0, k); if (k === 'tile-manifest' || k === 'minors-private-companies') (v.collapsed = v.collapsed || []).push(k); } });
        return v;
      }
    } catch (e) {}
    return { order: DEFAULT_ORDER[mode].slice(), collapsed: ['minors-private-companies', 'tile-manifest'] };
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
    var th0 = themePref(); if (th0) w.document.documentElement.setAttribute('data-theme', th0); else w.document.documentElement.removeAttribute('data-theme');
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
  var ST = window.__xxStats = { token: Date.now() + '-' + Math.random(), win: OLD && OLD.win, version: VERSION };
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
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>18xx-JNNstats v' + VERSION + '</title><style>' + CSS + '</style></head><body><p style="padding:20px">Loading game…</p><script>' + WATCHDOG + '<\/script></body></html>');
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
    var d = extract(gm.g, gm.raw);
    window.__xxLast = d;
    render(w, d);
  }
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
