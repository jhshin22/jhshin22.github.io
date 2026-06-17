window.ChuWar = window.ChuWar || {};
(function (A) {
  const STORAGE_KEY = "chuWar.matchLogs.v1";
  const MAX_LOGS = 30;
  let currentMatch = null;
  let lastMoveKey = "";

  function now() {
    return new Date().toISOString();
  }

  function mode() {
    const select = document.getElementById("modeSelect");
    return select ? select.value : "human";
  }

  function snapshotPiece(piece, onBoard) {
    if (!piece) return null;
    return {
      id: piece.id,
      owner: piece.owner,
      type: piece.type,
      revealed: !!piece.revealed,
      specialUsed: !!piece.specialUsed,
      onBoard: !!onBoard,
      alive: onBoard ? true : piece.alive !== false,
    };
  }

  function snapshotCell(row, col) {
    const piece = A.S.board[row] && A.S.board[row][col];
    return snapshotPiece(piece, true);
  }

  function snapshotBoard() {
    const result = [];
    for (let row = 0; row < 8; row++) {
      const line = [];
      for (let col = 0; col < 8; col++) {
        line.push(snapshotCell(row, col));
      }
      result.push(line);
    }
    return result;
  }

  function pieceCounts(owner) {
    const result = {};
    A.C.ORDER.forEach(function (type) {
      result[type] = 0;
    });
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = A.S.board[row][col];
        if (piece && piece.owner === owner) result[piece.type]++;
      }
    }
    return result;
  }

  function readLogs() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch (error) {
      return [];
    }
  }

  function writeLogs(logs) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(logs.slice(0, MAX_LOGS)),
      );
    } catch (error) {}
  }

  function beginMatch() {
    if (currentMatch && currentMatch.phase !== "saved") return;
    currentMatch = {
      id: "match-" + Date.now(),
      startedAt: now(),
      endedAt: null,
      mode: mode(),
      moves: [],
      initialBoard: snapshotBoard(),
      finalBoard: null,
      result: null,
      finalCounts: null,
      logs: [],
      phase: "playing",
    };
    lastMoveKey = "";
  }

  function moveKey(move) {
    if (!move) return "";
    return JSON.stringify([move.owner, move.from, move.to, move.text]);
  }

  function recordLastMove(extra) {
    beginMatch();
    const move = A.S.lastMove;
    if (!move) return;
    const key = moveKey(move);
    if (key && key === lastMoveKey) return;
    lastMoveKey = key;
    currentMatch.moves.push({
      turn: currentMatch.moves.length + 1,
      at: now(),
      owner: move.owner || null,
      from: move.from || null,
      to: move.to || null,
      text: move.text || "",
      extra: extra || null,
      boardAfter: snapshotBoard(),
      counts: {
        top: pieceCounts("top"),
        bottom: pieceCounts("bottom"),
      },
    });
  }

  function finishMatch() {
    if (
      !currentMatch ||
      currentMatch.phase === "saved" ||
      A.S.phase !== "gameOver"
    )
      return;
    currentMatch.phase = "saved";
    currentMatch.endedAt = now();
    currentMatch.result = {
      winner: A.S.winner || null,
      draw: !!A.S.draw,
      mode: mode(),
      lastMove: A.S.lastMove || null,
    };
    currentMatch.finalBoard = snapshotBoard();
    currentMatch.finalCounts = {
      top: pieceCounts("top"),
      bottom: pieceCounts("bottom"),
    };
    currentMatch.logs = (A.S.logs || []).slice(0, 80);
    const logs = readLogs();
    logs.unshift(currentMatch);
    writeLogs(logs);
    updateStatus();
    currentMatch = null;
    lastMoveKey = "";
  }

  function updateStatus() {
    const status = document.getElementById("matchLogStatus");
    if (!status) return;
    const logs = readLogs();
    let text = "저장된 경기 로그: " + logs.length + "개";
    const latest = logs[0];
    if (latest && latest.result) {
      if (latest.result.winner)
        text += " · 최근: " + A.label(latest.result.winner) + " 승리";
      else if (latest.result.draw) text += " · 최근: 무승부";
      else text += " · 최근: 결과 기록";
    }
    status.textContent = text;
  }

  function latestLog() {
    return readLogs()[0] || null;
  }

  function copyLatestLog() {
    const latest = latestLog();
    if (!latest) {
      if (A.alert) A.alert("경기 로그", "저장된 경기 로그가 없습니다.");
      return;
    }
    const text = JSON.stringify(latest, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        if (A.alert)
          A.alert("경기 로그", "최근 경기 로그를 클립보드에 복사했습니다.");
      });
    } else {
      window.prompt("아래 로그를 복사하세요.", text);
    }
  }

  function downloadLatestLog() {
    const latest = latestLog();
    if (!latest) {
      if (A.alert) A.alert("경기 로그", "저장된 경기 로그가 없습니다.");
      return;
    }
    const blob = new Blob([JSON.stringify(latest, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = latest.id + ".json";
    document.body.appendChild(link);
    link.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      link.remove();
    }, 0);
  }

  function clearLogs() {
    writeLogs([]);
    updateStatus();
    if (A.alert)
      A.alert("경기 로그", "브라우저에 저장된 경기 로그를 초기화했습니다.");
  }

  function bindButtons() {
    const copyButton = document.getElementById("copyMatchLogBtn");
    const downloadButton = document.getElementById("downloadMatchLogBtn");
    const clearButton = document.getElementById("clearMatchLogBtn");
    const passButton = document.getElementById("passBtn");

    if (copyButton) copyButton.onclick = copyLatestLog;
    if (downloadButton) downloadButton.onclick = downloadLatestLog;
    if (clearButton) clearButton.onclick = clearLogs;

    if (
      passButton &&
      passButton.onclick &&
      !passButton.dataset.matchLogWrapped
    ) {
      const originalPass = passButton.onclick;
      passButton.dataset.matchLogWrapped = "1";
      passButton.onclick = function () {
        const result = originalPass.apply(this, arguments);
        if (A.S.lastMove && /패스/.test(A.S.lastMove.text || "")) {
          recordLastMove({ pass: true, source: "button" });
        }
        finishMatch();
        updateStatus();
        return result;
      };
    }

    updateStatus();
  }

  const originalApplyMove = A.applyMove;
  if (originalApplyMove) {
    A.applyMove = function (fromRow, fromCol, toRow, toCol, move) {
      beginMatch();
      const before = {
        piece: snapshotCell(fromRow, fromCol),
        target: snapshotCell(toRow, toCol),
        from: [fromRow, fromCol],
        to: [toRow, toCol],
        kind: (move && move.kind) || "normal",
        dist:
          (move && move.dist) ||
          Math.abs(fromRow - toRow) + Math.abs(fromCol - toCol),
      };
      const result = originalApplyMove.apply(A, arguments);
      recordLastMove(before);
      finishMatch();
      updateStatus();
      return result;
    };
  }

  const originalEndTurn = A.endTurn;
  if (originalEndTurn) {
    A.endTurn = function () {
      const result = originalEndTurn.apply(A, arguments);
      if (A.S.lastMove && /패스/.test(A.S.lastMove.text || "")) {
        recordLastMove({ pass: true, source: "endTurn" });
      }
      finishMatch();
      updateStatus();
      return result;
    };
  }

  const originalAlert = A.alert;
  if (originalAlert) {
    A.alert = function (title, body, callback) {
      const wrappedCallback = callback
        ? function () {
            const result = callback.apply(this, arguments);
            recordLastMove({ source: "alertCallback" });
            finishMatch();
            updateStatus();
            return result;
          }
        : callback;
      return originalAlert.call(A, title, body, wrappedCallback);
    };
  }

  const originalReset = A.reset;
  if (originalReset) {
    A.reset = function () {
      currentMatch = null;
      lastMoveKey = "";
      const result = originalReset.apply(A, arguments);
      updateStatus();
      return result;
    };
  }

  A.matchLogs = {
    latest: latestLog,
    all: readLogs,
    clear: clearLogs,
  };

  document.addEventListener("DOMContentLoaded", bindButtons);
})(ChuWar);
