from __future__ import annotations

from pathlib import Path
from typing import Iterator

import chess.pgn

TWIC_DIR = Path(__file__).parent / "twic"


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


def main() -> None:
    if not TWIC_DIR.is_dir():
        raise SystemExit(f"Directory not found: {TWIC_DIR}")

    count = 0
    for i, game in enumerate(iter_games(TWIC_DIR), start=1):
        print(format_header(i, game))
        moves = format_moves(game)
        result = game.headers.get("Result", "*")
        if moves:
            print(f"       {moves} {result}")
        else:
            print(f"       {result}")
        print()
        count = i

    print(f"Total games: {count}")


if __name__ == "__main__":
    main()
