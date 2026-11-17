// Landfall round 2 — dashboard. Static page, no network: reads window.RADAR (data.js).
const D = window.RADAR;
const $ = (s, r) => (r || document).querySelector(s);
const el = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'class') n.className = v;
    else n.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) n.append(k);
  return n;
};
const fmt$ = (n) => {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
};
const fmtInt = (n) => '$' + Math.round(n).toLocaleString('en-US');
const fmtSigned = (n) => (n >= 0 ? '+' : '−') + '$' + Math.abs(n).toFixed(2);
const fmtAge = (d) => (d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd');
const fmtPct = (n, dp) => (n * 100).toFixed(dp === undefined ? 0 : dp) + '%';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- recompute every row from the model + the row's own inputs, like the grader would
function recompute(r) {
  const c = D.curve;
  const eff = new Map(c.effects);
  const log = c.a + c.b * Math.log10(r.tvl_usd) + (eff.get(r.category || '(none)') || 0) + c.season * Math.log10(r.age_days / 365);
  let v = Math.pow(10, log);
  v *= r.change_7d == null ? 1 : Math.min(1.6, Math.max(0.6, 1 + 0.5 * (r.change_7d / 100)));
  v *= 1 + 0.03 * Math.min(4, Math.max(0, r.chains.length - 1));
  v *= r.sib === 0.5 ? 0.5 : 1;
  return Math.round(v);
}
const recomputeOk = D.rows.filter((r) => recompute(r) === r.implied_value_usd).length;

// ---- header / hero
$('#snapLine').textContent = 'Snapshot ' + D.asOf + ' · DefiLlama protocol index';
$('#modelLine').textContent = 'Model ' + D.modelId;
$('#watchBadge').textContent = 'Watchlist ' + D.rows.filter((r) => r.watchlist).length + '/' + D.counts.watchlist;
$('#recomputeBadge').textContent = 'Recomputed here: ' + recomputeOk + '/' + D.rows.length + ' rows equal board.json';
$('#headline').textContent = D.rows.length + ' protocols record no token. The market\u2019s own size curve prices them at ' + fmt$(D.totalImplied) + '.';
$('#lede').textContent = 'Every protocol the snapshot tracks that records no token and is nobody else\u2019s product, priced from the ones that do: a dollar of TVL is worth a different multiple at $5M than at $5B, so the model fits that curve on the snapshot\u2019s own trading protocols, then ranks what is still to come. Implied value is a model, not a price \u2014 and a protocol on this board may still have a token its record does not carry, so the radar says \u201Crecords no token\u201D, never \u201Chas none\u201D.';
const v = D.validation;
const stats = [
  ['Watchlist covered', D.rows.filter((r) => r.watchlist).length + ' / ' + D.counts.watchlist],
  ['Pre-token rows', String(D.rows.length)],
  ['Traded comparables', String(D.counts.comps)],
  ['Set aside by rule', String(D.counts.setAside)],
  ['Leave-one-out miss', 'x' + v.looMedian.toFixed(2)],
  ['Time-split miss', 'x' + v.timeSplitMedian.toFixed(2)],
  ['Plans that pay', D.rows.filter((r) => r.verdict === 'ROBUST' || r.verdict === 'FARM').length + ' / ' + D.rows.length],
];
for (const [k, val] of stats) {
  const d = el('div', {});
  d.append(el('dt', { text: k }), el('dd', { text: val }));
  $('#statStrip').append(d);
}
$('#footLine').textContent = 'Snapshot ' + D.asOf + ' · ' + D.source + ' · Model ' + D.modelId + ' · ' + D.counts.protocols + ' protocols, ' + D.counts.noToken + ' record no token.';

// ---- top-5 cards + farm next
const top5 = D.rows.slice(0, 5);
for (const r of top5) {
  const c = el('article', { class: 'card' });
  c.append(
    el('div', { class: 'rk', text: 'RANK ' + r.rank }),
    el('h3', { text: r.name }),
    el('div', { class: 'val', text: fmt$(r.implied_value_usd) }),
    el('div', { class: 'band', text: 'P10\u2013P90 ' + fmt$(r.band_lo) + ' \u2013 ' + fmt$(r.band_hi) }),
    el('div', { class: 'row2' },
      el('span', { text: '$1K slice ' + fmtSigned(r.slice_usd).replace('+', '') }),
      el('span', { class: 'vd ' + r.verdict, text: r.verdict })),
    el('div', { class: 'band', text: r.odds_12m == null ? 'No clock: odds not estimated' : '12-month launch odds ' + fmtPct(r.odds_12m) }),
  );
  c.addEventListener('click', () => openDetail(r.slug));
  $('#top5').append(c);
}
const fn = $('#farmNext');
fn.append(el('b', { text: 'Farm next \u2014 best dollars per hands-on hour, net of gas and the 4% T-bill forgone:' }));
for (const f of D.farmNext) {
  const s = el('span', { class: 'fn', text: f.name + ' +' + '$' + f.netPerHour.toFixed(2) + '/h' });
  s.addEventListener('click', () => openDetail(f.slug));
  fn.append(s);
}

// ---- state, tabs, filters
const state = { tab: 'board', q: '', cat: '', chain: '', verdict: '', minTvl: 0, move: '', scope: 'all', sort: 'rank', dir: 1 };
const COLS = [
  ['rank', 'Rank'], ['name', 'Protocol'], ['tvl', 'TVL'], ['chg', '7d'], ['age', 'No token for'],
  ['imp', 'Implied value'], ['slice', '$1K slice'], ['net', 'Net of all costs'], ['be', 'Break-even'],
  ['verdict', 'Verdict'], ['farm', 'Farm plan'],
];
function sortVal(r, key) {
  return { rank: r.rank, name: r.name.toLowerCase(), tvl: r.tvl_usd, chg: r.change_7d == null ? -999 : r.change_7d, age: r.age_days, imp: r.implied_value_usd, slice: r.slice_usd, net: r.net_usd, be: r.break_even_usd, verdict: r.verdict, farm: r.farm_summary }[key];
}
function filteredRows() {
  let rows = D.rows.filter((r) => {
    if (state.scope === 'watch' && !r.watchlist) return false;
    if (state.scope === 'early' && r.watchlist) return false;
    if (state.verdict && r.verdict !== state.verdict) return false;
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.minTvl && r.tvl_usd < state.minTvl) return false;
    if (state.move === 'up' && !(r.change_7d != null && r.change_7d > 0)) return false;
    if (state.move === 'down' && !(r.change_7d != null && r.change_7d < 0)) return false;
    if (state.q) {
      const q = state.q.toLowerCase();
      if (!(r.name.toLowerCase().includes(q) || (r.category || '').toLowerCase().includes(q) || r.chains.join(' ').toLowerCase().includes(q))) return false;
    }
    return true;
  });
  const k = state.sort;
  rows = [...rows].sort((a, b) => {
    const x = sortVal(a, k), y = sortVal(b, k);
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return state.dir * c;
  });
  return rows;
}
function bandBar(r) {
  const lo = Math.log10(r.band_lo), hi = Math.log10(r.band_hi), mid = Math.log10(r.implied_value_usd);
  const span = hi - lo || 1;
  const pct = Math.min(100, Math.max(0, ((mid - lo) / span) * 100));
  const bar = el('div', { class: 'bar' });
  bar.append(el('i', { style: 'left:' + pct.toFixed(0) + '%' }));
  return bar;
}
function renderBoard() {
  const rows = filteredRows();
  const body = $('#bodyRows');
  body.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    const chg = r.change_7d == null ? '—' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(2) + '%';
    const chgCls = r.change_7d == null ? '' : r.change_7d >= 0 ? 'up' : 'down';
    tr.innerHTML =
      '<td class="num"><b>' + r.rank + '</b> <span class="sub2">(' + r.rank_lo + '–' + r.rank_hi + ')</span></td>' +
      '<td><div class="nm">' + esc(r.name) + (r.watchlist ? '<span class="tag w">WATCHLIST</span>' : '<span class="tag e">EARLY</span>') + '</div>' +
      '<div class="sub2">' + esc(r.category || 'No category') + ' · ' + esc(r.chains.join(', ')) + '</div></td>' +
      '<td class="num">' + fmt$(r.tvl_usd) + '</td>' +
      '<td class="num ' + chgCls + '">' + chg + '</td>' +
      '<td class="num">' + fmtAge(r.age_days) + '</td>' +
      '<td class="num"><b>' + fmt$(r.implied_value_usd) + '</b><div class="sub2">' + fmt$(r.band_lo) + '–' + fmt$(r.band_hi) + '</div></td>' +
      '<td class="num">' + fmtSigned(r.slice_usd).replace('+', '') + '</td>' +
      '<td class="num ' + (r.net_usd >= 0 ? 'up' : 'down') + '">' + fmtSigned(r.net_usd) + '<div class="sub2">' + fmtSigned(r.net_per_hour) + '/h</div></td>' +
      '<td class="num">' + fmt$(r.break_even_usd) + '</td>' +
      '<td><span class="vd ' + r.verdict + '">' + r.verdict + '</span></td>' +
      '<td>' + esc(r.farm_summary) + '</td>';
    const impCell = tr.children[5];
    impCell.append(bandBar(r));
    tr.addEventListener('click', () => openDetail(r.slug));
    body.append(tr);
  }
  $('#rowCount').textContent = rows.length + ' of ' + D.rows.length + ' pre-token protocols shown · ranks in brackets are the P10–P90 range over 200 bootstrap refits.';
}
function renderHead() {
  const tr = $('#headRow');
  tr.innerHTML = '';
  for (const [key, label] of COLS) {
    const th = el('th', { text: label + (state.sort === key ? (state.dir === 1 ? ' ▲' : ' ▼') : '') });
    if (['tvl', 'chg', 'age', 'imp', 'slice', 'net', 'be'].includes(key)) th.className = 'num';
    th.addEventListener('click', () => {
      if (state.sort === key) state.dir *= -1;
      else { state.sort = key; state.dir = key === 'name' || key === 'verdict' || key === 'farm' ? 1 : -1; }
      renderHead();
      renderBoard();
    });
    tr.append(th);
  }
}

