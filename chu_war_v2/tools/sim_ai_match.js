#!/usr/bin/env node
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const root = path.resolve(__dirname, "..");
const topMode = process.env.TOP_MODE || "ai-summer";
const bottomMode = process.env.BOTTOM_MODE || "ai-summer";
const games = Number(process.env.GAMES || 50);
const maxPlies = Number(process.env.MAX_PLIES || 240);
let seed = Number(process.env.SEED || 20260617);
let timers = [];
let intervals = [];

function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
}

const modeSelect = { value: topMode, addEventListener() {}, onchange: null };
const ctx = {
  console,
  Math: Object.create(Math),
  Date,
  JSON,
  window: {},
  localStorage: { getItem: () => null, setItem: () => {} },
  navigator: {},
  setTimeout: (fn) => {
    timers.push(fn);
    return timers.length;
  },
  clearTimeout: () => {},
  setInterval: (fn) => {
    intervals.push(fn);
    return intervals.length;
  },
  clearInterval: () => {},
};
ctx.Math.random = rand;
ctx.window = ctx;

function elem() {
  return {
    classList: { add() {}, remove() {}, toggle() {} },
    dataset: {},
    appendChild() {},
    querySelector() {
      return { src: "", textContent: "" };
    },
    innerHTML: "",
    textContent: "",
    onclick: null,
    style: {},
    addEventListener() {},
  };
}

ctx.document = {
  addEventListener: () => {},
  createElement: (tag) =>
    tag === "canvas"
      ? {
          getContext: () => ({
            beginPath() {},
            moveTo() {},
            lineTo() {},
            closePath() {},
            fill() {},
            stroke() {},
            fillText() {},
          }),
          toDataURL: () => "",
        }
      : elem(),
  getElementById: (id) => (id === "modeSelect" ? modeSelect : elem()),
};
vm.createContext(ctx);
[
  "constants",
  "state",
  "movement",
  "battle",
  "victory",
  "setup",
  "render",
  "main",
  "ai",
  "ai_setup",
  "ai_summer",
  "ai_special_guard",
  "ai_policy_guard",
  "ai_endgame_guard",
  "match_log",
].forEach((file) => {
  vm.runInContext(
    fs.readFileSync(path.join(root, "js", file + ".js"), "utf8"),
    ctx,
    {
      filename: file + ".js",
    },
  );
});

const A = ctx.ChuWar;
A.render = () => {};
A.alert = (title, html, next) => {
  if (next) next();
};

let selectingMirror = false;
let selectedMirrorMove = null;
const realApplyMove = A.applyMove;
A.applyMove = function (fromRow, fromCol, toRow, toCol, move) {
  if (selectingMirror) {
    selectedMirrorMove = { fromRow, fromCol, toRow, toCol, move: { ...move } };
    return;
  }
  return realApplyMove(fromRow, fromCol, toRow, toCol, move);
};

function flush(limit = 500) {
  let count = 0;
  while (timers.length && count++ < limit) timers.shift()();
  for (const fn of intervals.splice(0)) {
    try {
      fn();
    } catch (error) {}
  }
  timers = [];
}

function piece(owner, type, id) {
  return { id, owner, type, revealed: false, specialUsed: false, alive: true };
}

function randomSetup(owner) {
  const types = [];
  for (const type of A.C.ORDER) {
    for (let index = 0; index < A.C.TYPES[type].count; index++)
      types.push(type);
  }
  const rows = owner === "top" ? [0, 1, 2, 3] : [4, 5, 6, 7];
  const cells = [];
  for (const row of rows) {
    for (let col = 0; col < 8; col++) cells.push([row, col]);
  }
  cells.sort(() => rand() - 0.5);
  types
    .sort(() => rand() - 0.5)
    .forEach((type, index) => {
      const [row, col] = cells[index];
      A.S.board[row][col] = piece(
        owner,
        type,
        owner + "-" + type + "-" + index,
      );
    });
}

function resetGame() {
  if (A.resetAi) A.resetAi();
  A.S.board = A.emptyBoard();
  A.S.phase = "playing";
  A.S.turn = "bottom";
  A.S.viewer = "bottom";
  A.S.captured = { top: [], bottom: [] };
  A.S.logs = [];
  A.S.lastKingMove = { top: false, bottom: false };
  A.S.lastMove = null;
  A.S.winner = null;
  A.S.draw = false;
  randomSetup("top");
  randomSetup("bottom");
}

function countPieces(owner) {
  let count = 0;
  for (const row of A.S.board) {
    for (const p of row) if (p && (!owner || p.owner === owner)) count++;
  }
  return count;
}

function cloneAs(p, owner) {
  return p ? { ...p, owner } : null;
}

