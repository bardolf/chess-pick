from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Optional

import chess
import chess.engine


class EvalCache:
    """SQLite cache pro Stockfish analýzy.

    Schéma:
      eval_cache(fen, depth, pv_index, score_cp, mate_in, move_uci)
      PK = (fen, depth, pv_index)

    Jeden řádek = jedna varianta (pv_index 0 = nejlepší, 1 = druhý, ...).
    Pro pozici na hloubce D čteme všechny řádky a vrátíme prvních N podle multipv.
    """

    def __init__(self, db_path: Path, engine: chess.engine.SimpleEngine) -> None:
        self._engine = engine
        self._conn = sqlite3.connect(str(db_path))
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS eval_cache (
                fen TEXT NOT NULL,
                depth INTEGER NOT NULL,
                pv_index INTEGER NOT NULL,
                score_cp INTEGER,
                mate_in INTEGER,
                move_uci TEXT NOT NULL,
                PRIMARY KEY (fen, depth, pv_index)
            )
            """
        )
        self._conn.commit()
        self.hits = 0
        self.misses = 0

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> "EvalCache":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def analyse(
        self,
        board: chess.Board,
        *,
        depth: int,
        multipv: int = 1,
    ) -> list[chess.engine.InfoDict]:
        fen = board.fen()
        rows = self._conn.execute(
            "SELECT pv_index, score_cp, mate_in, move_uci "
            "FROM eval_cache WHERE fen=? AND depth=? ORDER BY pv_index",
            (fen, depth),
        ).fetchall()
        if len(rows) >= multipv:
            self.hits += 1
            return [_row_to_info(r, board.turn) for r in rows[:multipv]]

        self.misses += 1
        raw = self._engine.analyse(
            board, chess.engine.Limit(depth=depth), multipv=multipv
        )
        infos = raw if isinstance(raw, list) else [raw]
        self._conn.execute("DELETE FROM eval_cache WHERE fen=? AND depth=?", (fen, depth))
        self._conn.executemany(
            "INSERT INTO eval_cache(fen, depth, pv_index, score_cp, mate_in, move_uci) "
            "VALUES (?,?,?,?,?,?)",
            list(_rows_for_infos(fen, depth, infos)),
        )
        self._conn.commit()
        return infos


def _rows_for_infos(fen: str, depth: int, infos: list[chess.engine.InfoDict]):
    for idx, info in enumerate(infos):
        score = info.get("score")
        pv = info.get("pv", [])
        if score is None or not pv:
            continue
        rel = score.relative
        cp = None if rel.is_mate() else rel.score()
        mate = rel.mate() if rel.is_mate() else None
        yield (fen, depth, idx, cp, mate, pv[0].uci())


def _row_to_info(row, turn: chess.Color) -> chess.engine.InfoDict:
    _idx, score_cp, mate_in, move_uci = row
    if mate_in is not None:
        relative = chess.engine.Mate(mate_in)
    else:
        relative = chess.engine.Cp(score_cp)
    povscore = chess.engine.PovScore(relative, turn)
    return {"score": povscore, "pv": [chess.Move.from_uci(move_uci)]}


class ProcessedGames:
    """Sleduje partie, ze kterých už byl uživateli zobrazen kandidát.

    ID partie = `White|Black|Date|Event` — stabilní napříč běhy.
    """

    def __init__(self, db_path: Path) -> None:
        self._conn = sqlite3.connect(str(db_path))
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS processed_games (
                game_id TEXT PRIMARY KEY,
                processed_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            )
            """
        )
        self._conn.commit()
        self.ids: set[str] = {
            r[0] for r in self._conn.execute("SELECT game_id FROM processed_games").fetchall()
        }

    @staticmethod
    def game_id(game) -> str:
        h = game.headers
        return "|".join([
            h.get("White", "?"),
            h.get("Black", "?"),
            h.get("Date", "?"),
            h.get("Event", "?"),
        ])

    def is_processed(self, game) -> bool:
        return self.game_id(game) in self.ids

    def mark_processed(self, game) -> None:
        gid = self.game_id(game)
        if gid in self.ids:
            return
        self._conn.execute(
            "INSERT OR IGNORE INTO processed_games(game_id) VALUES (?)", (gid,)
        )
        self._conn.commit()
        self.ids.add(gid)

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> "ProcessedGames":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


class SeenStore:
    """Sleduje pozice, které už byly uživateli zobrazeny.

    Při startu načte všechny FENy do paměti (set) pro rychlou kontrolu.
    Po zobrazení nového kandidáta zavolat `mark_seen(fen)` — uloží do DB i do setu.
    """

    def __init__(self, db_path: Path) -> None:
        self._conn = sqlite3.connect(str(db_path))
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS seen_candidates (
                fen TEXT PRIMARY KEY,
                seen_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            )
            """
        )
        self._conn.commit()
        self.fens: set[str] = {
            r[0] for r in self._conn.execute("SELECT fen FROM seen_candidates").fetchall()
        }

    def is_seen(self, fen: str) -> bool:
        return fen in self.fens

    def mark_seen(self, fen: str) -> None:
        if fen in self.fens:
            return
        self._conn.execute(
            "INSERT OR IGNORE INTO seen_candidates(fen) VALUES (?)", (fen,)
        )
        self._conn.commit()
        self.fens.add(fen)

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> "SeenStore":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
