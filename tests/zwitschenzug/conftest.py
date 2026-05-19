"""Fixtures pro zwischenzug testy.

Engine i cache jsou session-scope — všechny testy v této složce sdílí jeden
Stockfish proces a jednu SQLite cache (`.cache/eval_cache.db`). Cache přežívá
mezi běhy testů, takže opakované spuštění je rychlé.
"""

from __future__ import annotations

from pathlib import Path

import chess.engine
import pytest

from cache import EvalCache
from evaluate import STOCKFISH_PATH

CACHE_DB = Path(__file__).parent / "eval_cache.db"

STOCKFISH_THREADS = 2
STOCKFISH_HASH_MB = 512


@pytest.fixture(scope="session")
def engine():
    with chess.engine.SimpleEngine.popen_uci(str(STOCKFISH_PATH)) as e:
        e.configure({"Threads": STOCKFISH_THREADS, "Hash": STOCKFISH_HASH_MB})
        yield e


@pytest.fixture(scope="session")
def cache(engine):
    with EvalCache(CACHE_DB, engine) as c:
        yield c