function mirrorBoard() {
  const board = A.emptyBoard();
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const p = A.S.board[row][col];
      if (!p) continue;
      board[7 - row][col] = cloneAs(p, p.owner === "bottom" ? "top" : "bottom");
    }
  }
  return board;
}

function chooseBottomMove() {
  const saved = {
    board: A.S.board,
    turn: A.S.turn,
    viewer: A.S.viewer,
    captured: A.S.captured,
    lastKingMove: A.S.lastKingMove,
    logs: A.S.logs,
    lastMove: A.S.lastMove,
    winner: A.S.winner,
    draw: A.S.draw,
    phase: A.S.phase,
    mode: modeSelect.value,
  };
  if (A.resetAi) A.resetAi();
  A.S.board = mirrorBoard();
  A.S.turn = "top";
  A.S.viewer = "bottom";
  A.S.phase = "playing";
  A.S.captured = { top: saved.captured.bottom, bottom: saved.captured.top };
  A.S.lastKingMove = {
    top: saved.lastKingMove.bottom,
    bottom: saved.lastKingMove.top,
  };
  A.S.logs = saved.logs;
  modeSelect.value = bottomMode;
  selectedMirrorMove = null;
  selectingMirror = true;
  A.scheduleAiTurn();
  flush();
  selectingMirror = false;
  Object.assign(A.S, saved);
  modeSelect.value = saved.mode;
  if (A.resetAi) A.resetAi();
  if (!selectedMirrorMove) return null;
  const m = selectedMirrorMove;
  return {
    fromRow: 7 - m.fromRow,
    fromCol: m.fromCol,
    toRow: 7 - m.toRow,
    toCol: m.toCol,
    move: { ...m.move, r: 7 - m.move.r, c: m.move.c },
  };
}

function doTurn(stats) {
  const beforeTurn = A.S.turn;
  const beforePieces = countPieces();
  if (A.S.turn === "top") {
    if (A.resetAi) A.resetAi();
    modeSelect.value = topMode;
    A.scheduleAiTurn();
    flush();
  } else {
    const choice = chooseBottomMove();
    if (choice)
      A.applyMove(
        choice.fromRow,
        choice.fromCol,
        choice.toRow,
        choice.toCol,
        choice.move,
      );
    else {
      A.S.lastKingMove.bottom = false;
      A.S.lastMove = { owner: "bottom", text: "하단 AI 패스" };
      A.S.logs.unshift("하단 AI 패스");
      A.S.turn = "top";
    }
  }
  if (A.S.lastMove && A.S.lastMove.owner === beforeTurn) {
    if (A.S.lastMove.to) stats.moves++;
    if (/공격/.test(A.S.lastMove.text || "")) stats.attacks++;
  }
  const afterPieces = countPieces();
  if (afterPieces < beforePieces) stats.captures += beforePieces - afterPieces;
}

const summary = {
  topWins: 0,
  bottomWins: 0,
  draws: 0,
  unfinished: 0,
  totalPlies: 0,
  totalRemaining: 0,
  totalAttacks: 0,
  totalCaptures: 0,
  finishedPlies: [],
};

for (let game = 0; game < games; game++) {
  resetGame();
  const stats = { moves: 0, attacks: 0, captures: 0 };
  let ply = 0;
  while (ply < maxPlies && A.S.phase === "playing") {
    doTurn(stats);
    ply++;
  }
  if (A.S.phase === "gameOver") {
    if (A.S.draw) summary.draws++;
    else if (A.S.winner === "top") summary.topWins++;
    else if (A.S.winner === "bottom") summary.bottomWins++;
    summary.finishedPlies.push(ply);
  } else summary.unfinished++;
  summary.totalPlies += ply;
  summary.totalRemaining += countPieces();
  summary.totalAttacks += stats.attacks;
  summary.totalCaptures += stats.captures;
}

console.log(
  JSON.stringify(
    {
      topMode,
      bottomMode,
      topWins: summary.topWins,
      bottomWins: summary.bottomWins,
      draws: summary.draws,
      unfinished: summary.unfinished,
      games,
      maxPlies,
      avgPlies: +(summary.totalPlies / games).toFixed(2),
      avgRemaining: +(summary.totalRemaining / games).toFixed(2),
      avgAttacks: +(summary.totalAttacks / games).toFixed(2),
      avgCaptures: +(summary.totalCaptures / games).toFixed(2),
      finishedAvgPlies: summary.finishedPlies.length
        ? +(
            summary.finishedPlies.reduce((a, b) => a + b, 0) /
            summary.finishedPlies.length
          ).toFixed(2)
        : null,
    },
    null,
    2,
  ),
);
