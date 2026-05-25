// chess-pick frontend
// State:
//   - selectedPgn: name of currently selected PGN file
//   - games: list of game metadata (idx, white, black, ...)
//   - selectedGameIdx: int or null
//   - gameDetail: {moves_san, fens, ...} for currently loaded game
//   - currentMoveIdx: 0 = initial position, k = after k-th half-move
//   - selectedRule: 'blunder' | 'zwischenzug' | 'pawn_structure'

const state = {
  pgns: [],
  selectedPgn: null,
  games: [],
  selectedGameIdx: null,
  gameDetail: null,
  currentMoveIdx: 0,
  selectedRule: 'blunder',
  lang: (localStorage.getItem('lang') === 'en') ? 'en' : 'cs',
};

// -------- i18n --------
// `t(key)` pro statické UI stringy.
// `tr(obj)` pro objekty tvaru {cs:'…', en:'…'} (v RULE_DEFS / MATE_ATTRS).
const I18N = {
  cs: {
    // header / page
    subtitle: '„pro filtrování zajímavých pozic"',
    title_github: 'Otevřít README a zdroják na GitHubu',
    theme_toggle: 'Přepnout dark / light mode',
    // board nav
    nav_start: 'Začátek partie', nav_back: 'Tah zpět',
    nav_forward: 'Tah vpřed', nav_end: 'Konec partie',
    lichess_link: 'Otevřít aktuální pozici v Lichess analýze (engine + database)',
    // output header
    output_header: 'Výsledek analýzy',
    select_all: '✓ Vybrat vše',
    select_all_off: '☐ Odznačit vše',
    select_all_title: 'Vybrat / odznačit všechny nálezy pro PDF',
    export_pdf_title: 'Stáhnout pozice jako PDF (A4, 4 diagramy na stránku + řešení)',
    export_pgn_title: 'Stáhnout PGN partií s vyznačenými nálezy (pro ChessBase / Lichess studie)',
    copy_output: 'Zkopírovat výstup',
    download_output: 'Stáhnout výstup',
    no_analysis: 'Žádná analýza zatím nespuštěna.',
    // middle column
    upload_pgn: 'Upload PGN',
    pgn_files: 'PGN soubory',
    games_in: 'Partie v',
    nothing_selected: '(nic vybráno)',
    game_detail: 'Detail partie',
    select_game_hint: 'Vyber partii dvojklikem nahoře.',
    // right column
    rule: 'Pravidlo',
    parameters: 'Parametry',
    engine_params: 'Parametry enginu (Stockfish)',
    engine_threads_hint: 'Počet CPU vláken Stockfishe. 1 = nejmenší zátěž stroje, vyšší = rychlejší analýza, ale vytíží jádra.',
    engine_hash_hint: 'Velikost transposition table v RAM. 1024 = 1 GB. Větší = obvykle rychlejší (nepřesáhni volnou RAM).',
    analyze: '▶ Analyze',
    stop: '■ Stop',
    // status / dynamic
    status_analyzing: 'analyzuji...',
    status_done: 'hotovo · {n} nálezů ({sec} s)',
    status_stopped: 'zastaveno · {n} nálezů',
    rule_header_start: 'Pravidlo: {rule} · čekám na nálezy...',
    rule_header_running: 'Pravidlo: běží · {n} nálezů',
    rule_header_stopped: 'Pravidlo: ZASTAVENO · {n} nálezů',
    rule_header_progress: 'Pravidlo: progress · {games} partií, {matches} nálezů',
    rule_header_done: 'Pravidlo: dokončeno{scanned} · {matches} nálezů',
    games_scanned_suffix: ' · prošlo {n} partií',
    no_pgn_selected: 'Nejdřív vyber PGN soubor (dvojklik na seznam vlevo).',
    error_prefix: 'Chyba: ',
    no_results_yet: 'Žádné výsledky.',
    pgn_list_click: 'Klikni pro načtení partií',
    bubble_include: 'Zahrnout do PDF',
    bubble_click: 'Klikni pro načtení partie a skok na tuto pozici',
    pdf_export_progress: '⏳ PDF',
    pgn_export_progress: '⏳ PGN',
    pdf_blocked_msg: 'PDF export není pro toto pravidlo k dispozici (jen Rule 1 — Blunder, Rule 2 — Zwischenzug, Rule 4 — Mate a Rule 5 — Only Move).',
    pdf_no_rule_tooltip: 'PDF export není pro toto pravidlo k dispozici (jen rule 1, 2, 4, 5)',
    pdf_wait_tooltip: 'Po spuštění analýzy ti tu nabídnu PDF s diagramy',
    pdf_count_tooltip: 'Stáhnout {sel} z {total} pozic jako PDF (jen zaškrtnuté)',
    pgn_wait_tooltip: 'Po spuštění analýzy ti tu nabídnu PGN s vyznačenými momenty',
    pgn_count_tooltip: 'Stáhnout PGN {sel} z {total} partií s komentáři u nalezených tahů',
    select_all_idle_tooltip: 'Po spuštění analýzy lze hromadně zaškrtnout / odznačit nálezy pro PDF',
    select_all_select_tooltip: 'Vybrat všechny pro PDF',
    select_all_unselect_tooltip: 'Odznačit všechny pro PDF',
    fen_editor_tooltip: 'Otevře Lichess board editor s aktuálním FEN',
    fen_editor_label: '🔗 board editor',
    pgn_source_unknown: 'Zdrojový PGN soubor není známý — spusť analýzu znovu.',
    pgn_error_prefix: 'Chyba při generování PGN: ',
    error_generic: 'Chyba: ',
    pdf_failed: 'PDF export selhal: ',
    mate_in_label: 'mat za N tahů',
    mate_in_hint: 'Počet tahů do matu (1–5). Pro 1 = přímý mat v 1 tahu, žádný předchozí tah. Pro 2+ se zobrazí (N-1) řádků k popisu tahů PŘED matem.',
    mate_overall_hint:
      'Pro každý tah popíšeš jeho povinné vlastnosti. „nezáleží" = filter ignoruje. ' +
      'Tahy se aplikují obě barvy dohromady (matující strana i protivník) — řádek mat-1 ' +
      'je tah těsně před matem, mat-{N-1} je nejvzdálenější.',
    mate_row_title: 'tah mat-{n}',
    mate_attr_check: 'šach',
    mate_attr_capture: 'braní',
    mate_attr_promotion: 'promotion',
    mate_opt_any: 'nezáleží',
    mate_opt_yes: 'ano',
    mate_opt_no: 'ne',
  },
  en: {
    subtitle: '„for filtering interesting positions"',
    title_github: 'Open README and source on GitHub',
    theme_toggle: 'Toggle dark / light mode',
    nav_start: 'Game start', nav_back: 'Move back',
    nav_forward: 'Move forward', nav_end: 'Game end',
    lichess_link: 'Open current position in Lichess analysis (engine + database)',
    output_header: 'Analysis output',
    select_all: '✓ Select all',
    select_all_off: '☐ Deselect all',
    select_all_title: 'Select / deselect all matches for PDF',
    export_pdf_title: 'Download positions as PDF (A4, 4 diagrams per page + solutions)',
    export_pgn_title: 'Download annotated PGN (for ChessBase / Lichess study)',
    copy_output: 'Copy output',
    download_output: 'Download output',
    no_analysis: 'No analysis run yet.',
    upload_pgn: 'Upload PGN',
    pgn_files: 'PGN files',
    games_in: 'Games in',
    nothing_selected: '(none selected)',
    game_detail: 'Game detail',
    select_game_hint: 'Double-click a game above to load it.',
    rule: 'Rule',
    parameters: 'Parameters',
    engine_params: 'Engine parameters (Stockfish)',
    engine_threads_hint: 'Number of Stockfish CPU threads. 1 = least load, higher = faster analysis but uses more cores.',
    engine_hash_hint: 'Transposition table size in RAM. 1024 = 1 GB. Bigger = usually faster (do not exceed free RAM).',
    analyze: '▶ Analyze',
    stop: '■ Stop',
    status_analyzing: 'analyzing...',
    status_done: 'done · {n} matches ({sec} s)',
    status_stopped: 'stopped · {n} matches',
    rule_header_start: 'Rule: {rule} · waiting for matches...',
    rule_header_running: 'Rule: running · {n} matches',
    rule_header_stopped: 'Rule: STOPPED · {n} matches',
    rule_header_progress: 'Rule: progress · {games} games, {matches} matches',
    rule_header_done: 'Rule: finished{scanned} · {matches} matches',
    games_scanned_suffix: ' · scanned {n} games',
    no_pgn_selected: 'Pick a PGN file first (double-click in the middle list).',
    error_prefix: 'Error: ',
    no_results_yet: 'No matches.',
    pgn_list_click: 'Click to load games',
    bubble_include: 'Include in PDF',
    bubble_click: 'Click to load this game and jump to this position',
    pdf_export_progress: '⏳ PDF',
    pgn_export_progress: '⏳ PGN',
    pdf_blocked_msg: 'PDF export is not available for this rule (only Rule 1 — Blunder, Rule 2 — Zwischenzug, Rule 4 — Mate, Rule 5 — Only Move).',
    pdf_no_rule_tooltip: 'PDF export is not available for this rule (only rule 1, 2, 4, 5)',
    pdf_wait_tooltip: 'PDF will be available once analysis produces matches',
    pdf_count_tooltip: 'Download {sel} of {total} positions as PDF (selected only)',
    pgn_wait_tooltip: 'PGN will be available once analysis produces matches',
    pgn_count_tooltip: 'Download annotated PGN of {sel} of {total} games',
    select_all_idle_tooltip: 'After analysis runs you can bulk select / deselect matches for PDF',
    select_all_select_tooltip: 'Select all for PDF',
    select_all_unselect_tooltip: 'Deselect all for PDF',
    fen_editor_tooltip: 'Open Lichess board editor with the current FEN',
    fen_editor_label: '🔗 board editor',
    pgn_source_unknown: 'Source PGN file unknown — run the analysis again.',
    pgn_error_prefix: 'PGN generation failed: ',
    error_generic: 'Error: ',
    pdf_failed: 'PDF export failed: ',
    mate_in_label: 'mate in N moves',
    mate_in_hint: 'Number of moves to mate (1–5). 1 = direct mate in one, no preceding moves. For 2+ you get (N-1) rows to constrain moves leading to mate.',
    mate_overall_hint:
      'For each move you can constrain mandatory properties. "any" = filter ignored. ' +
      'Both colors apply (mating side and defender) — row mate-1 is the move just before ' +
      'mate, mate-{N-1} is the most distant one.',
    mate_row_title: 'move mate-{n}',
    mate_attr_check: 'check',
    mate_attr_capture: 'capture',
    mate_attr_promotion: 'promotion',
    mate_opt_any: 'any',
    mate_opt_yes: 'yes',
    mate_opt_no: 'no',
  },
};

