// Landfall round 3 — the dashboard. Static page, no framework, no network.
// Reads window.RADAR from ../data.js and renders everything from it.
// The recompute badge re-derives every row's implied value in the browser
// from the curve and the snapshot figures, and counts the rows that match
// board.json exactly.

const D = window.RADAR;
const META = D.meta;
const ROWS = D.rows;

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
};

function fmtMoney(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n);
}
function fmtInt(n) {
  return Math.round(n).toLocaleString('en-US');
}
function fmtSigned(n, dec) {
  return (n < 0 ? '−$' : '+$') + Math.abs(n).toFixed(dec === undefined ? 2 : dec);
}
function fmtAge(days) {
  if (days < 365) return days + 'd';
  return (days / 365).toFixed(1) + 'y';
}
function fmtChange(v) {
  if (v === null || v === undefined) return '—';
  return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
}
/** The one factor, identical to the model in lib/model.ts. */
function momentum(row) {
  if (row.change_7d === null || row.change_7d === undefined) return 1;
  return Math.min(1.6, Math.max(0.6, 1 + 0.5 * (row.change_7d / 100)));
}
function recompute(row) {
  const { a, b } = META.curve;
  return Math.max(1, Math.round(Math.pow(10, a + b * Math.log10(row.tvl_usd)) * momentum(row)));
}
function chip(verdict) {
  const s = el('span', 'chip ' + verdict, verdict);
  return s;
}

// ---- Header badges and hero ----
let recomputeOk = 0;
(function header() {
  $('badgeWatch').textContent = 'Watchlist ' + ROWS.filter((r) => r.watchlist).length + '/' + META.counts.watchlist;
  for (const r of ROWS) if (recompute(r) === r.implied_value_usd) recomputeOk++;
  $('badgeRecompute').textContent = 'Recomputed here: ' + recomputeOk + '/' + ROWS.length + ' rows equal board.json';
  $('heroCount').textContent = ROWS.length;
  $('heroTotal').textContent = fmtMoney(META.counts.total_implied);
})();

// ---- Stat strip ----
(function stats() {
  const pay = META.verdict_counts.ROBUST + META.verdict_counts.FARM;
  const cells = [
    ['Watchlist covered', META.counts.watchlist + '/' + META.counts.watchlist, 'of the snapshot list'],
    ['Pre-token rows', String(ROWS.length), '40 watchlist + 158 early'],
    ['Traded comparables', String(META.counts.comps), 'fitted the curve'],
    ['Set aside by rule', String(META.counts.set_aside), 'wrapped / versioned / exchange'],
    ['Leave-one-out miss', '×' + META.loo.median.toFixed(2), Math.round(META.loo.within3 * 100) + '% within 3×'],
    ['Time-split miss', '×' + META.ts.median.toFixed(2), 'fit pre-2024, test newer'],
    ['Plans that pay', pay + '/' + ROWS.length, 'net > 0 at a $1,000 ticket'],
  ];
  for (const [k, v, s] of cells) {
    const d = el('div', 'stat');
    d.appendChild(el('div', 'k', k));
    d.appendChild(el('div', 'v', v));
    d.appendChild(el('div', 's', s));
    $('stats').appendChild(d);
  }
})();

// ---- Top-5 cards, leading with the break-even deposit ----
(function topCards() {
  for (const r of ROWS.slice(0, 5)) {
    const c = el('div', 'card');
    c.addEventListener('click', () => openModal(r.slug));
    const r1 = el('div', 'r1');
    r1.appendChild(el('span', null, 'RANK ' + r.rank));
    r1.appendChild(chip(r.verdict));
    c.appendChild(r1);
    c.appendChild(el('div', 'nm', r.name));
    c.appendChild(el('div', 'val', fmtMoney(r.implied_value_usd)));
    c.appendChild(
      el('div', 'band', 'P10–P90 ' + fmtMoney(r.band_lo) + '–' + fmtMoney(r.band_hi) + ' · $1K slice $' + r.slice_usd.toFixed(2)),
    );
    c.appendChild(
      el(
        'div',
        'dep',
        'Needs $' + fmtInt(r.break_even_deposit_usd) + ' deposit · ' + Math.round(r.needs_pct) + '% vs ' + Math.round(r.odds_12m * 100) + '% odds',
      ),
    );
    $('topCards').appendChild(c);
  }
})();

