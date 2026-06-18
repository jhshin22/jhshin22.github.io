#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const ENGINE_SCRIPTS = [
  'js/constants.js',
  'js/state.js',
  'js/movement.js',
  'js/battle.js',
  'js/victory.js',
  'js/setup.js',
];

function parseArgs(argv) {
  const options = {
    seed: String(Date.now()),
    maxTurns: 300,
    games: 1,
    topAi: 'random',
    bottomAi: 'random',
    pretty: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--seed') options.seed = String(argv[++i] || options.seed);
    else if (arg === '--max-turns') options.maxTurns = Number(argv[++i] || options.maxTurns);
    else if (arg === '--games') options.games = Number(argv[++i] || options.games);
    else if (arg === '--top-ai') options.topAi = String(argv[++i] || options.topAi);
    else if (arg === '--bottom-ai') options.bottomAi = String(argv[++i] || options.bottomAi);
    else if (arg === '--pretty') options.pretty = true;
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.maxTurns) || options.maxTurns <= 0) {
    throw new Error('--max-turns must be a positive integer');
  }
  if (!Number.isInteger(options.games) || options.games <= 0) {
    throw new Error('--games must be a positive integer');
  }
  for (const ai of [options.topAi, options.bottomAi]) {
    if (!['random', 'summer'].includes(ai)) throw new Error(`Unsupported AI: ${ai}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node Chu_war/tools/headless_match.js [options]

Options:
  --seed <value>       Seed for deterministic setup and move choices
  --max-turns <n>      Stop after n turns if no winner is found
  --games <n>          Run n matches and print aggregate summary
  --top-ai <name>      top AI: random or summer
  --bottom-ai <name>   bottom AI: random or summer
  --pretty            Pretty-print JSON output
  --help              Show this help
`);
}

function createRng(seedText) {
  let hash = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    hash ^= seedText.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  return function random() {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasStub() {
  const context = {
    fillStyle: '',
    lineWidth: 0,
    strokeStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    fillText() {},
  };
  return {
    width: 0,
    height: 0,
    getContext() {
      return context;
    },
    toDataURL(type) {
      return `data:${type || 'image/png'};base64,`;
    },
  };
}

function createContext(random) {
  const seededMath = Object.create(Math);
  seededMath.random = random;

  const context = {
    console,
    ChuWar: {},
    Math: seededMath,
    document: {
      createElement(tag) {
        if (tag === 'canvas') return canvasStub();
        return {};
      },
    },
  };
  context.window = context;
  return vm.createContext(context);
}

function loadEngine(random) {
  const context = createContext(random);
  for (const script of ENGINE_SCRIPTS) {
    const filename = path.join(ROOT, script);
    const code = fs.readFileSync(filename, 'utf8');
    vm.runInContext(code, context, { filename });
  }
  return context.ChuWar;
}

function pieceName(A, piece) {
  return piece ? A.C.TYPES[piece.type].name : null;
}

function compactPiece(piece) {
  if (!piece) return null;
  return {
    id: piece.id,
    owner: piece.owner,
    type: piece.type,
    revealed: !!piece.revealed,
    specialUsed: !!piece.specialUsed,
  };
}

function boardSnapshot(A) {
  return A.S.board.map((row) => row.map(compactPiece));
}

function counts(A, owner) {
  const result = {};
  for (const type of A.C.ORDER) result[type] = 0;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = A.S.board[row][col];
      if (piece && piece.owner === owner) result[piece.type]++;
    }
  }
  return result;
}

function removePiece(A, piece) {
  piece.alive = false;
  A.S.captured[piece.owner].push(piece);
}

function shuffle(items, random) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const BASE_SETUP_PLANS = [
  { name: 'king-fortress', core: [['KING',0,3],['BOMB',0,2],['BOMB',1,3],['G4',1,4],['G5',0,5],['INFANTRY',2,3]] },
  { name: 'infantry-scout-line', core: [['INFANTRY',3,2],['INFANTRY',3,3],['INFANTRY',3,4],['INFANTRY',3,5],['CAVALRY',2,1],['CAVALRY',2,6],['KING',0,3],['G4',1,3]] },
  { name: 'front-block', core: [['BOMB',3,3],['BOMB',3,4],['G4',2,3],['INFANTRY',2,4],['KING',0,2],['G5',1,4]] },
];

