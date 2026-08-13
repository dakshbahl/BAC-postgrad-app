const COLS = 7;
const ROWS = 6;
const SIZE = COLS * ROWS;
const HUMAN = 1;
const ENGINE = -1;
const ORDER = [3, 2, 4, 1, 5, 0, 6];
const WIN_SCORE = 100000;

class Game {
  constructor() {
    this.reset();
  }

  reset() {
    this.cells = new Int8Array(SIZE);
    this.heights = new Int8Array(COLS);
    this.moves = [];
    this.turn = HUMAN;
  }

  at(c, r) {
    return this.cells[c * ROWS + r];
  }

  canPlay(c) {
    return this.heights[c] < ROWS;
  }

  legal() {
    return ORDER.filter(c => this.canPlay(c));
  }

  full() {
    return this.moves.length === SIZE;
  }

  play(c) {
    const r = this.heights[c];
    this.cells[c * ROWS + r] = this.turn;
    this.heights[c]++;
    this.moves.push(c);
    this.turn = -this.turn;
    return r;
  }

  undo() {
    const c = this.moves.pop();
    this.heights[c]--;
    this.cells[c * ROWS + this.heights[c]] = 0;
    this.turn = -this.turn;
    return c;
  }
}

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

function lineAt(g, c, r, p) {
  for (const [dc, dr] of DIRS) {
    const line = [[c, r]];
    for (const sign of [1, -1]) {
      let cc = c + dc * sign;
      let rr = r + dr * sign;
      while (cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS && g.at(cc, rr) === p) {
        line.push([cc, rr]);
        cc += dc * sign;
        rr += dr * sign;
      }
    }
    if (line.length >= 4) return line;
  }
  return null;
}

function isWin(g, c, r, p) {
  return lineAt(g, c, r, p) !== null;
}

const WINDOWS = [];
for (let c = 0; c < COLS; c++) {
  for (let r = 0; r < ROWS; r++) {
    for (const [dc, dr] of DIRS) {
      const ec = c + 3 * dc;
      const er = r + 3 * dr;
      if (ec < 0 || ec >= COLS || er < 0 || er >= ROWS) continue;
      WINDOWS.push([0, 1, 2, 3].map(i => (c + i * dc) * ROWS + (r + i * dr)));
    }
  }
}

function evaluate(cells, me) {
  let score = 0;
  for (let w = 0; w < WINDOWS.length; w++) {
    const win = WINDOWS[w];
    let mine = 0;
    let theirs = 0;
    for (let i = 0; i < 4; i++) {
      const v = cells[win[i]];
      if (v === me) mine++;
      else if (v !== 0) theirs++;
    }
    if (mine && theirs) continue;
    if (mine === 3) score += 60;
    else if (mine === 2) score += 12;
    else if (mine === 1) score += 2;
    else if (theirs === 3) score -= 75;
    else if (theirs === 2) score -= 14;
    else if (theirs === 1) score -= 2;
  }
  for (let r = 0; r < ROWS; r++) {
    const v = cells[3 * ROWS + r];
    if (v === me) score += 8;
    else if (v !== 0) score -= 8;
  }
  return score;
}

const EXACT = 0;
const LOWER = 1;
const UPPER = 2;
const TT = new Map();

let nodes = 0;
let deadline = 0;
let aborted = false;

function ttKey(g) {
  let s = g.turn === HUMAN ? 'h' : 'e';
  for (let i = 0; i < SIZE; i++) s += g.cells[i] + 1;
  return s;
}

function negamax(g, depth, alpha, beta, ply) {
  nodes++;
  if ((nodes & 1023) === 0 && performance.now() > deadline) aborted = true;
  if (aborted) return 0;
  if (g.full()) return 0;

  const me = g.turn;
  const alphaOrig = alpha;
  let ttMove = -1;

  if (depth >= 3) {
    const hit = TT.get(ttKey(g));
    if (hit) {
      ttMove = hit.move;
      if (hit.depth >= depth) {
        if (hit.flag === EXACT) return hit.score;
        if (hit.flag === LOWER && hit.score > alpha) alpha = hit.score;
        if (hit.flag === UPPER && hit.score < beta) beta = hit.score;
        if (alpha >= beta) return hit.score;
      }
    }
  }

  for (const c of ORDER) {
    if (!g.canPlay(c)) continue;
    const r = g.heights[c];
    const i = c * ROWS + r;
    g.cells[i] = me;
    const won = isWin(g, c, r, me);
    g.cells[i] = 0;
    if (won) return WIN_SCORE - ply;
  }

  if (depth === 0) return evaluate(g.cells, me);

  const order = ttMove >= 0 ? [ttMove, ...ORDER.filter(c => c !== ttMove)] : ORDER;
  let best = -Infinity;
  let bestMove = -1;

  for (const c of order) {
    if (!g.canPlay(c)) continue;
    g.play(c);
    const score = -negamax(g, depth - 1, -beta, -alpha, ply + 1);
    g.undo();
    if (aborted) return 0;
    if (score > best) {
      best = score;
      bestMove = c;
    }
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }

  if (depth >= 3) {
    const flag = best <= alphaOrig ? UPPER : best >= beta ? LOWER : EXACT;
    TT.set(ttKey(g), { depth, score: best, flag, move: bestMove });
  }
  return best;
}

function search(g, cfg) {
  TT.clear();
  nodes = 0;
  aborted = false;
  deadline = performance.now() + cfg.time;
  const t0 = performance.now();

  const legal = g.legal();
  let bestMove = legal[0];
  let bestScores = null;
  let bestScore = 0;
  let reached = 0;

  for (let d = 1; d <= cfg.depth; d++) {
    const scores = {};
    let localBest = -Infinity;
    let localMove = bestMove;
    const order = [bestMove, ...legal.filter(c => c !== bestMove)];

    for (const c of order) {
      const mover = g.turn;
      const r = g.play(c);
      const v = isWin(g, c, r, mover)
        ? WIN_SCORE - 1
        : -negamax(g, d - 1, -Infinity, Infinity, 1);
      g.undo();
      if (aborted) break;
      scores[c] = v;
      if (v > localBest) {
        localBest = v;
        localMove = c;
      }
    }
    if (aborted) break;

    bestMove = localMove;
    bestScores = scores;
    bestScore = localBest;
    reached = d;
    if (localBest > WIN_SCORE - 100) break;
  }

  return {
    move: bestMove,
    scores: bestScores || {},
    score: bestScore,
    depth: reached,
    nodes,
    ms: Math.max(1, performance.now() - t0)
  };
}

if (typeof module !== 'undefined') {
  module.exports = { COLS, ROWS, HUMAN, ENGINE, WIN_SCORE, Game, lineAt, isWin, evaluate, search };
}
