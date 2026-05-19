"""Opening classifier postavený na Lichess chess-openings TSV souborech.

Při startu načte všechny TSV (data/eco/*.tsv), pro každý řádek zparsuje PGN tahy
a uloží výslednou pozici (EPD = placement + turn + castling + ep) do hashmapy.
Při klasifikaci partie iteruje její tahy a hledá nejhlubší pozici, která se
shoduje — vrátí ECO + jméno (případně varianty).

Nezávisí na PGN hlavičkách (ECO/Opening/Variation tagy v původním souboru
mohou být chybné/chybět).
"""

from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Optional

import chess
import chess.pgn


_MOVE_NUMBER_RE = re.compile(r"^\d+\.+$")
_RESULT_TOKENS = {"*", "1-0", "0-1", "1/2-1/2"}


class OpeningClassifier:
    def __init__(self, eco_dir: Path) -> None:
        self._table: dict[str, tuple[str, str]] = {}
        for tsv_path in sorted(eco_dir.glob("*.tsv")):
            with tsv_path.open(encoding="utf-8") as f:
                reader = csv.DictReader(f, delimiter="\t")
                for row in reader:
                    eco = (row.get("eco") or "").strip()
                    name = (row.get("name") or "").strip()
                    pgn_text = (row.get("pgn") or "").strip()
                    if not (eco and name and pgn_text):
                        continue
                    board = chess.Board()
                    ok = True
                    for token in pgn_text.split():
                        t = token.strip()
                        if not t or _MOVE_NUMBER_RE.match(t) or t in _RESULT_TOKENS:
                            continue
                        try:
                            move = board.parse_san(t)
                            board.push(move)
                        except Exception:
                            ok = False
                            break
                    if ok:
                        self._table[board.epd()] = (eco, name)

    def __len__(self) -> int:
        return len(self._table)

    def classify(self, game: chess.pgn.Game) -> Optional[tuple[str, str]]:
        """Vrátí (eco, name) z nejhlubší pozice, která se v partii shoduje.
        Pokud žádná pozice neshoduje, vrátí None.
        """
        board = game.board()
        best: Optional[tuple[str, str]] = self._table.get(board.epd())
        for move in game.mainline_moves():
            board.push(move)
            entry = self._table.get(board.epd())
            if entry is not None:
                best = entry
        return best
