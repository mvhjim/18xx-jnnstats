/* 18xx-JNNstats live-play simulation. Paste into the console on an 18xx.games page after loading the stats window.
   Set window.__XX_SIM = { id: <finished game number>, from: <action count to start at>, to: <action count to move to> } first.
   Choose a stretch without undo moves. Result: window.__xxSimResult (after about 40 seconds). */
(function () {
  var cfg = window.__XX_SIM, S = window.__xxStats;
  if (!cfg || !S) { console.error('Set window.__XX_SIM and load the stats window first.'); return; }
  var real = window.__xxRealFetch || window.fetch.bind(window); window.__xxRealFetch = real;
  window.__xxSimN = cfg.from;
  window.fetch = async function (u, o) {
    if (String(u).indexOf('/api/game/' + cfg.id) >= 0) {
      var j = await (await real(u, o)).json();
      j.actions = j.actions.slice(0, window.__xxSimN); j.status = 'active';
      return new Response(JSON.stringify(j), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return real(u, o);
  };
  // show the game in the stats window, then move time forward; the window picks up the new moves on its own
  var gi = S.win && S.win.document.getElementById('gi'), gf = S.win && S.win.document.getElementById('gf');
  if (gi && gf) { gi.value = String(cfg.id); gf.dispatchEvent(new Event('submit', { cancelable: true })); }
  setTimeout(function () {
    window.__xxSimN = cfg.to;
    var waited = 0, t = setInterval(function () {
      waited += 2000;
      if (S.verify || waited > 40000) {
        clearInterval(t); window.fetch = real;
        window.__xxSimResult = { incrementalSteps: S.increments || 0, verify: S.verify || null, fullLoads: S.fullLoads };
        console.log('live simulation:', window.__xxSimResult);
      }
    }, 2000);
  }, 5000);
})();