const SUMMER_EXTRA_SETUP_PLANS = [
  { name: 'spy-waiting', core: [['SPY',1,3],['SPY',2,4],['G5',3,4],['INFANTRY',3,3],['KING',0,2],['BOMB',1,2],['G4',1,5]] },
  { name: 'king-decoy-spread', core: [['KING',0,1],['BOMB',0,3],['SPY',0,5],['G4',1,1],['G5',1,5],['CAVALRY',2,3],['INFANTRY',3,4]] },
];

const SUMMER_SETUP_PLANS = BASE_SETUP_PLANS.concat(SUMMER_EXTRA_SETUP_PLANS);

function mappedSetupRow(owner, row) {
  return owner === 'top' ? row : 7 - row;
}

function mappedSetupCol(col, flip) {
  return flip ? 7 - col : col;
}

function placeSetupPiece(A, owner, type, row, col) {
  if (A.S.board[row][col]) return false;
  const piece = A.S.pool[owner].find((candidate) => candidate.type === type && candidate.alive);
  if (!piece) return false;
  piece.alive = false;
  A.S.board[row][col] = piece;
  return true;
}

function emptySetupCells(A, owner) {
  const cells = [];
  for (const row of A.zone(owner)) {
    for (let col = 0; col < 8; col++) {
      if (!A.S.board[row][col]) cells.push([row, col]);
    }
  }
  return cells;
}

function strategySetup(A, owner, plans, random) {
  A.clearSetup(owner);
  A.S.pool[owner] = A.makePieces(owner);
  const plan = plans[Math.floor(random() * plans.length)];
  const flip = random() < 0.5;
  for (const [type, planRow, planCol] of plan.core) {
    placeSetupPiece(A, owner, type, mappedSetupRow(owner, planRow), mappedSetupCol(planCol, flip));
  }
  const cells = shuffle(emptySetupCells(A, owner), random);
  const remaining = shuffle(A.S.pool[owner].filter((piece) => piece.alive), random);
  remaining.forEach((piece, index) => {
    piece.alive = false;
    A.S.board[cells[index][0]][cells[index][1]] = piece;
  });
  return plan.name;
}

function setupForAi(A, owner, aiName, random) {
  if (aiName === 'summer') return strategySetup(A, owner, SUMMER_SETUP_PLANS, random);
  A.randomSetup(owner);
  return 'A.randomSetup';
}

function publicLabel(A, piece) {
  if (!piece) return '';
  return `${A.label(piece.owner)} ${piece.revealed ? pieceName(A, piece) : 'hidden'}`;
}

function applyMove(A, fromRow, fromCol, move) {
  const board = A.S.board;
  const attacker = board[fromRow][fromCol];
  const defender = board[move.r][move.c];
  if (!attacker || attacker.owner !== A.S.turn) {
    throw new Error(`No ${A.S.turn} piece at ${fromRow},${fromCol}`);
  }

  const before = {
    attacker: compactPiece(attacker),
    defender: compactPiece(defender),
  };
  const record = {
    owner: attacker.owner,
    from: [fromRow, fromCol],
    to: [move.r, move.c],
    kind: move.kind || 'normal',
    hit: !!defender,
    distance: move.dist || Math.abs(fromRow - move.r) + Math.abs(fromCol - move.c),
    before,
    result: null,
  };

  if (move.kind === 'special') {
    attacker.specialUsed = true;
    attacker.revealed = true;
  }
  if (attacker.type === 'BOMB') attacker.revealed = true;
  if (attacker.type === 'CAVALRY' && record.distance >= 2) attacker.revealed = true;

  if (!defender) {
    board[move.r][move.c] = attacker;
    board[fromRow][fromCol] = null;
    A.S.lastKingMove[attacker.owner] = attacker.type === 'KING';
    A.S.lastMove = {
      owner: attacker.owner,
      from: [fromRow, fromCol],
      to: [move.r, move.c],
      text: `${publicLabel(A, attacker)} move`,
    };
    record.result = 'move';
    return record;
  }

  const canReturn = attacker.type === 'G4' && !attacker.revealed && !attacker.specialUsed;
  const battleResult = A.battleRank(attacker, defender);
  attacker.revealed = true;
  defender.revealed = true;

  if (battleResult === 'A') {
    removePiece(A, defender);
    if (canReturn) {
      attacker.specialUsed = true;
      board[move.r][move.c] = null;
      record.result = 'attacker-returned';
    } else {
      board[move.r][move.c] = attacker;
      board[fromRow][fromCol] = null;
      record.result = 'attacker-won';
    }
  } else if (battleResult === 'B') {
    removePiece(A, attacker);
    board[fromRow][fromCol] = null;
    record.result = 'defender-won';
  } else {
    removePiece(A, attacker);
    removePiece(A, defender);
    board[fromRow][fromCol] = null;
    board[move.r][move.c] = null;
    record.result = 'both-removed';
  }

  A.S.lastKingMove[attacker.owner] = attacker.type === 'KING';
  A.S.lastMove = {
    owner: attacker.owner,
    from: [fromRow, fromCol],
    to: [move.r, move.c],
    text: `${publicLabel(A, attacker)} attack ${publicLabel(A, defender)}`,
  };
  record.battleRank = battleResult;
  record.after = {
    attacker: compactPiece(attacker),
    defender: compactPiece(defender),
  };
  return record;
}

