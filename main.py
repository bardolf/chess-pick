from __future__ import annotations

from pathlib import Path
from typing import Iterator

import chess
import chess.engine
import chess.pgn

from cache import EvalCache, ProcessedGames, SeenStore
from evaluate import STOCKFISH_PATH
from filters import (
    FromMoveNumber,
    MinElo,
    MissedZwischenzug,
    NotYetProcessedGame,
    NotYetSeen,
    PlayedMoveLossAtLeast,
    PositionContext,
    PositionEvalInRange,
    ZwischenzugAvailable,
    find_positions,
)

TWIC_DIR = Path(__file__).parent / "twic"
EVAL_DB = Path(__file__).parent / "eval_cache.db"
TIE_TOLERANCE_CP = 20
STOCKFISH_THREADS = 8
STOCKFISH_HASH_MB = 4096

# Předvolby hledání — toggle změnou SEARCH_MODE.
SEARCH_MODE = "zwischenzug_available"  # "blunder" | "zwischenzug" | "zwischenzug_available"

# TEST_MODE: vypne Elo gate + balanced-eval gate, ať projdou ručně připravené partie
# bez Elo a v libovolné fázi. Pro běh nad TWIC nech False.
TEST_MODE = False

SEARCHES = {
    "blunder": [
        FromMoveNumber(threshold=10),
        PositionEvalInRange(min_cp=-100, max_cp=100),
        PlayedMoveLossAtLeast(min_loss_cp=100, tie_tolerance_cp=TIE_TOLERANCE_CP),
    ],
    "zwischenzug": [
        FromMoveNumber(threshold=10),
        PositionEvalInRange(min_cp=-100, max_cp=100),
        MissedZwischenzug(min_loss_cp=100),
    ],
    "zwischenzug_available": [
        FromMoveNumber(threshold=10),
        PositionEvalInRange(min_cp=-100, max_cp=100),
        ZwischenzugAvailable(min_gain_cp=100),
    ],
}


def iter_games(pgn_dir: Path) -> Iterator[chess.pgn.Game]:
    for pgn_path in sorted(pgn_dir.glob("*.pgn")):
        with pgn_path.open(encoding="utf-8", errors="replace") as fh:
            while True:
                game = chess.pgn.read_game(fh)
                if game is None:
                    break
                yield game


def format_header(index: int, game: chess.pgn.Game) -> str:
    h = game.headers
    white = h.get("White", "?")
    black = h.get("Black", "?")
    result = h.get("Result", "*")
    event = h.get("Event", "")
    year = h.get("Date", "").split(".")[0]
    if year and year in event:
        event = event.replace(year, "").strip(" ,-")
    label = ", ".join(p for p in (event, year) if p) or "?"
    return f"{index:5d}. {white} - {black}  {result}  [{label}]"


def format_moves(game: chess.pgn.Game) -> str:
    board = game.board()
    tokens: list[str] = []
    for move in game.mainline_moves():
        if board.turn == chess.WHITE:
            tokens.append(f"{board.fullmove_number}.")
        tokens.append(board.san(move))
        board.push(move)
    return " ".join(tokens)


def print_candidate(i: int, ctx: PositionContext) -> None:
    h = ctx.game.headers
    side = "Bílý" if ctx.player == chess.WHITE else "Černý"
    played_san = ctx.board.san(ctx.played_move)
    best_moves = ctx.acceptable_first_moves(TIE_TOLERANCE_CP)
    best_sans = [ctx.board.san(m) for m in best_moves] if best_moves else ["?"]

    sign = 1 if ctx.player == chess.WHITE else -1
    best_white = sign * ctx.cp_before()
    played_white = sign * ctx.cp_after_played()

    prev_to = ctx.previous_move.to_square if ctx.previous_move else None
    is_recapture = (
        prev_to is not None
        and ctx.played_move.to_square == prev_to
        and ctx.board.is_capture(ctx.played_move)
    )

    recap_san = "?"
    recap_white_str = "?"
    gap_str = ""
    if prev_to is not None:
        recap = ctx.best_recapture(prev_to)
        if recap is not None:
            recap_move, recap_cp = recap
            recap_san = ctx.board.san(recap_move)
            recap_white = sign * recap_cp
            recap_white_str = f"{recap_white/100:+.2f}"
            gap = ctx.cp_before() - recap_cp
            gap_str = f"{gap/100:+.2f}"

    event = h.get("Event", "")
    year = h.get("Date", "").split(".")[0]
    if year and year in event:
        event = event.replace(year, "").strip(" ,-")
    label = ", ".join(p for p in (event, year) if p) or "?"

    sq = chess.square_name(prev_to) if prev_to is not None else "?"
    if is_recapture:
        played_tag = "✗ rekapituloval (přehlédl mezitah)"
    elif ctx.played_move in best_moves:
        played_tag = "✓ zahrál mezitah"
    else:
        played_tag = "○ jiný tah (ne rekapitulace, ale ani engine best)"

    print(f"\n=== Kandidát #{i} ===")
    print(f"  Partie:  {h.get('White','?')} ({h.get('WhiteElo','?')})"
          f" – {h.get('Black','?')} ({h.get('BlackElo','?')})   [{label}]")
    print(f"  FEN:     {ctx.board.fen()}")
    print(f"  Na tahu: {side}  (tah č. {ctx.fullmove_number}, soupeř bral na {sq})")
    print()
    print(f"  ► Mezitah (engine):              {' / '.join(best_sans)}")
    print(f"      hodnocení po tomto tahu:     {best_white/100:+.2f}  (z bílého)")
    print()
    print(f"  ► Rekapitulace (zřejmý tah):     {recap_san}")
    print(f"      hodnocení po tomto tahu:     {recap_white_str}  (z bílého)")
    print()
    print(f"  Rozdíl mezitah vs rekapitulace:  {gap_str} pěšce")
    print()
    print(f"  Hráč skutečně zahrál:            {played_san}  [{played_tag}]")
    print(f"      hodnocení po tomto tahu:     {played_white/100:+.2f}  (z bílého)")


