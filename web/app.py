"""FastAPI server pro chess-pick web UI.

Endpointy:
- GET  /                            HTML stránka (3 sloupce)
- GET  /api/pgns                    seznam PGN souborů v twic/
- POST /api/upload                  upload .pgn (uloží do twic/)
- GET  /api/pgns/{name}/games       seznam partií v PGN (light metadata)
- GET  /api/pgns/{name}/games/{i}   detail partie (tahy, FENy, headers, ECO)
- POST /api/analyze                 spustí pravidlo nad partií

Spuštění:
    .venv/bin/uvicorn web.app:app --reload
"""

from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import chess
import chess.engine
import chess.pgn
from fastapi import FastAPI, File, HTTPException, UploadFile
import json
import urllib.parse
import urllib.request

from fastapi.responses import HTMLResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from cache import EvalCache
from evaluate import STOCKFISH_PATH
from filters import (
    MinElo,
    OpeningPositionMatches,
    PawnStructureMatches,
    PlayedMoveLossAtLeast,
    PositionContext,
    ZwischenzugAvailable,
    find_positions,
)
from openings import OpeningClassifier

TWIC_DIR = PROJECT_ROOT / "twic"
EVAL_DB = PROJECT_ROOT / "eval_cache.db"
ECO_DIR = PROJECT_ROOT / "data" / "eco"

TWIC_DIR.mkdir(exist_ok=True)

STOCKFISH_THREADS = 2
STOCKFISH_HASH_MB = 1024
DEFAULT_DEPTH = 16
DEFAULT_MULTIPV = 3

app = FastAPI(title="chess-pick")
app.mount(
    "/static",
    StaticFiles(directory=Path(__file__).parent / "static"),
    name="static",
)
INDEX_HTML_PATH = Path(__file__).parent / "templates" / "index.html"

CLASSIFIER: OpeningClassifier | None = (
    OpeningClassifier(ECO_DIR) if ECO_DIR.is_dir() else None
)


# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    # HTML čteme z disku při každém requestu — úpravy v šabloně se projeví bez restartu
    html = INDEX_HTML_PATH.read_text(encoding="utf-8")
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})




# ---------------------------------------------------------------------------
# PGN browsing
# ---------------------------------------------------------------------------