function t(key, vars) {
  let v = (I18N[state.lang] && I18N[state.lang][key]) || (I18N.cs[key]) || key;
  if (vars) for (const k in vars) v = v.split('{' + k + '}').join(String(vars[k]));
  return v;
}

function tr(field) {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'object') return field[state.lang] || field.cs || field.en || '';
  return String(field);
}

function applyLanguage(lang) {
  state.lang = (lang === 'en') ? 'en' : 'cs';
  localStorage.setItem('lang', state.lang);
  document.documentElement.setAttribute('lang', state.lang);

  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.setAttribute('title', t(el.dataset.i18nTitle));
  });

  const langBtn = document.getElementById('lang-toggle');
  if (langBtn) langBtn.textContent = state.lang === 'cs' ? '🌐 CS' : '🌐 EN';

  renderRuleSelect();
  renderRuleUI();
  updateExportPdfButton();
  updateSelectAllButton();
}

// -------- Rule definitions (parameter schemas + descriptions) --------
// Hodnoty typu {cs:'…', en:'…'} se rozbalují přes tr() / ruleDef().

const MIN_ELO_PARAM = {
  key: 'min_elo', type: 'number', default: 0,
  label: { cs: 'min Elo obou hráčů', en: 'min Elo of both players' },
  hint: {
    cs: '0 = bez filtru (všechny partie). Jinak partie projde jen pokud má oba hráče s Elo ≥ tato hodnota.',
    en: '0 = no filter (all games). Otherwise the game qualifies only if both players have Elo ≥ this value.',
  },
};