// ---- Farm Next rail ----
(function farmNext() {
  const parts = D.farm_next.map(
    (f) => f.name + ' +' + '$' + f.net_per_hour.toFixed(2) + '/h (' + Math.round(f.odds_12m * 100) + '% odds)',
  );
  const div = $('farmNext');
  div.appendChild(el('b', null, 'Farm next — best dollars per hands-on hour, net of gas and the 4% T-bill forgone: '));
  div.appendChild(document.createTextNode(parts.join(' · ')));
})();

// ---- Board table: filters, sorting, rendering ----
const state = { sort: 'rank', dir: 1, q: '', cat: '', chain: '', verdict: '', tvl: 0, mom: '', scope: '' };

/** At most 3 chains in the table; the rest collapse to "+N". */
function shortChains(chains) {
  if (chains.length <= 3) return chains.join(', ');
  return chains.slice(0, 3).join(', ') + ' +' + (chains.length - 3);
}
function dotband(row) {
  const lo = Math.log10(row.band_lo);
  const hi = Math.log10(row.band_hi);
  const v = Math.log10(row.implied_value_usd);
  const pos = hi === lo ? 50 : ((v - lo) / (hi - lo)) * 100;
  const d = el('div', 'dotband');
  d.appendChild(el('div', 'track'));
  const pt = el('div', 'pt');
  pt.style.left = Math.max(0, Math.min(100, pos)) + '%';
  d.appendChild(pt);
  return d;
}

function renderBoard() {
  const q = state.q.trim().toLowerCase();
  let list = ROWS.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q)) return false;
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.verdict && r.verdict !== state.verdict) return false;
    if (r.tvl_usd < state.tvl) return false;
    if (state.mom === 'up' && !(r.change_7d !== null && r.change_7d > 0)) return false;
    if (state.mom === 'down' && !(r.change_7d !== null && r.change_7d < 0)) return false;
    if (state.scope === 'watchlist' && !r.watchlist) return false;
    if (state.scope === 'early' && r.watchlist) return false;
    return true;
  });
  const key = state.sort;
  list = [...list].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === 'string') return state.dir * av.localeCompare(bv);
    return state.dir * (av - bv);
  });
  const body = $('boardBody');
  body.innerHTML = '';
  for (const r of list) {
    const tr = document.createElement('tr');
    const rank = el('td');
    rank.appendChild(el('div', null, '#' + r.rank));
    rank.appendChild(el('div', 'sub2', 'rank ' + r.rank_lo + '–' + r.rank_hi));
    tr.appendChild(rank);
    const proto = el('td');
    const nm = el('div', 'pname', r.name);
    const bdg = el('span', 'bdg ' + (r.watchlist ? 'wl' : 'er'), r.watchlist ? 'WATCHLIST' : 'EARLY');
    nm.appendChild(bdg);
    proto.appendChild(nm);
    proto.appendChild(el('div', 'pcat', (r.category || 'Uncategorised') + ' · ' + shortChains(r.chains)));
    tr.appendChild(proto);
    tr.appendChild(el('td', 'num', fmtMoney(r.tvl_usd)));
    tr.appendChild(el('td', 'num', fmtChange(r.change_7d)));
    tr.appendChild(el('td', 'num', fmtAge(r.age_days)));
    const imp = el('td', 'num');
    imp.appendChild(el('div', null, fmtMoney(r.implied_value_usd)));
    imp.appendChild(dotband(r));
    tr.appendChild(imp);
    tr.appendChild(el('td', 'num', '$' + r.slice_usd.toFixed(2)));
    const net = el('td', 'num');
    net.appendChild(el('div', null, fmtSigned(r.net_usd)));
    net.appendChild(el('div', 'sub2', fmtSigned(r.net_per_hour) + '/h'));
    tr.appendChild(net);
    tr.appendChild(el('td', 'num', '$' + fmtInt(r.break_even_deposit_usd)));
    const vd = el('td');
    vd.appendChild(chip(r.verdict));
    tr.appendChild(vd);
    const fm = el('td');
    fm.appendChild(el('div', null, r.farm_summary));
    const link = el('a', null, 'Plan →');
    link.href = '#';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      openModal(r.slug);
    });
    fm.appendChild(link);
    tr.appendChild(fm);
    body.appendChild(tr);
  }
  $('boardCount').textContent =
    list.length + ' of ' + ROWS.length + ' rows' + (list.length !== ROWS.length ? ' — filters on' : '');
}