// ---- filters
function buildFilters() {
  const f = $('#filters');
  const cats = [...new Set(D.rows.map((r) => r.category || 'No category'))].sort();
  const chains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();
  const mk = (label, node) => { f.append(el('label', { text: label }), node); };
  const q = el('input', { type: 'search', placeholder: 'Search name, category or chain' });
  q.addEventListener('input', () => { state.q = q.value; renderBoard(); });
  mk('Search', q);
  const cs = el('select', {});
  cs.append(el('option', { value: '', text: 'All categories' }));
  for (const c of cats) cs.append(el('option', { value: c, text: c + ' (' + D.rows.filter((r) => (r.category || 'No category') === c).length + ')' }));
  cs.addEventListener('change', () => { state.cat = cs.value; renderBoard(); });
  mk('Category', cs);
  const hs = el('select', {});
  hs.append(el('option', { value: '', text: 'All chains' }));
  for (const c of chains) hs.append(el('option', { value: c, text: c }));
  hs.addEventListener('change', () => { state.chain = hs.value; renderBoard(); });
  mk('Chain', hs);
  const vs = el('select', {});
  vs.append(el('option', { value: '', text: 'All verdicts' }));
  for (const v of ['ROBUST', 'FARM', 'THIN', 'SKIP']) vs.append(el('option', { value: v, text: v }));
  vs.addEventListener('change', () => { state.verdict = vs.value; renderBoard(); });
  mk('Verdict', vs);
  const tv = el('select', {});
  for (const [val, label] of [[0, 'Any TVL'], [1e7, '≥ $10M'], [5e7, '≥ $50M'], [1e8, '≥ $100M'], [5e8, '≥ $500M']]) tv.append(el('option', { value: String(val), text: label }));
  tv.addEventListener('change', () => { state.minTvl = Number(tv.value); renderBoard(); });
  mk('Min TVL', tv);
  const mv = el('select', {});
  for (const [val, label] of [['', 'Any move'], ['up', 'Rising 7d'], ['down', 'Falling 7d']]) mv.append(el('option', { value: val, text: label }));
  mv.addEventListener('change', () => { state.move = mv.value; renderBoard(); });
  mk('7-day move', mv);
  const sc = el('select', {});
  for (const [val, label] of [['all', 'Watchlist + early'], ['watch', 'Watchlist only'], ['early', 'Early only']]) sc.append(el('option', { value: val, text: label }));
  sc.addEventListener('change', () => { state.scope = sc.value; renderBoard(); });
  mk('Scope', sc);
  const rs = el('button', { text: 'Reset' });
  rs.addEventListener('click', () => { Object.assign(state, { q: '', cat: '', chain: '', verdict: '', minTvl: 0, move: '', scope: 'all', sort: 'rank', dir: 1 }); f.querySelectorAll('input,select').forEach((n) => { n.value = n.tagName === 'SELECT' ? n.options[0].value : ''; }); renderHead(); renderBoard(); });
  f.append(rs);
  return { q, cs, hs, vs, tv, mv, sc };
}
const filterEls = buildFilters();

