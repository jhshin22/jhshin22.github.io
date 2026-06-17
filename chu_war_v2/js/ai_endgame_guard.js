window.ChuWar = window.ChuWar || {};
(function (A) {
  const previousSchedule = A.scheduleAiTurn;
  let pendingSummerTurn = false;

  function mode() {
    const select = document.getElementById("modeSelect");
    return select ? select.value : "human";
  }

  function isSummerTurn() {
    return (
      mode() === "ai-summer" &&
      A.S &&
      A.S.phase === "playing" &&
      A.S.turn === "top"
    );
  }

  function distance(aRow, aCol, bRow, bCol) {
    return Math.abs(aRow - bRow) + Math.abs(aCol - bCol);
  }

  function inBounds(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
  }

  function clearLine(fromRow, fromCol, toRow, toCol) {
    if (fromRow !== toRow && fromCol !== toCol) return false;
    const rowStep = Math.sign(toRow - fromRow);
    const colStep = Math.sign(toCol - fromCol);
    let row = fromRow + rowStep;
    let col = fromCol + colStep;
    while (row !== toRow || col !== toCol) {
      if (A.S.board[row][col]) return false;
      row += rowStep;
      col += colStep;
    }
    return true;
  }

  function enemySummary() {
    const summary = { total: 0, hidden: 0, revealed: 0 };
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = A.S.board[row][col];
        if (!piece || piece.owner !== "bottom") continue;
        summary.total++;
        if (piece.revealed) summary.revealed++;
        else summary.hidden++;
      }
    }
    return summary;
  }

  function adjacentEnemySupport(row, col) {
    let support = 0;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dr, dc] of dirs) {
      const nr = row + dr;
      const nc = col + dc;
      if (!inBounds(nr, nc)) continue;
      const piece = A.S.board[nr][nc];
      if (piece && piece.owner === "bottom") support++;
    }
    return support;
  }

  function hiddenCandidateScore(target, row, col, summary) {
    if (!target || target.owner !== "bottom" || target.revealed) return 0;

    let score = 100;
    if (row === 7) score += 120;
    else if (row === 6) score += 90;
    else if (row === 5) score += 60;
    else if (row === 4) score += 30;

    if (col >= 2 && col <= 5) score += 20;
    score += Math.min(adjacentEnemySupport(row, col), 3) * 18;

    if (summary.total <= 8) score += 55;
    if (summary.total <= 6) score += 90;
    if (summary.total <= 4) score += 140;
    if (summary.total <= 3) score += 220;
    if (summary.hidden <= 3) score += 90;
    if (summary.hidden <= 2) score += 180;

    // 살아 있는 왕은 공개되지 않으므로, 게임이 끝나지 않았는데 하단 비공개 기물이 하나뿐이면 그 기물은 사실상 왕 후보 확정이다.
    if (summary.hidden === 1) score += 10000;

    return score;
  }

  function addCandidateMove(
    candidates,
    fromRow,
    fromCol,
    toRow,
    toCol,
    piece,
    kind,
    dist,
    targetScore,
  ) {
    if (!inBounds(toRow, toCol)) return;
    const target = A.S.board[toRow][toCol];
    if (!target || target.owner !== "bottom" || target.revealed) return;
    if (piece.type === "KING") return;
    const cost =
      {
        BOMB: 120,
        INFANTRY: 160,
        SPY: 190,
        CAVALRY: 310,
        G1: 360,
        G2: 500,
        G3: 620,
        G4: 760,
        G5: 900,
      }[piece.type] || 300;
    candidates.push({
      fromRow,
      fromCol,
      move: {
        r: toRow,
        c: toCol,
        kind: kind || "normal",
        hit: true,
        dist: dist || distance(fromRow, fromCol, toRow, toCol),
      },
      piece,
      target,
      score: targetScore * 10 - cost - (kind === "special" ? 30 : 0),
    });
  }

  function collectAttacksOn(row, col, targetScore) {
    const candidates = [];
    for (let fromRow = 0; fromRow < 8; fromRow++) {
      for (let fromCol = 0; fromCol < 8; fromCol++) {
        const piece = A.S.board[fromRow][fromCol];
        if (!piece || piece.owner !== "top" || piece.type === "KING") continue;

        if (piece.type === "CAVALRY") {
          if (
            (fromRow === row || fromCol === col) &&
            clearLine(fromRow, fromCol, row, col)
          ) {
            addCandidateMove(
              candidates,
              fromRow,
              fromCol,
              row,
              col,
              piece,
              "normal",
              distance(fromRow, fromCol, row, col),
              targetScore,
            );
          }
          continue;
        }

        if (distance(fromRow, fromCol, row, col) === 1) {
          addCandidateMove(
            candidates,
            fromRow,
            fromCol,
            row,
            col,
            piece,
            "normal",
            1,
            targetScore,
          );
        }

        if (!piece.revealed && !piece.specialUsed) {
          const dr = row - fromRow;
          const dc = col - fromCol;
          const ar = Math.abs(dr);
          const ac = Math.abs(dc);

          if (
            piece.type === "G1" &&
            ((ar === 2 && ac === 1) || (ar === 1 && ac === 2))
          ) {
            addCandidateMove(
              candidates,
              fromRow,
              fromCol,
              row,
              col,
              piece,
              "special",
              ar + ac,
              targetScore,
            );
          }

          if (
            piece.type === "G2" &&
            ((ar === 2 && ac === 0) || (ar === 0 && ac === 2))
          ) {
            const midRow = fromRow + Math.sign(dr);
            const midCol = fromCol + Math.sign(dc);
            const midPiece = A.S.board[midRow][midCol];
            if (midPiece && midPiece.owner === "top") {
              addCandidateMove(
                candidates,
                fromRow,
                fromCol,
                row,
                col,
                piece,
                "special",
                2,
                targetScore,
              );
            }
          }

          if (piece.type === "G3" && ar === 1 && ac === 1) {
            addCandidateMove(
              candidates,
              fromRow,
              fromCol,
              row,
              col,
              piece,
              "special",
              2,
              targetScore,
            );
          }
        }
      }
    }
    return candidates;
  }

  function bestForcedAttack() {
    const summary = enemySummary();
    if (summary.hidden === 0) return null;

    const candidates = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const target = A.S.board[row][col];
        const score = hiddenCandidateScore(target, row, col, summary);
        if (!score) continue;

        const guaranteed = summary.hidden === 1;
        const threshold = guaranteed
          ? 0
          : summary.total <= 4
            ? 360
            : summary.total <= 8 || summary.hidden <= 5
              ? 460
              : 560;
        if (score < threshold) continue;

        candidates.push.apply(candidates, collectAttacksOn(row, col, score));
      }
    }

    candidates.sort(function (a, b) {
      return b.score - a.score;
    });
    return candidates[0] || null;
  }

  function releaseWhenTurnEnds() {
    let ticks = 0;
    const timer = setInterval(function () {
      ticks++;
      if (!isSummerTurn() || ticks > 100) {
        pendingSummerTurn = false;
        clearInterval(timer);
      }
    }, 100);
  }

  function runForcedAttack(candidate) {
    pendingSummerTurn = true;
    A.S.viewer = "bottom";
    const cover = document.getElementById("cover");
    if (cover) cover.classList.add("hidden");
    if (A.render) A.render();

    setTimeout(function () {
      if (!isSummerTurn()) {
        pendingSummerTurn = false;
        return;
      }
      const piece =
        A.S.board[candidate.fromRow] &&
        A.S.board[candidate.fromRow][candidate.fromCol];
      const target =
        A.S.board[candidate.move.r] &&
        A.S.board[candidate.move.r][candidate.move.c];
      if (
        !piece ||
        piece.owner !== "top" ||
        !target ||
        target.owner !== "bottom" ||
        target.revealed
      ) {
        pendingSummerTurn = false;
        return;
      }
      A.S.logs.unshift("여름 AI 긴급 왕 후보 공격");
      A.applyMove(
        candidate.fromRow,
        candidate.fromCol,
        candidate.move.r,
        candidate.move.c,
        candidate.move,
      );
      releaseWhenTurnEnds();
    }, 520);
  }

  A.scheduleAiTurn = function () {
    if (mode() !== "ai-summer") {
      if (previousSchedule) previousSchedule.apply(A, arguments);
      return;
    }
    if (!isSummerTurn()) return;
    if (pendingSummerTurn) return;

    const forced = bestForcedAttack();
    if (forced) {
      runForcedAttack(forced);
      return;
    }

    pendingSummerTurn = true;
    if (previousSchedule) previousSchedule.apply(A, arguments);
    releaseWhenTurnEnds();
  };

  const previousResetAi = A.resetAi;
  A.resetAi = function () {
    pendingSummerTurn = false;
    if (previousResetAi) previousResetAi.apply(A, arguments);
  };
})(ChuWar);
