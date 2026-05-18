import chess

from evaluate import evaluate_position

PIRC_FEN = "rnbqk2r/pp2pp1p/3p1npb/8/3NPP2/2N5/PPP3PP/R1BQKB1R w KQkq - 1 7"


def test_evaluate_pirc_position_returns_score_and_pv(capsys):
    board = chess.Board(PIRC_FEN)

    info = evaluate_position(board, depth=15)

    assert "score" in info, "engine should return a score"
    assert "pv" in info and info["pv"], "engine should return a non-empty PV"

    score = info["score"].white()
    assert not score.is_mate(), "tato pozice není matová"

    cp = score.score()
    assert cp is not None
    # Standardní postavení z Pirce, bílý má mírnou výhodu — necháváme štědrý rozsah,
    # aby test neselhal kvůli variantě/verzi Stockfishe.
    assert -100 < cp < 300, f"unexpected eval: {cp} cp"

    pv_san = board.variation_san(info["pv"][:6])
    with capsys.disabled():
        print()
        print(f"  FEN:        {PIRC_FEN}")
        print(f"  hodnocení:  {cp / 100:+.2f}  ({cp} cp)")
        print(f"  hloubka:    {info.get('depth')}")
        print(f"  PV:         {pv_san}")
