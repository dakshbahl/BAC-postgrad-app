# Connect Four

A Connect 4 bot with a browser UI. No dependencies and no build step, just open `index.html`.

## Running it

```
open index.html
```

Tests:

```
node test.js
```

## Playing

Click a column or press 1 through 7. Four difficulty settings from Rookie (depth 2, plays randomly 35% of the time) to Ruthless (depth 16, 3 second budget).

The strip above the board shows the engine's score for every legal column from its last search. `-M3` means a forced loss in three moves. The bar on the left is the position score from the engine's side. The row under the board shows depth reached, nodes searched, and time.

## How it works

**Board.** A flat `Int8Array` of 42 cells with `index = col * 6 + row`, row 0 at the bottom. `+1` is you, `-1` is the engine. A `heights` array tracks how full each column is so finding the landing square is a lookup instead of a scan.

I skipped bitboards because JavaScript's bitwise operators truncate to 32 bits and a Connect 4 bitboard needs 49, so it would mean BigInt or splitting across two words. The array does ~700k nodes/sec which is plenty for a 7x6 board.

**Search.** Negamax with alpha-beta pruning and iterative deepening against a time budget.

Move ordering is centre-out (3,2,4,1,5,0,6) since centre columns are in more winning lines, so good moves get tried first and produce more cutoffs. When the transposition table has a best move for a position, that gets tried first instead.

The transposition table is a Map keyed on the position string, storing depth, score, and whether the score is exact or just a bound. It's only used at depth 3 and up because near the leaves building the key costs more than the lookup saves.

Every node checks for a win in one, including at depth 0. Without this the search returns a static eval at the horizon and walks into losses it was one move from seeing.

Terminal scores are `WIN_SCORE - ply` so the engine prefers winning in 3 over winning in 7, and from a losing position picks the line that survives longest. Iterative deepening stops early on a forced win but keeps going on a forced loss for the same reason.

The root search uses a full window per column instead of narrowing against the best sibling. That's slower but gives a real score for every column, which is what the display needs.

**Evaluation.** At the horizon it scores all 69 four-in-a-row windows: 3 of mine and none of theirs is +60, 2 is +12, 1 is +2, and the mirror is -75, -14, -2. Windows with both colors score zero since nobody can complete them. Centre column discs are worth 8 each. Enemy threats are punished a bit harder than equivalent threats of mine are rewarded, which makes it defend before it attacks.

The 69 windows are precomputed once at load.

## Dataset

`calibrate_eval.py` uses the Kaggle Connect-4 dataset to check the eval weights. The dataset is 67,557 positions at 8 plies labelled with the result under perfect play, which is ground truth for whether the heuristic is right when it says a position is good.

It pulls out the same seven quantities the eval reacts to, so a fitted logistic regression's coefficients land in the same units as the hardcoded numbers and can be compared directly. It reports sign agreement for both sets of weights and prints a replacement block.

```
python calibrate_eval.py --data connect-4.data
```

Needs numpy and scikit-learn. Draws are dropped when scoring since a heuristic that outputs a real number has no way to say "exactly drawn".

## Files

```
engine.js          board, search, evaluation
index.html         UI
test.js            17 tests, plain node
calibrate_eval.py  eval weight calibration
```