const RULE_DEFS = {
  blunder: {
    label: { cs: 'Rule 1 — Blunder', en: 'Rule 1 — Blunder' },
    description: {
      cs: 'Hledá pozice, kde hráč zahrál tah výrazně horší než nejlepší tah dle Stockfishe. Spouští se přes všechny partie ve vybraném PGN.',
      en: 'Finds positions where the player made a move significantly worse than Stockfish\'s best. Runs over every game in the selected PGN.',
    },
    params: [
      MIN_ELO_PARAM,
      { key: 'min_loss_cp', type: 'number', default: 100,
        label: { cs: 'min ztráta (cp)', en: 'min loss (cp)' },
        hint: { cs: 'Tah je mistake/blunder, pokud je horší o tolik centipawnů nebo víc. 100 cp = 1 pěšec.',
                en: 'A move is a mistake/blunder when it loses at least this many centipawns. 100 cp = 1 pawn.' } },
      { key: 'tie_tolerance_cp', type: 'number', default: 20,
        label: { cs: 'tie tolerance (cp)', en: 'tie tolerance (cp)' },
        hint: { cs: 'Tahy do této vzdálenosti od top tahu se považují za rovnocenné. Hráč není ve chybě, když zahrál jeden z nich.',
                en: 'Moves within this many cp of the top move count as equally good — the player is not at fault if they played one of them.' } },
      { key: 'eval_min_cp', type: 'number', default: -100000,
        label: { cs: 'min eval před tahem (cp)', en: 'min eval before move (cp)' },
        hint: { cs: 'Filtr na hodnocení pozice před zahraným tahem (z pohledu hráče). -100000 = bez spodní hranice. Doporučeno např. 150 — pozice musí mít zřetelnou výhodu, jinak "blunder" v už ztracené pozici nedává smysl.',
                en: 'Filter on the position\'s eval before the played move (player POV). -100000 = no lower bound. Try 150 — position must have a clear advantage, otherwise "blunder" in an already lost position is meaningless.' } },
      { key: 'eval_max_cp', type: 'number', default: 100000,
        label: { cs: 'max eval před tahem (cp)', en: 'max eval before move (cp)' },
        hint: { cs: 'Horní mez. 100000 = bez horní hranice. Doporučeno např. 500 — pozice nesmí být už triviálně vyhraná.',
                en: 'Upper bound. 100000 = no upper bound. Try 500 — exclude trivially winning positions.' } },
      { key: 'depth', type: 'number', default: 16,
        label: { cs: 'depth', en: 'depth' },
        hint: { cs: 'Hloubka prohledávání Stockfishe (počet půltahů). Vyšší = přesnější, pomalejší.',
                en: 'Stockfish search depth (half-moves). Higher = more accurate, slower.' } },
      { key: 'multipv', type: 'number', default: 3,
        label: { cs: 'multipv', en: 'multipv' },
        hint: { cs: 'Kolik nejlepších linií engine počítá. Vyšší = bezpečnější tie detekce, pomalejší.',
                en: 'How many top lines the engine computes. Higher = safer tie detection, slower.' } },
    ],
  },
  only_move: {
    label: { cs: 'Rule 5 — Only move (jediný správný tah)', en: 'Rule 5 — Only move' },
    description: {
      cs: 'Hledá pozice, kde existuje jediný správný tah — po něm je pozice rovná, ale druhý nejlepší (a všechny další) výrazně ztrácí. Klasická tréninková „najdi přesný tah" kategorie. Best move nesmí být braní (vyřadí triviální rekapitulace).',
      en: 'Finds positions with a unique correct move — after it the eval is balanced, while every other multipv line loses badly. Classic "find the only move" training set. Best move must not be a capture (skips trivial recaptures).',
    },
    params: [
      MIN_ELO_PARAM,
      { key: 'best_max_abs_cp', type: 'number', default: 150,
        label: { cs: '|best| max (cp)', en: '|best| max (cp)' },
        hint: { cs: 'Po nejlepším tahu je pozice „rovná" — |eval| ≤ tato hodnota (z pohledu hráče). 150 = ±1.5 pěšce.',
                en: 'After the best move the position is "balanced" — |eval| ≤ this value (player POV). 150 = ±1.5 pawn.' } },
      { key: 'second_max_cp', type: 'number', default: -200,
        label: { cs: '2. nejlepší max (cp)', en: '2nd best max (cp)' },
        hint: { cs: 'Druhý nejlepší tah musí klesnout pod tuto hodnotu (z pohledu hráče). -200 = 2. nejlepší ztrácí aspoň 2 pěšce.',
                en: 'The second-best move must fall below this value (player POV). -200 = 2nd best loses at least 2 pawns.' } },
      { key: 'min_gap_cp', type: 'number', default: 120,
        label: { cs: 'min gap (cp)', en: 'min gap (cp)' },
        hint: { cs: 'Minimální rozdíl best − 2. best (z pohledu hráče). 120 = best musí být o 1.2 pěšce lepší.',
                en: 'Minimum gap best − 2nd best (player POV). 120 = best must be 1.2 pawn better.' } },
      { key: 'exclude_captures', type: 'checkbox', default: true,
        label: { cs: 'best nesmí být braní', en: 'best must not be a capture' },
        hint: { cs: 'Vyřadí pozice, kde jediný správný tah je braní — typicky triviální rekapitulace.',
                en: 'Excludes positions where the only good move is a capture — typically trivial recaptures.' } },
      { key: 'depth', type: 'number', default: 16,
        label: { cs: 'depth', en: 'depth' },
        hint: { cs: 'Hloubka prohledávání Stockfishe. Vyšší = přesnější, pomalejší.',
                en: 'Stockfish search depth. Higher = more accurate, slower.' } },
      { key: 'multipv', type: 'number', default: 3,
        label: { cs: 'multipv', en: 'multipv' },
        hint: { cs: 'Kolik nejlepších linií engine počítá (potřebujeme alespoň 2 pro porovnání).',
                en: 'How many top lines the engine computes (need at least 2).' } },
    ],
  },
  zwischenzug: {
    label: { cs: 'Rule 2 — Zwischenzug', en: 'Rule 2 — Zwischenzug' },
    description: {
      cs: 'Hledá pozice, kde po soupeřově braní engine doporučuje non-recapture (mezitah). Spouští se přes všechny partie ve vybraném PGN.',
      en: 'Finds positions where, after the opponent\'s capture, the engine recommends a non-recapture (intermezzo). Runs over every game in the selected PGN.',
    },
    params: [
      MIN_ELO_PARAM,
      { key: 'min_gain_cp', type: 'number', default: 100,
        label: { cs: 'min gain (cp)', en: 'min gain (cp)' },
        hint: { cs: 'O kolik musí být mezitah lepší než nejlepší rekapitulace, aby pravidlo fires (cp). Ignoruje se, když je mezitah šach a "šach ignoruje gap" je zapnuté.',
                en: 'How much better the intermezzo must be than the best recapture for the rule to fire (cp). Ignored when the intermezzo is a check and "check ignores gap" is on.' } },
      { key: 'require_check_or_capture', type: 'checkbox', default: true,
        label: { cs: 'jen šach / branný', en: 'check or capture only' },
        hint: { cs: 'Mezitah musí být šach nebo branný — odfiltruje klidné vývinové tahy, které nejsou taktický mezitah.',
                en: 'The intermezzo must be a check or capture — filters out quiet developing moves that are not a tactical intermezzo.' } },
      { key: 'min_player_cp', type: 'number', default: -100,
        label: { cs: 'min hráčův eval (cp)', en: 'min player eval (cp)' },
        hint: { cs: 'Hráč po mezitahu nesmí být pod touhle hodnotou (z jeho pohledu). Vyřadí prohrané pozice, kde mezitah jen oddálí porážku.',
                en: 'Player\'s eval after the intermezzo must not be below this (player POV). Excludes lost positions where the intermezzo just delays defeat.' } },
      { key: 'check_skips_gap', type: 'checkbox', default: true,
        label: { cs: 'šach ignoruje gap', en: 'check ignores gap' },
        hint: { cs: 'Pokud je mezitah šach, fires bez ohledu na velikost gapu — šachy jsou téměř vždy zwischenzug.',
                en: 'If the intermezzo is a check, fire regardless of the gap — checks are almost always intermezzos.' } },
      { key: 'depth', type: 'number', default: 16,
        label: { cs: 'depth', en: 'depth' },
        hint: { cs: 'Hloubka prohledávání Stockfishe. Vyšší = přesnější, pomalejší.',
                en: 'Stockfish search depth. Higher = more accurate, slower.' } },
      { key: 'multipv', type: 'number', default: 3,
        label: { cs: 'multipv', en: 'multipv' },
        hint: { cs: 'Kolik nejlepších linií engine počítá. Vyšší = lepší rekapitulační eval.',
                en: 'How many top lines the engine computes. Higher = better recapture eval.' } },
    ],
  },
  mate: {
    label: { cs: 'Rule 4 — Mat (mate in N)', en: 'Rule 4 — Mate (mate in N)' },
    description: {
      cs: 'Hledá pozice s vynuceným matem v zadaném počtu tahů (1–5). Pro mat v 1 stačí najít pozici s matujícím tahem. Pro mat v 2 a víc můžeš popsat vlastnosti každého tahu vedoucího k matu (šach? braní? promotion?).',
      en: 'Finds positions with a forced mate in N moves (1–5). For mate in 1 it\'s enough to find the mating position. For 2+ you can constrain properties of each move leading to mate (check? capture? promotion?).',
    },
    params: [ MIN_ELO_PARAM ],
    customRender: true,
  },
  pawn_structure: {
    label: { cs: 'Rule 3 — Struktura / rozestavění', en: 'Rule 3 — Structure / placement' },
    description: {
      cs: 'Hledá partie, ve kterých vznikla zadaná struktura figurek a pěšců. Spouští se přes všechny partie ve vybraném PGN.',
      en: 'Finds games containing the given piece/pawn structure. Runs over every game in the selected PGN.',
    },
    params: [
      MIN_ELO_PARAM,
      { key: 'fen', type: 'text', default: '8/8/8/8/3P4/4P3/PP3PPP/8 w - - 0 1', extra: 'fen-buttons',
        label: { cs: 'FEN', en: 'FEN' },
        hint: { cs: 'Pravidlo se dívá doslova na FEN — všechny zadané figurky musí být na svých čtvercích, té barvy a typu. Subset match: ostatní pole jsou libovolná.',
                en: 'The rule reads the FEN literally — every specified piece must be on its square in the right color/type. Subset match: other squares are arbitrary.' } },
      { key: 'opening_moves', type: 'text', default: '',
        placeholder: { cs: '1.d4 Nf6 2.c4 e6 3.Nc3 Bb4 4.a3 Bxc3+ 5.bxc3', en: '1.d4 Nf6 2.c4 e6 3.Nc3 Bb4 4.a3 Bxc3+ 5.bxc3' },
        label: { cs: 'zahájení (volitelné)', en: 'opening (optional)' },
        hint: { cs: 'Volitelně PGN tahy — partie musí projít touhle pozicí (různé transpozice ano). Prázdné = libovolné zahájení.',
                en: 'Optional PGN moves — the game must pass through this position (transpositions allowed). Empty = any opening.' } },
    ],
  },
};

function ruleDef(name) {
  const def = RULE_DEFS[name];
  if (!def) return null;
  return {
    label: tr(def.label),
    description: tr(def.description),
    customRender: def.customRender,
    params: (def.params || []).map(p => ({
      ...p,
      label: tr(p.label),
      hint: tr(p.hint),
      placeholder: tr(p.placeholder),
    })),
  };
}

const RULE_ORDER = ['blunder', 'zwischenzug', 'pawn_structure', 'mate', 'only_move'];

function renderRuleSelect() {
  const sel = document.getElementById('rule-select');
  if (!sel) return;
  const prev = state.selectedRule;
  sel.innerHTML = '';
  for (const name of RULE_ORDER) {
    const d = ruleDef(name);
    if (!d) continue;
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = d.label;
    if (name === prev) opt.selected = true;
    sel.appendChild(opt);
  }
}

// -------- Chessboard --------

let board = null;

function initBoard() {
  board = Chessboard('board', {
    position: 'start',
    showNotation: true,
    pieceTheme: '/static/pieces/{piece}.png',
  });
  updateFENDisplay('start');
}

