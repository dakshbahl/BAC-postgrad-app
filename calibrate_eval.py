import argparse
import gzip
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
    opener = gzip.open if str(path).endswith(".gz") else open
    code = {"x": 1, "o": -1, "b": 0}
    result = {"win": 1, "loss": -1, "draw": 0}
    boards, labels = [], []

    with opener(path, "rt") as fh:
        for line in fh:
            parts = line.strip().split(",")
            if len(parts) != 43:
                continue
            try:
                boards.append([code[p] for p in parts[:42]])
                labels.append(result[parts[42]])
            except KeyError:
                continue

    return np.array(boards, dtype=np.int8), np.array(labels, dtype=np.int8)


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
    print(f"  {name:<20} {rate:6.1%} on {decisive.sum():,} decisive positions")
    return rate


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="connect-4.data")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    path = Path(args.data)
    if not path.exists():
        print(f"Could not find {path}")
        print("Download the Connect-4 dataset, decompress it, and pass it with --data")
        sys.exit(1)

    boards, labels = load(path)
    print(f"\n{len(boards):,} positions "
          f"(win {(labels == 1).mean():.1%}, "
          f"loss {(labels == -1).mean():.1%}, "
          f"draw {(labels == 0).mean():.1%})")

    X = featurise(boards)
    Xtr, Xte, ytr, yte = train_test_split(
        X, labels, test_size=0.25, random_state=args.seed, stratify=labels)

    print("\nsign agreement with the true result")
    agreement("hand-tuned", handcrafted_score(Xte), yte)

    dec = ytr != 0
    scaler = StandardScaler().fit(Xtr[dec])
    model = LogisticRegression(max_iter=2000).fit(scaler.transform(Xtr[dec]), ytr[dec])
    agreement("refitted", model.decision_function(scaler.transform(Xte)), yte)

    raw = model.coef_[0] / scaler.scale_
    raw = raw / np.abs(raw).max() * 75.0

    print("\nweights")
    print(f"  {'feature':<14}{'hand':>8}{'refitted':>11}")
    for name, value in zip(FEATURES, raw):
        print(f"  {name:<14}{HAND_WEIGHTS[name]:>8.0f}{value:>11.1f}")

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
