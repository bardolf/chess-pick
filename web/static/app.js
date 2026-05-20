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
  selectedRule: 'zwischenzug',
};

// -------- Rule definitions (parameter schemas + descriptions) --------

const RULE_DEFS = {
  blunder: {
    label: 'Rule 1 — Blunder',
    description:
      'Hledá pozice, kde hráč zahrál tah výrazně horší než nejlepší tah dle Stockfishe. ' +
      'Spouští se přes všechny partie ve vybraném PGN.',
    params: [
      { key: 'min_loss_cp', label: 'min ztráta (cp)', type: 'number', default: 100,
        hint: 'Tah je blunder, pokud je horší o tolik centipawnů nebo víc. 100 cp = 1 pěšec.' },
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
  pawn_structure: {
    label: 'Rule 3 — Pawn structure',
    description:
      'Hledá partie, ve kterých vznikla zadaná pěšcová struktura. ' +
      'Spouští se přes všechny partie ve vybraném PGN.',
    params: [
      { key: 'fen', label: 'FEN', type: 'text', default: '8/8/8/8/3P4/4P3/PP3PPP/8 w - - 0 1',
        hint: 'FEN se zadanou pěšcovou strukturou. Můžeš dát i figury (jezdce, střelce…) — pravidlo z FEN bere v úvahu pouze pěšce, vše ostatní je dekorativní. Subset match: na šachovnici musí být všechny zadané pěšce, jiné figury/pěšce nikde jinde jsou OK.',
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
  if (!state.gameDetail) {
    document.getElementById('move-counter').textContent = '0 / 0';
    document.getElementById('last-move').textContent = '—';
    return;
  }
  const total = state.gameDetail.moves_san.length;
  document.getElementById('move-counter').textContent = `${state.currentMoveIdx} / ${total}`;
  if (state.currentMoveIdx === 0) {
    document.getElementById('last-move').textContent = '—';
  } else {
    const move = state.gameDetail.moves_san[state.currentMoveIdx - 1];
    const fullmove = Math.ceil(state.currentMoveIdx / 2);
    const dots = state.currentMoveIdx % 2 === 1 ? '.' : '...';
    document.getElementById('last-move').textContent = `${fullmove}${dots} ${move}`;
  }
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

function renderRuleUI() {
  const def = RULE_DEFS[state.selectedRule];
  document.getElementById('rule-description').textContent = def.description;
  const container = document.getElementById('rule-params');
  container.innerHTML = '';
  for (const p of def.params) {
    const wrap = document.createElement('div');
    wrap.className = 'param';

    const lbl = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = p.label;
    lbl.appendChild(span);
    let input;
    if (p.type === 'checkbox') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!p.default;
    } else {
      input = document.createElement('input');
      input.type = p.type;
      input.value = p.default;
      if (p.placeholder) input.placeholder = p.placeholder;
    }
    input.dataset.key = p.key;
    input.dataset.type = p.type;
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

function collectParams() {
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
  });

  document.getElementById('btn-analyze').addEventListener('click', runAnalyze);
  document.getElementById('btn-stop').addEventListener('click', stopAnalyze);
  document.getElementById('btn-copy-output').addEventListener('click', copyOutput);
  document.getElementById('btn-download-output').addEventListener('click', downloadOutput);
  document.getElementById('open-in-lichess').addEventListener('click', openInLichess);

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
  document.getElementById('rule-select').value = state.selectedRule;
  renderRuleUI();
  fetchPgns();
});