function allMoves(A, owner) {
  const moves = [];
  A.S.turn = owner;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = A.S.board[row][col];
      if (!piece || piece.owner !== owner) continue;
      for (const move of A.legal(row, col)) {
        moves.push({ fromRow: row, fromCol: col, move, piece: compactPiece(piece) });
      }
    }
  }
  return moves;
}

function chooseRandomMove(moves, random) {
  if (!moves.length) return null;
  return moves[Math.floor(random() * moves.length)];
}

function enemyOf(owner) {
  return owner === 'top' ? 'bottom' : 'top';
}

function distance(aRow, aCol, bRow, bCol) {
  return Math.abs(aRow - bRow) + Math.abs(aCol - bCol);
}

function pieceValue(type) {
  return {
    KING: 10000,
    G5: 900,
    G4: 760,
    G3: 620,
    G2: 500,
    G1: 380,
    CAVALRY: 330,
    SPY: 310,
    BOMB: 260,
    INFANTRY: 160,
  }[type] || 100;
}

function clearLine(board, fromRow, fromCol, toRow, toCol) {
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

function canReach(board, piece, fromRow, fromCol, toRow, toCol) {
  if (!piece) return false;
  if (piece.type === 'CAVALRY') {
    return (fromRow === toRow || fromCol === toCol) && clearLine(board, fromRow, fromCol, toRow, toCol);
  }
  return distance(fromRow, fromCol, toRow, toCol) === 1;
}

function cloneBoard(A) {
  return A.S.board.map((row) => row.map((piece) => (piece ? { ...piece } : null)));
}

function simulateBoard(A, fromRow, fromCol, move) {
  const board = cloneBoard(A);
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
    board[fromRow][fromCol] = null;
    if (attacker.type === 'BOMB') board[move.r][move.c] = null;
    return board;
  }
  const result = A.battleRank(attacker, defender);
  if (result === 'A') {
    board[fromRow][fromCol] = null;
    board[move.r][move.c] = attacker;
  } else if (result === 'B') {
    board[fromRow][fromCol] = null;
  } else {
    board[fromRow][fromCol] = null;
    board[move.r][move.c] = null;
  }
  return board;
}

function kingPosition(board, owner) {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (piece && piece.owner === owner && piece.type === 'KING') return [row, col];
    }
  }
  return null;
}

function kingDanger(A, board, owner) {
  const king = kingPosition(board, owner);
  if (!king) return 99999;
  const enemy = enemyOf(owner);
  let danger = 0;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (!piece || piece.owner !== enemy) continue;
      const dist = distance(row, col, king[0], king[1]);
      if (piece.revealed) {
        if (canReach(board, piece, row, col, king[0], king[1])) {
          danger += piece.type === 'CAVALRY' ? 1400 : 900;
        }
        if (dist === 2 && A.isGen(piece.type)) danger += 260;
      } else if (dist === 1) {
        danger += 500;
      }
    }
  }
  return danger;
}

