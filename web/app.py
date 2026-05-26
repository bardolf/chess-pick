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

import asyncio
import sys
from pathlib import Path

# Na Windows si vynutíme ProactorEventLoop policy — bez toho asyncio.subprocess
# (který používá python-chess pro spuštění Stockfishe) na Pythonu 3.14 padá.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

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

print(f"[chess-pick] STOCKFISH_PATH = {STOCKFISH_PATH!r}", flush=True)
print(f"[chess-pick]   exists()    = {STOCKFISH_PATH.exists()}", flush=True)
print(f"[chess-pick]   is_file()   = {STOCKFISH_PATH.is_file()}", flush=True)
from filters import (
    MinElo,
    OnlyMoveAvailable,
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


# ----------------------------- TWIC scraper -----------------------------
# Index ze stránky theweekinchess.com/twic. Cachuje se na disk; staré položky
# se nemění, jen občas přibyde nová položka shora.
_TWIC_INDEX_PATH = PROJECT_ROOT / "data" / "twic_index.json"
_TWIC_INDEX_TTL_SECONDS = 6 * 60 * 60  # 6 hodin
_TWIC_ROW_RE = __import__("re").compile(
    r"<td>(\d{4}-\d{2}-\d{2})</td>\s*"
    r'<td><a href="[^"]*?/html/twic(\d+)\.html">HTML</a></td>\s*'
    r'<td><a href="[^"]*?/zips/twic\d+g\.zip">PGN</a></td>'
)


def _parse_twic_index(html: str) -> list[dict]:
    """Vrátí jen TWIC vydání, která mají PGN ZIP — to je TWIC 920 a novější.
    Starší jen jako HTML stránky, ty nás nezajímají."""
    items: list[dict] = []
    for m in _TWIC_ROW_RE.finditer(html):
        items.append({"number": int(m.group(2)), "date": m.group(1)})
    items.sort(key=lambda x: x["number"], reverse=True)
    return items


@app.get("/api/twic/list")
def twic_list() -> dict:
    """Vrátí seznam TWIC vydání (number, date). Cachuje na disk 6 hodin."""
    import time as _time
    cached: dict | None = None
    if _TWIC_INDEX_PATH.is_file():
        try:
            cached = json.loads(_TWIC_INDEX_PATH.read_text(encoding="utf-8"))
            if _time.time() - float(cached.get("fetched_at", 0)) < _TWIC_INDEX_TTL_SECONDS:
                return cached
        except Exception:
            cached = None

    http_req = urllib.request.Request(
        "https://theweekinchess.com/twic",
        headers={"User-Agent": "chess-pick/1.0"},
    )
    try:
        with urllib.request.urlopen(http_req, timeout=20) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        if cached:  # fallback na zastaralou cache
            return cached
        raise HTTPException(502, f"Nepodařilo se stáhnout TWIC index: {e}")

    items = _parse_twic_index(html)
    payload = {"fetched_at": _time.time(), "items": items}
    try:
        _TWIC_INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
        _TWIC_INDEX_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except Exception:
        pass
    return payload


class TwicDownloadRequest(BaseModel):
    number: int


@app.post("/api/twic/download")
def twic_download(req: TwicDownloadRequest) -> dict:
    """Stáhne ZIP s PGN pro daný TWIC, rozbalí, uloží jako twic/twic{N}.pgn."""
    import io as _io
    import zipfile
    if req.number < 920:
        raise HTTPException(400, "TWIC číslování začíná na 920.")
    zip_url = f"https://theweekinchess.com/zips/twic{req.number}g.zip"
    http_req = urllib.request.Request(
        zip_url,
        headers={"User-Agent": "chess-pick/1.0"},
    )
    try:
        with urllib.request.urlopen(http_req, timeout=30) as resp:
            zip_bytes = resp.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise HTTPException(404, f"TWIC {req.number} neexistuje (404).")
        raise HTTPException(502, f"Stažení TWIC {req.number} selhalo: HTTP {e.code}")
    except Exception as e:
        raise HTTPException(502, f"Stažení TWIC {req.number} selhalo: {e}")

    try:
        with zipfile.ZipFile(_io.BytesIO(zip_bytes)) as z:
            pgn_names = [n for n in z.namelist() if n.lower().endswith(".pgn")]
            if not pgn_names:
                raise HTTPException(502, "Stažený ZIP neobsahuje .pgn soubor.")
            pgn_bytes = z.read(pgn_names[0])
    except zipfile.BadZipFile:
        raise HTTPException(502, "Stažený soubor není platný ZIP.")

    target = TWIC_DIR / f"twic{req.number}.pgn"
    target.write_bytes(pgn_bytes)
    return {"name": target.name, "size_kb": len(pgn_bytes) // 1024, "number": req.number}


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
    engine: dict = {}  # threads, hash (MB), případně další UCI parametry
    limit: int | None = None  # max kandidátů (None = default per mód)


class LichessImportRequest(BaseModel):
    pgn: str


class ExportPgnRequest(BaseModel):
    pgn: str                # název zdrojového PGN v twic/
    rule: str | None = None # pro kontext do komentářů
    matches: list[dict]     # data z `match` událostí (game_idx, ply, played, best, fullmove, side, ...)


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


@app.post("/api/export-pgn")
def export_pgn(req: ExportPgnRequest) -> Response:
    """Vrátí původní PGN, ale jen partie kde byl nález, a u příslušných
    tahů jsou doplněné komentáře typu '[chess-pick] blunder: best=Bxd4, played=Qe5'.
    Pohodlné pro import zpět do ChessBase / Lichess studie."""
    if not req.matches:
        raise HTTPException(400, "Žádné nálezy k exportu.")

    by_game: dict[int, list[dict]] = {}
    for m in req.matches:
        try:
            gi = int(m["game_idx"])
        except (KeyError, TypeError, ValueError):
            continue
        by_game.setdefault(gi, []).append(m)

    if not by_game:
        raise HTTPException(400, "Žádné nálezy s platným game_idx.")

    pgn_path = _pgn_path(req.pgn)
    needed = set(by_game.keys())
    max_needed = max(needed)
    import io as _io

    # Načteme zdrojové partie do paměti (jen ty, co potřebujeme),
    # ať z nich pak můžeme tahat hlavičky pro jednotlivé výřezy.
    source_games: dict[int, chess.pgn.Game] = {}
    for gi, game in _iter_pgn_games(pgn_path):
        if gi in needed:
            source_games[gi] = game
        if gi >= max_needed:
            break

    if not source_games:
        raise HTTPException(404, "Nepodařilo se najít žádnou z partií podle game_idx.")

    chunks: list[str] = []
    for m in req.matches:
        try:
            gi = int(m["game_idx"])
        except (KeyError, TypeError, ValueError):
            continue
        src = source_games.get(gi)
        if src is None:
            continue
        chunk = _format_match_pgn(src, m, req.rule)
        if chunk is None:
            continue
        chunks.append(chunk)

    if not chunks:
        raise HTTPException(404, "Žádný nález se nepodařilo převést na PGN záznam.")
    pgn_text = "\n".join(chunks)
    print(f"[chess-pick] export-pgn: {len(chunks)} zaznamu", flush=True)
    base = req.pgn.rsplit(".", 1)[0] if "." in req.pgn else req.pgn
    rule_tag = f"-{req.rule}" if req.rule else ""
    filename = f"{base}{rule_tag}-marked.pgn"
    return Response(
        content=pgn_text,
        media_type="application/x-chess-pgn",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


_HEADERS_TO_COPY = (
    "Event", "Site", "Date", "Round", "White", "Black",
    "WhiteElo", "BlackElo", "ECO", "Opening", "Variation",
)


def _format_match_pgn(
    source: chess.pgn.Game,
    match: dict,
    rule: str | None,
) -> str | None:
    """Postaví samostatný PGN záznam pro jeden nález ve formátu, který ChessBase
    importuje rovnou jako pozici/diagram:

    ```
    [Event "..."]
    [Result "*"]
    [SetUp "1"]
    [FEN "...0 1"]
    ...

    {[#]} 1. e4 {[chess-pick] blunder: best=Bf4, played=e4} *
    ```

    Klíčové detaily:
    - Fullmove counter ve FEN je resetovaný na 1, aby ChessBase číslo tahu
      započítal od 1, ne od původní polohy v partii (např. 14. ...).
    - `{[#]}` bez mezer uvnitř — ChessBase parser si toho jinak nemusí
      všimnout a nezobrazí diagram.
    """
    fen = match.get("fen")
    if not fen:
        return None

    parts = fen.split()
    if len(parts) != 6:
        return None
    parts[4] = "0"   # halfmove clock
    parts[5] = "1"   # fullmove counter — ChessBase pak číslo tahu začne na 1
    fen_norm = " ".join(parts)

    try:
        board = chess.Board(fen_norm)
    except ValueError:
        return None

    headers: list[tuple[str, str]] = []
    for k in _HEADERS_TO_COPY:
        if k in source.headers:
            headers.append((k, source.headers[k]))
    headers.append(("Result", "*"))
    headers.append(("Annotator", "chess-pick"))
    headers.append(("SetUp", "1"))
    headers.append(("FEN", fen_norm))
    if rule:
        headers.append(("ChessPickRule", rule))
    fullmove = match.get("fullmove")
    if fullmove:
        headers.append(("ChessPickFullmove", str(fullmove)))

    # Komentář ve tvaru, který si uživatel přečte v ChessBase
    comment_parts = ["[chess-pick]"]
    if rule:
        comment_parts.append(rule + ":")
    played = match.get("played")
    best = match.get("best")
    if rule == "mate" and played:
        comment_parts.append(f"mate sequence: {played}")
    elif played and best:
        comment_parts.append(f"best={best}, played={played}")
    elif best:
        comment_parts.append(f"best={best}")
    pick_comment = " ".join(comment_parts)

    moves: list[str] = []
    if rule == "mate" and played:
        moves = played.split()
    elif rule in ("blunder", "zwischenzug", "only_move") and played:
        moves = [played]

    move_text = ""
    move_num = board.fullmove_number  # po normalizaci FEN by mělo být 1
    black_to_move = (board.turn == chess.BLACK)
    rendered = 0
    for san in moves:
        try:
            mv = board.parse_san(san)
            san_norm = board.san(mv)
        except (ValueError, chess.IllegalMoveError):
            break
        if not black_to_move:
            move_text += f"{move_num}. "
        elif rendered == 0:
            move_text += f"{move_num}... "
        move_text += san_norm + " "
        board.push(mv)
        if black_to_move:
            move_num += 1
        black_to_move = not black_to_move
        rendered += 1

    if move_text:
        body = f"{{[#]}} {move_text.strip()} {{{pick_comment}}} *"
    else:
        body = f"{{[#]}} {{{pick_comment}}} *"

    header_lines = "\n".join(f'[{k} "{v}"]' for k, v in headers)
    return header_lines + "\n\n" + body + "\n\n"


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest) -> StreamingResponse:
    pgn_path = _pgn_path(req.pgn)
    # `limit=None` => bez stropu, projíždíme dokud PGN nedojde (nebo dokud
    # uživatel nezmáčkne Stop).
    limit = req.limit
    if req.rule == "pawn_structure":
        gen = _stream_pawn_structure(pgn_path, req.params, limit)
    elif req.rule in ("blunder", "zwischenzug", "only_move"):
        gen = _stream_engine(pgn_path, req.rule, req.params, limit, req.engine)
    elif req.rule == "mate":
        gen = _stream_mate(pgn_path, req.params, limit)
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


def _stream_pawn_structure(pgn_path: Path, params: dict, limit: int | None):
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
            if limit is not None and matches_found >= limit:
                break
    yield _emit({"type": "done", "games_scanned": games_scanned, "matches_total": matches_found})


def _stream_engine(pgn_path: Path, rule_name: str, params: dict, limit: int | None, engine_opts: dict | None = None):
    depth = int(params.get("depth", DEFAULT_DEPTH))
    multipv = int(params.get("multipv", DEFAULT_MULTIPV))
    if rule_name == "blunder":
        rule = PlayedMoveLossAtLeast(
            min_loss_cp=int(params.get("min_loss_cp", 100)),
            tie_tolerance_cp=int(params.get("tie_tolerance_cp", 20)),
            eval_min_cp=int(params.get("eval_min_cp", -100_000)),
            eval_max_cp=int(params.get("eval_max_cp", 100_000)),
        )
    elif rule_name == "only_move":
        rule = OnlyMoveAvailable(
            best_max_abs_cp=int(params.get("best_max_abs_cp", 150)),
            min_gap_cp=int(params.get("min_gap_cp", 200)),
            exclude_captures=bool(params.get("exclude_captures", True)),
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
    sf_path = str(STOCKFISH_PATH)
    eopt = engine_opts or {}
    try:
        threads = max(1, int(eopt.get("threads", STOCKFISH_THREADS)))
    except (TypeError, ValueError):
        threads = STOCKFISH_THREADS
    try:
        hash_mb = max(1, int(eopt.get("hash", STOCKFISH_HASH_MB)))
    except (TypeError, ValueError):
        hash_mb = STOCKFISH_HASH_MB
    print(f"[chess-pick] Spouštím Stockfish: {sf_path!r} (Threads={threads}, Hash={hash_mb}MB)", flush=True)
    try:
        with chess.engine.SimpleEngine.popen_uci(sf_path) as engine:
            engine.configure({"Threads": threads, "Hash": hash_mb})
            with EvalCache(EVAL_DB, engine) as cache:
                def stats_cb():
                    return {"type": "engine_stats", "data": cache.perf.snapshot()}

                for item in find_positions(
                    games_with_index(),
                    cache,
                    game_rules=game_rules,
                    position_rules=[rule],
                    depth=depth,
                    multipv=multipv,
                    limit=limit,
                    # Blunder/Zwischenzug: chceme všechny zajímavé momenty z partie,
                    # ne jen první. Limit počtu výsledků řeší `limit` celkově.
                    max_per_game=None,
                    verbose=False,
                    stats_callback=stats_cb,
                    stats_interval_s=3.0,
                ):
                    # find_positions yieldne PositionContext (match) NEBO dict (stats).
                    if isinstance(item, dict):
                        yield _emit(item)
                        continue
                    ctx = item
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
                # poslední stats event před done
                yield _emit({"type": "engine_stats", "data": cache.perf.snapshot()})
    except GeneratorExit:
        # klient se odpojil (Stop) — context managers (engine, cache) se uklidí samy
        return
    yield _emit({"type": "done", "matches_total": matches_found})


# --- Rule 4: Mate ---------------------------------------------------------

def _attr_match(filter_value, actual_bool: bool) -> bool:
    """Ano/ne/nezáleží filtr vs reálná bool hodnota."""
    if not filter_value or filter_value == "nezáleží":
        return True
    if filter_value == "ano":
        return bool(actual_bool)
    if filter_value == "ne":
        return not bool(actual_bool)
    return True


def _stream_mate(pgn_path: Path, params: dict, limit: int | None):
    try:
        mate_in = int(params.get("mate_in") or 1)
    except (TypeError, ValueError):
        mate_in = 1
    mate_in = max(1, min(5, mate_in))
    moves_filter = params.get("moves") or []  # list of {move_from_mate, check, capture, promotion}
    elo_rule = _build_elo_rule(params)

    yield _emit({"type": "start", "rule": "mate", "limit": limit, "mate_in": mate_in})

    games_scanned = 0
    matches_found = 0
    for game_idx, game in _iter_pgn_games(pgn_path):
        games_scanned += 1
        if games_scanned % 100 == 0:
            yield _emit({"type": "progress", "games_scanned": games_scanned, "matches_found": matches_found})
        if elo_rule is not None and not elo_rule.match(game):
            continue

        # spočítej atributy pro každý tah + FEN před každým tahem
        board = game.board()
        fens_before = [board.fen()]
        attrs = []
        san_list = []
        for move in game.mainline_moves():
            cap = board.is_capture(move)
            prom = move.promotion is not None
            try:
                san = board.san(move)
            except Exception:
                san = move.uci()
            san_list.append(san)
            board.push(move)
            attrs.append({
                "check": board.is_check(),
                "capture": cap,
                "promotion": prom,
                "checkmate": board.is_checkmate(),
            })
            fens_before.append(board.fen())

        # najdi pozice s matem
        for i, a in enumerate(attrs):
            if not a["checkmate"]:
                continue
            # mate_in = počet tahů matující strany (M_1..M_N, mezi nimi obrana D_1..D_{N-1}).
            # Sekvence má 2*N - 1 půltahů, target_ply je půltah před M_1.
            # M_K (vzdálenost K od matu) = attrs[i - 2*K], K=0..N-1.
            target_ply = i + 2 - 2 * mate_in
            if target_ply < 0:
                continue

            # aplikuj filtr na předchozí tahy matující strany (mat-1 .. mat-(N-1))
            ok = True
            for fm in moves_filter:
                try:
                    move_from_mate = int(fm.get("move_from_mate"))
                except (TypeError, ValueError):
                    continue
                if move_from_mate < 1 or move_from_mate >= mate_in:
                    continue
                idx = i - 2 * move_from_mate  # M_{N - move_from_mate}, tah matující strany
                if idx < target_ply or idx >= i:
                    ok = False
                    break
                ma = attrs[idx]
                if not _attr_match(fm.get("check"), ma["check"]):
                    ok = False; break
                if not _attr_match(fm.get("capture"), ma["capture"]):
                    ok = False; break
                if not _attr_match(fm.get("promotion"), ma["promotion"]):
                    ok = False; break
            if not ok:
                continue

            # vystaveno: pozice před prvním tahem sekvence
            fen = fens_before[target_ply]
            board_at = chess.Board(fen)
            mating_seq = " ".join(san_list[target_ply:i + 1])
            data = {
                **_game_meta(game, game_idx),
                "ply": target_ply,
                "fullmove": board_at.fullmove_number,
                "side": _side(board_at),
                "fen": fen,
                "played": mating_seq,
                "best": f"mate in {mate_in}",
            }
            yield _emit({"type": "match", "data": data})
            matches_found += 1
            if limit is not None and matches_found >= limit:
                break
            break  # max 1 mate sekvence per partii

        if limit is not None and matches_found >= limit:
            break

    yield _emit({"type": "done", "games_scanned": games_scanned, "matches_total": matches_found})


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
