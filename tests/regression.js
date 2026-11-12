/* 18xx-JNNstats regression check. Paste into the console on an 18xx.games game page after loading the stats window.
   Set window.__XX_TEST_IDS = [numbers of finished games] first. Results: window.__xxTestRows, window.__xxTestDone. */
(function () {
  var A = window.__xxStats && window.__xxStats.api;
  if (!A) { console.error('Load the stats window first (click the bookmark).'); return; }
  var ids = window.__XX_TEST_IDS || [];
  window.__xxTestRows = []; window.__xxTestDone = false;
  var holder = document.getElementById('xxs-h'); if (holder) holder.remove();
  holder = document.createElement('iframe'); holder.id = 'xxs-h'; holder.style.cssText = 'position:fixed;left:-9999px;width:900px;height:900px'; document.body.appendChild(holder);
  (async function () {
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i], row = { id: id };
      try {
        var text = await (await fetch('/api/game/' + id, { credentials: 'same-origin' })).text(), j = JSON.parse(text);
        row.title = j.title;
        if (!j.actions || !j.actions.length) { row.note = 'archived or no moves'; window.__xxTestRows.push(row); continue; }
        await A.ensureTitle(j.title);
        var g = A.loadGame(text), d = A.extract(g, j);
        var idOf = {}; j.players.forEach(function (p) { idOf[p.name] = p.id; });
        var bad = [];
        d.players.forEach(function (p) { var off = (j.result || {})[idOf[p.name]]; if (off == null) bad.push(p.name + ': no official score'); else if (Math.round(off) !== Math.round(p.value)) bad.push(p.name + ' ' + Math.round(p.value) + ' vs ' + Math.round(off)); });
        row.score = j.status === 'finished' ? (bad.length ? bad.join('; ') : 'exact') : 'game not finished';
        var gridBad = 0, n = 0;
        if (d.grid) d.corps.forEach(function (c) {
          if (c.price == null || c.closed) return; n++;
          var f = null; d.grid.cells.forEach(function (r) { r.forEach(function (cell) { if (cell && cell.c.indexOf(c.name) >= 0) f = cell.p; }); });
          if (f !== c.price) gridBad++;
        });
        row.grid = d.grid ? gridBad + ' of ' + n + ' wrong' : 'no grid';
        // cross-check against the engine itself: bank cash, phase, game-end trigger (at up to 6 points in the game) and the Routes table
        var xbad = [];
        if (Math.round(d.bank) !== Math.round(d.bank2.cash)) xbad.push('bank cash differs inside the tool');
        var runLines = 0; d.gameLog.rounds.forEach(function (r) { r.lines.forEach(function (l) { if (/^.+? runs an? .+? train for .+?: /.test(l.msg)) runLines++; }); });
        var tableTrains = 0; d.routes.forEach(function (r) { r.corps.forEach(function (c) { tableTrains += c.trains.length; }); });
        if (runLines !== tableTrains) xbad.push('route table has ' + tableTrains + ' trains, log has ' + runLines);
        var cuts = d.gameLog.cuts.filter(function (c, k, arr) { return c > 0 && (k === 0 || c !== arr[k - 1]); }), pick = [];
        for (var q = 0; q < 6 && cuts.length; q++) pick.push(cuts[Math.floor(q * (cuts.length - 1) / 5)]);
        for (var pi = 0; pi < pick.length; pi++) {
          var j2 = JSON.parse(text); j2.actions = j.actions.filter(function (a) { return a.id <= pick[pi]; }); j2.status = 'active'; j2.result = {};
          var g2 = A.loadGame(JSON.stringify(j2)), d2 = A.extract(g2, j2);
          if (String(g2.$finished()) === 'true') continue; // the engine writes no end-of-game text once the game is over
          var desc = g2.$game_ending_description(), engineSays = desc !== Opal.nil && desc != null && String(desc) !== '';
          var weSay = !!(d2.live && d2.live.end && d2.live.end.triggered);
          if (engineSays !== weSay) xbad.push('after action ' + pick[pi] + ': game-end trigger engine=' + engineSays + ' tool=' + weSay);
          if (Math.round(d2.bank) !== Math.round(g2.$bank().$cash())) xbad.push('after action ' + pick[pi] + ': bank cash differs from engine');
          if (d2.phase !== String(g2.$phase().$name())) xbad.push('after action ' + pick[pi] + ': phase differs from engine');
        }
        var ids2 = {}; (d.hexMap ? d.hexMap.hexes : []).forEach(function (h) { ids2[h.id] = 1; });
        var stopN = 0, stopOk = 0; d.routes.forEach(function (r) { r.corps.forEach(function (c) { c.trains.forEach(function (tr) { tr.stops.split('-').forEach(function (x) { var k = x.replace(/[\[\]()]/g, '').split(' + ')[0].trim(); stopN++; if (ids2[k]) stopOk++; }); }); }); });
        row.map = !d.hexMap ? 'no hex data' : Math.round(100 * stopOk / Math.max(stopN, 1)) + '% of route stops found on the map (' + d.hexMap.hexes.length + ' hexes)';
        row.replay = d.replay ? d.replay.labels.length + ' frames, ' + d.replay.hx.filter(function (z) { return z; }).length + ' with a board' : 'no replay';
        row.engine = xbad.length ? xbad.join('; ') : 'ok (' + pick.length + ' points)';
        try { var w = holder.contentWindow; w.document.body.innerHTML = ''; A.render(w, d); row.render = 'ok'; } catch (e) { row.render = 'ERROR ' + String(e).slice(0, 100); }
      } catch (e) { row.error = String(e).slice(0, 160); }
      window.__xxTestRows.push(row);
    }
    window.__xxTestDone = true;
    console.table(window.__xxTestRows);
  })();
})();