function applyCurrentPosition() {
  if (!state.gameDetail) {
    board.position('start');
    updateFENDisplay('start');
    return;
  }
  const fen = state.gameDetail.fens[state.currentMoveIdx];
  // chessboard.js accepts FEN's piece placement portion
  const placement = fen.split(' ')[0];
  board.position(placement, /* useAnimation= */ true);
  updateFENDisplay(fen);
  updateMoveCounter();
  highlightCurrentMove();
}

function updateFENDisplay(fen) {
  const finalFen = fen === 'start'
    ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    : fen;
  document.getElementById('fen').value = finalFen;
  // fallback href (FEN analysis) — kliknutím se ale spustí openInLichess() který
  // pošle PGN, pokud je partie otevřená
  document.getElementById('open-in-lichess').href =
    `https://lichess.org/analysis/${encodeURIComponent(finalFen)}`;
}

function buildPgnFromDetail(detail) {
  const lines = [];
  const push = (k, v) => { if (v && v !== '?') lines.push(`[${k} "${v}"]`); };
  push('Event', detail.event);
  push('Date', detail.date);
  push('White', detail.white);
  push('Black', detail.black);
  push('WhiteElo', detail.white_elo);
  push('BlackElo', detail.black_elo);
  push('Result', detail.result);
  lines.push('');
  const parts = [];
  for (let i = 0; i < detail.moves_san.length; i++) {
    if (i % 2 === 0) parts.push(`${Math.floor(i / 2) + 1}.`);
    parts.push(detail.moves_san[i]);
  }
  if (detail.result && detail.result !== '*') parts.push(detail.result);
  lines.push(parts.join(' '));
  return lines.join('\n');
}

async function openInLichess(e) {
  // Bez načtené partie nech proběhnout výchozí FEN-only link
  if (!state.gameDetail) return;
  e.preventDefault();
  const link = document.getElementById('open-in-lichess');
  const originalText = link.textContent;
  link.textContent = '⏳ Lichess';
  try {
    const pgn = buildPgnFromDetail(state.gameDetail);
    const ply = state.currentMoveIdx;
    const r = await fetch('/api/lichess-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pgn }),
    });
    if (!r.ok) {
      alert('Lichess import selhal: ' + (await r.text()));
      return;
    }
    const data = await r.json();
    if (!data.url) {
      alert('Lichess nevrátil URL');
      return;
    }
    const url = data.url + (ply > 0 ? '#' + ply : '');
    window.open(url, '_blank', 'noopener');
  } finally {
    link.textContent = originalText;
  }
}

function updateMoveCounter() {
  const lastMoveEl = document.getElementById('last-move');
  if (!state.gameDetail || state.currentMoveIdx === 0) {
    lastMoveEl.textContent = '—';
    return;
  }
  const move = state.gameDetail.moves_san[state.currentMoveIdx - 1];
  const fullmove = Math.ceil(state.currentMoveIdx / 2);
  const dots = state.currentMoveIdx % 2 === 1 ? '.' : '...';
  lastMoveEl.textContent = `${fullmove}${dots} ${move}`;
}

// -------- API --------

async function fetchPgns() {
  const r = await fetch('/api/pgns');
  state.pgns = await r.json();
  renderPgnList();
}

async function fetchGames(pgnName) {
  const r = await fetch(`/api/pgns/${encodeURIComponent(pgnName)}/games`);
  state.games = await r.json();
  state.selectedGameIdx = null;
  state.gameDetail = null;
  renderGameList();
  renderGameDetail();
  applyCurrentPosition();
}

async function fetchGameDetail(pgnName, idx) {
  const r = await fetch(`/api/pgns/${encodeURIComponent(pgnName)}/games/${idx}`);
  state.gameDetail = await r.json();
  state.currentMoveIdx = 0;
  renderGameDetail();
  applyCurrentPosition();
}

async function uploadPgn(file) {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch('/api/upload', { method: 'POST', body: fd });
  if (!r.ok) {
    alert('Upload selhal: ' + await r.text());
    return;
  }
  await fetchPgns();
}

let currentAbortController = null;
let currentMatches = [];

function selectedMatches() {
  return currentMatches.filter(m => m.selected !== false);
}

function updateExportPdfButton() {
  const btn = document.getElementById('btn-export-pdf');
  if (!btn) return;
  const allowed = ['blunder', 'zwischenzug', 'mate', 'only_move'].includes(state.selectedRule);
  const total = currentMatches.length;
  const sel = selectedMatches().length;
  btn.disabled = !(allowed && sel > 0);
  if (!allowed) {
    btn.title = t('pdf_no_rule_tooltip');
  } else if (total === 0) {
    btn.title = t('pdf_wait_tooltip');
  } else {
    btn.title = t('pdf_count_tooltip', { sel, total });
  }

  const pgnBtn = document.getElementById('btn-export-pgn');
  if (pgnBtn) {
    pgnBtn.disabled = sel === 0;
    if (total === 0) {
      pgnBtn.title = t('pgn_wait_tooltip');
    } else {
      pgnBtn.title = t('pgn_count_tooltip', { sel, total });
    }
  }
}

function updateSelectAllButton() {
  const btn = document.getElementById('btn-select-all');
  if (!btn) return;
  const total = currentMatches.length;
  const sel = selectedMatches().length;
  if (total === 0) {
    btn.disabled = true;
    btn.textContent = t('select_all');
    btn.title = t('select_all_idle_tooltip');
    return;
  }
  btn.disabled = false;
  const allOn = sel === total;
  btn.textContent = allOn ? t('select_all_off') : t('select_all');
  btn.title = allOn ? t('select_all_unselect_tooltip') : t('select_all_select_tooltip');
}

function toggleSelectAll() {
  if (currentMatches.length === 0) return;
  const allOn = selectedMatches().length === currentMatches.length;
  const newState = !allOn;
  currentMatches.forEach(m => { m.selected = newState; });
  document.querySelectorAll('.result-item-checkbox').forEach(cb => {
    cb.checked = newState;
  });
  updateSelectAllButton();
  updateExportPdfButton();
}

// ---- Client-side PDF generation pomocí jsPDF ----

const PIECE_CODES = ['wP','wN','wB','wR','wQ','wK','bP','bN','bB','bR','bQ','bK'];
let PIECE_IMAGES = null;  // {wP: dataURL, ...} po preloadu

async function preloadPieces() {
  if (PIECE_IMAGES) return PIECE_IMAGES;
  const map = {};
  await Promise.all(PIECE_CODES.map(async code => {
    const r = await fetch(`/static/pieces/${code}.png`);
    if (!r.ok) throw new Error('failed to load ' + code);
    const blob = await r.blob();
    map[code] = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }));
  PIECE_IMAGES = map;
  return map;
}

function asciiText(s) {
  if (!s) return '';
  // NFKD + odstraň combining diacritical marks (U+0300 až U+036F)
  return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function fenToBoard(fen) {
  // 2D pole [rank 0..7][file 0..7], rank 0 = řada 1, rank 7 = řada 8
  const placement = fen.split(' ')[0];
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  const rows = placement.split('/');  // index 0 = rank 8
  for (let i = 0; i < 8; i++) {
    let f = 0;
    for (const ch of rows[i]) {
      if (/\d/.test(ch)) {
        f += parseInt(ch, 10);
      } else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        const piece = ch.toUpperCase();
        board[7 - i][f] = color + piece;
        f++;
      }
    }
  }
  return board;
}

function drawBoardOnPdf(pdf, fen, x, y, size) {
  const board = fenToBoard(fen);
  const cell = size / 8;
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const isLight = (rank + file) % 2 === 1;
      pdf.setFillColor(isLight ? 237 : 181, isLight ? 214 : 136, isLight ? 178 : 99);
      const sx = x + file * cell;
      const sy = y + (7 - rank) * cell;
      pdf.rect(sx, sy, cell, cell, 'F');
      const piece = board[rank][file];
      if (piece && PIECE_IMAGES[piece]) {
        pdf.addImage(PIECE_IMAGES[piece], 'PNG', sx, sy, cell, cell);
      }
    }
  }
  // border
  pdf.setDrawColor(0);
  pdf.setLineWidth(0.3);
  pdf.rect(x, y, size, size);
  // coordinates a-h (under board), 1-8 (left)
  pdf.setFontSize(6);
  pdf.setTextColor(80);
  for (let i = 0; i < 8; i++) {
    pdf.text('abcdefgh'[i], x + i * cell + cell * 0.4, y + size + 2.5);
    pdf.text(String(8 - i), x - 2.5, y + i * cell + cell * 0.65);
  }
  pdf.setTextColor(0);
}

