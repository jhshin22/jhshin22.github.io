window.ChuWar = window.ChuWar || {};
(function (A) {
  A.isGen = function (t) {
    return t && t[0] === "G";
  };
  A.isSol = function (t) {
    return t === "INFANTRY" || t === "CAVALRY";
  };
  A.label = function (o) {
    return A.C.PLAYERS[o];
  };
  A.pname = function (p) {
    return p ? A.C.TYPES[p.type].name : "";
  };
  A.checkEnd = function () {
    var alive = { top: [], bottom: [] };
    for (var r = 0; r < 8; r++)
      for (var c = 0; c < 8; c++) {
        var p = A.S.board[r][c];
        if (p) alive[p.owner].push(p);
      }
    var kt = alive.top.some(function (p) {
        return p.type === "KING";
      }),
      kb = alive.bottom.some(function (p) {
        return p.type === "KING";
      });
    if (!kt && !kb) {
      A.S.draw = true;
      A.S.phase = "gameOver";
      return "양쪽 왕이 제거되어 무승부입니다.";
    }
    if (!kt) {
      A.S.winner = "bottom";
      A.S.phase = "gameOver";
      return "하단 플레이어 승리!";
    }
    if (!kb) {
      A.S.winner = "top";
      A.S.phase = "gameOver";
      return "상단 플레이어 승리!";
    }
    var ot = alive.top.some(function (p) {
        return p.type !== "KING";
      }),
      ob = alive.bottom.some(function (p) {
        return p.type !== "KING";
      });
    if (!ot && !ob) {
      A.S.draw = true;
      A.S.phase = "gameOver";
      return "양쪽 모두 왕만 남아 무승부입니다.";
    }
    if (!ot && ob) {
      A.S.winner = "bottom";
      A.S.phase = "gameOver";
      return "하단 플레이어 승리! 상단에는 왕만 남았습니다.";
    }
    if (!ob && ot) {
      A.S.winner = "top";
      A.S.phase = "gameOver";
      return "상단 플레이어 승리! 하단에는 왕만 남았습니다.";
    }
    return "";
  };
})(ChuWar);