function hiddenKingCandidateScore(A, owner, target, row, col) {
  if (!target || target.owner !== enemyOf(owner) || target.revealed) return 0;
  let score = 100;
  const backRow = target.owner === 'bottom' ? 7 : 0;
  const secondRow = target.owner === 'bottom' ? 6 : 1;
  const thirdRow = target.owner === 'bottom' ? 5 : 2;
  if (row === backRow) score += 110;
  else if (row === secondRow) score += 70;
  else if (row === thirdRow) score += 28;
  if (col === 3 || col === 4) score += 18;
  let guards = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const other = A.S.board[row + dr] && A.S.board[row + dr][col + dc];
      if (other && other.owner === target.owner) guards++;
    }
  }
  return score + Math.min(guards, 4) * 12;
}

function pieceSummary(A, owner) {
  const summary = { total: 0, hidden: 0, revealed: 0 };
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = A.S.board[row][col];
      if (!piece || piece.owner !== owner) continue;
      summary.total++;
      if (piece.revealed) summary.revealed++;
      else summary.hidden++;
    }
  }
  return summary;
}

function nearestHiddenCandidate(A, owner, row, col) {
  let best = { score: 0, distance: 99 };
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const target = A.S.board[r][c];
      const score = hiddenKingCandidateScore(A, owner, target, r, c);
      if (!score) continue;
      const dist = distance(row, col, r, c) - score / 520;
      if (dist < best.distance) best = { score, distance: dist };
    }
  }
  return best;
}

function publicFightScore(A, attacker, target) {
  const result = A.battleRank(attacker, target);
  const attackValue = pieceValue(attacker.type);
  const targetValue = pieceValue(target.type);
  if (target.type === 'KING' && (result === 'A' || result === 'X')) return 100000;
  if (attacker.type === 'KING' && result !== 'A') return -100000;
  if (attacker.type === 'SPY') {
    if (attacker.revealed) return -50000;
    if (A.isGen(target.type)) return 3500;
  }
  if (result === 'A') return 700 + targetValue - attackValue * 0.15;
  if (result === 'X') return 300 + targetValue * 0.55 - attackValue * 0.55;
  if (result === 'D' || result === 'K') return targetValue >= attackValue ? targetValue - attackValue * 0.8 : -4000;
  return -80000;
}

function scoreSummerMove(A, owner, candidate, random) {
  const { fromRow, fromCol, move } = candidate;
  const piece = A.S.board[fromRow][fromCol];
  const target = A.S.board[move.r][move.c];
  const beforeDanger = kingDanger(A, A.S.board, owner);
  const afterBoard = simulateBoard(A, fromRow, fromCol, move);
  const afterDanger = kingDanger(A, afterBoard, owner);
  const moveDistance = move.dist || distance(fromRow, fromCol, move.r, move.c);
  let score = (beforeDanger - afterDanger) * 2.2;

  if (target) {
    if (target.revealed) {
      score += publicFightScore(A, piece, target);
    } else {
      const candidateScore = hiddenKingCandidateScore(A, owner, target, move.r, move.c);
      const highConfidence = candidateScore >= 310;
      if (piece.type === 'KING') score -= 100000;
      score += candidateScore * 1.6;
      if (piece.type === 'INFANTRY') score += 180;
      if (piece.type === 'SPY' && !piece.revealed) score += 80;
      if (piece.type === 'BOMB') score += highConfidence ? 100 : -260;
      if (A.isGen(piece.type) && !highConfidence) score -= pieceValue(piece.type) * 0.85;
      if (piece.type === 'CAVALRY' && moveDistance >= 2 && !highConfidence) score -= 180;
    }
  } else {
    const before = nearestHiddenCandidate(A, owner, fromRow, fromCol);
    const after = nearestHiddenCandidate(A, owner, move.r, move.c);
    if (before.distance < 99) score += (before.distance - after.distance) * 120;
    if (piece.type === 'BOMB') score -= 320;
    if (piece.type === 'KING') score -= beforeDanger > 0 && afterDanger < beforeDanger ? 80 : 900;
    if (piece.revealed && afterDanger >= beforeDanger) score -= 50;
    if (move.kind === 'special') score -= 180;
    if (piece.type === 'CAVALRY' && moveDistance >= 3 && after.distance > before.distance) score -= 150;
  }

  if (afterDanger >= 900 && afterDanger > beforeDanger) score -= 2500;
  if (move.kind === 'special' && !target) score -= 300;
  return score + random() * 0.001;
}