async function exportPdf() {
  const items = selectedMatches();
  if (items.length === 0) return;
  if (!['blunder', 'zwischenzug', 'mate', 'only_move'].includes(state.selectedRule)) {
    alert(t('pdf_blocked_msg'));
    return;
  }
  const btn = document.getElementById('btn-export-pdf');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ PDF';
  try {
    await preloadPieces();
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const PAGE_W = 210, PAGE_H = 297;
    const MARGIN_X = 12, MARGIN_TOP = 18, MARGIN_BOTTOM = 12;
    const COLS = 2, ROWS = 2, PER_PAGE = COLS * ROWS;
    const CELL_W = (PAGE_W - 2 * MARGIN_X) / COLS;
    const CELL_H = (PAGE_H - MARGIN_TOP - MARGIN_BOTTOM) / ROWS;
    const BOARD_SIZE = Math.min(CELL_W, CELL_H) * 0.85;

    for (let i = 0; i < items.length; i++) {
      const m = items[i];
      const slot = i % PER_PAGE;
      if (slot === 0 && i > 0) pdf.addPage();
      if (slot === 0) {
        pdf.setFontSize(11);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`chess-pick - ${state.selectedRule} puzzles`, MARGIN_X, MARGIN_TOP / 2 + 2);
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(100);
        pdf.text(`page ${Math.floor(i / PER_PAGE) + 1}`, PAGE_W - MARGIN_X, MARGIN_TOP / 2 + 2, { align: 'right' });
        pdf.setTextColor(0);
      }
      const col = slot % COLS;
      const row = Math.floor(slot / COLS);
      const cellX = MARGIN_X + col * CELL_W;
      const cellYTop = MARGIN_TOP + row * CELL_H;
      const boardX = cellX + (CELL_W - BOARD_SIZE) / 2;
      const boardY = cellYTop + 14;  // 14 mm rezerva nahoře pro dvouřádkový header

      // Řádek 1 (větší, tučný): #N + jména hráčů
      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'bold');
      const idxStr = `#${i + 1}`;
      pdf.text(idxStr, boardX, boardY - 8);
      // jména v normálním řezu, posunutá doprava o pevný offset (vejde se i #99/999)
      pdf.setFont('helvetica', 'normal');
      const PLAYERS_OFFSET = 12;
      const players = `${asciiText(m.white || '?')} - ${asciiText(m.black || '?')}`;
      let playersLine = players;
      const MAX_PLAYERS_CHARS = 50;
      if (playersLine.length > MAX_PLAYERS_CHARS) {
        playersLine = playersLine.slice(0, MAX_PLAYERS_CHARS - 2) + '..';
      }
      pdf.text(playersLine, boardX + PLAYERS_OFFSET, boardY - 8);

      // Řádek 2 (menší, šedý): turnaj + rok
      let extras = '';
      if (m.event && m.event !== '?') extras += asciiText(m.event);
      if (m.date && m.date !== '?') {
        const year = m.date.split('.')[0];
        if (year && !extras.includes(year)) extras += (extras ? ' ' : '') + year;
      }
      if (extras) {
        const MAX_EXTRAS_CHARS = 60;
        if (extras.length > MAX_EXTRAS_CHARS) {
          extras = extras.slice(0, MAX_EXTRAS_CHARS - 2) + '..';
        }
        pdf.setFontSize(8);
        pdf.setTextColor(110);
        pdf.text(extras, boardX + PLAYERS_OFFSET, boardY - 3);
        pdf.setTextColor(0);
      }

      // board
      drawBoardOnPdf(pdf, m.fen, boardX, boardY, BOARD_SIZE);

      // side label under board
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      const sideLbl = m.side === 'white' ? 'White to move' : 'Black to move';
      pdf.text(sideLbl, boardX + BOARD_SIZE / 2, boardY + BOARD_SIZE + 7, { align: 'center' });
    }

    // ---- Solutions page ----
    pdf.addPage();
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Solutions', MARGIN_X, MARGIN_TOP);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    let sy = MARGIN_TOP + 10;
    const lineH = 5.5;
    for (let i = 0; i < items.length; i++) {
      const m = items[i];
      if (sy > PAGE_H - MARGIN_BOTTOM - 10) {
        pdf.addPage();
        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Solutions (continued)', MARGIN_X, MARGIN_TOP);
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        sy = MARGIN_TOP + 10;
      }
      const side = m.side === 'white' ? 'White' : 'Black';
      const best = m.best || '?';
      const played = m.played || '?';
      pdf.setFont('helvetica', 'bold');
      pdf.text(`#${i + 1}`, MARGIN_X, sy);
      pdf.setFont('helvetica', 'normal');
      let solutionLine;
      if (state.selectedRule === 'mate') {
        // Pro mate: vypisujeme celou matovou sekvenci
        solutionLine = `${side}, ${best}: ${played}`;
      } else {
        solutionLine = `${side}: best = ${best}    (played: ${played})`;
      }
      pdf.text(solutionLine, MARGIN_X + 10, sy);
      const players = `${asciiText(m.white)} - ${asciiText(m.black)}`;
      const event = m.event && m.event !== '?' ? ` | ${asciiText(m.event)}` : '';
      const year = m.date && m.date !== '?' ? ` ${m.date.split('.')[0]}` : '';
      pdf.setFontSize(8);
      pdf.setTextColor(100);
      pdf.text(players + event + year, MARGIN_X + 10, sy + 3.2);
      pdf.setTextColor(0);
      pdf.setFontSize(10);
      sy += lineH + 2;
    }

    // Patička na každé stránce — značka chess-pick
    const totalPages = pdf.getNumberOfPages();
    const ts = new Date().toISOString().slice(0, 10);
    const FOOTER_Y = PAGE_H - 6;
    for (let p = 1; p <= totalPages; p++) {
      pdf.setPage(p);
      pdf.setFontSize(7);
      pdf.setFont('helvetica', 'italic');
      pdf.setTextColor(140);
      pdf.text(
        `Generated by chess-pick · github.com/bardolf/chess-pick · ${ts}`,
        MARGIN_X, FOOTER_Y,
      );
      pdf.text(`${p} / ${totalPages}`, PAGE_W - MARGIN_X, FOOTER_Y, { align: 'right' });
      pdf.setTextColor(0);
      pdf.setFont('helvetica', 'normal');
    }

    pdf.save(`chess-pick-${state.selectedRule}-puzzles.pdf`);
  } catch (e) {
    console.error('[PDF] error:', e);
    alert(t('pdf_failed') + (e.message || e));
  } finally {
    btn.textContent = orig;
    updateExportPdfButton();
  }
}

async function runAnalyze() {
  if (!state.selectedPgn) {
    alert(t('no_pgn_selected'));
    return;
  }
  const params = collectParams();
  const btn = document.getElementById('btn-analyze');
  const stopBtn = document.getElementById('btn-stop');
  const status = document.getElementById('analyze-status');
  const out = document.getElementById('output-area');

  btn.disabled = true;
  stopBtn.disabled = false;
  status.textContent = t('status_analyzing');
  out.innerHTML = '<div class="result-header" id="result-header">analýza spuštěna...</div>';

  currentAbortController = new AbortController();
  currentMatches = [];
  updateExportPdfButton();
  updateSelectAllButton();
  let matchCount = 0;
  const startTime = Date.now();

  try {
    const r = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rule: state.selectedRule,
        pgn: state.selectedPgn,
        params,
        engine: collectEngineParams(),
      }),
      signal: currentAbortController.signal,
    });
    if (!r.ok) {
      out.innerHTML = '<div class="result-empty">' + escape(t('error_prefix') + (await r.text())) + '</div>';
      return;
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        matchCount = handleStreamMessage(msg, matchCount);
      }
    }
    status.textContent = t('status_done', { n: matchCount, sec: ((Date.now() - startTime) / 1000).toFixed(1) });
  } catch (e) {
    if (e.name === 'AbortError') {
      status.textContent = t('status_stopped', { n: matchCount });
      const h = document.getElementById('result-header');
      if (h) h.textContent = t('rule_header_stopped', { n: matchCount });
    } else {
      out.innerHTML = '<div class="result-empty">' + escape(t('error_prefix') + e.message) + '</div>';
    }
  } finally {
    btn.disabled = false;
    stopBtn.disabled = true;
    currentAbortController = null;
  }
}

