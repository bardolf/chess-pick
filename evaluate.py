from __future__ import annotations

from pathlib import Path

import chess
import chess.engine

STOCKFISH_PATH = Path("/home/milan/opt/stockfish/stockfish-ubuntu-x86-64-avx2")


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