function isImmediateBacktrack(A, candidate, piece) {
  const previous = A.S.headlessLastByPiece && A.S.headlessLastByPiece.get(piece.id);
  if (!previous || previous.hit || candidate.move.hit) return false;
  return (
    previous.from[0] === candidate.move.r &&
    previous.from[1] === candidate.move.c &&
    previous.to[0] === candidate.fromRow &&
    previous.to[1] === candidate.fromCol
  );
}

function shouldRejectSummerMove(A, owner, candidate) {
  const { fromRow, fromCol, move } = candidate;
  const piece = A.S.board[fromRow][fromCol];
  const target = A.S.board[move.r][move.c];
  const moveDistance = move.dist || distance(fromRow, fromCol, move.r, move.c);
  if (!piece) return true;
  if (isImmediateBacktrack(A, candidate, piece)) return true;
  if (piece.type === 'BOMB' && !target) return true;
  if (move.kind === 'special' && !target) return true;

  if (target) {
    if (piece.type === 'KING' && (!target.revealed || publicFightScore(A, piece, target) < 90000)) return true;
    if (!target.revealed) {
      const candidateScore = hiddenKingCandidateScore(A, owner, target, move.r, move.c);
      const highConfidence = candidateScore >= 330;
      const enemySummary = pieceSummary(A, enemyOf(owner));
      const confirmedCandidate = enemySummary.hidden <= 2 || enemySummary.total <= 5;
      if (A.isGen(piece.type) && !highConfidence) return true;
      if ((A.isGen(piece.type) || piece.type === 'CAVALRY' || piece.type === 'BOMB') && !confirmedCandidate) return true;
      if (piece.type === 'CAVALRY' && moveDistance >= 2 && !confirmedCandidate) return true;
      if (piece.type === 'BOMB' && !confirmedCandidate) return true;
    }
  } else if (piece.type === 'CAVALRY' && moveDistance >= 3) {
    return true;
  }

  const beforeDanger = kingDanger(A, A.S.board, owner);
  const afterDanger = kingDanger(A, simulateBoard(A, fromRow, fromCol, move), owner);
  if (afterDanger > beforeDanger && afterDanger >= 900) return true;
  if (beforeDanger >= 900 && afterDanger + 120 >= beforeDanger) {
    const winningKingAttack = target && target.revealed && target.type === 'KING' && publicFightScore(A, piece, target) > 90000;
    if (!winningKingAttack) return true;
  }
  return false;
}

