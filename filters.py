from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Iterable, Iterator, Optional, Protocol

import chess
import chess.engine
import chess.pgn

MATE_SCORE = 10_000


def _parse_int(value) -> Optional[int]:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


class PositionContext:
    """Snapshot pozice před zahraným tahem + cache pro Stockfish dotazy.

    Engine se vyhodnocuje líně — když žádný filtr nesáhne na score/best_move,
    žádný analyse() se nezavolá.
    """

    def __init__(
        self,
        game: chess.pgn.Game,
        board_before: chess.Board,
        played_move: chess.Move,
        analyser,
        depth: int,
        multipv: int = 3,
        previous_move: Optional[chess.Move] = None,
        previous_was_capture: bool = False,
    ) -> None:
        self.game = game
        self.board = board_before.copy()
        self.played_move = played_move
        self.previous_move = previous_move
        self.previous_was_capture = previous_was_capture
        self._analyser = analyser
        self._depth = depth
        self._multipv = multipv
        self._infos_before: Optional[list[chess.engine.InfoDict]] = None
        self._info_after: Optional[chess.engine.InfoDict] = None

    @property
    def player(self) -> chess.Color:
        return self.board.turn

    @property
    def fullmove_number(self) -> int:
        return self.board.fullmove_number

    @property
    def white_elo(self) -> Optional[int]:
        return _parse_int(self.game.headers.get("WhiteElo"))

    @property
    def black_elo(self) -> Optional[int]:
        return _parse_int(self.game.headers.get("BlackElo"))

    def analyse_before(self) -> list[chess.engine.InfoDict]:
        if self._infos_before is None:
            self._infos_before = self._analyser.analyse(
                self.board, depth=self._depth, multipv=self._multipv
            )
        return self._infos_before

    def analyse_after_played(self) -> chess.engine.InfoDict:
        if self._info_after is None:
            board_after = self.board.copy()
            board_after.push(self.played_move)
            infos = self._analyser.analyse(
                board_after, depth=self._depth, multipv=1
            )
            self._info_after = infos[0]
        return self._info_after

    def best_info(self) -> chess.engine.InfoDict:
        return self.analyse_before()[0]

    def best_move(self) -> Optional[chess.Move]:
        pv = self.best_info().get("pv", [])
        return pv[0] if pv else None

    def cp_before(self) -> int:
        return self.best_info()["score"].pov(self.player).score(mate_score=MATE_SCORE)

    def cp_after_played(self) -> int:
        return self.analyse_after_played()["score"].pov(self.player).score(mate_score=MATE_SCORE)

    def cp_loss(self) -> int:
        return self.cp_before() - self.cp_after_played()

    def acceptable_first_moves(self, tolerance_cp: int) -> list[chess.Move]:
        """Tahy z multipv, jejichž hodnocení je do `tolerance_cp` od nejlepšího."""
        best_cp = self.cp_before()
        cutoff = best_cp - tolerance_cp
        out: list[chess.Move] = []
        for info in self.analyse_before():
            pv = info.get("pv", [])
            if not pv:
                continue
            cp = info["score"].pov(self.player).score(mate_score=MATE_SCORE)
            if cp >= cutoff:
                out.append(pv[0])
        return out

    def best_recapture(self, target_square: int) -> Optional[tuple[chess.Move, int]]:
        """Vrátí (nejlepší rekapitulace na target_square, její cp z pohledu hráče).

        Hledá nejdřív mezi multipv variantami; pokud rekapitulace tam není,
        zvlášť ji analyzuje. Vrací None, pokud žádná legální rekapitulace neexistuje.
        """
        recap_moves = [
            m for m in self.board.legal_moves
            if m.to_square == target_square and self.board.is_capture(m)
        ]
        if not recap_moves:
            return None

        best_pair: Optional[tuple[chess.Move, int]] = None
        for info in self.analyse_before():
            pv = info.get("pv", [])
            if pv and pv[0] in recap_moves:
                cp = info["score"].pov(self.player).score(mate_score=MATE_SCORE)
                if best_pair is None or cp > best_pair[1]:
                    best_pair = (pv[0], cp)
        if best_pair is not None:
            return best_pair

        # rekapitulace nebyla v top-multipv → analyzuj každou zvlášť
        for m in recap_moves:
            board_after = self.board.copy()
            board_after.push(m)
            infos = self._analyser.analyse(board_after, depth=self._depth, multipv=1)
            cp = infos[0]["score"].pov(self.player).score(mate_score=MATE_SCORE)
            if best_pair is None or cp > best_pair[1]:
                best_pair = (m, cp)
        return best_pair


class GameRule(Protocol):
    """Levný filtr — rozhoduje z PGN hlaviček, neotvírá engine."""
    def match(self, game: chess.pgn.Game) -> bool: ...