def main() -> None:
    if not TWIC_DIR.is_dir():
        raise SystemExit(f"Directory not found: {TWIC_DIR}")

    game_rules = [] if TEST_MODE else [MinElo(threshold=2500, both=True)]
    position_rules = [
        r for r in SEARCHES[SEARCH_MODE]
        if not (TEST_MODE and isinstance(r, PositionEvalInRange))
    ]
    depth = 18
    multipv = 3
    limit = None
    max_per_game = None

    with SeenStore(EVAL_DB) as seen, ProcessedGames(EVAL_DB) as processed:
        if TEST_MODE:
            game_rules = game_rules + [NotYetProcessedGame(processed.ids, ProcessedGames.game_id)]
            tracker_info = f"test mód = per-partie ({len(processed.ids)} už hotových)"
        else:
            position_rules = [NotYetSeen(seen.fens)] + position_rules
            tracker_info = f"už zobrazeno={len(seen.fens)}"
        limit_str = "VŠECHNY" if limit is None else f"prvních {limit}"
        print(
            f"Hledám {limit_str} kandidátů, mód={SEARCH_MODE!r} "
            f"(depth={depth}, multipv={multipv}, threads={STOCKFISH_THREADS}, "
            f"hash={STOCKFISH_HASH_MB}MB, cache={EVAL_DB.name}, "
            f"{tracker_info})..."
        )
        with chess.engine.SimpleEngine.popen_uci(str(STOCKFISH_PATH)) as engine:
            engine.configure({"Threads": STOCKFISH_THREADS, "Hash": STOCKFISH_HASH_MB})
            with EvalCache(EVAL_DB, engine) as cache:
                if TEST_MODE:
                    process_one_test_game(
                        cache, game_rules, position_rules,
                        depth, multipv, processed,
                    )
                else:
                    for i, ctx in enumerate(
                        find_positions(
                            iter_games(TWIC_DIR),
                            cache,
                            game_rules,
                            position_rules,
                            depth=depth,
                            multipv=multipv,
                            limit=limit,
                            max_per_game=max_per_game,
                        ),
                        start=1,
                    ):
                        print_candidate(i, ctx)
                        seen.mark_seen(ctx.board.fen())
                print(f"\nCache: {cache.hits} hits, {cache.misses} misses")


def process_one_test_game(cache, game_rules, position_rules, depth, multipv, processed):
    """V test módu: najdi další neprocesovanou partii, najdi v ní kandidáta
    (nebo nahlas, že není), označ partii jako hotovou."""
    target = None
    for game in iter_games(TWIC_DIR):
        if all(r.match(game) for r in game_rules):
            target = game
            break

    if target is None:
        print("\nVšechny testovací partie už projité. Dáš si reset (DELETE FROM processed_games)?")
        return

    h = target.headers
    print(f"\n>>> Partie: {h.get('White','?')} – {h.get('Black','?')}  [{h.get('Event','?')}]")

    found_ctx = None
    for ctx in find_positions(
        [target], cache, [], position_rules,
        depth=depth, multipv=multipv, limit=1, max_per_game=1,
    ):
        found_ctx = ctx
        break

    if found_ctx is not None:
        print_candidate(1, found_ctx)
    else:
        print("\n   → V této partii naše pravidlo nenašlo žádný mezitah-kandidát.")
        print("     (žádná pozice neprošla check_or_capture + min_gain + min_player_cp)")

    processed.mark_processed(target)


if __name__ == "__main__":
    main()