function stopAnalyze() {
  if (currentAbortController) currentAbortController.abort();
}

function handleStreamMessage(msg, matchCount) {
  const out = document.getElementById('output-area');
  const h = document.getElementById('result-header');
  if (msg.type === 'start') {
    if (h) h.textContent = t('rule_header_start', { rule: msg.rule });
  } else if (msg.type === 'progress') {
    if (h) h.textContent = t('rule_header_progress', { games: msg.games_scanned, matches: msg.matches_found });
  } else if (msg.type === 'match') {
    matchCount++;
    msg.data.selected = true;
    currentMatches.push(msg.data);
    updateExportPdfButton();
    updateSelectAllButton();
    const item = renderMatchItem(matchCount, msg.data);
    out.appendChild(item);
    if (h) h.textContent = t('rule_header_running', { n: matchCount });
  } else if (msg.type === 'done') {
    if (h) {
      const scanned = msg.games_scanned !== undefined ? t('games_scanned_suffix', { n: msg.games_scanned }) : '';
      h.textContent = t('rule_header_done', { scanned, matches: msg.matches_total });
    }
  } else if (msg.type === 'error') {
    out.innerHTML = '<div class="result-empty">' + escape(t('error_prefix') + msg.message) + '</div>';
  }
  return matchCount;
}

function renderMatchItem(idx, m) {
  const item = document.createElement('div');
  item.className = 'result-item';
  item.dataset.gameIdx = m.game_idx ?? -1;
  item.dataset.ply = m.ply ?? 0;

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'result-item-checkbox';
  cb.checked = m.selected !== false;
  cb.title = t('bubble_include');
  cb.addEventListener('click', (e) => e.stopPropagation());
  cb.addEventListener('change', () => {
    m.selected = cb.checked;
    updateSelectAllButton();
    updateExportPdfButton();
  });
  item.appendChild(cb);

  const body = document.createElement('div');
  body.className = 'result-item-body';
  body.title = t('bubble_click');
  const elo = (e) => (e && e !== '?' ? ` (${e})` : '');
  const side = m.side === 'white' ? 'bílý' : 'černý';
  let tag = `${m.fullmove}. (${side})`;
  let extra = '';
  if (m.played) extra = ` — hráč: ${escape(m.played)} | best: ${escape(m.best)}`;
  body.innerHTML = `
    <div class="result-line"><strong>#${idx}</strong> ${escape(m.white)}${elo(m.white_elo)} – ${escape(m.black)}${elo(m.black_elo)} · ${escape(m.event)}, ${escape(m.date)} · ${escape(m.result)}</div>
    <div class="result-line2">${tag}${extra}</div>
    <div class="result-fen">${escape(m.fen)}</div>
  `;
  body.addEventListener('click', () => {
    const gi = Number(item.dataset.gameIdx);
    const ply = Number(item.dataset.ply);
    if (gi >= 0) {
      state.selectedGameIdx = gi;
      fetchGameDetail(state.selectedPgn, gi).then(() => {
        state.currentMoveIdx = ply;
        applyCurrentPosition();
      });
    }
  });
  item.appendChild(body);
  return item;
}

// -------- Rendering --------

function renderPgnList() {
  const ul = document.getElementById('pgn-list');
  ul.innerHTML = '';
  for (const p of state.pgns) {
    const li = document.createElement('li');
    li.textContent = `${p.name} (${p.size_kb} KB)`;
    if (p.name === state.selectedPgn) li.classList.add('selected');
    li.title = t('pgn_list_click');
    li.addEventListener('click', () => {
      state.selectedPgn = p.name;
      document.getElementById('selected-pgn').textContent = p.name;
      renderPgnList();
      fetchGames(p.name);
    });
    ul.appendChild(li);
  }
}

function renderGameList() {
  const ul = document.getElementById('games-list');
  ul.innerHTML = '';
  for (const g of state.games) {
    const li = document.createElement('li');
    const wElo = g.white_elo !== '?' ? ` (${g.white_elo})` : '';
    const bElo = g.black_elo !== '?' ? ` (${g.black_elo})` : '';
    li.textContent = `${g.white}${wElo} — ${g.black}${bElo}    [${g.result}]`;
    li.title = `${g.event}, ${g.date} — klikni pro načtení na šachovnici`;
    if (g.idx === state.selectedGameIdx) li.classList.add('selected');
    li.addEventListener('click', () => {
      state.selectedGameIdx = g.idx;
      renderGameList();
      fetchGameDetail(state.selectedPgn, g.idx);
    });
    ul.appendChild(li);
  }
}

function renderGameDetail() {
  const area = document.getElementById('game-detail-area');
  if (!state.gameDetail) {
    area.innerHTML = '<em>Vyber partii dvojklikem nahoře.</em>';
    return;
  }
  const g = state.gameDetail;
  const movesHtml = formatMovesHtml(g.moves_san);
  area.innerHTML = `
    <div><strong>${escape(g.white)} (${escape(g.white_elo)}) — ${escape(g.black)} (${escape(g.black_elo)})</strong></div>
    <div><em>${escape(g.event)}, ${escape(g.date)} · ${escape(g.result)}</em></div>
    <div>Zahájení: <strong>${escape(g.opening)}</strong></div>
    <div class="moves">${movesHtml}</div>
  `;
}

function formatMovesHtml(moves) {
  const out = [];
  for (let i = 0; i < moves.length; i++) {
    if (i % 2 === 0) {
      out.push(`<strong>${Math.floor(i / 2) + 1}.</strong>`);
    }
    const cls = (i + 1) === state.currentMoveIdx ? 'move-token current' : 'move-token';
    out.push(`<span class="${cls}" data-idx="${i + 1}">${escape(moves[i])}</span>`);
  }
  return out.join(' ');
}

function highlightCurrentMove() {
  document.querySelectorAll('.move-token').forEach(el => {
    const idx = Number(el.dataset.idx);
    el.classList.toggle('current', idx === state.currentMoveIdx);
  });
}

function formatAnalysisResult(data) {
  if (data.matches && data.matches.length > 0) {
    const lines = [`Pravidlo: ${data.rule}`, `Nálezů: ${data.matches.length}`, ''];
    for (const m of data.matches) {
      const side = m.side === 'white' ? 'bílý' : 'černý';
      const tag = `tah ${m.fullmove} (${side})`;
      const detail = m.played ? ` zahráno: ${m.played} | engine best: ${m.best}` : '';
      const fen = m.fen ? `\n    FEN: ${m.fen}` : '';
      const err = m.error ? `\n    chyba: ${m.error}` : '';
      lines.push(`  ${tag}${detail}${fen}${err}`);
    }
    return lines.join('\n');
  }
  return `Pravidlo: ${data.rule}\nŽádné nálezy v této partii.`;
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// -------- Rule UI --------

function paramStorageKey(ruleName, paramKey) {
  return `chess-pick:param:${ruleName}:${paramKey}`;
}

function renderRuleUI() {
  const def = ruleDef(state.selectedRule);
  if (!def) return;
  document.getElementById('rule-description').textContent = def.description;
  const container = document.getElementById('rule-params');
  container.innerHTML = '';

  // Mate rule má custom dynamický UI — nejdřív bežné parametry, pak řádky pro tahy.
  if (state.selectedRule === 'mate') {
    renderMateUI(container, def);
    return;
  }

  for (const p of def.params) {
    const wrap = document.createElement('div');
    wrap.className = 'param';

    const lbl = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = p.label;
    lbl.appendChild(span);

    const storedRaw = localStorage.getItem(paramStorageKey(state.selectedRule, p.key));

    let input;
    if (p.type === 'checkbox') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = storedRaw !== null ? storedRaw === 'true' : !!p.default;
    } else {
      input = document.createElement('input');
      input.type = p.type;
      input.value = storedRaw !== null ? storedRaw : p.default;
      if (p.placeholder) input.placeholder = p.placeholder;
    }
    input.dataset.key = p.key;
    input.dataset.type = p.type;

    const saveValue = () => {
      const v = p.type === 'checkbox' ? input.checked : input.value;
      localStorage.setItem(paramStorageKey(state.selectedRule, p.key), String(v));
    };
    input.addEventListener('change', saveValue);
    input.addEventListener('input', saveValue);

    lbl.appendChild(input);
    wrap.appendChild(lbl);

    if (p.hint) {
      const hint = document.createElement('div');
      hint.className = 'param-hint';
      hint.textContent = p.hint;
      wrap.appendChild(hint);
    }

    if (p.extra === 'fen-buttons') {
      const btnRow = document.createElement('div');
      btnRow.className = 'fen-buttons';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = t('fen_editor_label');
      editBtn.title = t('fen_editor_tooltip');
      editBtn.addEventListener('click', () => {
        const cur = input.value;
        const url = cur ? `https://lichess.org/editor/${encodeURIComponent(cur)}` : 'https://lichess.org/editor';
        window.open(url, '_blank', 'noopener');
      });
      btnRow.appendChild(editBtn);
      wrap.appendChild(btnRow);
    }

    container.appendChild(wrap);
  }
}

