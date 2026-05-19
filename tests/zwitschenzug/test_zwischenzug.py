"""Testy pro pravidlo `ZwischenzugAvailable`.

Každý test definuje vlastní PGN partii a asertuje, že pravidlo najde
očekávané pozice (mezitah-kandidáty). Cache z conftest.py držíme napříč
testy, takže opakované spuštění je rychlé.
"""

from __future__ import annotations

import io
from typing import Optional

import chess
import chess.pgn
import pytest

from filters import PositionContext, ZwischenzugAvailable

DEPTH = 18
MULTIPV = 3


def find_candidates(pgn_text: str, cache, rule=None) -> list[PositionContext]:
    """Projde mainline partie a vrátí všechny pozice, kde pravidlo fires."""
    if rule is None:
        rule = ZwischenzugAvailable()
    game = chess.pgn.read_game(io.StringIO(pgn_text))
    assert game is not None, "PGN se nepodařilo načíst"

    candidates: list[PositionContext] = []
    board = game.board()
    prev_move: Optional[chess.Move] = None
    prev_was_capture = False
    for move in game.mainline_moves():
        ctx = PositionContext(
            game, board, move, cache, DEPTH, multipv=MULTIPV,
            previous_move=prev_move,
            previous_was_capture=prev_was_capture,
        )
        if rule.match(ctx):
            candidates.append(ctx)
        prev_was_capture = board.is_capture(move)
        prev_move = move
        board.push(move)
    return candidates


def find_candidate_at(candidates, fullmove_number: int, player: chess.Color):
    """Vyhledá kandidáta na zadaném tahu + barvě (None pokud nenalezen)."""
    for c in candidates:
        if c.fullmove_number == fullmove_number and c.player == player:
            return c
    return None


# ---------------------------------------------------------------------------
# 1) Stanke – Storm (Regionalliga NordN 1990)
#    Očekáváno: pozice na 30. tahu (bílý), engine best Rd7+, hráč zahrál Kxg2
# ---------------------------------------------------------------------------

PGN_STANKE_STORM = """[Event "Regionalliga NordN"]
[Site "Germany"]
[Date "1990.??.??"]
[White "Juergen Stanke"]
[Black "Roland Storm"]
[Result "0-1"]

1.d4 d5 2.c4 c6 3.Nc3 f5 4.Nf3 e6 5.g3 Nf6 6.Bg2 Bd6 7.Bf4 O-O 8.e3 b6
9.Bxd6 Qxd6 10.Ne5 Nbd7 11.f4 a5 12.cxd5 exd5 13.O-O Bb7 14.Rc1 Rac8
15.Qd3 g6 16.Rfd1 Kg7 17.Nb1 Rfe8 18.Qa3 Qe6 19.Nd2 Nxe5 20.dxe5 Ne4
21.Bh3 Nxd2 22.Rxd2 Rc7 23.Rcd1 c5 24.Qb3 c4 25.Qc3 Rc5 26.e4 Rd8
27.Qc2 Rf8 28.exd5 Bxd5 29.Bg2 Bxg2 30.Kxg2 Qc6+ 31.Kh3 c3 32.Rd7+ Kh6
33.R1d6 Qf3 34.b3 b5 35.Rf6 Rxf6 36.exf6 Rc6 37.f7 Kg7 38.b4 a4
39.Rd3 Qe4 40.a3 Kxf7 41.Qa2+ Qc4 42.Qc2 Rc7 43.Re3 Qb3 44.Qc1 c2
45.Rxb3 axb3 46.Kh4 b2 47.Qxb2 c1=Q 48.Qh8 Qc3 0-1
"""


def _describe(candidates) -> str:
    return ", ".join(
        f"{c.fullmove_number}{'.' if c.player == chess.WHITE else '...'}"
        f"{c.board.san(c.played_move)}"
        for c in candidates
    ) or "(nic)"


