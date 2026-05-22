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
};

// -------- Rule definitions (parameter schemas + descriptions) --------

const RULE_DEFS = {
  blunder: {
    label: 'Rule 1 — Blunder',
    description:
      'Hledá pozice, kde hráč zahrál tah výrazně horší než nejlepší tah dle Stockfishe. ' +
      'Spouští se přes všechny partie ve vybraném PGN.',
    params: [
      { key: 'min_elo', label: 'min Elo obou hráčů', type: 'number', default: 0,
        hint: '0 = bez filtru (všechny partie). Jinak partie projde jen pokud má oba hráče s Elo ≥ tato hodnota.' },
      { key: 'min_loss_cp', label: 'min ztráta (cp)', type: 'number', default: 100,
        hint: 'Tah je mistake/blunder, pokud je horší o tolik centipawnů nebo víc. 100 cp = 1 pěšec.' },
      { key: 'tie_tolerance_cp', label: 'tie tolerance (cp)', type: 'number', default: 20,
        hint: 'Tahy do této vzdálenosti od top tahu se považují za rovnocenné. Hráč není ve chybě, když zahrál jeden z nich.' },
      { key: 'depth', label: 'depth', type: 'number', default: 16,
        hint: 'Hloubka prohledávání Stockfishe (počet půltahů). Vyšší = přesnější, pomalejší.' },
      { key: 'multipv', label: 'multipv', type: 'number', default: 3,
        hint: 'Kolik nejlepších linií engine počítá. Vyšší = bezpečnější tie detekce, pomalejší.' },
    ],
  },
  zwischenzug: {
    label: 'Rule 2 — Zwischenzug',
    description:
      'Hledá pozice, kde po soupeřově braní engine doporučuje non-recapture (mezitah). ' +
      'Spouští se přes všechny partie ve vybraném PGN.',
    params: [
      { key: 'min_elo', label: 'min Elo obou hráčů', type: 'number', default: 0,
        hint: '0 = bez filtru (všechny partie). Jinak partie projde jen pokud má oba hráče s Elo ≥ tato hodnota.' },
      { key: 'min_gain_cp', label: 'min gain (cp)', type: 'number', default: 100,
        hint: 'O kolik musí být mezitah lepší než nejlepší rekapitulace, aby pravidlo fires (cp). Ignoruje se, když je mezitah šach a "šach ignoruje gap" je zapnuté.' },
      { key: 'require_check_or_capture', label: 'jen šach / branný', type: 'checkbox', default: true,
        hint: 'Mezitah musí být šach nebo branný — odfiltruje klidné vývinové tahy, které nejsou taktický mezitah.' },
      { key: 'min_player_cp', label: 'min hráčův eval (cp)', type: 'number', default: -100,
        hint: 'Hráč po mezitahu nesmí být pod touhle hodnotou (z jeho pohledu). Vyřadí prohrané pozice, kde mezitah jen oddálí porážku.' },
      { key: 'check_skips_gap', label: 'šach ignoruje gap', type: 'checkbox', default: true,
        hint: 'Pokud je mezitah šach, fires bez ohledu na velikost gapu — šachy jsou téměř vždy zwischenzug.' },
      { key: 'depth', label: 'depth', type: 'number', default: 16,
        hint: 'Hloubka prohledávání Stockfishe. Vyšší = přesnější, pomalejší.' },
      { key: 'multipv', label: 'multipv', type: 'number', default: 3,
        hint: 'Kolik nejlepších linií engine počítá. Vyšší = lepší rekapitulační eval.' },
    ],
  },
  mate: {
    label: 'Rule 4 — Mat (mate in N)',
    description:
      'Hledá pozice s vynuceným matem v zadaném počtu tahů (1–5). ' +
      'Pro mat v 1 stačí najít pozici s matujícím tahem. ' +
      'Pro mat v 2 a víc můžeš popsat vlastnosti každého tahu vedoucího k matu ' +
      '(šach? braní? promotion?).',
    params: [
      { key: 'min_elo', label: 'min Elo obou hráčů', type: 'number', default: 0,
        hint: '0 = bez filtru (všechny partie). Jinak partie projde jen pokud má oba hráče s Elo ≥ tato hodnota.' },
    ],
    // dynamický UI — vlastní renderer
    customRender: true,
  },
  pawn_structure: {
    label: 'Rule 3 — Struktura / rozestavění',
    description:
      'Hledá partie, ve kterých vznikla zadaná struktura figurek a pěšců. ' +
      'Spouští se přes všechny partie ve vybraném PGN.',
    params: [
      { key: 'min_elo', label: 'min Elo obou hráčů', type: 'number', default: 0,
        hint: '0 = bez filtru (všechny partie). Jinak partie projde jen pokud má oba hráče s Elo ≥ tato hodnota.' },
      { key: 'fen', label: 'FEN', type: 'text', default: '8/8/8/8/3P4/4P3/PP3PPP/8 w - - 0 1',
        hint: 'Pravidlo se dívá doslova na FEN — všechny zadané figurky musí být na svých čtvercích, té barvy a typu. Subset match: ostatní pole jsou libovolná.',
        extra: 'fen-buttons' },
      { key: 'opening_moves', label: 'zahájení (volitelné)', type: 'text',
        default: '', placeholder: '1.d4 Nf6 2.c4 e6 3.Nc3 Bb4 4.a3 Bxc3+ 5.bxc3',
        hint: 'Volitelně PGN tahy — partie musí projít touhle pozicí (různé transpozice ano). Prázdné = libovolné zahájení.' },
    ],
  },
};

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

