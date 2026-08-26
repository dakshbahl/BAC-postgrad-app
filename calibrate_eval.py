import argparse
import sys
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

COLS, ROWS = 7, 6

HAND_WEIGHTS = {
    "mine_3": 60.0,
    "mine_2": 12.0,
    "mine_1": 2.0,
    "theirs_3": -75.0,
    "theirs_2": -14.0,
    "theirs_1": -2.0,
    "centre_diff": 8.0,
}
FEATURES = list(HAND_WEIGHTS)

# The CSV stores cells row-major with row 0 at the top. engine.js indexes
# col * ROWS + row with row 0 at the bottom. This maps one onto the other.
REINDEX = np.array([(i % COLS) * ROWS + (ROWS - 1 - i // COLS) for i in range(42)])


def build_windows():
    out = []
    for c in range(COLS):
        for r in range(ROWS):
            for dc, dr in ((0, 1), (1, 0), (1, 1), (1, -1)):
                ec, er = c + 3 * dc, r + 3 * dr
                if 0 <= ec < COLS and 0 <= er < ROWS:
                    out.append([(c + i * dc) * ROWS + (r + i * dr) for i in range(4)])
    return np.array(out, dtype=np.int32)


WINDOWS = build_windows()


def load(path):
    """Read c4_game_database.csv: 42 cell columns, then a winner column."""
    rows = np.genfromtxt(path, delimiter=",", skip_header=1, dtype=np.float32)
    rows = rows[~np.isnan(rows).any(axis=1)]

    raw = rows[:, :42].astype(np.int8)
    labels = rows[:, 42].astype(np.int8)

    boards = np.zeros_like(raw)
    boards[:, REINDEX] = raw
    return boards, labels


def check_gravity(boards, sample=2000):
    """Every disc rests on the floor or another disc. Catches a wrong layout."""
    grid = boards[:sample].reshape(-1, COLS, ROWS)
    filled = grid != 0
    heights = filled.sum(axis=2)
    expected = np.arange(ROWS)[None, None, :] < heights[:, :, None]
    return float((filled == expected).all(axis=(1, 2)).mean())


def featurise(boards):
    win_cells = boards[:, WINDOWS]
    mine = (win_cells == 1).sum(axis=2)
    theirs = (win_cells == -1).sum(axis=2)

    feats = np.zeros((boards.shape[0], len(FEATURES)), dtype=np.float32)
    for k, count in enumerate((3, 2, 1)):
        feats[:, k] = ((mine == count) & (theirs == 0)).sum(axis=1)
        feats[:, k + 3] = ((theirs == count) & (mine == 0)).sum(axis=1)

    centre = boards[:, 3 * ROWS:4 * ROWS]
    feats[:, 6] = (centre == 1).sum(axis=1) - (centre == -1).sum(axis=1)
    return feats


def handcrafted_score(feats):
    return feats @ np.array([HAND_WEIGHTS[f] for f in FEATURES], dtype=np.float32)


def agreement(name, scores, labels):
    decisive = labels != 0
    rate = (np.sign(scores[decisive]) == labels[decisive]).mean()
    print(f"  {name:<22} {rate:6.1%} on {decisive.sum():,} decisive positions")
    return rate


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="c4_game_database.csv")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    path = Path(args.data)
    if not path.exists():
        print(f"Could not find {path}")
        print("Download the Kaggle Connect 4 game database and pass it with --data")
        sys.exit(1)

    boards, labels = load(path)

    legal = check_gravity(boards)
    if legal < 0.99:
        print(f"Only {legal:.1%} of boards are physically legal after reindexing.")
        print("The cell ordering assumed by REINDEX is wrong for this file.")
        sys.exit(1)

    discs = (boards != 0).sum(axis=1)
    print(f"\n{len(boards):,} positions "
          f"(p1 {(labels == 1).mean():.1%}, "
          f"p2 {(labels == -1).mean():.1%}, "
          f"draw {(labels == 0).mean():.1%})")
    print(f"{discs.min()}-{discs.max()} discs per position, mean {discs.mean():.1f}")

    X = featurise(boards)
    Xtr, Xte, ytr, yte, _, dte = train_test_split(
        X, labels, discs, test_size=0.25, random_state=args.seed, stratify=labels)

    dec_te = yte != 0
    print("\nsign agreement with the game result")
    majority = max((yte[dec_te] == 1).mean(), (yte[dec_te] == -1).mean())
    print(f"  {'always-guess-majority':<22} {majority:6.1%} baseline")

    hand = handcrafted_score(Xte)
    agreement("hand-tuned", hand, yte)

    dec = ytr != 0
    scaler = StandardScaler().fit(Xtr[dec])
    model = LogisticRegression(max_iter=2000).fit(scaler.transform(Xtr[dec]), ytr[dec])
    fitted = model.decision_function(scaler.transform(Xte))
    agreement("refitted", fitted, yte)

    raw = model.coef_[0] / scaler.scale_
    raw = raw / np.abs(raw).max() * 75.0

    print("\nweights")
    print(f"  {'feature':<14}{'hand':>8}{'refitted':>11}")
    for name, value in zip(FEATURES, raw):
        print(f"  {name:<14}{HAND_WEIGHTS[name]:>8.0f}{value:>11.1f}")

    print("\nagreement by game stage")
    print(f"  {'discs':<10}{'n':>9}{'hand':>9}{'refitted':>11}")
    for lo, hi in ((7, 14), (15, 21), (22, 28), (29, 35), (36, 42)):
        m = (dte >= lo) & (dte <= hi) & dec_te
        if m.sum() < 50:
            continue
        h = (np.sign(hand[m]) == yte[m]).mean()
        f = (np.sign(fitted[m]) == yte[m]).mean()
        print(f"  {f'{lo}-{hi}':<10}{m.sum():>9,}{h:>9.1%}{f:>11.1%}")

    m3, m2, m1, t3, t2, t1, centre = raw
    print("\nreplacement block for evaluate() in engine.js")
    print(f"    if (mine === 3) score += {m3:.0f};")
    print(f"    else if (mine === 2) score += {m2:.0f};")
    print(f"    else if (mine === 1) score += {m1:.0f};")
    print(f"    else if (theirs === 3) score += {t3:.0f};")
    print(f"    else if (theirs === 2) score += {t2:.0f};")
    print(f"    else if (theirs === 1) score += {t1:.0f};")
    print(f"    centre column term: {centre:.0f} per disc\n")


if __name__ == "__main__":
    main()