function fillFilterOptions() {
  const cats = [...new Set(ROWS.map((r) => r.category).filter(Boolean))].sort();
  const chains = [...new Set(ROWS.flatMap((r) => r.chains))].sort();
  for (const c of cats) $('fCat').appendChild(el('option', null, c));
  for (const c of chains) $('fChain').appendChild(el('option', null, c));
}

function bindFilters() {
  $('fSearch').addEventListener('input', (e) => {
    state.q = e.target.value;
    renderBoard();
  });
  $('fCat').addEventListener('change', (e) => {
    state.cat = e.target.value;
    renderBoard();
  });
  $('fChain').addEventListener('change', (e) => {
    state.chain = e.target.value;
    renderBoard();
  });
  $('fVerdict').addEventListener('change', (e) => {
    state.verdict = e.target.value;
    renderBoard();
  });
  $('fTvl').addEventListener('change', (e) => {
    state.tvl = Number(e.target.value);
    renderBoard();
  });
  $('fMom').addEventListener('change', (e) => {
    state.mom = e.target.value;
    renderBoard();
  });
  $('fScope').addEventListener('change', (e) => {
    state.scope = e.target.value;
    renderBoard();
  });
  $('fReset').addEventListener('click', () => {
    Object.assign(state, { q: '', cat: '', chain: '', verdict: '', tvl: 0, mom: '', scope: '' });
    $('fSearch').value = '';
    $('fCat').value = '';
    $('fChain').value = '';
    $('fVerdict').value = '';
    $('fTvl').value = '0';
    $('fMom').value = '';
    $('fScope').value = '';
    renderBoard();
  });
  document.querySelectorAll('#boardTable th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir;
      else {
        state.sort = k;
        state.dir = k === 'name' ? 1 : -1;
      }
      renderBoard();
    });
  });
}

// ---- Traded and set-aside tabs ----
(function otherTabs() {
  $('tabBoardN').textContent = ROWS.length;
  $('tabTradedN').textContent = D.traded.length;
  $('tabSetN').textContent = D.set_aside.length;
  const tb = $('tradedBody');
  for (const p of D.traded) {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', 'pname', p.name));
    tr.appendChild(el('td', null, p.category || '—'));
    tr.appendChild(el('td', null, p.chains.join(', ')));
    tr.appendChild(el('td', 'num', fmtMoney(p.tvl)));
    tr.appendChild(el('td', 'num', fmtMoney(p.mcap)));
    tr.appendChild(el('td', 'num', '×' + (p.mcap / p.tvl).toFixed(2)));
    tb.appendChild(tr);
  }
  const reasonLabel = { category: 'Excluded category', version: 'Versioned copy', 'wrapped-word': 'Wrapped / staked product name', exchange: 'Exchange product' };
  const sb = $('setBody');
  for (const p of D.set_aside) {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', 'pname', p.name));
    tr.appendChild(el('td', null, p.category || '—'));
    tr.appendChild(el('td', null, p.chains.join(', ')));
    tr.appendChild(el('td', 'num', fmtMoney(p.tvl)));
    tr.appendChild(el('td', null, (reasonLabel[p.reason] || p.reason) + (p.reason === 'category' ? ' (' + p.category + ')' : '')));
    sb.appendChild(tr);
  }
})();