function updateExportPdfButton() {
  const btn = document.getElementById('btn-export-pdf');
  if (!btn) return;
  const allowed = ['blunder', 'zwischenzug', 'mate'].includes(state.selectedRule);
  btn.disabled = !(allowed && currentMatches.length > 0);
  btn.title = allowed
    ? (currentMatches.length > 0
        ? `Stáhnout ${currentMatches.length} pozic jako PDF (client-side)`
        : 'Po spuštění analýzy ti tu nabídnu PDF s diagramy')
    : 'PDF export není pro toto pravidlo k dispozici (jen rule 1, 2, 4)';
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
  if (currentMatches.length === 0) return;
  if (!['blunder', 'zwischenzug', 'mate'].includes(state.selectedRule)) {
    alert('PDF export není pro toto pravidlo k dispozici (jen Rule 1 — Blunder, Rule 2 — Zwischenzug a Rule 4 — Mate).');
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

    for (let i = 0; i < currentMatches.length; i++) {
      const m = currentMatches[i];
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
    for (let i = 0; i < currentMatches.length; i++) {
      const m = currentMatches[i];
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

    pdf.save(`chess-pick-${state.selectedRule}-puzzles.pdf`);
  } catch (e) {
    console.error('[PDF] error:', e);
    alert('PDF export selhal: ' + (e.message || e));
  } finally {
    btn.textContent = orig;
    updateExportPdfButton();
  }
}

async function runAnalyze() {
  if (!state.selectedPgn) {
    alert('Nejdřív vyber PGN soubor (dvojklik na seznam vlevo).');
    return;
  }
  const params = collectParams();
  const btn = document.getElementById('btn-analyze');
  const stopBtn = document.getElementById('btn-stop');
  const status = document.getElementById('analyze-status');
  const out = document.getElementById('output-area');

  btn.disabled = true;
  stopBtn.disabled = false;
  status.textContent = 'analyzuji...';
  out.innerHTML = '<div class="result-header" id="result-header">analýza spuštěna...</div>';

  currentAbortController = new AbortController();
  currentMatches = [];
  updateExportPdfButton();
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
      }),
      signal: currentAbortController.signal,
    });
    if (!r.ok) {
      out.innerHTML = '<div class="result-empty">Chyba: ' + escape(await r.text()) + '</div>';
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
    status.textContent = `hotovo · ${matchCount} nálezů (${((Date.now() - startTime) / 1000).toFixed(1)} s)`;
  } catch (e) {
    if (e.name === 'AbortError') {
      status.textContent = `zastaveno · ${matchCount} nálezů`;
      const h = document.getElementById('result-header');
      if (h) h.textContent = `Pravidlo: ZASTAVENO · ${matchCount} nálezů`;
    } else {
      out.innerHTML = '<div class="result-empty">Chyba: ' + escape(e.message) + '</div>';
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
    if (h) h.textContent = `Pravidlo: ${msg.rule} · čekám na nálezy...`;
  } else if (msg.type === 'progress') {
    if (h) h.textContent = `Pravidlo: progress · ${msg.games_scanned} partií, ${msg.matches_found} nálezů`;
  } else if (msg.type === 'match') {
    matchCount++;
    currentMatches.push(msg.data);
    updateExportPdfButton();
    const item = renderMatchItem(matchCount, msg.data);
    out.appendChild(item);
    if (h) h.textContent = `Pravidlo: běží · ${matchCount} nálezů`;
  } else if (msg.type === 'done') {
    if (h) {
      const scanned = msg.games_scanned !== undefined ? ` · prošlo ${msg.games_scanned} partií` : '';
      h.textContent = `Pravidlo: dokončeno${scanned} · ${msg.matches_total} nálezů`;
    }
  } else if (msg.type === 'error') {
    out.innerHTML = '<div class="result-empty">Chyba: ' + escape(msg.message) + '</div>';
  }
  return matchCount;
}

