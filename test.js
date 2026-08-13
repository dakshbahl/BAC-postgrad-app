const { COLS, ROWS, HUMAN, ENGINE, Game, lineAt, isWin, search } = require('./engine.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const detail = fn();
    console.log(`  ok    ${name}${detail ? '  ' + detail : ''}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}  ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

let seed = 12345;
function rng() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

function render(g) {
  let s = '';
  for (let r = ROWS - 1; r >= 0; r--) {
    for (let c = 0; c < COLS; c++) {
      const v = g.at(c, r);
      s += v === 1 ? ' X' : v === -1 ? ' O' : ' .';
    }
    s += '\n';
  }
  return s + ' 0 1 2 3 4 5 6';
}

function fromPicture(rows, turn) {
  const g = new Game();
  rows.slice().reverse().forEach((row, r) => {
    row.replace(/ /g, '').split('').forEach((ch, c) => {
      if (ch !== '.') g.cells[c * ROWS + r] = ch === 'X' ? 1 : -1;
    });
  });
  for (let c = 0; c < COLS; c++) {
    let h = 0;
    while (h < ROWS && g.at(c, h) !== 0) h++;
    g.heights[c] = h;
  }
  g.moves = new Array(g.heights.reduce((a, b) => a + b, 0)).fill(0);
  g.turn = turn;
  return g;
}

function noExistingFour(g) {
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const v = g.at(c, r);
      if (v && isWin(g, c, r, v)) return false;
    }
  }
  return true;
}

const DEEP = { depth: 12, time: 2000 };

console.log('\nwin detection');

test('horizontal', () => {
  const g = new Game();
  for (let c = 2; c < 6; c++) g.cells[c * ROWS] = -1;
  assert(isWin(g, 5, 0, -1));
});

test('vertical', () => {
  const g = new Game();
  for (let r = 0; r < 4; r++) g.cells[2 * ROWS + r] = -1;
  assert(isWin(g, 2, 3, -1));
});

test('diagonal up', () => {
  const g = new Game();
  [0, 1, 2, 3].forEach(i => g.cells[i * ROWS + i] = 1);
  assert(isWin(g, 3, 3, 1));
});

test('diagonal down', () => {
  const g = new Game();
  [0, 1, 2, 3].forEach(i => g.cells[(3 - i) * ROWS + i] = 1);
  assert(isWin(g, 0, 3, 1));
});

test('three in a row is not a win', () => {
  const g = new Game();
  [0, 1, 2].forEach(i => g.cells[i * ROWS] = 1);
  assert(!isWin(g, 2, 0, 1));
});

console.log('\nboard mechanics');

test('undo restores state', () => {
  const g = new Game();
  const before = g.cells.slice();
  [3, 3, 4, 2, 5, 1, 0, 6].forEach(c => g.play(c));
  while (g.moves.length) g.undo();
  assert(g.cells.every((v, i) => v === before[i]) && g.turn === HUMAN && g.moves.length === 0);
});

test('columns cap at six', () => {
  const g = new Game();
  for (let i = 0; i < 6; i++) g.play(3);
  assert(!g.canPlay(3) && !g.legal().includes(3));
});

console.log('\ntactics');

test('takes the immediate win', () => {
  const g = fromPicture([
    '. . . . . . .',
    '. . . . . . .',
    '. . . . . . .',
    '. . . . . . .',
    '. . . . . . .',
    'O O O . X X .'
  ], ENGINE);
  assert(noExistingFour(g), 'bad setup');
  const r = search(g, DEEP);
  assert(r.move === 3, `played ${r.move}\n${render(g)}`);
  return `col ${r.move}`;
});

test('blocks the opponent win', () => {
  const g = fromPicture([
    '. . . . . . .',
    '. . . . . . .',
    '. . . . . . .',
    '. . . . . . .',
    '. . . . . . .',
    'O X X X . . O'
  ], ENGINE);
  assert(noExistingFour(g), 'bad setup');
  const r = search(g, DEEP);
  assert(r.move === 4, `played ${r.move}\n${render(g)}`);
  return `col ${r.move}`;
});

test('will not fill the square under an opponent win', () => {
  const g = fromPicture([
    '. . . . . . .',
    '. . . . . . .',
    '. . . . . . .',
    '. . . . . . .',
    '. O X X X . .',
    'O X O X O . .'
  ], ENGINE);
  assert(noExistingFour(g), 'bad setup');
  const r = search(g, DEEP);
  assert(r.move !== 5, `played the losing column\n${render(g)}`);
  return `chose col ${r.move}, scored col 5 at ${r.scores[5]}`;
});

test('opens near the centre', () => {
  const r = search(new Game(), DEEP);
  assert([2, 3, 4].includes(r.move), `opened on ${r.move}`);
  return `col ${r.move}`;
});

test('keeps searching from a lost position', () => {
  const g = fromPicture([
    '. . . . . . .',
    '. . . . . . .',
    '. . . . . . .',
    '. . . . . . .',
    '. . . . . . .',
    '. X X X . O O'
  ], ENGINE);
  const r = search(g, { depth: 10, time: 1200 });
  assert(r.depth >= 6, `only reached depth ${r.depth}`);
  return `depth ${r.depth}, score ${r.score}`;
});

console.log('\nstrength');

test('never loses to random over 20 games', () => {
  let w = 0, l = 0, d = 0;
  for (let n = 0; n < 20; n++) {
    const g = new Game();
    g.turn = n % 2 ? ENGINE : HUMAN;
    let result = 'draw';
    while (!g.full()) {
      const isEngine = g.turn === ENGINE;
      const legal = g.legal();
      const mv = isEngine
        ? search(g, { depth: 7, time: 250 }).move
        : legal[Math.floor(rng() * legal.length)];
      const mover = g.turn;
      const r = g.play(mv);
      if (isWin(g, mv, r, mover)) {
        result = isEngine ? 'engine' : 'random';
        break;
      }
    }
    if (result === 'engine') w++;
    else if (result === 'random') l++;
    else d++;
  }
  assert(l === 0, `lost ${l}`);
  return `${w} wins, ${l} losses, ${d} draws`;
});

test('depth 8 beats depth 2', () => {
  let strong = 0, weak = 0, draw = 0;
  for (let n = 0; n < 6; n++) {
    const g = new Game();
    g.turn = n % 2 ? ENGINE : HUMAN;
    let result = 'draw';
    while (!g.full()) {
      const isStrong = g.turn === ENGINE;
      let mv = search(g, isStrong ? { depth: 8, time: 600 } : { depth: 2, time: 60 }).move;
      if (!isStrong && rng() < 0.3) {
        const legal = g.legal();
        mv = legal[Math.floor(rng() * legal.length)];
      }
      const mover = g.turn;
      const r = g.play(mv);
      if (isWin(g, mv, r, mover)) {
        result = isStrong ? 'strong' : 'weak';
        break;
      }
    }
    if (result === 'strong') strong++;
    else if (result === 'weak') weak++;
    else draw++;
  }
  assert(weak === 0, `depth 2 won ${weak} of 6`);
  return `${strong} wins, ${weak} losses, ${draw} draws`;
});

console.log('\nsearch');

test('reaches depth 8 inside a 2s budget', () => {
  const g = new Game();
  [3, 3, 4, 2].forEach(c => g.play(c));
  const r = search(g, DEEP);
  assert(r.depth >= 8, `only depth ${r.depth}`);
  return `depth ${r.depth}, ${r.nodes.toLocaleString()} nodes, ${Math.round(r.nodes / (r.ms / 1000)).toLocaleString()} nodes/sec`;
});

test('scores every legal column', () => {
  const g = new Game();
  [3, 3, 4].forEach(c => g.play(c));
  const r = search(g, { depth: 8, time: 800 });
  assert(Object.keys(r.scores).length === g.legal().length);
});

test('respects the time budget', () => {
  const g = new Game();
  g.play(3);
  const t0 = performance.now();
  search(g, { depth: 30, time: 500 });
  const spent = performance.now() - t0;
  assert(spent < 1500, `took ${Math.round(spent)}ms`);
  return `${Math.round(spent)}ms for a 500ms budget`;
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