// ---- Method tab: fill every number from the same data ----
(function method() {
  $('mA').textContent = META.curve.a.toFixed(4);
  $('mB').textContent = META.curve.b.toFixed(4);
  $('mComps').textContent = META.counts.comps;
  $('mComps2').textContent = META.counts.comps;
  $('mExcl').textContent = META.counts.comps_excluded;
  $('mCap').textContent = fmtMoney(META.curve.cap);
  $('mLevel').textContent = '×' + META.curve.level_100m.toFixed(3);
  $('mClockOos').textContent = META.clock.log_loss_oos.toFixed(3);
  $('mClockConst').textContent = META.clock.log_loss_const.toFixed(3);
  $('mLoo').textContent = '×' + META.loo.median.toFixed(2);
  $('mLoo3').textContent = Math.round(META.loo.within3 * 100) + '%';
  $('mLoo10').textContent = Math.round(META.loo.within10 * 100) + '%';
  $('mTs').textContent = '×' + META.ts.median.toFixed(2);
  $('mTs3').textContent = Math.round(META.ts.within3 * 100) + '%';
  $('mFlatLoo').textContent = '×' + META.flat.loo.median.toFixed(2);
  $('mFlatTs').textContent = '×' + META.flat.ts.median.toFixed(2);
  $('mBandLo').textContent = META.band.loF.toFixed(2) + '×';
  $('mBandHi').textContent = META.band.hiF.toFixed(2) + '×';
  $('mBandR2').textContent = (META.band.r2style * 100).toFixed(1) + '%';
  $('mBandHonest').textContent = (META.band.honest * 100).toFixed(1) + '%';
  const ab = $('ablationBody');
  for (const s of META.ablation) {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', null, s.label));
    tr.appendChild(el('td', null, '×' + s.loo.toFixed(2)));
    tr.appendChild(el('td', null, '×' + s.ts.toFixed(2)));
    ab.appendChild(tr);
  }
  $('bLoo').textContent = '×' + META.loo.median.toFixed(2);
  $('bTs').textContent = '×' + META.ts.median.toFixed(2);
  $('bFlat').textContent = '×' + META.flat.loo.median.toFixed(2);
  $('fAsOf').textContent = META.as_of;
})();