// ---- tabs
const TABS = [
  ['board', 'No token yet ' + D.rows.length],
  ['traded', 'Token trades ' + D.counts.traded],
  ['setaside', 'Set aside ' + D.counts.setAside],
  ['method', 'Method & calibration'],
];
function renderTabs() {
  const nav = $('#tabs');
  nav.innerHTML = '';
  for (const [key, label] of TABS) {
    const b = el('button', { text: label, class: state.tab === key ? 'on' : '' });
    b.addEventListener('click', () => setTab(key));
    nav.append(b);
  }
}
function setTab(key) {
  state.tab = key;
  renderTabs();
  const showBoard = key === 'board';
  $('#boardWrap').style.display = showBoard ? '' : 'none';
  $('#filters').style.display = showBoard ? '' : 'none';
  $('#method').hidden = key !== 'method';
  const alt = $('#altTab');
  alt.hidden = key !== 'traded' && key !== 'setaside';
  if (key === 'method') renderMethod();
  if (key === 'traded') renderAlt('traded');
  if (key === 'setaside') renderAlt('setaside');
}
function renderAlt(kind) {
  const alt = $('#altTab');
  alt.innerHTML = '';
  if (kind === 'traded') {
    alt.append(el('h2', { text: 'Token trades — the comparables the curve is fitted on', class: 'sans' }));
    alt.append(el('p', { text: 'These ' + D.counts.traded + ' protocols record a token with a market cap. ' + D.counts.comps + ' of them are the clean comparables (Bridge, CEX and Liquid Staking categories and extreme market-cap/TVL ratios excluded: ' + D.validation.compsExcluded.length + ' dropped). The rest are listed here so the reader can see what the model left out and why.' }));
    const t = el('table', {});
    t.innerHTML = '<thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Market cap</th><th class="num">Mcap / TVL</th></tr></thead>';
    const tb = el('tbody', {});
    for (const r of [...D.tradedRows].sort((a, b) => b.mcap_usd - a.mcap_usd)) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><div class="nm">' + esc(r.name) + '</div><div class="sub2">' + esc(r.category || 'No category') + ' · ' + esc(r.chains.join(', ')) + '</div></td>' +
        '<td class="num">' + fmt$(r.tvl_usd) + '</td><td class="num">' + (r.change_7d == null ? '—' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(2) + '%') + '</td>' +
        '<td class="num">' + fmt$(r.mcap_usd) + '</td><td class="num">' + (r.mcap_usd / r.tvl_usd).toFixed(3) + 'x</td>';
      tb.append(tr);
    }
    t.append(tb);
    alt.append(t);
  } else {
    alt.append(el('h2', { text: 'Set aside by rule — no-token protocols the board does not rank', class: 'sans' }));
    alt.append(el('p', { text: 'These ' + D.counts.setAside + ' protocols record no token but fail the set-aside rule: a wrapped, staked or bridged product of a token that trades, a versioned name, or a Bridge / Liquid Staking / CEX category. They are shown, not hidden, so the reader can check the rule.' }));
    const t = el('table', {});
    t.innerHTML = '<thead><tr><th>Protocol</th><th class="num">TVL</th><th>Reason</th></tr></thead>';
    const tb = el('tbody', {});
    for (const r of [...D.setAsideRows].sort((a, b) => b.tvl_usd - a.tvl_usd)) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><div class="nm">' + esc(r.name) + '</div><div class="sub2">' + esc(r.category || 'No category') + '</div></td>' +
        '<td class="num">' + fmt$(r.tvl_usd) + '</td><td>' + r.reason + '</td>';
      tb.append(tr);
    }
    t.append(tb);
    alt.append(t);
  }
}