function chooseSummerMove(A, owner, moves, random) {
  if (!moves.length) return null;
  const winning = moves.find((candidate) => {
    const piece = A.S.board[candidate.fromRow][candidate.fromCol];
    const target = A.S.board[candidate.move.r][candidate.move.c];
    return target && target.revealed && target.type === 'KING' && publicFightScore(A, piece, target) > 90000;
  });
  if (winning) return winning;

  const filtered = moves.filter((candidate) => !shouldRejectSummerMove(A, owner, candidate));
  let candidates = filtered;
  if (!candidates.length) {
    const currentDanger = kingDanger(A, A.S.board, owner);
    candidates = moves.filter((candidate) => {
      const piece = A.S.board[candidate.fromRow][candidate.fromCol];
      const target = A.S.board[candidate.move.r][candidate.move.c];
      if (piece && piece.type === 'BOMB' && !target) return false;
      if (candidate.move.kind === 'special' && !target) return false;
      const afterDanger = kingDanger(A, simulateBoard(A, candidate.fromRow, candidate.fromCol, candidate.move), owner);
      return afterDanger + 120 < currentDanger;
    });
  }
  if (!candidates.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const score = scoreSummerMove(A, owner, candidate, random);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  if (best) best.score = Number(bestScore.toFixed(3));
  return best;
}

function chooseMove(A, owner, moves, random, aiName) {
  if (aiName === 'summer') return chooseSummerMove(A, owner, moves, random);
  return chooseRandomMove(moves, random);
}

function finishTurn(A) {
  const endMessage = A.checkEnd();
  if (endMessage) return endMessage;
  A.S.turn = A.S.turn === 'bottom' ? 'top' : 'bottom';
  return '';
}

function runMatch(options) {
  const random = createRng(options.seed);
  const A = loadEngine(random);
  const ai = {
    top: options.topAi || 'random',
    bottom: options.bottomAi || 'random',
  };

  A.reset();
  const bottomSetup = setupForAi(A, 'bottom', ai.bottom, random);
  const topSetup = setupForAi(A, 'top', ai.top, random);
  A.S.phase = 'playing';
  A.S.turn = 'bottom';
  A.S.viewer = 'bottom';
  A.S.headlessLastByPiece = new Map();

  const log = {
    version: 1,
    seed: options.seed,
    maxTurns: options.maxTurns,
    ai,
    setup: {
      top: topSetup,
      bottom: bottomSetup,
    },
    initialBoard: boardSnapshot(A),
    turns: [],
    result: null,
    finalBoard: null,
  };

  for (let turnNumber = 1; turnNumber <= options.maxTurns && A.S.phase === 'playing'; turnNumber++) {
    const owner = A.S.turn;
    const moves = allMoves(A, owner);
    const selected = chooseMove(A, owner, moves, random, ai[owner]);

    const turn = {
      turn: turnNumber,
      owner,
      legalMoveCount: moves.length,
      selected: selected
        ? { from: [selected.fromRow, selected.fromCol], to: [selected.move.r, selected.move.c], move: selected.move, score: selected.score }
        : null,
      pass: !selected,
    };

    if (!selected) {
      A.S.lastKingMove[owner] = false;
      A.S.lastMove = { owner, text: `${A.label(owner)} pass` };
      turn.result = 'pass';
    } else {
      const kingDangerBefore = kingDanger(A, A.S.board, owner);
      const kingDangerAfter = kingDanger(A, simulateBoard(A, selected.fromRow, selected.fromCol, selected.move), owner);
      turn.applied = applyMove(A, selected.fromRow, selected.fromCol, selected.move);
      turn.kingDanger = {
        before: kingDangerBefore,
        after: kingDangerAfter,
        delta: kingDangerBefore - kingDangerAfter,
      };
      const moved = turn.applied.before && turn.applied.before.attacker;
      if (moved) {
        A.S.headlessLastByPiece.set(moved.id, {
          from: turn.applied.from,
          to: turn.applied.to,
          hit: turn.applied.hit,
        });
      }
    }

    const endMessage = finishTurn(A);
    turn.endMessage = endMessage || null;
    turn.remaining = {
      top: counts(A, 'top'),
      bottom: counts(A, 'bottom'),
    };
    log.turns.push(turn);
  }

  if (A.S.phase !== 'gameOver') {
    A.S.draw = true;
    A.S.phase = 'gameOver';
    log.result = {
      winner: null,
      draw: true,
      reason: `turn-cap-${options.maxTurns}`,
    };
  } else {
    log.result = {
      winner: A.S.winner || null,
      draw: !!A.S.draw,
      reason: A.S.draw ? 'draw-condition' : 'win-condition',
    };
  }
  log.finalBoard = boardSnapshot(A);
  log.totalTurns = log.turns.length;
  return log;
}

function analyzeMatch(log) {
  const anomalies = [];
  const lastSeen = new Map();

  for (const turn of log.turns) {
    const applied = turn.applied;
    if (!applied) continue;
    const attacker = applied.before && applied.before.attacker;
    const defender = applied.before && applied.before.defender;
    const key = attacker && attacker.id;

    if (attacker && attacker.type === 'KING' && applied.hit) {
      anomalies.push({ type: 'king-attack', turn: turn.turn, owner: turn.owner, seed: log.seed });
    }
    if (attacker && attacker.type === 'BOMB' && !applied.hit) {
      anomalies.push({ type: 'bomb-quiet-move', turn: turn.turn, owner: turn.owner, seed: log.seed });
    }
    if (applied.kind === 'special' && !applied.hit) {
      anomalies.push({ type: 'quiet-special-move', turn: turn.turn, owner: turn.owner, seed: log.seed });
    }
    if (attacker && attacker.type === 'CAVALRY' && !applied.hit && applied.distance >= 3) {
      anomalies.push({ type: 'long-empty-cavalry-move', turn: turn.turn, owner: turn.owner, seed: log.seed });
    }
    if (defender && !defender.revealed && applied.hit && attacker && attacker.type !== 'INFANTRY' && attacker.type !== 'SPY' && turn.turn < 60) {
      anomalies.push({ type: 'costly-hidden-attack', turn: turn.turn, owner: turn.owner, seed: log.seed });
    } else if (defender && !defender.revealed && applied.hit && attacker && attacker.type !== 'INFANTRY' && attacker.type !== 'SPY') {
      anomalies.push({ type: 'late-hidden-hunt', turn: turn.turn, owner: turn.owner, seed: log.seed });
    }
    if (turn.kingDanger && turn.kingDanger.before >= 900 && turn.kingDanger.after + 120 >= turn.kingDanger.before) {
      anomalies.push({ type: 'unanswered-king-danger', turn: turn.turn, owner: turn.owner, seed: log.seed });
      if (defender && !defender.revealed) {
        anomalies.push({ type: 'hunt-while-king-threatened', turn: turn.turn, owner: turn.owner, seed: log.seed });
      }
    }
    if (key && !applied.hit) {
      const previous = lastSeen.get(key);
      if (
        previous &&
        previous.from[0] === applied.to[0] &&
        previous.from[1] === applied.to[1] &&
        previous.to[0] === applied.from[0] &&
        previous.to[1] === applied.from[1]
      ) {
        if (!turn.kingDanger || turn.kingDanger.delta < 120) {
          anomalies.push({ type: 'immediate-backtrack', turn: turn.turn, owner: turn.owner, seed: log.seed });
        }
      }
      lastSeen.set(key, { from: applied.from, to: applied.to });
    }
  }

  if (log.totalTurns <= 10) anomalies.push({ type: 'short-game', turn: log.totalTurns, seed: log.seed });
  if (log.result.reason.startsWith('turn-cap')) anomalies.push({ type: 'turn-cap', turn: log.totalTurns, seed: log.seed });
  return anomalies;
}

function summarizeMatches(matches) {
  const summary = {
    games: matches.length,
    ai: matches[0] ? matches[0].ai : null,
    topWins: 0,
    bottomWins: 0,
    draws: 0,
    totalTurns: 0,
    minTurns: Infinity,
    maxTurns: 0,
    reasons: {},
    anomalies: {},
    anomalyExamples: {},
  };

  for (const match of matches) {
    if (match.result.winner === 'top') summary.topWins++;
    else if (match.result.winner === 'bottom') summary.bottomWins++;
    else summary.draws++;
    summary.totalTurns += match.totalTurns;
    summary.minTurns = Math.min(summary.minTurns, match.totalTurns);
    summary.maxTurns = Math.max(summary.maxTurns, match.totalTurns);
    summary.reasons[match.result.reason] = (summary.reasons[match.result.reason] || 0) + 1;

    for (const anomaly of analyzeMatch(match)) {
      summary.anomalies[anomaly.type] = (summary.anomalies[anomaly.type] || 0) + 1;
      if (!summary.anomalyExamples[anomaly.type]) summary.anomalyExamples[anomaly.type] = anomaly;
    }
  }

  const turns = matches.map((match) => match.totalTurns).sort((a, b) => a - b);
  summary.avgTurns = Number((summary.totalTurns / Math.max(1, matches.length)).toFixed(2));
  summary.medianTurns = turns.length % 2
    ? turns[(turns.length - 1) / 2]
    : (turns[turns.length / 2 - 1] + turns[turns.length / 2]) / 2;
  summary.winRates = {
    top: Number((summary.topWins / Math.max(1, matches.length) * 100).toFixed(1)),
    bottom: Number((summary.bottomWins / Math.max(1, matches.length) * 100).toFixed(1)),
    draw: Number((summary.draws / Math.max(1, matches.length) * 100).toFixed(1)),
  };
  return summary;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.games === 1) {
      const log = runMatch(options);
      console.log(JSON.stringify(log, null, options.pretty ? 2 : 0));
    } else {
      const matches = [];
      for (let i = 1; i <= options.games; i++) {
        matches.push(runMatch({ ...options, seed: `${options.seed}-${i}` }));
      }
      console.log(JSON.stringify(summarizeMatches(matches), null, options.pretty ? 2 : 0));
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  createRng,
  loadEngine,
  analyzeMatch,
  runMatch,
  summarizeMatches,
};
