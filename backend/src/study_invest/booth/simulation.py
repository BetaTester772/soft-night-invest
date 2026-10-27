"""Reproducible full-session simulation using the actual ORM/pricing/fund engine.

Run: python -m study_invest.booth.simulation --paths 25 --seed 42
Each path has its own disposable in-memory DB. No production database is opened.
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from ..db import Base
from ..params import INITIAL_CASH
from .accounts import ensure_rounds, model_assets
from .domain import FUNDS
from .market import freeze, open_round, tick


def quantile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int((len(ordered) - 1) * p))]


def simulate(paths: int = 25, seed: int = 42) -> dict[str, Any]:
    result: dict[str, Any] = {"paths_per_round": paths, "seed": seed, "rounds": []}
    for number in (1, 2, 3):
        returns: dict[str, list[float]] = {c: [] for c in FUNDS}
        for path in range(paths):
            engine = create_engine("sqlite://")
            Base.metadata.create_all(engine)
            with Session(engine) as s:
                row = ensure_rounds(s, date(2026, 10, 30))[number - 1]
                open_round(s, row, seed=f"{seed}:{number}:{path}")
                for n in range(1, 301):
                    tick(s, row, n)
                freeze(s, row, row.closes_at)
                for code, assets in model_assets(s, row).items():
                    returns[code].append((assets - INITIAL_CASH) / INITIAL_CASH)
            engine.dispose()
        result["rounds"].append(
            {
                "round": number,
                "funds": {
                    code: {
                        "min": min(values),
                        "p05": quantile(values, 0.05),
                        "median": quantile(values, 0.5),
                        "p95": quantile(values, 0.95),
                        "max": max(values),
                        "positive_fraction": sum(v > 0 for v in values) / len(values),
                    }
                    for code, values in returns.items()
                },
            }
        )
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--paths", type=int, default=25)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if not 1 <= args.paths <= 1000:
        parser.error("--paths must be in [1, 1000]")
    print(json.dumps(simulate(args.paths, args.seed), ensure_ascii=False, indent=2))
