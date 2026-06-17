window.ChuWar = window.ChuWar || {};
(function (A) {
  var base = A.legal;
  if (!base) return;
  function mode() {
    var s = document.getElementById("modeSelect");
    return s ? s.value : "human";
  }
  function active() {
    return (
      mode() !== "human" && A.S && A.S.phase === "playing" && A.S.turn === "top"
    );
  }
  function phase() {
    var n = 0;
    for (var r = 0; r < 8; r++)
      for (var c = 0; c < 8; c++) if (A.S.board[r][c]) n++;
    return n > 24 ? "early" : n > 12 ? "mid" : "late";
  }
  function line(a, b, board) {
    if (a[0] !== b[0] && a[1] !== b[1]) return false;
    var dr = Math.sign(b[0] - a[0]),
      dc = Math.sign(b[1] - a[1]),
      r = a[0] + dr,
      c = a[1] + dc;
    while (r !== b[0] || c !== b[1]) {
      if (board[r][c]) return false;
      r += dr;
      c += dc;
    }
    return true;
  }
  function canReach(p, fr, fc, tr, tc, board) {
    if (p.type === "CAVALRY")
      return (fr === tr || fc === tc) && line([fr, fc], [tr, tc], board);
    return Math.abs(fr - tr) + Math.abs(fc - tc) === 1;
  }
  function copy(p, reveal) {
    var q = {};
    for (var k in p) q[k] = p[k];
    if (reveal) q.revealed = true;
    return q;
  }
  function threat(p, r, c, reveal) {
    if (!p) return 0;
    var probe = copy(p, reveal),
      worst = 0,
      pv = (A.C.TYPES[p.type].rank || 0) * 120 + 120;
    if (!probe.revealed) return 0;
    for (var er = 0; er < 8; er++)
      for (var ec = 0; ec < 8; ec++) {
        var e = A.S.board[er][ec];
        if (!e || e.owner !== "bottom" || !e.revealed) continue;
        if (!canReach(e, er, ec, r, c, A.S.board)) continue;
        var res = A.battleRank(e, probe),
          risk = 0;
        if (res === "A") risk = 900 + pv;
        if (res === "X") risk = 500 + pv * 0.6;
        if (res === "D" || res === "K") risk = 250 + pv * 0.25;
        if (probe.type === "KING" && risk > 0) risk += 9000;
        if (risk > worst) worst = risk;
      }
    return worst;
  }
  function enemyDist(r, c) {
    var best = 99;
    for (var i = 0; i < 8; i++)
      for (var j = 0; j < 8; j++) {
        var p = A.S.board[i][j];
        if (p && p.owner === "bottom") {
          var d = Math.abs(r - i) + Math.abs(c - j);
          if (d < best) best = d;
        }
      }
    return best;
  }
  function hiddenAdj(r, c) {
    var n = 0;
    for (var dr = -1; dr <= 1; dr++)
      for (var dc = -1; dc <= 1; dc++) {
        if (Math.abs(dr) + Math.abs(dc) !== 1) continue;
        var p = A.S.board[r + dr] && A.S.board[r + dr][c + dc];
        if (p && p.owner === "bottom" && !p.revealed) n++;
      }
    return n;
  }
  function candScore(p, r, c) {
    if (!p || p.owner !== "bottom" || p.revealed) return 0;
    var s = 100;
    if (r === 7) s += 95;
    else if (r === 6) s += 55;
    else if (r === 5) s += 25;
    if (c === 3 || c === 4) s += 18;
    var guard = 0;
    for (var dr = -1; dr <= 1; dr++)
      for (var dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        var q = A.S.board[r + dr] && A.S.board[r + dr][c + dc];
        if (q && q.owner === "bottom") guard++;
      }
    return s + Math.min(guard, 4) * 12;
  }
  function bestCandDist(r, c) {
    var best = 99,
      score = 0;
    for (var i = 0; i < 8; i++)
      for (var j = 0; j < 8; j++) {
        var p = A.S.board[i][j],
          cs = candScore(p, i, j);
        if (cs) {
          var d = Math.abs(r - i) + Math.abs(c - j) - cs / 600;
          if (d < best) {
            best = d;
            score = cs;
          }
        }
      }
    return { d: best, s: score };
  }
  function linePressure(r, c) {
    var best = 0;
    for (var i = 0; i < 8; i++)
      for (var j = 0; j < 8; j++) {
        var p = A.S.board[i][j],
          cs = candScore(p, i, j);
        if (
          cs &&
          (i === r || j === c) &&
          line([r, c], [i, j], A.S.board) &&
          cs > best
        )
          best = cs;
      }
    return best;
  }
  function isLastNonKingTarget(t) {
    if (!t || !t.revealed || t.type === "KING") return false;
    var n = 0;
    for (var r = 0; r < 8; r++)
      for (var c = 0; c < 8; c++) {
        var p = A.S.board[r][c];
        if (p && p.owner === "bottom" && p.type !== "KING") n++;
      }
    return n === 1;
  }
  function keepSpecial(fr, fc, m, p) {
    if (m.kind !== "special" || m.hit) return true;
    var before = threat(p, fr, fc, false),
      after = threat(p, m.r, m.c, true);
    if (before > 0 && after < before) return true;
    var forward = m.r - fr,
      front = m.r >= 3,
      near = enemyDist(m.r, m.c) <= 1;
    if (front && forward > 0 && near) return true;
    return false;
  }
  function keepCavalry(fr, fc, m, p) {
    if (p.type !== "CAVALRY") return true;
    var dist = m.dist || Math.abs(fr - m.r) + Math.abs(fc - m.c);
    if (dist < 2) return true;
    var ph = phase(),
      t = A.S.board[m.r][m.c],
      afterThreat = threat(p, m.r, m.c, true),
      adj = hiddenAdj(m.r, m.c),
      bc = bestCandDist(m.r, m.c),
      lp = linePressure(m.r, m.c);
    if (t && t.revealed) {
      if (t.type === "KING" || t.type === "SPY" || isLastNonKingTarget(t))
        return true;
      var res = A.battleRank(copy(p, true), t);
      if (ph === "early" && (res !== "A" || afterThreat > 0)) return false;
      return true;
    }
    if (t && !t.revealed) {
      var cs = candScore(t, m.r, m.c);
      if (ph === "early" && cs < 245) return false;
      if (ph === "early" && afterThreat > 0) return false;
      if (ph === "early" && adj >= 2) return false;
      if (ph === "mid" && cs < 200 && afterThreat > 0) return false;
      return true;
    }
    if (ph === "late") return true;
    if (afterThreat > 0) return false;
    if (ph === "early") {
      if (bc.d <= 2 && bc.s >= 230 && adj <= 1) return true;
      if (lp >= 260 && adj === 0) return true;
      return false;
    }
    if (ph === "mid") {
      if (bc.d <= 2 || lp >= 210) return true;
      if (adj >= 2) return false;
    }
    return true;
  }
  function keep(fr, fc, m, p) {
    return keepSpecial(fr, fc, m, p) && keepCavalry(fr, fc, m, p);
  }
  A.legal = function (r, c) {
    var moves = base.apply(A, arguments),
      p = A.S.board[r] && A.S.board[r][c];
    if (!active() || !p || p.owner !== "top") return moves;
    return moves.filter(function (m) {
      return keep(r, c, m, p);
    });
  };
})(ChuWar);