// ---- Mate rule (Rule 4) custom UI ----

// Hodnoty options jsou české keys (kvůli backendu — ten ano/ne/nezáleží
// rozeznává podle stringu); textContent dáváme přes t() ať se v EN módu
// zobrazí localized label.
const MATE_ATTRS = [
  { key: 'check',     labelKey: 'mate_attr_check',     options: ['nezáleží', 'ano', 'ne'] },
  { key: 'capture',   labelKey: 'mate_attr_capture',   options: ['nezáleží', 'ano', 'ne'] },
  { key: 'promotion', labelKey: 'mate_attr_promotion', options: ['nezáleží', 'ano', 'ne'] },
];

function mateOptionLabel(value) {
  if (value === 'ano') return t('mate_opt_yes');
  if (value === 'ne')  return t('mate_opt_no');
  return t('mate_opt_any');
}

function renderMateUI(container, def) {
  // 1) min_elo (sdílený)
  for (const p of def.params) {
    container.appendChild(buildPlainParam(p));
  }

  // 2) mat za N tahů (dropdown 1-5)
  const storedN = localStorage.getItem(paramStorageKey('mate', 'mate_in'));
  const mateIn = storedN ? Math.max(1, Math.min(5, parseInt(storedN))) : 3;

  const mateInWrap = document.createElement('div');
  mateInWrap.className = 'param';
  const mateInLbl = document.createElement('label');
  const mateInSpan = document.createElement('span');
  mateInSpan.textContent = t('mate_in_label');
  mateInLbl.appendChild(mateInSpan);
  const mateInSel = document.createElement('select');
  mateInSel.className = 'mate-select';
  for (const n of [1, 2, 3, 4, 5]) {
    const opt = document.createElement('option');
    opt.value = String(n);
    opt.textContent = String(n);
    if (n === mateIn) opt.selected = true;
    mateInSel.appendChild(opt);
  }
  mateInSel.addEventListener('change', () => {
    localStorage.setItem(paramStorageKey('mate', 'mate_in'), mateInSel.value);
    renderRuleUI();
  });
  mateInLbl.appendChild(mateInSel);
  mateInWrap.appendChild(mateInLbl);

  const mateInHint = document.createElement('div');
  mateInHint.className = 'param-hint';
  mateInHint.textContent = t('mate_in_hint');
  mateInWrap.appendChild(mateInHint);
  container.appendChild(mateInWrap);

  if (mateIn === 1) return;

  // 3) Pro každý tah PŘED matem (mat-{N-1}, mat-{N-2}, ..., mat-1) jeden řádek
  for (let m = mateIn - 1; m >= 1; m--) {
    container.appendChild(buildMateMoveRow(m));
  }

  // 4) Společný popisek pod tahy
  const overall = document.createElement('div');
  overall.className = 'param-hint';
  overall.style.marginLeft = '0';
  overall.style.marginTop = '6px';
  overall.textContent = t('mate_overall_hint');
  container.appendChild(overall);
}

function buildMateMoveRow(moveIndex) {
  // moveIndex = vzdálenost od matu, 1 = těsně před matem
  const row = document.createElement('div');
  row.className = 'mate-row';

  const title = document.createElement('div');
  title.className = 'mate-row-title';
  title.textContent = t('mate_row_title', { n: moveIndex });
  row.appendChild(title);

  for (const attr of MATE_ATTRS) {
    const sk = paramStorageKey('mate', `move_${moveIndex}_${attr.key}`);
    const stored = localStorage.getItem(sk);
    const value = stored != null ? stored : attr.options[0];  // default 'nezáleží'

    const cell = document.createElement('label');
    cell.className = 'mate-cell';
    const lbl = document.createElement('span');
    lbl.textContent = t(attr.labelKey);
    cell.appendChild(lbl);

    const sel = document.createElement('select');
    sel.dataset.mateMove = String(moveIndex);
    sel.dataset.mateAttr = attr.key;
    for (const o of attr.options) {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = mateOptionLabel(o);
      if (o === value) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      localStorage.setItem(sk, sel.value);
    });
    cell.appendChild(sel);
    row.appendChild(cell);
  }
  return row;
}

function buildPlainParam(p) {
  // Plain (number/text/checkbox) param row — výtah z renderRuleUI pro reuse v mate UI.
  const wrap = document.createElement('div');
  wrap.className = 'param';
  const lbl = document.createElement('label');
  const span = document.createElement('span');
  span.textContent = p.label;
  lbl.appendChild(span);
  const stored = localStorage.getItem(paramStorageKey(state.selectedRule, p.key));
  const input = document.createElement('input');
  if (p.type === 'checkbox') {
    input.type = 'checkbox';
    input.checked = stored !== null ? stored === 'true' : !!p.default;
  } else {
    input.type = p.type;
    input.value = stored !== null ? stored : p.default;
    if (p.placeholder) input.placeholder = p.placeholder;
  }
  input.dataset.key = p.key;
  input.dataset.type = p.type;
  const save = () => {
    const v = p.type === 'checkbox' ? input.checked : input.value;
    localStorage.setItem(paramStorageKey(state.selectedRule, p.key), String(v));
  };
  input.addEventListener('change', save);
  input.addEventListener('input', save);
  lbl.appendChild(input);
  wrap.appendChild(lbl);
  if (p.hint) {
    const hint = document.createElement('div');
    hint.className = 'param-hint';
    hint.textContent = p.hint;
    wrap.appendChild(hint);
  }
  return wrap;
}

function collectMateParams() {
  const params = {};
  // shared params (min_elo)
  for (const input of document.querySelectorAll('#rule-params input')) {
    const k = input.dataset.key;
    if (!k) continue;
    params[k] = input.dataset.type === 'number' ? Number(input.value) : input.value;
  }
  // mate_in
  const mateInSel = document.querySelector('#rule-params select.mate-select');
  params.mate_in = mateInSel ? parseInt(mateInSel.value) : 1;
  // moves
  params.moves = [];
  for (let m = params.mate_in - 1; m >= 1; m--) {
    const move = { move_from_mate: m };
    for (const attr of MATE_ATTRS) {
      const sel = document.querySelector(
        `#rule-params select[data-mate-move="${m}"][data-mate-attr="${attr.key}"]`
      );
      move[attr.key] = sel ? sel.value : 'nezáleží';
    }
    params.moves.push(move);
  }
  return params;
}

function collectParams() {
  if (state.selectedRule === 'mate') return collectMateParams();
  const params = {};
  for (const input of document.querySelectorAll('#rule-params input')) {
    const key = input.dataset.key;
    const type = input.dataset.type;
    if (type === 'checkbox') {
      params[key] = input.checked;
    } else if (type === 'number') {
      params[key] = Number(input.value);
    } else {
      params[key] = input.value;
    }
  }
  return params;
}

// -------- Navigation --------