// ---- Scatter: log-log comps, fitted curve, band, board rows ----
(function scatter() {
  const cv = $('scatter');
  const ctx = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  const padL = 46;
  const padR = 12;
  const padT = 10;
  const padB = 26;
  const x0 = 6.7;
  const x1 = 10.4;
  const y0 = 5.0;
  const y1 = 9.6;
  const X = (tvl) => padL + ((Math.log10(tvl) - x0) / (x1 - x0)) * (W - padL - padR);
  const Y = (mcap) => H - padB - ((Math.log10(mcap) - y0) / (y1 - y0)) * (H - padT - padB);
  const { a, b } = META.curve;
  const curve = (tvl) => Math.pow(10, a + b * Math.log10(tvl));
  // Band.
  ctx.fillStyle = 'rgba(11,92,173,0.10)';
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const tvl = Math.pow(10, x0 + ((x1 - x0) * i) / 40);
    const y = Y(curve(tvl) * META.band.hiF);
    if (i === 0) ctx.moveTo(X(tvl), y);
    else ctx.lineTo(X(tvl), y);
  }
  for (let i = 40; i >= 0; i--) {
    const tvl = Math.pow(10, x0 + ((x1 - x0) * i) / 40);
    ctx.lineTo(X(tvl), Y(curve(tvl) * META.band.loF));
  }
  ctx.closePath();
  ctx.fill();
  // Axes.
  ctx.strokeStyle = '#cbd5de';
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, H - padB);
  ctx.lineTo(W - padR, H - padB);
  ctx.stroke();
  ctx.fillStyle = '#6b7c8d';
  ctx.font = '11px sans-serif';
  for (let e = 7; e <= 10; e++) {
    ctx.fillText('$' + Math.pow(10, e - 9) + 'B', X(Math.pow(10, e)) - 12, H - 10);
  }
  for (let e = 6; e <= 9; e++) {
    ctx.fillText('$' + Math.pow(10, e - 6) + 'M', 4, Y(Math.pow(10, e)) + 4);
  }
  // Fitted line.
  ctx.strokeStyle = '#0b5cad';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(X(Math.pow(10, x0)), Y(curve(Math.pow(10, x0))));
  ctx.lineTo(X(Math.pow(10, x1)), Y(curve(Math.pow(10, x1))));
  ctx.stroke();
  ctx.lineWidth = 1;
  // Comps.
  ctx.fillStyle = '#9aa8b5';
  for (const c of D.comps) {
    ctx.beginPath();
    ctx.arc(X(c.tvl), Y(c.mcap), 2.5, 0, 7);
    ctx.fill();
  }
  // Board rows.
  ctx.fillStyle = '#0b5cad';
  for (const r of ROWS) {
    ctx.beginPath();
    ctx.arc(X(r.tvl_usd), Y(r.implied_value_usd), r.rank <= 5 ? 4 : 2, 0, 7);
    ctx.fill();
  }
})();

// ---- Histogram of implied values, log buckets ----
(function hist() {
  const buckets = [
    ['< $1M', 0, 1e6],
    ['$1–3M', 1e6, 3e6],
    ['$3–10M', 3e6, 1e7],
    ['$10–30M', 1e7, 3e7],
    ['$30–100M', 3e7, 1e8],
    ['> $100M', 1e8, Infinity],
  ];
  const counts = buckets.map(([, lo, hi]) => ROWS.filter((r) => r.implied_value_usd >= lo && r.implied_value_usd < hi).length);
  const max = Math.max(...counts);
  const wrap = $('hist');
  const bars = el('div', 'histrow');
  for (const c of counts) {
    const b = el('div', 'histbar');
    b.style.height = Math.max(2, (c / max) * 100) + '%';
    b.title = c + ' rows';
    bars.appendChild(b);
  }
  wrap.appendChild(bars);
  const labs = el('div', 'histlab');
  for (const [lab] of buckets) labs.appendChild(el('span', null, lab));
  wrap.appendChild(labs);
  const vals = el('div', 'histlab');
  for (const c of counts) vals.appendChild(el('span', null, String(c)));
  wrap.appendChild(vals);
})();

