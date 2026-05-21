from __future__ import annotations

import os
from pathlib import Path

import chess
import chess.engine


def _resolve_stockfish_path() -> Path:
    """Cesta ke Stockfish binárce. Priorita:
    1. env proměnná STOCKFISH_PATH
    2. cesta ./stockfish (relativně k projektu) nebo ./stockfish.exe na Windows
    3. linuxový default na vývojářském stroji
    """
    env = os.environ.get("STOCKFISH_PATH")
    if env:
        return Path(env)

    project_root = Path(__file__).resolve().parent
    candidates = [
        project_root / "stockfish.exe",
        project_root / "stockfish",
        Path("/home/milan/opt/stockfish/stockfish-ubuntu-x86-64-avx2"),
    ]
    for c in candidates:
        if c.exists():
            return c
    return candidates[-1]  # fallback (i kdyby neexistovala, chess.engine pak vrátí chybu)


STOCKFISH_PATH = _resolve_stockfish_path()


def evaluate_position(
    board: chess.Board,
    *,
    depth: int | None = 20,
    time_limit: float | None = None,
) -> chess.engine.InfoDict:
    """Ohodnotí pozici Stockfishem. Vrací info dict (score, pv, depth, ...).

    Použij buď `depth` (pevná hloubka), nebo `time_limit` (v sekundách).
    """
    if depth is None and time_limit is None:
        raise ValueError("Zadej depth nebo time_limit.")

    limit = chess.engine.Limit(depth=depth, time=time_limit)
    with chess.engine.SimpleEngine.popen_uci(str(STOCKFISH_PATH)) as engine:
        return engine.analyse(board, limit)