def test_stanke_storm_finds_only_rd7_plus(cache):
    candidates = find_candidates(PGN_STANKE_STORM, cache)

    assert len(candidates) == 1, (
        f"Očekával jsem PRÁVĚ jednoho kandidáta (30. tah, Rd7+), "
        f"nalezeno {len(candidates)}: {_describe(candidates)}"
    )

    target = candidates[0]
    assert target.fullmove_number == 30 and target.player == chess.WHITE, (
        f"Kandidát měl být 30. tah bílého, je "
        f"{target.fullmove_number}{'.' if target.player == chess.WHITE else '...'}"
    )

    best_san = target.board.san(target.best_move())
    played_san = target.board.san(target.played_move)
    assert best_san == "Rd7+", f"Engine best měl být Rd7+, je {best_san}"
    assert played_san == "Kxg2", f"Hráč zahrál Kxg2, ne {played_san}"


# ---------------------------------------------------------------------------
# 2) Anand – Ponomariov (Corus Group A 2005)
#    Očekáváno: pouze pozice na 34. tahu (bílý), engine best Rf7+,
#    hráč v partii skutečně zahrál Rf7+ (nalezl mezitah).
# ---------------------------------------------------------------------------

PGN_ANAND_PONOMARIOV = """[Event "Corus Group A"]
[Site "Wijk aan Zee NED"]
[Date "2005.01.21"]
[White "Viswanathan Anand"]
[Black "Ruslan Ponomariov"]
[Result "1-0"]

1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6 6.f3 Qb6 7.Nb3 e6 8.Bf4
Nbd7 9.g4 Be7 10.Qe2 h6 11.h4 Qc7 12.O-O-O b5 13.a3 Rb8 14.Qg2 Nc5 15.g5 Nh5
16.Be3 Na4 17.Rd3 g6 18.Kb1 Bb7 19.Be2 e5 20.Qf2 Bc6 21.gxh6 Nb6 22.f4 Nf6 23.fxe5
dxe5 24.Rf1 O-O 25.Nc5 Bb7 26.Ne6 fxe6 27.Bxb6 Qc6 28.Qg1 Kh7 29.Rdf3 Qe8 30.Bc5 Bxc5
31.Qxc5 Nd7 32.Qe3 Qe7 33.Qg5 Qxg5 34.Rf7+ Rxf7 35.Rxf7+ Kh8 36.hxg5 Bc6 37.b4 Nf8 38.Rf6
Kg8 39.Bg4 Bd7 40.Kb2 Re8 41.Nd1 Re7 42.Nf2 Be8 43.Rf3 Rf7 44.Rxf7 Kxf7 45.Kc3 Nh7
46.Nh3 Bc6 47.Kd3 Ke7 48.Ke3 Kd6 49.Be2 Ke7 50.Bd3 Kd6 51.Kf3 Ke7 52.Kg4 Nf8 53.Ng1
Nh7 54.Nf3 Kd6 55.Kg3 Be8 56.Kf2 Bc6 57.Ke3 Bd7 58.c4 bxc4 59.Bxc4 Bc8 60.a4 Bb7
61.a5 Bc8 62.Bd3 1-0
"""


def test_anand_ponomariov_finds_only_rf7_plus(cache):
    candidates = find_candidates(PGN_ANAND_PONOMARIOV, cache)

    assert len(candidates) == 1, (
        f"Očekával jsem PRÁVĚ jednoho kandidáta (34. tah, Rf7+), "
        f"nalezeno {len(candidates)}: {_describe(candidates)}"
    )

    target = candidates[0]
    assert target.fullmove_number == 34 and target.player == chess.WHITE, (
        f"Kandidát měl být 34. tah bílého, je "
        f"{target.fullmove_number}{'.' if target.player == chess.WHITE else '...'}"
    )

    best_san = target.board.san(target.best_move())
    played_san = target.board.san(target.played_move)
    assert best_san == "Rf7+", f"Engine best měl být Rf7+, je {best_san}"
    assert played_san == "Rf7+", f"Hráč zahrál Rf7+, ne {played_san}"


# ---------------------------------------------------------------------------
# 3) Paehtz – Vasilevich (World Junior Girls 2005)
#    Očekáváno: pouze pozice na 32. tahu (bílý), engine best Qh7+,
#    hráč v partii zahrál Qh7+ (nalezl mezitah).
# ---------------------------------------------------------------------------