class PositionRule(Protocol):
    """Filtr nad konkrétní pozicí. Smí (ale nemusí) sahat na engine přes ctx."""
    def match(self, ctx: PositionContext) -> bool: ...


@dataclass
class OpeningPositionMatches:
    """GameRule: během prvních max_ply půltahů musí pozice projít zadaným FEN.

    Porovnává jen piece placement + side to move (ignoruje halfmove/fullmove
    a počty tahů), takže různé transpozice ke stejné pozici matchnou.

    Příklad — Nimzo po 3...Bb4 (jakákoliv transpozice):
        OpeningPositionMatches("rnbqk2r/pppp1ppp/4pn2/8/1bPP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 1")
    """
    fen: str
    max_ply: int = 30

    def __post_init__(self):
        parts = self.fen.split()
        self._target_placement = parts[0]
        self._target_turn = parts[1] if len(parts) > 1 else "w"

    def match(self, game: chess.pgn.Game) -> bool:
        board = game.board()
        if self._matches(board):
            return True
        ply = 0
        for move in game.mainline_moves():
            board.push(move)
            ply += 1
            if self._matches(board):
                return True
            if ply >= self.max_ply:
                return False
        return False

    def _matches(self, board: chess.Board) -> bool:
        parts = board.fen().split()
        return parts[0] == self._target_placement and parts[1] == self._target_turn


@dataclass
class PawnStructureMatches:
    """PositionRule: na šachovnici jsou všechny pěšce ze zadaného FEN.

    Z FEN se extrahují pozice bílých i černých pěšců a vyžadují se na daných
    čtvercích. Další pěšce a figury kdekoliv. Subset match.

    Příklad — Nimzo c3/c4/d4 centrum:
        PawnStructureMatches("8/8/8/8/2PP4/2P5/8/8 w - - 0 1")
    """
    fen: str

    def __post_init__(self):
        board = chess.Board(self.fen)
        self._required: list[tuple[int, chess.Color]] = []
        for sq in chess.SQUARES:
            piece = board.piece_at(sq)
            if piece is not None and piece.piece_type == chess.PAWN:
                self._required.append((sq, piece.color))

    def match(self, ctx: "PositionContext") -> bool:
        for sq, color in self._required:
            p = ctx.board.piece_at(sq)
            if p is None or p.piece_type != chess.PAWN or p.color != color:
                return False
        return True


@dataclass
class NotYetProcessedGame:
    """GameRule: přeskočí partii, jejíž ID je v `processed_ids`."""
    processed_ids: set
    game_id_fn: Callable[[chess.pgn.Game], str]

    def match(self, game: chess.pgn.Game) -> bool:
        return self.game_id_fn(game) not in self.processed_ids


@dataclass
class MinElo:
    threshold: int = 2500
    both: bool = True

    def match(self, game: chess.pgn.Game) -> bool:
        we = _parse_int(game.headers.get("WhiteElo"))
        be = _parse_int(game.headers.get("BlackElo"))
        if we is None or be is None:
            return False
        if self.both:
            return we >= self.threshold and be >= self.threshold
        return we >= self.threshold or be >= self.threshold


@dataclass
class FromMoveNumber:
    threshold: int = 10

    def match(self, ctx: PositionContext) -> bool:
        return ctx.fullmove_number >= self.threshold


@dataclass
class UntilMoveNumber:
    """PositionRule: fires jen pokud je `fullmove_number <= threshold`."""
    threshold: int = 10

    def match(self, ctx: PositionContext) -> bool:
        return ctx.fullmove_number <= self.threshold


@dataclass
class NotYetSeen:
    """Přeskoč pozici, jejíž FEN je v `seen_fens` (= uživatel ji už viděl)."""
    seen_fens: set

    def match(self, ctx: PositionContext) -> bool:
        return ctx.board.fen() not in self.seen_fens


@dataclass
class PositionEvalInRange:
    """Hodnocení pozice (z bílého pohledu) v rozsahu [min_cp, max_cp]. Mat = vyřazeno."""
    min_cp: int = -100
    max_cp: int = 100

    def match(self, ctx: PositionContext) -> bool:
        score = ctx.best_info()["score"].white()
        if score.is_mate():
            return False
        cp = score.score()
        return cp is not None and self.min_cp <= cp <= self.max_cp


@dataclass
class PlayedMoveLossAtLeast:
    """Zahraný tah je o ≥ min_loss_cp centipawnů horší než nejlepší tah.
    Tahy do tie_tolerance_cp od nejlepšího jsou považovány za rovnocenné a hráč
    není ve „chybě", pokud zahrál kterýkoliv z nich.
    """
    min_loss_cp: int = 100
    tie_tolerance_cp: int = 20

    def match(self, ctx: PositionContext) -> bool:
        if ctx.played_move in ctx.acceptable_first_moves(self.tie_tolerance_cp):
            return False
        return ctx.cp_loss() >= self.min_loss_cp


