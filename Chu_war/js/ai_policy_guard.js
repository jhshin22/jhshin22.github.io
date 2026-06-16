window.ChuWar = window.ChuWar || {};
(function (A) {
  const previousLegal = A.legal;
  const previousApplyMove = A.applyMove;
  const previousResetAi = A.resetAi;
  const previousScheduleAiTurn = A.scheduleAiTurn;
  if (!previousLegal) return;

  const lastTopMoveByPiece = new Map();
  let forcedHuntBusy = false;

  function currentMode() {
    const select = document.getElementById('modeSelect');
    return select ? select.value : 'human';
  }

  function isAiTopTurn() {
    return currentMode() !== 'human' && A.S && A.S.phase === 'playing' && A.S.turn === 'top';
  }

  function phase() {
    let count = 0;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if (A.S.board[row][col]) count++;
      }
    }
    if (count > 24) return 'early';
    if (count > 12) return 'mid';
    return 'late';
  }

  function distance(aRow, aCol, bRow, bCol) {
    return Math.abs(aRow - bRow) + Math.abs(aCol - bCol);
  }

  function pieceValue(type) {
    if (type === 'KING') return 10000;
    if (type === 'G5') return 900;
    if (type === 'G4') return 760;
    if (type === 'G3') return 620;
    if (type === 'G2') return 500;
    if (type === 'G1') return 380;
    if (type === 'CAVALRY') return 330;
    if (type === 'SPY') return 310;
    if (type === 'BOMB') return 260;
    if (type === 'INFANTRY') return 160;
    return 100;
  }

  function sameSquare(a, row, col) {
    return a && a[0] === row && a[1] === col;
  }

  function pieceSummary(owner) {
    const result = { total: 0, hidden: 0, revealed: 0, nonKing: 0 };
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = A.S.board[row][col];
        if (!piece || piece.owner !== owner) continue;
        result.total++;
        if (piece.type !== 'KING') result.nonKing++;
        if (piece.revealed) result.revealed++;
        else result.hidden++;
      }
    }
    return result;
  }

  function isEndgameHuntMode() {
    const enemy = pieceSummary('bottom');
    return phase() === 'late' || enemy.total <= 5 || enemy.hidden <= 4;
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
    if (isEndgameHuntMode()) {
      const enemy = pieceSummary('bottom');
      score += Math.max(0, 6 - enemy.total) * 85;
      score += Math.max(0, 5 - enemy.hidden) * 70;
      if (enemy.hidden <= 2) score += 180;
    }
    return score;
  }

  function clearLine(fromRow, fromCol, toRow, toCol, board) {
    if (fromRow !== toRow && fromCol !== toCol) return false;
    const rowStep = Math.sign(toRow - fromRow);
    const colStep = Math.sign(toCol - fromCol);
    let row = fromRow + rowStep;
    let col = fromCol + colStep;
    while (row !== toRow || col !== toCol) {
      if (board[row][col]) return false;
      row += rowStep;
      col += colStep;
    }
    return true;
  }

  function canReach(piece, fromRow, fromCol, toRow, toCol, board) {
    if (piece.type === 'CAVALRY') {
      return (fromRow === toRow || fromCol === toCol) && clearLine(fromRow, fromCol, toRow, toCol, board);
    }
    return distance(fromRow, fromCol, toRow, toCol) === 1;
  }

  function cloneBoard() {
    return A.S.board.map(function (row) {
      return row.slice();
    });
  }

  function simulateMove(fromRow, fromCol, move) {
    const board = cloneBoard();
    const attacker = board[fromRow][fromCol];
    const defender = board[move.r][move.c];
    if (!attacker) return board;
    if (!defender) {
      board[fromRow][fromCol] = null;
      board[move.r][move.c] = attacker;
      return board;
    }
    if (defender.owner === attacker.owner) return board;
    if (!defender.revealed) {
      if (attacker.type === 'BOMB') {
        board[fromRow][fromCol] = null;
        board[move.r][move.c] = null;
      } else {
        board[fromRow][fromCol] = null;
      }
      return board;
    }
    const result = A.battleRank(attacker, defender);
    if (result === 'A') {
      if (attacker.type === 'G4' && !attacker.revealed && !attacker.specialUsed) {
        board[move.r][move.c] = null;
      } else {
        board[fromRow][fromCol] = null;
        board[move.r][move.c] = attacker;
      }
    } else if (result === 'B') {
      board[fromRow][fromCol] = null;
    } else {
      board[fromRow][fromCol] = null;
      board[move.r][move.c] = null;
    }
    return board;
  }

  function topKingPosition(board) {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = board[row][col];
        if (piece && piece.owner === 'top' && piece.type === 'KING') return [row, col];
      }
    }
    return null;
  }

  function kingDanger(board) {
    const king = topKingPosition(board);
    if (!king) return 99999;
    let danger = 0;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const enemy = board[row][col];
        if (!enemy || enemy.owner !== 'bottom') continue;
        const dist = distance(row, col, king[0], king[1]);
        if (enemy.revealed) {
          if (canReach(enemy, row, col, king[0], king[1], board)) {
            danger += enemy.type === 'CAVALRY' ? 1400 : 900;
          }
          if (dist === 2 && A.isGen(enemy.type)) danger += 260;
        } else {
          if (dist === 1) danger += 500;
        }
      }
    }
    return danger;
  }

  function moveHelpsKing(fromRow, fromCol, move) {
    const before = kingDanger(A.S.board);
    const after = kingDanger(simulateMove(fromRow, fromCol, move));
    return after + 120 < before;
  }

  function bestHiddenCandidateNear(row, col) {
    let bestScore = 0;
    let bestDistance = 99;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const target = A.S.board[r][c];
        const score = hiddenKingCandidateScore(target, r, c);
        if (!score) continue;
        const dist = distance(row, col, r, c);
        if (dist < bestDistance || (dist === bestDistance && score > bestScore)) {
          bestDistance = dist;
          bestScore = score;
        }
      }
    }
    return { score: bestScore, distance: bestDistance };
  }

  function linePressure(row, col) {
    let best = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const target = A.S.board[r][c];
        const score = hiddenKingCandidateScore(target, r, c);
        if (!score) continue;
        if ((r === row || c === col) && clearLine(row, col, r, c, A.S.board)) {
          best = Math.max(best, score);
        }
      }
    }
    return best;
  }

  function isImmediateBacktrack(fromRow, fromCol, move, piece) {
    if (move.hit) return false;
    const previous = lastTopMoveByPiece.get(piece.id);
    if (!previous || previous.hit) return false;
    return sameSquare(previous.to, fromRow, fromCol) && sameSquare(previous.from, move.r, move.c);
  }

  function directAttackScore(piece, target, row, col, move) {
    if (!piece || !target || target.owner !== 'bottom') return -99999;
    if (target.revealed) {
      const result = A.battleRank(piece, target);
      if (target.type === 'KING' && (result === 'A' || result === 'X')) return 90000;
      if (result === 'A') return 700 + pieceValue(target.type) - pieceValue(piece.type) * 0.15;
      if (result === 'X') return 420 + pieceValue(target.type) * 0.55 - pieceValue(piece.type) * 0.55;
      if (result === 'D' || result === 'K') return 220 + pieceValue(target.type) * 0.35 - pieceValue(piece.type) * 0.35;
      return -90000;
    }
    let score = hiddenKingCandidateScore(target, row, col);
    if (isEndgameHuntMode()) score += 320;
    if (move && move.kind === 'special') score -= 120;
    return score;
  }

  function bestDirectCavalryAttack(fromRow, fromCol, piece) {
    if (!piece || piece.type !== 'CAVALRY') return { score: -99999, move: null };
    let best = { score: -99999, move: null };
    const rawMoves = previousLegal.apply(A, [fromRow, fromCol]);
    for (const move of rawMoves) {
      if (!move.hit) continue;
      const target = A.S.board[move.r] && A.S.board[move.r][move.c];
      const score = directAttackScore(piece, target, move.r, move.c, move);
      if (score > best.score) best = { score, move };
    }
    return best;
  }

  function shouldSuppressCavalrySetupMove(fromRow, fromCol, move, piece) {
    if (!piece || piece.type !== 'CAVALRY' || move.hit) return false;
    const best = bestDirectCavalryAttack(fromRow, fromCol, piece);
    if (!best.move || best.score < 520) return false;
    return !moveHelpsKing(fromRow, fromCol, move);
  }

  function shouldKeepCavalryMove(fromRow, fromCol, move, piece, target, nowPhase) {
    const moveDistance = move.dist || distance(fromRow, fromCol, move.r, move.c);
    if (moveDistance < 2) return true;

    if (target && target.owner === 'bottom') {
      if (target.revealed) return true;
      const candidateScore = hiddenKingCandidateScore(target, move.r, move.c);
      if (isEndgameHuntMode()) return candidateScore >= 120;
      if (candidateScore < 210) return false;
      if (nowPhase === 'early' && candidateScore < 285 && hiddenNeighborCount(move.r, move.c) >= 1) return false;
      return true;
    }

    if (piece.revealed && !target) {
      if (hiddenNeighborCount(move.r, move.c) >= 1 && !moveHelpsKing(fromRow, fromCol, move)) return false;
      return true;
    }

    if (!target) {
      const nearest = bestHiddenCandidateNear(move.r, move.c);
      const beforeNearest = bestHiddenCandidateNear(fromRow, fromCol);
      const usefulCandidatePressure = nearest.distance <= 2 && nearest.score >= 230;
      const improvesCandidateDistance = nearest.score >= 220 && nearest.distance + 1 < beforeNearest.distance;
      const usefulLinePressure = linePressure(move.r, move.c) >= 250;
      if (!usefulCandidatePressure && !improvesCandidateDistance && !usefulLinePressure && !moveHelpsKing(fromRow, fromCol, move)) return false;
      if (hiddenNeighborCount(move.r, move.c) >= 1) return false;
      if (nowPhase === 'late' && !usefulLinePressure && nearest.distance > 3 && !moveHelpsKing(fromRow, fromCol, move)) return false;
    }

    return true;
  }

  function shouldKeepHiddenAttack(fromRow, fromCol, move, piece, target, nowPhase) {
    if (!target || target.owner !== 'bottom' || target.revealed) return true;
    if (piece.type === 'CAVALRY' && (move.dist || distance(fromRow, fromCol, move.r, move.c)) >= 2) return true;
    if (!A.isGen(piece.type)) return true;
    if (moveHelpsKing(fromRow, fromCol, move)) return true;
    if (isEndgameHuntMode()) return true;
    const candidateScore = hiddenKingCandidateScore(target, move.r, move.c);
    if (piece.type === 'G5' && candidateScore < 330) return false;
    if (nowPhase !== 'late' && candidateScore < 260) return false;
    if (nowPhase === 'late' && candidateScore < 220) return false;
    return true;
  }

  function shouldKeepMove(fromRow, fromCol, move, piece) {
    const target = A.S.board[move.r] && A.S.board[move.c] ? null : null;
    const realTarget = A.S.board[move.r] && A.S.board[move.r][move.c];
    const nowPhase = phase();
    const currentKingDanger = kingDanger(A.S.board);
    const afterBoard = simulateMove(fromRow, fromCol, move);
    const afterKingDanger = kingDanger(afterBoard);

    if (afterKingDanger >= 900 && afterKingDanger > currentKingDanger + 250) {
      return false;
    }

    if (currentKingDanger >= 900 && afterKingDanger >= currentKingDanger) {
      return false;
    }

    if (piece.type === 'BOMB' && !move.hit) return false;

    if (isImmediateBacktrack(fromRow, fromCol, move, piece) && !moveHelpsKing(fromRow, fromCol, move)) {
      return false;
    }

    if (shouldSuppressCavalrySetupMove(fromRow, fromCol, move, piece)) {
      return false;
    }

    if (move.kind === 'special' && !move.hit) {
      if (!moveHelpsKing(fromRow, fromCol, move)) return false;
    }

    if (piece.type === 'CAVALRY') {
      if (!shouldKeepCavalryMove(fromRow, fromCol, move, piece, realTarget, nowPhase)) return false;
    }

    if (!shouldKeepHiddenAttack(fromRow, fromCol, move, piece, realTarget, nowPhase)) return false;

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

  function forcePieceScore(piece) {
    if (!piece || piece.type === 'KING') return -99999;
    if (piece.type === 'G5') return 760;
    if (piece.type === 'G4') return 740;
    if (piece.type === 'G3') return 610;
    if (piece.type === 'G2') return 520;
    if (piece.type === 'SPY') return piece.revealed ? 280 : 560;
    if (piece.type === 'INFANTRY') return 430;
    if (piece.type === 'BOMB') return 330;
    if (piece.type === 'CAVALRY') return 300;
    return 250;
  }

  function chooseForcedCavalryStrike() {
    if (currentMode() !== 'ai-summer' || !isAiTopTurn()) return null;
    let best = null;
    let bestScore = -99999;
    const currentDanger = kingDanger(A.S.board);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = A.S.board[row][col];
        if (!piece || piece.owner !== 'top' || piece.type !== 'CAVALRY') continue;
        const moves = A.legal(row, col);
        for (const move of moves) {
          if (!move.hit) continue;
          const target = A.S.board[move.r] && A.S.board[move.r][move.c];
          if (!target || target.owner !== 'bottom') continue;
          const afterDanger = kingDanger(simulateMove(row, col, move));
          if (currentDanger >= 900 && afterDanger >= currentDanger) continue;
          if (afterDanger >= 900 && afterDanger > currentDanger + 250) continue;
          let score = directAttackScore(piece, target, move.r, move.c, move);
          if (target.revealed) score += 180;
          if (piece.revealed) score += 120;
          if (isEndgameHuntMode()) score += 140;
          if (score > bestScore) {
            bestScore = score;
            best = { fromRow: row, fromCol: col, move, piece, score };
          }
        }
      }
    }
    return bestScore >= 640 ? best : null;
  }

  function chooseForcedHunt() {
    if (currentMode() !== 'ai-summer' || !isAiTopTurn() || !isEndgameHuntMode()) return null;
    const enemy = pieceSummary('bottom');
    if (enemy.total > 5 && enemy.hidden > 3) return null;
    const currentDanger = kingDanger(A.S.board);
    let best = null;
    let bestScore = -99999;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = A.S.board[row][col];
        if (!piece || piece.owner !== 'top' || piece.type === 'KING') continue;
        const moves = A.legal(row, col);
        for (const move of moves) {
          const target = A.S.board[move.r] && A.S.board[move.r][move.c];
          if (!target || target.owner !== 'bottom' || target.revealed) continue;
          const afterDanger = kingDanger(simulateMove(row, col, move));
          if (currentDanger >= 900 && afterDanger >= currentDanger) continue;
          if (afterDanger >= 900 && afterDanger > currentDanger + 250) continue;
          let score = forcePieceScore(piece) + hiddenKingCandidateScore(target, move.r, move.c);
          score += Math.max(0, 6 - enemy.total) * 125;
          score += Math.max(0, 5 - enemy.hidden) * 95;
          if (enemy.hidden <= 2) score += 260;
          if (piece.revealed && A.isGen(piece.type)) score += 140;
          if (piece.type === 'CAVALRY') score += 210;
          if (piece.type === 'BOMB') score -= 180;
          if (move.kind === 'special') score -= 120;
          if (score > bestScore) {
            bestScore = score;
            best = { fromRow: row, fromCol: col, move: move, piece: piece };
          }
        }
      }
    }
    return bestScore >= 720 ? best : null;
  }

  function runForcedHunt() {
    if (forcedHuntBusy) return true;
    const cavalryStrike = chooseForcedCavalryStrike();
    const hunt = cavalryStrike || chooseForcedHunt();
    if (!hunt) return false;
    forcedHuntBusy = true;
    A.S.viewer = 'bottom';
    const cover = document.getElementById('cover');
    if (cover) cover.classList.add('hidden');
    if (A.render) A.render();
    setTimeout(function () {
      forcedHuntBusy = false;
      if (!isAiTopTurn() || A.S.phase !== 'playing') return;
      const piece = A.S.board[hunt.fromRow] && A.S.board[hunt.fromRow][hunt.fromCol];
      const target = A.S.board[hunt.move.r] && A.S.board[hunt.move.r][hunt.move.c];
      if (piece && piece.id === hunt.piece.id && target && target.owner === 'bottom') {
        A.S.logs.unshift(cavalryStrike ? '여름 AI 기병 직격: 장거리 공격 우선' : '여름 AI 긴급 추격: 후반 왕 후보 직접 공격');
        A.applyMove(hunt.fromRow, hunt.fromCol, hunt.move.r, hunt.move.c, hunt.move);
        return;
      }
      if (previousScheduleAiTurn) previousScheduleAiTurn.apply(A, arguments);
    }, 420);
    return true;
  }

  if (previousScheduleAiTurn) {
    A.scheduleAiTurn = function () {
      if (currentMode() === 'ai-summer' && isAiTopTurn() && runForcedHunt()) return;
      return previousScheduleAiTurn.apply(A, arguments);
    };
  }

  if (previousApplyMove) {
    A.applyMove = function (fromRow, fromCol, toRow, toCol, move) {
      const pieceBeforeMove = A.S.board[fromRow] && A.S.board[fromRow][fromCol];
      const wasTopPiece = pieceBeforeMove && pieceBeforeMove.owner === 'top';
      const id = pieceBeforeMove && pieceBeforeMove.id;
      const result = previousApplyMove.apply(A, arguments);
      if (wasTopPiece && id) {
        lastTopMoveByPiece.set(id, {
          from: [fromRow, fromCol],
          to: [toRow, toCol],
          hit: !!(move && move.hit)
        });
      }
      return result;
    };
  }

  A.resetAi = function () {
    forcedHuntBusy = false;
    lastTopMoveByPiece.clear();
    if (previousResetAi) previousResetAi.apply(A, arguments);
  };
})(ChuWar);
