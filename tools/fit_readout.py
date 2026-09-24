#!/usr/bin/env python3
"""Fit logistic readout on data/reports.csv → public/readout.json."""
from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "reports.csv"
OUT_PATH = ROOT / "public" / "readout.json"

CATEGORIES = ["payment", "receipt", "digest", "meeting", "complaint", "personal"]
CAT_TO_I = {c: i for i, c in enumerate(CATEGORIES)}
FEATURE_DIM = 16
SEED = 42


def transform(X: np.ndarray) -> np.ndarray:
    """log1p on brain dims [0..9]; leave integer token scores [10..15] alone."""
    out = np.array(X, dtype=np.float64, copy=True)
    out[:, :10] = np.log1p(np.maximum(out[:, :10], 0.0))
    return out


def main() -> None:
    if not CSV_PATH.exists():
        raise SystemExit(f"missing {CSV_PATH} — run tools/run_reports.mjs first")

    rows = []
    with CSV_PATH.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            feats = [float(row[f"f{i}"]) for i in range(FEATURE_DIM)]
            cat = row["category"]
            if cat not in CAT_TO_I:
                continue
            rows.append((feats, CAT_TO_I[cat], row.get("id", "")))

    if len(rows) < 10:
        raise SystemExit(f"need ≥10 rows, got {len(rows)}")

    X = np.array([r[0] for r in rows], dtype=np.float64)
    y = np.array([r[1] for r in rows], dtype=np.int64)
    X_t = transform(X)

    X_train, X_test, y_train, y_test = train_test_split(
        X_t, y, test_size=0.2, random_state=SEED, stratify=y
    )

    # Holdout metrics (honest number for UI / results.md)
    scaler_h = StandardScaler()
    X_tr_s = scaler_h.fit_transform(X_train)
    X_te_s = scaler_h.transform(X_test)
    clf_h = LogisticRegression(solver="lbfgs", max_iter=4000, random_state=SEED, C=0.5)
    clf_h.fit(X_tr_s, y_train)
    pred_h = clf_h.predict(X_te_s)
    acc = float(accuracy_score(y_test, pred_h))
    cm = confusion_matrix(y_test, pred_h, labels=list(range(6))).tolist()

    # Deploy model: fit on all rows (report holdout separately)
    scaler = StandardScaler()
    X_all_s = scaler.fit_transform(X_t)
    clf = LogisticRegression(solver="lbfgs", max_iter=4000, random_state=SEED, C=0.5)
    clf.fit(X_all_s, y)
    train_acc = float(accuracy_score(y, clf.predict(X_all_s)))

    payload = {
        "coefficients": clf.coef_.tolist(),
        "intercept": clf.intercept_.tolist(),
        "featureMean": scaler.mean_.tolist(),
        "featureStd": scaler.scale_.tolist(),
        "accuracy": acc,
        "trainAccuracy": train_acc,
        "confusion": cm,
        "categories": CATEGORIES,
        "nTrain": int(len(y_train)),
        "nHoldout": int(len(y_test)),
        "nDeploy": int(len(y)),
        "transform": "log1p",
        "source": "reports.csv + sklearn LogisticRegression seed=42",
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {OUT_PATH}")
    print(f"holdout accuracy: {acc:.4f}  (n_train={len(y_train)}, n_holdout={len(y_test)})")
    print(f"deploy train accuracy: {train_acc:.4f}  (n={len(y)})")
    print("confusion (rows=true, cols=pred):")
    print(np.array(cm))

    # Check the 3 demo emails under the deploy model
    ids = [r[2] for r in rows]
    for tid in ["de-cmp-01", "en-mtg-01", "en-pay-01"]:
        if tid not in ids:
            continue
        i = ids.index(tid)
        p = int(clf.predict(X_all_s[i : i + 1])[0])
        print(f"  demo {tid}: true={CATEGORIES[y[i]]} pred={CATEGORIES[p]}")


if __name__ == "__main__":
    main()