@dataclass
class ZwischenzugAvailable:
    """Tréninková pozice: po soupeřově braní engine doporučuje non-recapture,
    a rozdíl oproti nejlepší rekapitulaci je ≥ min_gain_cp.

    Nezávisí na tom, jaký tah hráč skutečně zahrál — pozice je k řešení
    bez ohledu na původní průběh partie.

    `require_check_or_capture`: mezitah musí být šach nebo branný. Odfiltruje
    případy, kdy je „rekapitulace" jen ztráta materiálu pro nedostatečnou
    obranu (engine doporučí klidný vývinový tah). Pro klasické taktické
    mezitahy (zwischenzug = šach / vzetí jiné figury) ponechej True.
    """
    min_gain_cp: int = 100        # min gap pro NE-šach capture (kde gap dává smysl)
    require_check_or_capture: bool = True
    min_player_cp: int = -100     # hráč nesmí být po mezitahu pod tuhle hodnotu
    check_skips_gap: bool = True  # pokud je best šach, ignoruj gap (vždy zwischenzug)

    def match(self, ctx: PositionContext) -> bool:
        prev = ctx.previous_move
        if prev is None or not ctx.previous_was_capture:
            return False

        best = ctx.best_move()
        if best is None or best.to_square == prev.to_square:
            return False

        is_check = ctx.board.gives_check(best)
        is_capture = ctx.board.is_capture(best)
        if self.require_check_or_capture and not (is_check or is_capture):
            return False

        best_cp = ctx.cp_before()
        if best_cp < self.min_player_cp:
            return False

        recap = ctx.best_recapture(prev.to_square)
        if recap is None:
            return False
        recap_cp = recap[1]

        # mate-vs-mate stejným směrem: i malý rozdíl v délce matu je významný
        if (best_cp > 9000 and recap_cp > 9000) or (best_cp < -9000 and recap_cp < -9000):
            return best_cp > recap_cp

        # šach po braní = klasický zwischenzug vzor, nezáleží na velikosti gapu
        if is_check and self.check_skips_gap:
            return True

        gap = best_cp - recap_cp
        return gap >= self.min_gain_cp


@dataclass
class MissedZwischenzug:
    """Hráč automaticky dobral figurku, ale lepší byl mezitah / tichý tah.

    Vzor:
      1. Soupeřův poslední tah byl branný (vzal figurku na čtverci X).
      2. Hráč v této pozici zahrál rekapitulaci — capture na stejný čtverec X.
      3. Nejlepší tah podle Stockfishe NENÍ tato rekapitulace.
      4. Ztráta rekapitulace oproti nejlepšímu ≥ min_loss_cp.
    """
    min_loss_cp: int = 100

    def match(self, ctx: PositionContext) -> bool:
        prev = ctx.previous_move
        if prev is None or not ctx.previous_was_capture:
            return False

        played = ctx.played_move
        if played.to_square != prev.to_square:
            return False
        if not ctx.board.is_capture(played):
            return False

        best = ctx.best_move()
        if best is None or best.to_square == prev.to_square:
            return False

        return ctx.cp_loss() >= self.min_loss_cp


def find_positions(
    games: Iterable[chess.pgn.Game],
    analyser,
    game_rules: list[GameRule],
    position_rules: list[PositionRule],
    depth: int = 16,
    multipv: int = 3,
    limit: Optional[int] = None,
    max_per_game: Optional[int] = None,
    verbose: bool = True,
) -> Iterator[PositionContext]:
    yielded = 0
    games_analyzed = 0
    for game in games:
        if not all(r.match(game) for r in game_rules):
            continue
        games_analyzed += 1
        h = game.headers
        hits_before = getattr(analyser, "hits", 0)
        misses_before = getattr(analyser, "misses", 0)
        if verbose:
            print(
                f"[{games_analyzed:4d}] {h.get('White','?')} vs {h.get('Black','?')}",
                flush=True,
            )
        board = game.board()
        from_this_game = 0
        prev_move: Optional[chess.Move] = None
        prev_was_capture = False
        for move in game.mainline_moves():
            ctx = PositionContext(
                game,
                board,
                move,
                analyser,
                depth,
                multipv=multipv,
                previous_move=prev_move,
                previous_was_capture=prev_was_capture,
            )
            if all(r.match(ctx) for r in position_rules):
                yield ctx
                yielded += 1
                from_this_game += 1
                if limit is not None and yielded >= limit:
                    return
                if max_per_game is not None and from_this_game >= max_per_game:
                    break
            prev_was_capture = board.is_capture(move)
            prev_move = move
            board.push(move)
        hits = getattr(analyser, "hits", 0) - hits_before
        misses = getattr(analyser, "misses", 0) - misses_before
        if verbose:
            print(
                f"        cache: {hits}h / {misses}m, {from_this_game} kandid.",
                flush=True,
            )