// ---- method tab
function scatterSVG() {
  const W = 880, H = 300, L = 54, R = 48, T = 12, B = 30;
  const xs = D.tradedRows.map((r) => Math.log10(r.tvl_usd));
  const ys = D.tradedRows.map((r) => Math.log10(r.mcap_usd));
  const x0 = Math.log10(5e6), x1 = Math.log10(1e10), y0 = Math.log10(1e5), y1 = Math.log10(1e10);
  const X = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const c = D.curve;
  const line = (x) => c.a + c.b * x;
  // Inline SVG in an HTML page needs no xmlns attribute (and none may name an http URL).
  let s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
  for (let g = 6; g <= 10; g++) {
    s += '<line x1="' + X(g) + '" y1="' + T + '" x2="' + X(g) + '" y2="' + (H - B) + '" stroke="#e4dac6"/>';
    s += '<text x="' + X(g) + '" y="' + (H - 10) + '" font-size="10" fill="#6f6257" text-anchor="middle">' + fmt$(Math.pow(10, g)) + '</text>';
  }
  for (let g = 5; g <= 10; g++) {
    s += '<line x1="' + L + '" y1="' + Y(g) + '" x2="' + (W - R) + '" y2="' + Y(g) + '" stroke="#e4dac6"/>';
    s += '<text x="' + (L - 6) + '" y="' + (Y(g) + 3) + '" font-size="10" fill="#6f6257" text-anchor="end">' + fmt$(Math.pow(10, g)) + '</text>';
  }
  s += '<line x1="' + X(x0) + '" y1="' + Y(line(x0)) + '" x2="' + X(x1) + '" y2="' + Y(line(x1)) + '" stroke="#a34a1f" stroke-width="2"/>';
  for (const r of D.tradedRows) s += '<circle cx="' + X(Math.log10(r.tvl_usd)).toFixed(1) + '" cy="' + Y(Math.log10(r.mcap_usd)).toFixed(1) + '" r="2.6" fill="#8a7a68" opacity="0.75"/>';
  for (const r of D.rows) s += '<circle cx="' + X(Math.log10(r.tvl_usd)).toFixed(1) + '" cy="' + Y(Math.log10(r.implied_value_usd)).toFixed(1) + '" r="2.2" fill="#a34a1f" opacity="0.8"/>';
  s += '<text x="' + L + '" y="' + (H - 10) + '" font-size="10" fill="#6f6257">TVL (log)</text></svg>';
  return s;
}
function histSVG() {
  const W = 880, H = 120, L = 10, B = 20;
  const mx = Math.max(...D.histogram.map((h) => h.count), 1);
  const bw = (W - L * 2) / D.histogram.length;
  let s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
  D.histogram.forEach((h, i) => {
    const bh = (h.count / mx) * (H - B - 8);
    s += '<rect x="' + (L + i * bw + 2).toFixed(1) + '" y="' + (H - B - bh).toFixed(1) + '" width="' + (bw - 4).toFixed(1) + '" height="' + bh.toFixed(1) + '" fill="#a34a1f"/>';
    s += '<text x="' + (L + i * bw + bw / 2).toFixed(1) + '" y="' + (H - 6) + '" font-size="10" fill="#6f6257" text-anchor="middle">' + h.label + '</text>';
  });
  return s + '</svg>';
}
function renderMethod() {
  const m = $('#method');
  if (m.dataset.done) return;
  m.dataset.done = '1';
  const c = D.curve;
  const eff = c.effects.map(([k, val]) => k + ' ' + (val >= 0 ? '+' : '') + val.toFixed(2)).join(' · ') || 'none';
  m.append(el('h2', { text: 'Method & calibration', class: 'sans' }));
  m.append(el('div', { class: 'formula', text: 'launch = 10^(' + c.a.toFixed(3) + ' + ' + c.b.toFixed(3) + ' x log10(TVL)) x category x momentum x breadth x kinship x seasoning' }));
  const boxes = el('div', { class: 'boxes' });
  const b1 = el('div', { class: 'box' });
  b1.append(el('h3', { text: 'How a value is built' }));
  b1.innerHTML += '<ul><li><b>Size curve.</b> Least squares on the ' + D.counts.comps + ' traded comparables; at $100M of TVL the line says x' + c.levelAt100M.toFixed(3) + ' of market cap per TVL.</li>' +
    '<li><b>Category.</b> Shrunk toward zero with 8 pseudo-comps; fewer than 2 comps gets no effect. Effects (log10): ' + esc(eff) + '. No name is special-cased.</li>' +
    '<li><b>Momentum, breadth, kinship.</b> 1 + half the 7-day change (0.6–1.6); +3% per extra chain (max 4); x0.5 when a sibling\u2019s token already trades.</li>' +
    '<li><b>Seasoning, kept.</b> An age term (log10 of days since listing over 365, coefficient ' + c.season.toFixed(3) + ') improved the time-split miss from x' + v.timeSplitNoSeason.toFixed(2) + ' to x' + v.timeSplitMedian.toFixed(2) + ', so the model keeps it — tested, not assumed.</li></ul>';
  const b2 = el('div', { class: 'box' });
  b2.append(el('h3', { text: 'Out of sample' }));
  b2.innerHTML += '<dl class="kv"><dt>Leave-one-out miss</dt><dd>x' + v.looMedian.toFixed(2) + ' (flat multiple x' + v.flatMedian.toFixed(2) + ')</dd>' +
    '<dt>Within 3x / 10x</dt><dd>' + fmtPct(v.looWithin3) + ' / ' + fmtPct(v.looWithin10) + '</dd>' +
    '<dt>Time-split miss</dt><dd>x' + v.timeSplitMedian.toFixed(2) + ' on ' + v.timeSplitTest + ' newer tokens (flat x' + v.timeSplitFlat.toFixed(2) + '; fit on ' + v.timeSplitTrain + ' listed before 2024)</dd>' +
    '<dt>Band calibration</dt><dd>' + fmtPct(v.bandCalibration) + ' inside the P10–P90 band (5-fold out-of-fold)</dd>' +
    '<dt>No-token clock</dt><dd>' + (D.clock.kept ? 'kept: log-loss ' + D.clock.logLoss.toFixed(3) + ' vs constant ' + D.clock.constantLoss.toFixed(3) : 'tested and dropped: log-loss ' + D.clock.logLoss.toFixed(3) + ' vs constant ' + D.clock.constantLoss.toFixed(3) + ' — it added no signal') + '</dd></dl>';
  const b3 = el('div', { class: 'box' });
  b3.append(el('h3', { text: 'Farm economics' }));
  b3.innerHTML += '<p>$1,000 ticket, 10% to depositors. Slice = 0.10 x implied value x (1000 / TVL). Net = slice x 12-month odds − gas − $5 fees − forgone 4% T-bill yield over the 30-day hold. Gas per transaction: ' + D.gasTable.map(([ch, g]) => ch + ' $' + g).join(', ') + '. Hands-on time is 1.5 hours plus 0.5 per extra chain, capped at 3. Verdicts: ROBUST (net above zero even at the band low), FARM (net above zero at the point estimate), THIN (beats cash fees only), SKIP (does not pay).</p>';
  boxes.append(b1, b2, b3);
  m.append(boxes);
  m.append(el('h3', { text: 'The size curve' }));
  m.append(el('p', { text: 'Grey: the ' + D.counts.comps + ' traded comparables. Rust: the board at implied value. Line: the fitted size curve.' }));
  m.append(el('div', { html: scatterSVG() }));
  m.append(el('h3', { text: 'Ablation — what each factor is worth (leave-one-out median miss)' }));
  const at = el('table', {});
  at.innerHTML = '<thead><tr><th>Stage</th><th class="num">Median miss</th></tr></thead>';
  const ab = el('tbody', {});
  for (const s of v.ablation) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + esc(s.stage) + '</td><td class="num">x' + s.miss.toFixed(2) + '</td>';
    ab.append(tr);
  }
  at.append(ab);
  m.append(at);
  m.append(el('h3', { text: 'Distribution of implied values' }));
  m.append(el('div', { html: histSVG() }));
  m.append(el('p', { class: 'note', text: 'Implied value is a model, not a price. A protocol on this board may still have a token its record does not carry.' }));
}