function goToStart() { state.currentMoveIdx = 0; applyCurrentPosition(); }
function goForward() {
  if (!state.gameDetail) return;
  if (state.currentMoveIdx < state.gameDetail.moves_san.length) {
    state.currentMoveIdx++;
    applyCurrentPosition();
  }
}
function goBack() {
  if (state.currentMoveIdx > 0) {
    state.currentMoveIdx--;
    applyCurrentPosition();
  }
}
function goToEnd() {
  if (!state.gameDetail) return;
  state.currentMoveIdx = state.gameDetail.moves_san.length;
  applyCurrentPosition();
}

// -------- Output actions --------

function copyOutput() {
  const text = document.getElementById('output-area').textContent;
  navigator.clipboard.writeText(text);
}

function downloadOutput() {
  const text = document.getElementById('output-area').textContent;
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'analysis.txt';
  a.click();
  URL.revokeObjectURL(url);
}

async function exportPgn() {
  const items = selectedMatches();
  if (items.length === 0) return;
  if (!state.selectedPgn) {
    alert(t('pgn_source_unknown'));
    return;
  }
  const btn = document.getElementById('btn-export-pgn');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ PGN';
  try {
    const r = await fetch('/api/export-pgn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pgn: state.selectedPgn,
        rule: state.selectedRule,
        matches: items,
      }),
    });
    if (!r.ok) {
      const errTxt = await r.text();
      alert(t('pgn_error_prefix') + errTxt);
      return;
    }
    const blob = await r.blob();
    const cd = r.headers.get('content-disposition') || '';
    const m = cd.match(/filename="([^"]+)"/);
    const filename = m ? m[1] : 'chess-pick-marked.pgn';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(t('error_generic') + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
    updateExportPdfButton();
  }
}

// -------- Wire up --------

function setupEvents() {
  document.getElementById('upload-input').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) uploadPgn(f);
  });
  document.getElementById('nav-start').addEventListener('click', goToStart);
  document.getElementById('nav-forward').addEventListener('click', goForward);
  document.getElementById('nav-back').addEventListener('click', goBack);
  document.getElementById('nav-end').addEventListener('click', goToEnd);

  document.getElementById('rule-select').addEventListener('change', (e) => {
    state.selectedRule = e.target.value;
    renderRuleUI();
    updateExportPdfButton();
  });

  document.getElementById('btn-analyze').addEventListener('click', runAnalyze);
  document.getElementById('btn-stop').addEventListener('click', stopAnalyze);
  document.getElementById('btn-copy-output').addEventListener('click', copyOutput);
  document.getElementById('btn-download-output').addEventListener('click', downloadOutput);
  document.getElementById('open-in-lichess').addEventListener('click', openInLichess);
  document.getElementById('btn-export-pdf').addEventListener('click', exportPdf);
  document.getElementById('btn-export-pgn').addEventListener('click', exportPgn);
  document.getElementById('btn-select-all').addEventListener('click', toggleSelectAll);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') goBack();
    else if (e.key === 'ArrowRight') goForward();
    else if (e.key === 'Home') goToStart();
    else if (e.key === 'End') goToEnd();
  });

  // Klik na tah v textu partie → skok na pozici
  document.getElementById('game-detail-area').addEventListener('click', (e) => {
    const tok = e.target.closest('.move-token');
    if (!tok || !state.gameDetail) return;
    const idx = Number(tok.dataset.idx);
    if (!Number.isNaN(idx)) {
      state.currentMoveIdx = idx;
      applyCurrentPosition();
    }
  });

  setupResizers();
  window.addEventListener('resize', () => board && board.resize());
}

// -------- Resizable columns --------

function setupResizers() {
  const main = document.getElementById('main-grid');
  let active = null;
  let startX = 0;
  let startLeft = 0;
  let startMiddle = 0;

  function readCols() {
    const cs = getComputedStyle(main).gridTemplateColumns.split(/\s+/).map(parseFloat);
    return { left: cs[0], middle: cs[2] };
  }
  function writeCols(left, middle) {
    main.style.gridTemplateColumns = `${left}px 6px ${middle}px 6px 1fr`;
  }

  document.querySelectorAll('.resizer').forEach(r => {
    r.addEventListener('mousedown', (e) => {
      active = r.dataset.resizer;
      startX = e.clientX;
      const { left, middle } = readCols();
      startLeft = left;
      startMiddle = middle;
      r.classList.add('active');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ew-resize';
      e.preventDefault();
    });
  });

  document.addEventListener('mousemove', (e) => {
    if (!active) return;
    const dx = e.clientX - startX;
    if (active === 'left') {
      writeCols(Math.max(280, startLeft + dx), startMiddle);
    } else if (active === 'middle') {
      writeCols(startLeft, Math.max(220, startMiddle + dx));
    }
    if (board) board.resize();
  });

  document.addEventListener('mouseup', () => {
    if (active) {
      document.querySelectorAll('.resizer').forEach(r => r.classList.remove('active'));
      active = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      if (board) board.resize();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // Theme — načti uloženou volbu z localStorage
  if (localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light');
  }
  document.getElementById('theme-toggle').addEventListener('click', () => {
    document.body.classList.toggle('light');
    localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
  });
  document.getElementById('lang-toggle').addEventListener('click', () => {
    applyLanguage(state.lang === 'cs' ? 'en' : 'cs');
  });

  initBoard();
  setupEvents();
  setupPiecesAnimations();
  setupEngineParams();
  renderRuleSelect();
  document.getElementById('rule-select').value = state.selectedRule;
  applyLanguage(state.lang);
  fetchPgns();
});

const ENGINE_PARAM_FIELDS = [
  { id: 'engine-threads', key: 'threads', def: 2 },
  { id: 'engine-hash',    key: 'hash',    def: 1024 },
];

function setupEngineParams() {
  ENGINE_PARAM_FIELDS.forEach(f => {
    const el = document.getElementById(f.id);
    if (!el) return;
    const stored = localStorage.getItem(`chess-pick:engine:${f.key}`);
    if (stored !== null) el.value = stored;
    el.addEventListener('change', () => {
      localStorage.setItem(`chess-pick:engine:${f.key}`, el.value);
    });
  });
}

function collectEngineParams() {
  const out = {};
  ENGINE_PARAM_FIELDS.forEach(f => {
    const el = document.getElementById(f.id);
    const n = Number(el && el.value);
    out[f.key] = Number.isFinite(n) && n > 0 ? n : f.def;
  });
  return out;
}

const KNIGHT_FX = {
  colors: ['#ffe060', '#ff8030', '#ff4020', '#ff2010', '#c00000'],
  count: 16, distance: 70, blur: 2, size: [14, 24],
};

const FILES = ['a','b','c','d','e','f','g','h'];
function randomSquare() {
  return FILES[Math.floor(Math.random() * 8)] + (Math.floor(Math.random() * 8) + 1);
}

function setupPiecesAnimations() {
  const knight = document.querySelector('.header-knight');
  if (!knight) return;

  knight.addEventListener('click', () => {
    knight.classList.remove('active');
    void knight.offsetWidth;
    knight.classList.add('active');
    setTimeout(() => knight.classList.remove('active'), 1200);

    const bubble = knight.querySelector('.piece-bubble');
    if (bubble) {
      bubble.textContent = randomSquare() + '!';
      bubble.classList.remove('show');
      void bubble.offsetWidth;
      bubble.classList.add('show');
    }

    spawnKnightParticles(knight);
  });
}

function spawnKnightParticles(host) {
  const cfg = KNIGHT_FX;
  const [sMin, sMax] = cfg.size;
  for (let i = 0; i < cfg.count; i++) {
    const p = document.createElement('div');
    p.className = 'piece-particle';
    const angle = (360 / cfg.count) * i + (Math.random() - 0.5) * 25;
    const distance = cfg.distance * (0.7 + Math.random() * 0.6);
    const duration = 0.55 + Math.random() * 0.45;
    const size = sMin + Math.random() * (sMax - sMin);
    const color = cfg.colors[Math.floor(Math.random() * cfg.colors.length)];
    p.style.setProperty('--angle', angle + 'deg');
    p.style.setProperty('--distance', distance + 'px');
    p.style.setProperty('--duration', duration + 's');
    p.style.width = size + 'px';
    p.style.height = size + 'px';
    p.style.background = `radial-gradient(circle, ${color} 0%, transparent 70%)`;
    p.style.filter = `blur(${cfg.blur}px)`;
    host.appendChild(p);
    setTimeout(() => p.remove(), duration * 1000 + 100);
  }
}