PGN_PAEHTZ_VASILEVICH = """[Event "World Junior Championship (Girls)"]
[Site "Istanbul TUR"]
[Date "2005.11.20"]
[White "Elisabeth Paehtz"]
[Black "Irina Vasilevich"]
[Result "1-0"]

1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 5. Nc3 a6
6. Be3 Nf6 7. Be2 Qc7 8. O-O Bb4 9. Na4 O-O 10. c4 Bd6
11. Nxc6 bxc6 12. g3 Nxe4 13. c5 Be7 14. Bd3 Nf6 15. Bf4 Qd8
16. Nb6 Ra7 17. Qe2 h6 18. b4 Nd5 19. Nxd5 cxd5 20. a4 Bf6
21. Rac1 Re8 22. Bd6 Bb7 23. f4 Ra8 24. Rce1 Qc8 25. Qh5 Bd4+
26. Kg2 Bc3 27. Re2 d4+ 28. Kh3 f5 29. g4 Qd8 30. gxf5 exf5
31. Qxf5 Rxe2 32. Qh7+ Kf7 33. Bxe2 d3 34. Bh5+ Ke6 35. Qxd3 1-0
"""


def test_paehtz_vasilevich_finds_only_qh7_plus(cache):
    candidates = find_candidates(PGN_PAEHTZ_VASILEVICH, cache)

    assert len(candidates) == 1, (
        f"Očekával jsem PRÁVĚ jednoho kandidáta (32. tah, Qh7+), "
        f"nalezeno {len(candidates)}: {_describe(candidates)}"
    )

    target = candidates[0]
    assert target.fullmove_number == 32 and target.player == chess.WHITE, (
        f"Kandidát měl být 32. tah bílého, je "
        f"{target.fullmove_number}{'.' if target.player == chess.WHITE else '...'}"
    )

    best_san = target.board.san(target.best_move())
    played_san = target.board.san(target.played_move)
    assert best_san == "Qh7+", f"Engine best měl být Qh7+, je {best_san}"
    assert played_san == "Qh7+", f"Hráč zahrál Qh7+, ne {played_san}"


# ---------------------------------------------------------------------------
# 4) Kholmov – Golz (Dresden 1956)
#    Očekáváno: pouze pozice na 21. tahu (bílý), engine best Nxf6+,
#    hráč v partii zahrál Nxf6+ (mezitah místo dobírání dámy fxg3).
# ---------------------------------------------------------------------------

PGN_KHOLMOV_GOLZ = """[Event "Dresden it"]
[Site "Dresden GDR"]
[Date "1956.03.??"]
[White "Ratmir Kholmov"]
[Black "Werner Golz"]
[Result "1-0"]

1. c4 e6 2. Nc3 d5 3. d4 Nf6 4. Bg5 Be7 5. e3 O-O
6. Nf3 Nbd7 7. Rc1 c6 8. Bd3 dxc4 9. Bxc4 Nd5 10. Bxe7 Qxe7
11. O-O Nxc3 12. Rxc3 e5 13. Qc2 exd4 14. exd4 Nf6 15. Re1 Qd6
16. Ng5 Bg4 17. Rg3 g6 18. h3 Bf5 19. Qxf5 gxf5 20. Ne4+ Qxg3
21. Nxf6+ Kh8 22. fxg3 Rad8 23. Re7 Rxd4 24. Bxf7 Rd6 25. Nh5 b5
26. g4 fxg4 27. hxg4 Rd4 28. Be6 Rd1+ 29. Kh2 Rd4 30. Nf6 1-0
"""


def test_kholmov_golz_finds_only_nxf6_plus(cache):
    candidates = find_candidates(PGN_KHOLMOV_GOLZ, cache)

    assert len(candidates) == 1, (
        f"Očekával jsem PRÁVĚ jednoho kandidáta (21. tah, Nxf6+), "
        f"nalezeno {len(candidates)}: {_describe(candidates)}"
    )

    target = candidates[0]
    assert target.fullmove_number == 21 and target.player == chess.WHITE, (
        f"Kandidát měl být 21. tah bílého, je "
        f"{target.fullmove_number}{'.' if target.player == chess.WHITE else '...'}"
    )

    best_san = target.board.san(target.best_move())
    played_san = target.board.san(target.played_move)
    assert best_san == "Nxf6+", f"Engine best měl být Nxf6+, je {best_san}"
    assert played_san == "Nxf6+", f"Hráč zahrál Nxf6+, ne {played_san}"