@app.get("/api/pgns")
def list_pgns() -> list[dict]:
    out = []
    for p in sorted(TWIC_DIR.glob("*.pgn")):
        out.append({"name": p.name, "size_kb": p.stat().st_size // 1024})
    return out


@app.post("/api/upload")
async def upload_pgn(file: UploadFile = File(...)) -> dict:
    if not file.filename or not file.filename.lower().endswith(".pgn"):
        raise HTTPException(400, "Soubor musí mít koncovku .pgn")
    dest = TWIC_DIR / file.filename
    content = await file.read()
    dest.write_bytes(content)
    return {"name": dest.name, "size_kb": len(content) // 1024}


@app.get("/api/pgns/{name}/games")
def list_games(name: str) -> list[dict]:
    """Rychlý seznam — používá `read_headers` (nečte tahy)."""
    path = _pgn_path(name)
    out = []
    with path.open(encoding="utf-8", errors="replace") as f:
        idx = 0
        while True:
            h = chess.pgn.read_headers(f)
            if h is None:
                break
            out.append({
                "idx": idx,
                "white": h.get("White", "?"),
                "black": h.get("Black", "?"),
                "white_elo": h.get("WhiteElo", "?"),
                "black_elo": h.get("BlackElo", "?"),
                "date": h.get("Date", "?"),
                "event": h.get("Event", "?"),
                "result": h.get("Result", "*"),
            })
            idx += 1
    return out


@app.get("/api/pgns/{name}/games/{idx}")
def game_detail(name: str, idx: int) -> dict:
    game = _load_game(name, idx)
    moves_uci: list[str] = []
    moves_san: list[str] = []
    fens: list[str] = []
    board = game.board()
    fens.append(board.fen())
    for move in game.mainline_moves():
        moves_uci.append(move.uci())
        moves_san.append(board.san(move))
        board.push(move)
        fens.append(board.fen())

    opening = "(neidentifikováno)"
    if CLASSIFIER is not None:
        detected = CLASSIFIER.classify(game)
        if detected:
            opening = f"{detected[0]} · {detected[1]}"

    h = game.headers
    return {
        "white": h.get("White", "?"),
        "black": h.get("Black", "?"),
        "white_elo": h.get("WhiteElo", "?"),
        "black_elo": h.get("BlackElo", "?"),
        "date": h.get("Date", "?"),
        "event": h.get("Event", "?"),
        "result": h.get("Result", "*"),
        "opening": opening,
        "moves_uci": moves_uci,
        "moves_san": moves_san,
        "fens": fens,
    }


# ---------------------------------------------------------------------------
# Analyze
# ---------------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    rule: str
    pgn: str
    params: dict = {}
    limit: int | None = None  # max kandidátů (None = default per mód)


class LichessImportRequest(BaseModel):
    pgn: str


@app.post("/api/lichess-import")
def lichess_import(req: LichessImportRequest) -> dict:
    """Server-side proxy na Lichess /api/import — obejde browser CORS."""
    if not req.pgn.strip():
        raise HTTPException(400, "Prázdný PGN")
    data = urllib.parse.urlencode({"pgn": req.pgn}).encode()
    http_req = urllib.request.Request(
        "https://lichess.org/api/import",
        data=data,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": "chess-pick/0.1",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(http_req, timeout=15) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        raise HTTPException(502, f"Lichess vrátil {e.code}: {e.read().decode('utf-8', errors='replace')[:200]}")
    except Exception as e:
        raise HTTPException(502, f"Spojení s Lichess selhalo: {e}")
    try:
        game = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(502, f"Neplatná odpověď z Lichess: {body[:200]}")
    return {"url": game.get("url"), "id": game.get("id")}


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest) -> StreamingResponse:
    pgn_path = _pgn_path(req.pgn)
    if req.rule == "pawn_structure":
        limit = req.limit or 500
        gen = _stream_pawn_structure(pgn_path, req.params, limit)
    elif req.rule in ("blunder", "zwischenzug"):
        limit = req.limit or 50
        gen = _stream_engine(pgn_path, req.rule, req.params, limit)
    else:
        raise HTTPException(400, f"Neznámé pravidlo: {req.rule}")
    return StreamingResponse(gen, media_type="application/x-ndjson")


def _emit(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False) + "\n"


def _iter_pgn_games(pgn_path: Path):
    """Generátor partií ze souboru, s indexem."""
    with pgn_path.open(encoding="utf-8", errors="replace") as f:
        idx = 0
        while True:
            game = chess.pgn.read_game(f)
            if game is None:
                break
            yield idx, game
            idx += 1


def _game_meta(game: chess.pgn.Game, game_idx: int) -> dict:
    h = game.headers
    return {
        "game_idx": game_idx,
        "white": h.get("White", "?"),
        "black": h.get("Black", "?"),
        "white_elo": h.get("WhiteElo", "?"),
        "black_elo": h.get("BlackElo", "?"),
        "event": h.get("Event", "?"),
        "date": h.get("Date", "?"),
        "result": h.get("Result", "*"),
    }


def _build_elo_rule(params: dict):
    """Vrátí MinElo pravidlo, pokud params obsahuje kladnou hodnotu, jinak None.
    Při 0 / chybějícím parametru se filtr Elo vůbec neaplikuje."""
    try:
        min_elo = int(params.get("min_elo") or 0)
    except (TypeError, ValueError):
        min_elo = 0
    if min_elo <= 0:
        return None
    return MinElo(threshold=min_elo, both=True)


def _stream_pawn_structure(pgn_path: Path, params: dict, limit: int):
    fen = params.get("fen", "")
    if not fen:
        yield _emit({"type": "error", "message": "Pawn structure rule vyžaduje 'fen' parametr"})
        return
    opening_moves = (params.get("opening_moves") or "").strip()
    opening_rule = None
    if opening_moves:
        try:
            target_fen = _moves_text_to_fen(opening_moves)
        except Exception as e:
            yield _emit({"type": "error", "message": f"Chybný zápis zahájení: {e}"})
            return
        opening_rule = OpeningPositionMatches(target_fen)
    structure_rule = PawnStructureMatches(fen=fen)
    elo_rule = _build_elo_rule(params)

    yield _emit({"type": "start", "rule": "pawn_structure", "limit": limit})
    games_scanned = 0
    matches_found = 0
    for game_idx, game in _iter_pgn_games(pgn_path):
        games_scanned += 1
        if games_scanned % 100 == 0:
            yield _emit({"type": "progress", "games_scanned": games_scanned, "matches_found": matches_found})
        if elo_rule is not None and not elo_rule.match(game):
            continue
        if opening_rule is not None and not opening_rule.match(game):
            continue
        board = game.board()
        hit: dict | None = None
        if structure_rule.match(_FakeCtx(board)):
            hit = {"ply": 0, "fullmove": board.fullmove_number, "side": _side(board), "fen": board.fen()}
        else:
            for move in game.mainline_moves():
                board.push(move)
                if structure_rule.match(_FakeCtx(board)):
                    hit = {"ply": board.ply(), "fullmove": board.fullmove_number,
                           "side": _side(board), "fen": board.fen()}
                    break
        if hit is not None:
            yield _emit({"type": "match", "data": {**_game_meta(game, game_idx), **hit}})
            matches_found += 1
            if matches_found >= limit:
                break
    yield _emit({"type": "done", "games_scanned": games_scanned, "matches_total": matches_found})


def _stream_engine(pgn_path: Path, rule_name: str, params: dict, limit: int):
    depth = int(params.get("depth", DEFAULT_DEPTH))
    multipv = int(params.get("multipv", DEFAULT_MULTIPV))
    if rule_name == "blunder":
        rule = PlayedMoveLossAtLeast(
            min_loss_cp=int(params.get("min_loss_cp", 100)),
            tie_tolerance_cp=int(params.get("tie_tolerance_cp", 20)),
        )
    else:
        rule = ZwischenzugAvailable(
            min_gain_cp=int(params.get("min_gain_cp", 100)),
            require_check_or_capture=bool(params.get("require_check_or_capture", True)),
            min_player_cp=int(params.get("min_player_cp", -100)),
            check_skips_gap=bool(params.get("check_skips_gap", True)),
        )

    yield _emit({"type": "start", "rule": rule_name, "limit": limit, "depth": depth, "multipv": multipv})

    elo_rule = _build_elo_rule(params)
    game_rules = [elo_rule] if elo_rule is not None else []
    game_idx_map: dict[int, int] = {}

    def games_with_index():
        for game_idx, game in _iter_pgn_games(pgn_path):
            game_idx_map[id(game)] = game_idx
            yield game

    matches_found = 0
    try:
        with chess.engine.SimpleEngine.popen_uci(str(STOCKFISH_PATH)) as engine:
            engine.configure({"Threads": STOCKFISH_THREADS, "Hash": STOCKFISH_HASH_MB})
            with EvalCache(EVAL_DB, engine) as cache:
                for ctx in find_positions(
                    games_with_index(),
                    cache,
                    game_rules=game_rules,
                    position_rules=[rule],
                    depth=depth,
                    multipv=multipv,
                    limit=limit,
                    max_per_game=1,
                    verbose=False,
                ):
                    try:
                        san_played = ctx.board.san(ctx.played_move)
                        best = ctx.best_move()
                        san_best = ctx.board.san(best) if best else "?"
                    except Exception:
                        san_played = ctx.played_move.uci()
                        san_best = "?"
                    game_idx = game_idx_map.get(id(ctx.game), -1)
                    data = {
                        **_game_meta(ctx.game, game_idx),
                        "ply": ctx.board.ply(),
                        "fullmove": ctx.fullmove_number,
                        "side": _side(ctx.board),
                        "fen": ctx.board.fen(),
                        "played": san_played,
                        "best": san_best,
                    }
                    yield _emit({"type": "match", "data": data})
                    matches_found += 1
    except GeneratorExit:
        # klient se odpojil (Stop) — context managers (engine, cache) se uklidí samy
        return
    yield _emit({"type": "done", "matches_total": matches_found})


_MOVE_NUMBER_PREFIX_RE = __import__("re").compile(r"^\d+\.+")
_RESULT_TOKENS = {"*", "1-0", "0-1", "1/2-1/2"}


def _moves_text_to_fen(text: str) -> str:
    """Parsuje SAN tahy (např. '1.d4 Nf6 2.c4 e6') a vrátí FEN výsledné pozice."""
    board = chess.Board()
    for raw in text.split():
        t = raw.strip()
        if not t or t in _RESULT_TOKENS:
            continue
        m = _MOVE_NUMBER_PREFIX_RE.match(t)
        if m:
            t = t[m.end():]
        if not t:
            continue
        board.push_san(t)
    return board.fen()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _pgn_path(name: str) -> Path:
    path = TWIC_DIR / name
    if not path.is_file():
        raise HTTPException(404, "PGN nenalezeno")
    return path


def _load_game(name: str, idx: int) -> chess.pgn.Game:
    path = _pgn_path(name)
    with path.open(encoding="utf-8", errors="replace") as f:
        i = 0
        while True:
            game = chess.pgn.read_game(f)
            if game is None:
                raise HTTPException(404, "Index partie mimo rozsah")
            if i == idx:
                return game
            i += 1


def _side(board: chess.Board) -> str:
    return "white" if board.turn == chess.WHITE else "black"


class _FakeCtx:
    """Lehký PositionContext jen s `board` — pro non-engine pravidla."""
    def __init__(self, board: chess.Board) -> None:
        self.board = board
