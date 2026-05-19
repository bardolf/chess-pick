# chess-pick

Filtrování zajímavých pozic z PGN partií pro šachový trénink. Aplikace prochází
PGN soubory, hodnotí pozice Stockfishem a podle zvolených pravidel vybírá
pozice, které si uživatel pak sám řeší.

## Závislosti

- Python 3.12+
- [python-chess](https://python-chess.readthedocs.io/) (UCI komunikace + PGN parser)
- Stockfish (lokálně, default cesta `~/opt/stockfish/stockfish-ubuntu-x86-64-avx2`)
- pytest (pro testy)

## Setup

```bash
python -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
```

Cestu ke Stockfishi případně uprav v `evaluate.py` (`STOCKFISH_PATH`).

## Spuštění

```bash
.venv/bin/python main.py
```

Defaultní chování:
- Projde všechny `*.pgn` v `twic/`
- Aplikuje vybraný mód hledání (viz `SEARCH_MODE` v `main.py`)
- Tiskne jednoho kandidáta za druhým, jak je najde
- Vyhodnocené pozice cachuje v `eval_cache.db`
- Už zobrazené kandidáty (`seen_candidates`) v dalších bězích přeskakuje

Reset cache / seen:

```bash
sqlite3 eval_cache.db "DELETE FROM seen_candidates;"
# případně celé:
rm eval_cache.db
```

## Konfigurace v `main.py`

| Konstanta | Význam |
|---|---|
| `SEARCH_MODE` | `"blunder"`, `"zwischenzug"`, `"zwischenzug_available"` |
| `TEST_MODE` | `True` = vypne Elo gate + eval-range, per-partii tracking (pro ruční testovací PGN) |
| `STOCKFISH_THREADS` | Počet vláken Stockfishe (defaultně 8) |
| `STOCKFISH_HASH_MB` | Velikost transposition table (MB) |
| `TIE_TOLERANCE_CP` | „Tied" tahy do tolerance se považují za rovnocenné |

## Vyhledávací módy

### `blunder`
Hráč zahrál tah ≥ 1.00 pěšce horší než nejlepší. Klasický blunder.

### `zwischenzug` (MissedZwischenzug)
Hráč automaticky dobral po soupeřově braní, ačkoliv engine doporučoval
non-recapture (mezitah).

### `zwischenzug_available` (ZwischenzugAvailable)
Pozice, kde po soupeřově braní engine doporučuje **non-recapture šach nebo
braní jiné figury** — tréninková pozice bez ohledu na to, co hráč skutečně zahrál.

Parametry pravidla:
- `min_gain_cp = 100` — minimální převaha mezitahu nad rekapitulací (pro ne-šach)
- `require_check_or_capture = True` — mezitah musí být šach nebo braní
- `min_player_cp = -100` — hráč nesmí být po mezitahu prohraný o >1 pěšce
- `check_skips_gap = True` — šach po soupeřově braní fires bez ohledu na gap

## Struktura projektu

```
chess-pick/
├── main.py                      # Entry point, konfigurace, výpis kandidátů
├── filters.py                   # Pravidla (ZwischenzugAvailable, ...), pipeline
├── evaluate.py                  # evaluate_position() + STOCKFISH_PATH
├── cache.py                     # SQLite cache + SeenStore + ProcessedGames
├── twic/                        # PGN partie (TWIC dumpy)
├── tests/
│   ├── test_evaluate.py         # smoke test Stockfish API
│   └── zwitschenzug/
│       ├── conftest.py          # engine + cache fixtures
│       ├── eval_cache.db        # commitnutá testovací cache
│       └── test_zwischenzug.py  # asserty na konkrétní mezitahy
└── pyproject.toml               # pytest config (potlačení deprecation warningů)
```

## Testy

```bash
.venv/bin/pytest -v
```

Testy v `tests/zwitschenzug/` mají vlastní commitnutou SQLite cache —
po `git checkout` jdou okamžitě bez nutnosti přepočítat pozice Stockfishem.

## Pracovní postup s `TEST_MODE`

Pro ruční testování pravidel na curated partiích:

1. Přidej PGN soubor do `twic/`
2. V `main.py` nastav `TEST_MODE = True`
3. Spusť `python main.py` — projíždí jednu partii za běh, vyřízené partie se
   tagují do `processed_games` tabulky
4. Reset: `sqlite3 eval_cache.db "DELETE FROM processed_games;"`