function renderMatchItem(idx, m) {
  const item = document.createElement('div');
  item.className = 'result-item';
  item.dataset.gameIdx = m.game_idx ?? -1;
  item.dataset.ply = m.ply ?? 0;
  item.title = 'Klikni pro načtení partie a skok na tuto pozici';
  const elo = (e) => (e && e !== '?' ? ` (${e})` : '');
  const side = m.side === 'white' ? 'bílý' : 'černý';
  let tag = `${m.fullmove}. (${side})`;
  let extra = '';
  if (m.played) extra = ` — hráč: ${escape(m.played)} | best: ${escape(m.best)}`;
  item.innerHTML = `
    <div class="result-line"><strong>#${idx}</strong> ${escape(m.white)}${elo(m.white_elo)} – ${escape(m.black)}${elo(m.black_elo)} · ${escape(m.event)}, ${escape(m.date)} · ${escape(m.result)}</div>
    <div class="result-line2">${tag}${extra}</div>
    <div class="result-fen">${escape(m.fen)}</div>
  `;
  item.addEventListener('click', () => {
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
    li.title = 'Klikni pro načtení partií';
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
  const def = RULE_DEFS[state.selectedRule];
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
      editBtn.textContent = '🔗 board editor';
      editBtn.title = 'Otevře Lichess board editor s aktuálním FEN';
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

const MATE_ATTRS = [
  { key: 'check',     label: 'šach',      options: ['nezáleží', 'ano', 'ne'] },
  { key: 'capture',   label: 'braní',     options: ['nezáleží', 'ano', 'ne'] },
  { key: 'promotion', label: 'promotion', options: ['nezáleží', 'ano', 'ne'] },
];

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
  mateInSpan.textContent = 'mat za N tahů';
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
  mateInHint.textContent = 'Počet tahů do matu (1–5). Pro 1 = přímý mat v 1 tahu, žádný předchozí tah. Pro 2+ se zobrazí (N-1) řádků k popisu tahů PŘED matem.';
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
  overall.textContent =
    'Pro každý tah popíšeš jeho povinné vlastnosti. „nezáleží" = filter ignoruje. ' +
    'Tahy se aplikují obě barvy dohromady (matující strana i protivník) — řádek mat-1 ' +
    'je tah těsně před matem, mat-{N-1} je nejvzdálenější.';
  container.appendChild(overall);
}

function buildMateMoveRow(moveIndex) {
  // moveIndex = vzdálenost od matu, 1 = těsně před matem
  const row = document.createElement('div');
  row.className = 'mate-row';

  const title = document.createElement('div');
  title.className = 'mate-row-title';
  title.textContent = `tah mat-${moveIndex}`;
  row.appendChild(title);

  for (const attr of MATE_ATTRS) {
    const sk = paramStorageKey('mate', `move_${moveIndex}_${attr.key}`);
    const stored = localStorage.getItem(sk);
    const value = stored != null ? stored : attr.options[0];  // default 'nezáleží'

    const cell = document.createElement('label');
    cell.className = 'mate-cell';
    const lbl = document.createElement('span');
    lbl.textContent = attr.label;
    cell.appendChild(lbl);

    const sel = document.createElement('select');
    sel.dataset.mateMove = String(moveIndex);
    sel.dataset.mateAttr = attr.key;
    for (const o of attr.options) {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
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

  initBoard();
  setupEvents();
  setupPiecesAnimations();
  document.getElementById('rule-select').value = state.selectedRule;
  renderRuleUI();
  updateExportPdfButton();
  fetchPgns();
});

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