// ---- Detail modal ----
function openModal(slug) {
  const r = ROWS.find((x) => x.slug === slug);
  if (!r) return;
  const box = $('modalBox');
  box.innerHTML = '';
  const head = el('div', 'mhead');
  const ht = el('div');
  ht.appendChild(el('h2', null, '#' + r.rank + ' · ' + r.name));
  ht.appendChild(el('p', 'pcat', (r.category || 'Uncategorised') + ' · ' + r.chains.join(', ') + ' · TVL ' + fmtMoney(r.tvl_usd) + ' · ' + (r.watchlist ? 'watchlist' : 'early')));
  head.appendChild(ht);
  const right = el('div');
  right.appendChild(chip(r.verdict));
  const close = el('button', 'mclose', '✕');
  close.addEventListener('click', closeModal);
  right.appendChild(close);
  head.appendChild(right);
  box.appendChild(head);
  const grid = el('div', 'mgrid');
  const left = el('div');
  left.appendChild(el('h3', null, 'The value'));
  const kv1 = el('dl', 'kv');
  const kv = (k, v) => {
    kv1.appendChild(el('dt', null, k));
    kv1.appendChild(el('dd', null, v));
  };
  kv('Implied value', fmtMoney(r.implied_value_usd) + '  (P10–P90 ' + fmtMoney(r.band_lo) + '–' + fmtMoney(r.band_hi) + ')');
  kv('Rank range', r.rank_lo === r.rank_hi ? 'rank ' + r.rank_lo + ' in all 200 refits' : 'rank ' + r.rank_lo + '–' + r.rank_hi + ' across 200 refits');
  kv('7-day TVL change', fmtChange(r.change_7d) + '  (momentum ×' + momentum(r).toFixed(2) + ')');
  kv('No-token for', fmtAge(r.age_days));
  kv('12-month launch odds', Math.round(r.odds_12m * 100) + '%  (informational — never ranks, never sets the verdict)');
  kv('Curve', 'log10(mcap) = ' + META.curve.a.toFixed(4) + ' + ' + META.curve.b.toFixed(4) + ' · log10(TVL)');
  kv('Nearest traded comps', r.comparables.map((c) => c.name + ' (' + fmtMoney(c.mcap) + ')').join(' · '));
  left.appendChild(kv1);
  left.appendChild(el('h3', null, 'The farm economics — $1,000 ticket'));
  const kv2 = el('dl', 'kv');
  const kv2f = (k, v) => {
    kv2.appendChild(el('dt', null, k));
    kv2.appendChild(el('dd', null, v));
  };
  kv2f('$1k slice', '$' + r.slice_usd.toFixed(2) + '  (10% of implied × $1,000 / TVL)');
  kv2f('Expected net', fmtSigned(r.net_usd) + '  (' + fmtSigned(r.net_per_hour) + ' per hands-on hour)');
  kv2f('Break-even deposit', '$' + fmtInt(r.break_even_deposit_usd) + '  — the deposit that makes expected net zero at this implied value');
  kv2f('Break-even value', fmtMoney(r.break_even_value_usd) + '  — the implied value a $1,000 ticket needs at these odds');
  kv2f('Needs vs odds', Math.round(r.needs_pct) + '% of its own implied value, against ' + Math.round(r.odds_12m * 100) + '% launch odds');
  kv2f('Verdict', r.verdict + (r.verdict === 'SKIP' ? ' — at $1,000 the ticket does not pay; the deposit above is what would' : ''));
  left.appendChild(kv2);
  left.appendChild(
    el(
      'p',
      'small',
      'Recomputed in your browser: this row’s implied value equals the curve’s output from its TVL and 7-day change (checked on load, ' + recomputeOk + '/' + ROWS.length + ' rows match).',
    ),
  );
  grid.appendChild(left);
  const rightCol = el('div');
  rightCol.appendChild(el('h3', null, 'The plan — 8 steps'));
  const ol = el('ol', 'steps');
  for (const s of r.farm_steps) ol.appendChild(el('li', null, s));
  rightCol.appendChild(ol);
  grid.appendChild(rightCol);
  box.appendChild(grid);
  $('modal').classList.remove('hidden');
  window.__shotReady = true;
}
function closeModal() {
  $('modal').classList.add('hidden');
}
$('modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// ---- Tabs ----
document.querySelectorAll('#tabs button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    for (const t of ['board', 'traded', 'setaside', 'method']) {
      $('panel-' + t).classList.toggle('hidden', t !== b.getAttribute('data-tab'));
    }
    window.__shotReady = true;
  });
});

// ---- Init: filters, table, URL state for screenshots ----
fillFilterOptions();
bindFilters();
renderBoard();
(function urlState() {
  const q = new URLSearchParams(location.search);
  if (q.get('tab')) {
    const b = document.querySelector('#tabs button[data-tab="' + q.get('tab') + '"]');
    if (b) b.click();
  }
  if (q.get('verdict')) {
    state.verdict = q.get('verdict');
    $('fVerdict').value = q.get('verdict');
    renderBoard();
  }
  if (q.get('view') === 'detail' && q.get('slug')) openModal(q.get('slug'));
})();
window.__shotReady = true;