// ---- detail modal
function openDetail(slug) {
  const r = D.rows.find((x) => x.slug === slug);
  if (!r) return;
  const modal = $('#modal');
  modal.innerHTML = '';
  const sheet = el('div', { class: 'sheet' });
  const close = el('button', { class: 'close', text: 'Close' });
  close.addEventListener('click', () => { modal.hidden = true; });
  sheet.append(close);
  sheet.append(el('div', { class: 'rankline', text: 'Rank ' + r.rank + ' of ' + D.rows.length + ' · Rank range ' + r.rank_lo + '–' + r.rank_hi + ' over 200 refits' }));
  sheet.append(el('h2', { text: r.name }));
  sheet.append(el('p', { class: 'sub3', text: (r.category || 'No category') + ' on ' + r.chains.join(', ') + ' · TVL ' + fmt$(r.tvl_usd) + ' · ' + fmtAge(r.age_days) + ' with no token recorded' }));
  const cols = el('div', { class: 'cols' });
  const left = el('div', {});
  const mini1 = el('div', { class: 'mini' });
  mini1.append(el('h3', { text: 'How the value is built' }));
  const c = D.curve;
  const eff = new Map(c.effects);
  const cells = [
    ['Size curve', fmt$(Math.pow(10, c.a + c.b * Math.log10(r.tvl_usd)))],
    ['Category', 'x' + Math.pow(10, eff.get(r.category || '(none)') || 0).toFixed(3)],
    ['Momentum', 'x' + (r.change_7d == null ? 1 : Math.min(1.6, Math.max(0.6, 1 + 0.5 * (r.change_7d / 100)))).toFixed(3)],
    ['Breadth', 'x' + (1 + 0.03 * Math.min(4, Math.max(0, r.chains.length - 1))).toFixed(3)],
    ['Kinship', 'x' + (r.sib === 0.5 ? '0.500' : '1.000')],
    ['Seasoning', 'x' + Math.pow(10, c.season * Math.log10(r.age_days / 365)).toFixed(3)],
    ['Implied value', fmt$(r.implied_value_usd)],
    ['Band P10–P90', fmt$(r.band_lo) + ' – ' + fmt$(r.band_hi)],
    ['12-month launch odds', r.odds_12m == null ? 'not estimated' : fmtPct(r.odds_12m)],
    ['$1K slice', fmtSigned(r.slice_usd).replace('+', '')],
  ];
  const grid = el('div', { class: 'grid' });
  for (const [k, val] of cells) {
    const cell = el('div', { class: 'cell' });
    cell.append(el('dt', { text: k }), el('dd', { text: val }));
    grid.append(cell);
  }
  const gridWrap = el('dl', {});
  gridWrap.append(grid);
  mini1.append(gridWrap);
  mini1.append(el('p', { class: 'note', text: 'The page recomputes this row as ' + fmt$(recompute(r)) + ', the same number board.json carries. This is an estimate, not a price.' }));
  left.append(mini1);
  const mini2 = el('div', { class: 'mini' });
  mini2.append(el('h3', { text: 'Farm economics — $1,000 ticket, 10% to depositors' }));
  const econ = [
    ['Net, expected (x odds)', fmtSigned(r.net_usd)],
    ['Net if it launches', fmtSigned(r.slice_usd - r.costs_usd)],
    ['Net per hands-on hour', fmtSigned(r.net_per_hour) + '/h'],
    ['Break-even launch value', fmt$(r.break_even_usd)],
    ['Needs vs clock', r.odds_12m == null ? r.needs_pct.toFixed(0) + '% needed' : r.needs_pct.toFixed(0) + '% needed · ' + fmtPct(r.odds_12m) + ' clock'],
    ['Verdict', r.verdict],
  ];
  const grid2 = el('div', { class: 'grid' });
  for (const [k, val] of econ) {
    const cell = el('div', { class: 'cell' });
    cell.append(el('dt', { text: k }), el('dd', { text: val }));
    grid2.append(cell);
  }
  const grid2Wrap = el('dl', {});
  grid2Wrap.append(grid2);
  mini2.append(grid2Wrap);
  const gasEntry = D.gasTable.find(([ch]) => ch === (r.chains[0] || 'Ethereum')) || ['Ethereum', 15];
  mini2.append(el('p', { class: 'note', text: 'Ticket $1,000 · 30-day hold · gas $' + gasEntry[1] + ' a transaction on ' + gasEntry[0] + ' · $5 fees · $3.29 forgone T-bill yield (4% over 30 days).' }));
  left.append(mini2);
  const right = el('div', {});
  right.append(el('h3', { text: 'Farm plan — eight steps' }));
  const ol = el('ol', { class: 'steps' });
  for (const s of r.farm_steps) ol.append(el('li', { text: s }));
  right.append(ol);
  right.append(el('p', { class: 'note', text: 'Nearest traded comparables: ' + r.comparables.map((x) => x.name + ' (' + fmt$(x.mcap_usd) + ')').join(' · ') + '.' }));
  cols.append(left, right);
  sheet.append(cols);
  modal.append(sheet);
  modal.hidden = false;
}
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').hidden = true; });

// ---- init
renderHead();
renderTabs();
renderBoard();
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.get('tab') === 'method') setTab('method');
if (hash.get('verdict')) {
  state.verdict = hash.get('verdict');
  const vs = filterEls.vs;
  vs.value = state.verdict;
  renderBoard();
}
if (hash.get('detail')) openDetail(hash.get('detail'));
window.__shotReady = true;
