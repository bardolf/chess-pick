from __future__ import annotations

import os
from pathlib import Path

import chess
import chess.engine


def _resolve_stockfish_path() -> Path:
    """Cesta ke Stockfish binárce. Priorita:
    1. env proměnná STOCKFISH_PATH
    2. ./stockfish[.exe] v kořeni projektu (přesný název)
    3. ./stockfish*[.exe] v kořeni nebo bezprostřední podsložce
       (chytí např. stockfish-windows-x86-64-avx2.exe)
    4. linuxový default na vývojářském stroji
    """
    env = os.environ.get("STOCKFISH_PATH")
    if env:
        return Path(env)

    project_root = Path(__file__).resolve().parent

    # 1) přesný název
    for name in ("stockfish.exe", "stockfish"):
        p = project_root / name
        if p.is_file():
            return p

    # 2) glob na varianty (stockfish-windows-x86-64-avx2.exe apod.),
    #    v rootu i v jedné úrovni podsložek
    patterns = [
        "stockfish*.exe",
        "stockfish*/stockfish*.exe",
        "stockfish-*",
        "stockfish*/stockfish-*",
    ]
    for pat in patterns:
        for p in sorted(project_root.glob(pat)):
            if p.is_file():
                return p

    # 3) linuxový dev default
    linux_default = Path("/home/milan/opt/stockfish/stockfish-ubuntu-x86-64-avx2")
    if linux_default.is_file():
        return linux_default

    # fallback — engine.popen_uci pak vrátí čitelnější chybu než my zde
    return project_root / "stockfish.exe"


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


