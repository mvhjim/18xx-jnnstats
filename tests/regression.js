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
        try { var w = holder.contentWindow; w.document.body.innerHTML = ''; A.render(w, d); row.render = 'ok'; } catch (e) { row.render = 'ERROR ' + String(e).slice(0, 100); }
      } catch (e) { row.error = String(e).slice(0, 160); }
      window.__xxTestRows.push(row);
    }
    window.__xxTestDone = true;
    console.table(window.__xxTestRows);
  })();
})();
