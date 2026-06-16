window.ChuWar = window.ChuWar || {};
(function (A) {
  const previousLegal = A.legal;
  if (!previousLegal) return;

  function currentMode() {
    const select = document.getElementById('modeSelect');
    return select ? select.value : 'human';
  }

  function isAiTopTurn() {
    return currentMode() !== 'human' && A.S && A.S.phase === 'playing' && A.S.turn === 'top';
  }

  function phase() {
    let count = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (A.S.board[r][c]) count++;
      }
    }
    if (count > 24) return 'early';
    if (count > 12) return 'mid';
    return 'late';
  }

  function hiddenNeighborCount(row, col) {
    let count = 0;
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dr, dc] of dirs) {
      const target = A.S.board[row + dr] && A.S.board[row + dr][col + dc];
      if (target && target.owner === 'bottom' && !target.revealed) count++;
    }
    return count;
  }

  function hiddenKingCandidateScore(target, row, col) {
    if (!target || target.owner !== 'bottom' || target.revealed) return 0;
    let score = 100;
    if (row === 7) score += 95;
    else if (row === 6) score += 55;
    else if (row === 5) score += 25;
    if (col === 3 || col === 4) score += 18;
    return score;
  }

  function shouldKeepMove(fromRow, fromCol, move, piece) {
    const target = A.S.board[move.r] && A.S.board[move.r][move.c];
    const nowPhase = phase();

    if (piece.type === 'BOMB' && !move.hit) {
      return false;
    }

    if (piece.type === 'CAVALRY' && target && target.owner === 'bottom' && !target.revealed && nowPhase !== 'late') {
      if (hiddenKingCandidateScore(target, move.r, move.c) < 285) return false;
      if (nowPhase === 'early' && hiddenNeighborCount(move.r, move.c) >= 1) return false;
    }

    if (move.kind === 'special' && !move.hit) {
      const targetPressure = hiddenKingCandidateScore(target, move.r, move.c);
      if (targetPressure < 285 && hiddenNeighborCount(move.r, move.c) === 0) return false;
    }

    return true;
  }

  A.legal = function (row, col) {
    const moves = previousLegal.apply(A, arguments);
    const piece = A.S.board[row] && A.S.board[row][col];
    if (!isAiTopTurn() || !piece || piece.owner !== 'top') return moves;
    return moves.filter(function (move) {
      return shouldKeepMove(row, col, move, piece);
    });
  };
})(ChuWar);
