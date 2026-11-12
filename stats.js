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
  var VERSION = '0.5.0';
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
    var snap = { label: short + ' ' + s(g.$turn()) + (short === 'OR' ? '.' + s(call(rd, 'round_num')) : ''), prices: {}, hold: {}, cash: {}, priv: {}, value: {}, minors: {}, companies: {}, corpCash: {} };
    var corps = g.$corporations();
    corps.forEach(function (c) {
      var sp = call(c, 'share_price'); if (sp) snap.prices[s(c.$name())] = num(call(sp, 'price'));
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
  function installHook() {
    var B = Opal.Engine.Game.Base.prototype;
    if (B.__xxHooked) return;
    var orig = B.$store_player_info;
    if (typeof orig !== 'function') return;
    B.$store_player_info = function () {
      var r = orig.apply(this, arguments);
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

  function extract(g, raw) {
    var cfg = Object.assign({}, CONFIG.default, CONFIG[raw.title] || {});
    var money = function (v) { try { return s(g.$format_currency(Math.round(v))); } catch (e) { return String(Math.round(v)); } };
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
        loans: (call(c, 'loans') || []).length
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
      var sig = function (x) { return JSON.stringify([x.prices, x.hold, x.cash]); };
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
    groups.forEach(function (gr) { gr.rustIn = gr.rustsOn ? untilTrigger([gr.rustsOn]) : -1; });
    // trains at risk: owned trains whose rust trigger is still ahead
    var risk = [];
    corps.forEach(function (c) {
      var rustIn = c.trains.map(function (t) { return t.rustsOn ? untilTrigger([t.rustsOn]) : -1; });
      var safe = rustIn.filter(function (x) { return x < 0; }).length;
      var soonest = rustIn.filter(function (x) { return x >= 0; }).sort(function (a, b) { return a - b; })[0];
      c.rustIn = rustIn;
      c.trainless = c.trains.length === 0;
      c.allRustAt = (safe === 0 && c.trains.length) ? Math.max.apply(null, rustIn) : null;
      if (soonest != null) risk.push({ corp: c.name, inPurchases: soonest, count: rustIn.filter(function (x) { return x === soonest; }).length, ofTotal: c.trains.length });
    });

    var notes = cfg.notes ? cfg.notes(g) : [];
    return {
      id: raw.id, title: raw.title, status: raw.status, finished: finished, description: raw.description,
      roundLabel: roundLabel, phase: curPhase, trainLimit: s(call(phase, 'train_limit', corpObjs[0])) || '',
      bank: num(g.$bank().$cash()), money: money, actions: raw.actions.length,
      players: players, valueHistory: vh, corps: corps, revenue: revenue, prices: prices,
      trainGroups: groups, phases: phases, risk: risk,
      ticker: ticker, portfolio: portfolio, holdings: holdings, minors: minorList, companies: companyList, snapErr: SNAP && SNAP.err,
      nextTrain: nextTrain ? { name: s(nextTrain.$name()), sym: s(call(nextTrain, 'sym')), price: num(nextTrain.$price()) } : null,
      upcomingCount: upcoming.length, notes: notes, updated: new Date()
    };
  }

  // ---------- Rendering -------------------------------------------------------------------
  var CSS = [
    ':root{--surface-0:#f4f4f2;--surface-1:#fcfcfb;--text-primary:#0b0b0b;--text-secondary:#52514e;--text-muted:#7a7974;--grid:#e6e5e1;--border:#dddcd7;--good:#1a7f37;--warn:#b26b00;--crit:#c62828;--accent:#2a78d6;color-scheme:light}',
    '@media (prefers-color-scheme: dark){:root{--surface-0:#121211;--surface-1:#1a1a19;--text-primary:#f0efec;--text-secondary:#c3c2b7;--text-muted:#8f8e86;--grid:#2c2c2a;--border:#33332f;--good:#4cc36b;--warn:#e0a020;--crit:#ef6b6b;--accent:#3987e5;color-scheme:dark}}',
    '*{box-sizing:border-box}body{margin:0;background:var(--surface-0);color:var(--text-primary);font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    'header{position:sticky;top:0;z-index:5;background:var(--surface-1);border-bottom:1px solid var(--border);padding:10px 16px;display:flex;flex-wrap:wrap;gap:6px 18px;align-items:baseline}',
    'header h1{font-size:15px;margin:0;font-weight:650}header .kv{color:var(--text-secondary)}header .kv b{color:var(--text-primary);font-weight:600}',
    'header .right{margin-left:auto;color:var(--text-muted);font-size:12px}header button{font:inherit;font-size:12px;padding:3px 9px;border:1px solid var(--border);background:var(--surface-0);color:var(--text-primary);border-radius:6px;cursor:pointer}',
    'main{padding:10px 12px;display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(min(560px,100%),1fr));align-items:start}',
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
    '.tl{display:flex;flex-wrap:wrap;gap:4px;align-items:center}.tl span.o{border:1px solid var(--border);border-radius:6px;padding:0 6px}.tl small{color:var(--text-muted)}'
  ].join('\n');

  function isDark(w) { try { return w.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; } }
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
      out.push('<path data-s="' + si + '" d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"' + (ser.dashed ? ' stroke-dasharray="5 4"' : '') + '/>');
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

  function render(w, d) {
    var doc = w.document, dark = isDark(w), pal = PLAYER_COLORS[dark ? 'dark' : 'light'];
    var m = d.money;
    doc.title = d.title + ' · ' + d.id + ' · Stats';
    var leader = Math.max.apply(null, d.players.map(function (p) { return p.value; }));
    var ranked = d.players.slice().sort(function (a, b) { return b.value - a.value; });
    var maxVal = leader || 1;

    var h = [];
    h.push('<header><h1>' + esc(d.title) + ' <span style="color:var(--text-muted);font-weight:400">#' + esc(d.id) + '</span></h1>');
    h.push('<span class="kv">Round <b>' + esc(d.roundLabel) + '</b></span><span class="kv">Phase <b>' + esc(d.phase) + '</b></span>');
    h.push('<span class="kv">Bank <b class="' + (d.bank <= 0 ? 'st-crit' : '') + '">' + esc(m(d.bank)) + '</b></span>');
    if (d.nextTrain) h.push('<span class="kv">Next train <b>' + esc(d.nextTrain.name) + '</b> ' + esc(m(d.nextTrain.price)) + '</span>');
    if (d.finished) h.push('<span class="pill" style="border-color:var(--crit);color:var(--crit)">Game over</span>');
    h.push('<span class="right"><a href="' + REPO_URL + '" target="_blank" rel="noopener" style="color:inherit">18xx-JNNstats v' + VERSION + ' by jimiste</a> · ' + d.actions + ' actions · updated ' + d.updated.toLocaleTimeString() + ' · auto-refresh 10 s <button id="rf">Refresh</button> <button id="sn" title="Move this window to the right half of the screen">◨ Half screen</button> <button id="lr" title="Restore the default order and expand all sections">Reset <span id="lm">layout</span></button> <form id="gf" style="display:inline"><input id="gi" placeholder="game # or link" size="12" style="font:inherit;font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:6px;background:var(--surface-0);color:var(--text-primary)"> <button>Open</button></form></span></header><main>');

    // Stock ticker
    if (d.ticker && d.ticker.length) {
      h.push('<section class="card wide"><h2>Stock ticker</h2><p class="sub">Share price now · change since the previous round · trend over the game</p><div class="ticker">');
      d.ticker.forEach(function (tk) {
        var dlt = tk.prev != null ? tk.price - tk.prev : 0, pct = tk.prev ? dlt / tk.prev * 100 : 0;
        var cls = dlt > 0 ? 'up' : dlt < 0 ? 'down' : 'flat', arrow = dlt > 0 ? '▲' : dlt < 0 ? '▼' : '■';
        var tot = tk.first ? (tk.price - tk.first) / tk.first * 100 : 0;
        h.push('<div class="tk' + (tk.closed ? ' closed' : '') + '" title="' + esc(tk.name) + ': ' + esc(m(tk.first)) + ' → ' + esc(m(tk.price)) + ' over the game (' + (tot >= 0 ? '+' : '') + tot.toFixed(0) + '%)"><div><span class="nm"><i class="sw" style="background:' + displayColor(tk.color, dark) + '"></i>' + esc(tk.name) + '</span>' + (tk.closed ? ' <small>closed</small>' : '') +
          '<div class="px">' + esc(m(tk.price)) + '</div><div class="ch ' + cls + '">' + arrow + ' ' + (dlt ? (dlt > 0 ? '+' : '−') + esc(m(Math.abs(dlt))) + ' (' + Math.abs(pct).toFixed(1) + '%)' : 'unchanged') + '</div></div>' + sparkline(tk.spark, tk.color, dark) + '</div>');
      });
      h.push('</div></section>');
    }

    // Standings
    h.push('<section class="card"><h2>Standings</h2><p class="sub">Player value = cash + shares at market price' + (d.finished ? ' (final)' : '') + '</p><div class="tw"><table><thead><tr><th>#</th><th>Player</th><th>Value</th><th style="width:30%"></th><th>Gap</th><th>Cash</th><th>Certs</th></tr></thead><tbody>');
    ranked.forEach(function (p, i) {
      var c = pal[p.idx % pal.length];
      var certCls = p.certLimit && p.certs >= p.certLimit ? 'st-crit' : p.certLimit && p.certs >= p.certLimit - 1 ? 'st-warn' : '';
      h.push('<tr><td>' + (i + 1) + '</td><td style="text-align:left"><i class="sw" style="background:' + c + '"></i>' + esc(p.name) + (p.bankrupt ? ' <span class="pill">bankrupt</span>' : '') + '</td><td><b>' + esc(m(p.value)) + '</b></td>');
      h.push('<td><div class="bar"><i style="width:' + (p.value / maxVal * 100).toFixed(1) + '%;background:' + c + '"></i></div></td>');
      h.push('<td>' + (i === 0 ? '—' : '−' + esc(m(leader - p.value))) + '</td><td>' + esc(m(p.cash)) + '</td><td class="' + certCls + '">' + p.certs + (p.certLimit ? '/' + p.certLimit : '') + '</td></tr>');
    });
    h.push('</tbody></table></div></section>');

    // Value history
    var vModel = { labels: d.valueHistory.labels, fmt: m, series: d.players.map(function (p, i) { return { name: p.name, color: pal[p.idx % pal.length], values: d.valueHistory.series[i] }; }) };
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
    var pfSel = Math.min(ST.pfPlayer || 0, d.portfolio.length - 1);
    if (d.portfolio.length && d.portfolio[0].labels.length > 1) {
      h.push('<section class="card wide"><h2>Portfolios</h2><p class="sub">What each player holds, valued at the market price at the end of each round. Grey is cash, sand is private companies, blue-grey is anything else the title counts in player value (such as bids or debts); layers below zero are short positions or debts.</p>');
      h.push('<div class="tabs" id="pf-tabs">' + d.portfolio.map(function (p, i) { return '<button data-i="' + i + '"' + (i === pfSel ? ' class="on"' : '') + '><i class="sw" style="background:' + pal[d.players[i].idx % pal.length] + '"></i>' + esc(p.name) + '</button>'; }).join('') + '</div>');
      h.push('<div class="chart" id="c-pf"></div>');
      // holdings matrix
      var hc = d.holdings.corps;
      var anyPriv = d.holdings.rows.some(function (r) { return r.priv; });
      var anyOther = d.holdings.rows.some(function (r) { return r.other; });
      h.push('<h2 style="margin-top:12px">Holdings now</h2><p class="sub"><span class="pres">★</span> president · value at current market price</p><div class="tw"><table><thead><tr><th>Player</th>' + hc.map(function (cn) { var col = (d.ticker.find(function (t) { return t.name === cn; }) || {}).color || '#999'; return '<th><i class="sw" style="background:' + displayColor(col, dark) + '"></i>' + esc(cn) + '</th>'; }).join('') + '<th>Shares total</th>' + (anyPriv ? '<th>Privates</th>' : '') + (anyOther ? '<th title="Other parts of player value, such as bids or debts">Other</th>' : '') + '<th>Cash</th></tr></thead><tbody>');
      d.holdings.rows.forEach(function (row) {
        var tot = 0;
        h.push('<tr><td><i class="sw" style="background:' + pal[row.idx % pal.length] + '"></i>' + esc(row.name) + '</td>' + hc.map(function (cn) {
          var c = row.cells[cn]; if (!c) return '<td style="color:var(--text-muted)">·</td>';
          tot += c.val;
          return '<td><span class="' + (c.pct < 0 ? 'short' : '') + '">' + (c.pres ? '<span class="pres">★</span> ' : '') + c.pct + '%' + (c.pct < 0 ? ' short' : '') + '</span><span class="cellv">' + esc(m(c.val)) + '</span></td>';
        }).join('') + '<td><b>' + esc(m(tot)) + '</b></td>' + (anyPriv ? '<td>' + (row.priv ? esc(m(row.priv)) : '') + '</td>' : '') + (anyOther ? '<td>' + (row.other ? esc(m(row.other)) : '') + '</td>' : '') + '<td>' + esc(m(row.cash)) + '</td></tr>');
      });
      h.push('</tbody></table></div></section>');
    }

    // Trains
    var totalLeft = d.trainGroups.reduce(function (a, g) { return a + (g.unlimited ? 0 : g.available); }, 0);
    var unlimitedLeft = d.trainGroups.some(function (g) { return g.unlimited && g.available; });
    h.push('<section class="card wide"><h2>Trains &amp; phases</h2><p class="sub">What is left in the bank, what is running, and what rusts next</p>');
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

    h.push('<div class="tw"><table><thead><tr><th>Train</th><th>Variants</th><th>Price</th><th>In bank</th><th>Pool</th><th>Running</th><th>Rusted / gone</th><th style="width:22%">Supply</th><th>Rusts when</th><th>Held by</th></tr></thead><tbody>');
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
      h.push('<td>' + esc(g.rustsOn ? g.rustsOn : g.obsoleteOn ? 'obsolete: ' + g.obsoleteOn : '—') + '</td><td>' + esc(Object.keys(g.owners).map(function (o) { return o + (g.owners[o] > 1 ? '×' + g.owners[o] : ''); }).join(', ')) + '</td></tr>');
    });
    h.push('</tbody></table></div><p class="sub" style="margin-top:6px"><i class="sw" style="background:var(--accent)"></i>in bank <i class="sw" style="background:var(--warn);margin-left:10px"></i>bank pool <i class="sw" style="background:var(--good);margin-left:10px"></i>running <i class="sw" style="background:var(--text-muted);opacity:.45;margin-left:10px"></i>rusted / removed</p></section>');

    // Corporations
    var anyLoans = d.corps.some(function (c) { return c.loans > 0; });
    h.push('<section class="card wide"><h2>Corporations</h2><p class="sub">Treasury vs next train, train health, recent results</p><div class="tw"><table><thead><tr><th>Corp</th><th>President</th><th>Price</th><th>Treasury</th><th>Can buy next?</th><th>Trains</th><th>Train status</th><th>Tokens left</th>' + (anyLoans ? '<th>Loans</th>' : '') + '<th>Last revenue</th><th>Avg last 3</th></tr></thead><tbody>');
    d.corps.forEach(function (c) {
      var ohs = c.oh.slice().sort(function (a, b) { return (a.t * 100 + a.r) - (b.t * 100 + b.r); });
      var last = ohs[ohs.length - 1];
      var l3 = ohs.slice(-3); var avg = l3.length ? l3.reduce(function (a, o) { return a + o.revenue; }, 0) / l3.length : null;
      var can = d.nextTrain ? (c.cash >= d.nextTrain.price ? '<span class="st-good">✓ yes</span>' : '<span class="st-warn">short ' + esc(m(d.nextTrain.price - c.cash)) + '</span>') : '—';
      var status = c.trainless ? '<span class="st-crit">⚠ no trains</span>'
        : c.allRustAt != null ? '<span class="st-crit">⚠ trainless ' + (c.allRustAt === 1 ? 'on next buy' : 'in ' + c.allRustAt + ' buys') + '</span>'
        : c.rustIn.some(function (x) { return x >= 0; }) ? '<span class="st-warn">◐ ' + c.rustIn.filter(function (x) { return x >= 0; }).length + ' will rust</span>'
        : '<span class="st-good">✓ safe</span>';
      h.push('<tr><td><i class="sw" style="background:' + displayColor(c.color, dark) + '"></i><b>' + esc(c.name) + '</b></td><td>' + esc(c.president) + '</td><td>' + (c.price != null ? esc(m(c.price)) : '—') + '</td><td>' + esc(m(c.cash)) + '</td><td>' + can + '</td>');
      h.push('<td>' + esc(c.trains.map(function (t) { return t.name; }).join(', ') || '—') + '</td><td>' + status + '</td><td>' + (c.tokensTotal ? c.tokensLeft + '/' + c.tokensTotal : '—') + '</td>' + (anyLoans ? '<td>' + (c.loans || '') + '</td>' : ''));
      h.push('<td>' + (last ? esc(m(last.revenue)) + (last.kind && last.kind !== 'payout' ? ' <small style="color:var(--text-muted)">' + esc(last.kind) + '</small>' : '') : '—') + '</td><td>' + (avg != null ? esc(m(avg)) : '—') + '</td></tr>');
    });
    h.push('</tbody></table></div>');
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
    doc.getElementById('rf').onclick = function () { refresh(true); };
    doc.getElementById('sn').onclick = function () { snapRight(w); };
    doc.getElementById('gf').onsubmit = function (ev) { ev.preventDefault(); var mm = String(doc.getElementById('gi').value).match(/(\d{3,})/); if (mm) { ST.gameId = mm[1]; ST.sig = null; w.document.body.innerHTML = '<p style="padding:20px">Loading game ' + mm[1] + '…</p>'; refresh(true); } };
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
    live: ['trains-phases', 'corporations', 'standings', 'stock-ticker', 'portfolios', 'company-revenue-per-operating-round', 'player-value-over-time', 'share-price', 'minors-private-companies'],
    review: ['stock-ticker', 'standings', 'player-value-over-time', 'company-revenue-per-operating-round', 'share-price', 'portfolios', 'trains-phases', 'corporations', 'minors-private-companies']
  };
  function slug(txt) { return String(txt).toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function loadLayout(mode) {
    try { var v = JSON.parse(localStorage.getItem('xxStats.layout.' + mode) || 'null'); if (v && v.order) return v; } catch (e) {}
    return { order: DEFAULT_ORDER[mode].slice(), collapsed: [] };
  }
  function saveLayout(mode, lay) { try { localStorage.setItem('xxStats.layout.' + mode, JSON.stringify(lay)); } catch (e) {} }
  function applyLayout(w, mode) {
    var doc = w.document, main = doc.querySelector('main'); if (!main) return;
    var lay = loadLayout(mode);
    var secs = Array.prototype.slice.call(main.children).filter(function (el) { return el.tagName === 'SECTION'; });
    secs.forEach(function (sec) {
      var h2 = sec.querySelector('h2'); if (!h2) return;
      var key = slug(h2.textContent); sec.setAttribute('data-key', key);
      var title = h2.innerHTML;
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
    w.document.body.innerHTML = '<header><h1>' + esc(raw.title) + ' <span style="color:var(--text-muted);font-weight:400">#' + esc(raw.id) + '</span></h1><span class="kv">' + esc(raw.description || '') + '</span>' +
      '<span class="right"><form id="gf" style="display:inline"><input id="gi" placeholder="game # or link" size="12" style="font:inherit;font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:6px;background:var(--surface-0);color:var(--text-primary)"> <button>Open</button></form></span></header>' +
      '<main><section class="card wide"><h2>Archived game: only the final result is kept</h2><p class="sub">18xx.games deletes the moves of archived games, so there is no history to replay or chart. This is the final result as the site stored it.</p>' +
      '<div class="tw"><table><thead><tr><th>#</th><th>Player</th><th>Final score</th><th style="width:40%"></th></tr></thead><tbody>' +
      res.map(function (r, i) { return '<tr><td>' + (i + 1) + '</td><td style="text-align:left">' + esc(r.name) + '</td><td><b>' + esc(r.score) + '</b></td><td><div class="bar"><i style="width:' + (r.score / top * 100).toFixed(1) + '%;background:var(--accent)"></i></div></td></tr>'; }).join('') +
      '</tbody></table></div></section></main>';
    w.document.getElementById('gf').onsubmit = function (ev) { ev.preventDefault(); var mm = String(w.document.getElementById('gi').value).match(/(\d{3,})/); if (mm) { ST.gameId = mm[1]; ST.sig = null; refresh(true); } };
  }

  var ST = window.__xxStats || (window.__xxStats = {});
  ST.api = { extract: extract, loadGame: loadGame, ensureTitle: ensureTitle, render: render };
  function openWin() {
    if (ST.win && !ST.win.closed) return ST.win;
    // The bookmark opens the window itself (window.__xxStatsTarget), during the click, so pop-up
    // blockers allow it; this script arrives a moment later from GitHub via jsDelivr.
    var w = window.__xxStatsTarget;
    window.__xxStatsTarget = null;
    if (!w || w.closed) w = window.open('', 'xx-stats', 'width=1280,height=900');
    if (!w) { alert('18xx-JNNstats: the popup was blocked. Allow popups for 18xx.games and click the bookmark again.'); return null; }
    w.document.open();
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>18xx-JNNstats v' + VERSION + '</title><style>' + CSS + '</style></head><body><p style="padding:20px">Loading game…</p></body></html>');
    w.document.close();
    snapRight(w);
    ST.win = w;
    return w;
  }
  function refresh(force) {
    var w = ST.win; if (!w || w.closed) { clearInterval(ST.timer); ST.timer = null; return; }
    var id = gameId();
    return fetch('/api/game/' + id, { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (text) {
      var raw = JSON.parse(text);
      if (!raw.actions) throw new Error('Game ' + id + ' not found (' + (raw.error || 'no data') + ')');
      var sig = raw.actions.length + ':' + (raw.actions.length ? raw.actions[raw.actions.length - 1].id : 0) + ':' + raw.updated_at;
      if (!force && sig === ST.sig) return;
      ST.sig = sig;
      if (!raw.actions.length && (raw.status === 'archived' || (raw.result && Object.keys(raw.result).length))) { renderArchived(w, raw); return; }
      return ensureTitle(raw.title).then(function () {
        var g = loadGame(text);
        var d = extract(g, raw);
        window.__xxLast = d;
        render(w, d);
      });
    }).catch(function (e) {
      console.error('18xx-JNNstats', e);
      try { w.document.body.innerHTML = '<div class="err"><b>Could not build stats.</b><br>' + esc(e && e.message || e) + '</div>'; } catch (_) {}
    });
  }

  if (!pageGameId() || typeof Opal === 'undefined' || !Opal.Engine) { alert('18xx-JNNstats: open a game on 18xx.games first, then click the bookmark.'); return; }
  if (!openWin()) return;
  ST.win.focus();
  ST.gameId = null;
  ST.sig = null;
  refresh(true);
  if (!ST.timer) ST.timer = setInterval(function () { refresh(false); }, REFRESH_MS);
  ST.version = VERSION;
})();
