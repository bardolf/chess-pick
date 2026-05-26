from __future__ import annotations

import sqlite3
import time
from collections import deque
from pathlib import Path
from typing import Deque, Optional

import chess
import chess.engine


class EnginePerfTracker:
    """Sleduje výkon Stockfishe — kumulativně i v klouzavých oknech.

    Frontend tyto údaje zobrazuje při dlouhých analýzách, aby uživatel viděl
    jestli engine nezpomaluje (např. kvůli rostoucí transposition table nebo
    saturaci disku při SQLite zápisech).
    """

    # Klouzavá okna (v sekundách)
    WINDOWS: tuple[tuple[str, int], ...] = (
        ("1m", 60),
        ("5m", 300),
        ("30m", 1800),
        ("1h", 3600),
    )

    def __init__(self) -> None:
        # (timestamp, nodes, engine_time_s) — nejstarší vlevo
        self._samples: Deque[tuple[float, int, float]] = deque()
        self.total_nodes: int = 0
        self.total_positions: int = 0
        self.total_engine_time_s: float = 0.0
        self._started_at: float = time.time()

    def record(self, nodes: int, elapsed_s: float) -> None:
        if nodes <= 0 or elapsed_s <= 0:
            return
        now = time.time()
        self._samples.append((now, nodes, elapsed_s))
        self.total_nodes += nodes
        self.total_positions += 1
        self.total_engine_time_s += elapsed_s
        # Odřízneme cokoliv staršího než nejdelší okno
        max_window = self.WINDOWS[-1][1]
        cutoff = now - max_window
        while self._samples and self._samples[0][0] < cutoff:
            self._samples.popleft()

    def _window_nps(self, window_s: int) -> Optional[int]:
        """NPS = ∑ nodes / ∑ engine_time_s pro samples v posledních `window_s`
        sekundách (wall-clock). Tedy reálná rychlost enginu, ne efektivní
        propustnost včetně režie. Vrací None pokud máme příliš málo dat."""
        if not self._samples:
            return None
        now = time.time()
        cutoff = now - window_s
        in_window = [(n, e) for ts, n, e in self._samples if ts >= cutoff]
        if not in_window:
            return None
        total_nodes = sum(n for n, _ in in_window)
        total_time = sum(e for _, e in in_window)
        # Statisticky relevantní výsledek až po >= 3 vzorcích nebo > 1s engine času.
        if len(in_window) < 3 and total_time < 1.0:
            return None
        if total_time <= 0:
            return None
        return int(total_nodes / total_time)

    def snapshot(self) -> dict:
        return {
            "total_nodes": self.total_nodes,
            "total_positions": self.total_positions,
            "total_engine_time_s": round(self.total_engine_time_s, 2),
            "lifetime_nps": int(self.total_nodes / self.total_engine_time_s)
                            if self.total_engine_time_s > 0 else 0,
            "windows": {
                label: self._window_nps(seconds) for label, seconds in self.WINDOWS
            },
        }


class EvalCache:
    """SQLite cache pro Stockfish analýzy.

    Schéma:
      eval_cache(fen, depth, pv_index, score_cp, mate_in, move_uci)
      PK = (fen, depth, pv_index)

    Jeden řádek = jedna varianta (pv_index 0 = nejlepší, 1 = druhý, ...).
    Pro pozici na hloubce D čteme všechny řádky a vrátíme prvních N podle multipv.
    """

    # Po kolika engine missech commitnout. Vyšší = méně fsync overhead při
    # velkých runech, ale větší ztráta při crashi (znovuanalýza max N pozic).
    DEFAULT_COMMIT_EVERY = 50

    def __init__(
        self,
        db_path: Path,
        engine: chess.engine.SimpleEngine,
        perf: Optional[EnginePerfTracker] = None,
        commit_every: int = DEFAULT_COMMIT_EVERY,
    ) -> None:
        self._engine = engine
        self.perf = perf or EnginePerfTracker()
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
        self._commit_every = max(1, int(commit_every))
        self._uncommitted = 0

    def flush(self) -> None:
        """Commitne všechny pending zápisy (i pokud nebylo dosaženo `commit_every`)."""
        if self._uncommitted > 0:
            self._conn.commit()
            self._uncommitted = 0

    def close(self) -> None:
        try:
            self.flush()
        finally:
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
        t0 = time.time()
        raw = self._engine.analyse(
            board, chess.engine.Limit(depth=depth), multipv=multipv
        )
        elapsed = time.time() - t0
        infos = raw if isinstance(raw, list) else [raw]
        # `nodes` je celkový počet uzlů prohledaných enginem v tomto volání
        # (stejný napříč multipv variantami — bereme první).
        nodes = int(infos[0].get("nodes", 0)) if infos else 0
        self.perf.record(nodes, elapsed)
        self._conn.execute("DELETE FROM eval_cache WHERE fen=? AND depth=?", (fen, depth))
        self._conn.executemany(
            "INSERT INTO eval_cache(fen, depth, pv_index, score_cp, mate_in, move_uci) "
            "VALUES (?,?,?,?,?,?)",
            list(_rows_for_infos(fen, depth, infos)),
        )
        # Batchovaný commit — fsync jen každých N missů, jinak vidím
        # 0.5-1 ms fsync overhead na každou analyzovanou pozici.
        self._uncommitted += 1
        if self._uncommitted >= self._commit_every:
            self._conn.commit()
            self._uncommitted = 0
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
