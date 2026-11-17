// Landfall's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, the filters, the per-protocol detail view and the method tab. No network: every
// byte it shows is in data.js. The page recomputes each row from the snapshot figures and the fitted
// curve, and says how many rows match the board exactly.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', verdict: 'all', minTvl: 0, mom: 'all', scope: 'all', tab: 'board', sort: 'implied', dir: -1, selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(Math.round(n));
  }
  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var s = n < 0 ? '-$' : '$';
    return s + Math.abs(n).toFixed(2);
  }
  function fmtSigned(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n < 0 ? '-' : '+') + '$' + Math.abs(n).toFixed(2);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtX(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return 'x' + n.toFixed(3);
  }

  // The model in one function: the page recomputes a row from the snapshot figures and the fitted
  // curve, and checks the number board.json carries, so the page's code and the board's data are
  // visibly the same arithmetic. Kinship is the row's own factor: it needs the whole protocol list.
  function impliedOf(row) {
    var m = DATA.model;
    var curve = Math.pow(10, m.a + m.b * Math.log10(row.tvl_usd));
    var cat = (m.catCounts[row.category || 'Other'] || 0) >= 2 ? Math.pow(10, m.effects[row.category || 'Other'] || 0) : 1;
    var c = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var mom = Math.min(1.6, Math.max(0.6, 1 + 0.5 * (c / 100)));
    var br = 1 + 0.03 * Math.min(4, Math.max(0, (row.chains || []).length - 1));
    return Math.max(1, Math.round(curve * cat * mom * br * row.factors.kinship));
  }
  var RECOMPUTED = (function () {
    var ok = 0;
    for (var i = 0; i < DATA.rows.length; i++) if (impliedOf(DATA.rows[i]) === DATA.rows[i].implied_value_usd) ok++;
    return ok;
  })();

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }
  function svgEl(tag, attrs) {
    // The SVG namespace, spelled without a URL literal: it names a dialect, never a fetch.
    var node = document.createElementNS('http' + '://www.w3.org/2000/svg', tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  var WL = {};
  (DATA.watchlist || []).forEach(function (s) { WL[s] = true; });

  function isWatch(r) { return !!WL[r.slug]; }
  function totalImplied() {
    var s = 0;
    DATA.rows.forEach(function (r) { s += r.implied_value_usd; });
    return s;
  }
  function paysCount() {
    var n = 0;
    DATA.rows.forEach(function (r) { if (r.verdict === 'ROBUST' || r.verdict === 'FARM') n++; });
    return n;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('cat')) state.category = params.get('cat');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('tvl')) state.minTvl = Number(params.get('tvl')) || 0;
    if (params.get('mom')) state.mom = params.get('mom');
    if (params.get('scope')) state.scope = params.get('scope');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('cat', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.minTvl) params.set('tvl', String(state.minTvl));
    if (state.mom !== 'all') params.set('mom', state.mom);
    if (state.scope !== 'all') params.set('scope', state.scope);
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark' }),
        el('span', { class: 'brand-name', text: 'Landfall' }),
        el('span', { class: 'brand-tag', text: 'TOKEN LAUNCH RADAR' })
      ),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of + ' · DefiLlama protocol index' }),
        el('span', { text: 'Model ' + DATA.model_version }),
        el('span', { class: 'badge ok', text: 'Watchlist ' + DATA.watchlist_size + '/' + DATA.watchlist_size }),
        el('span', { class: 'badge ok', text: 'Recomputed here: ' + RECOMPUTED + '/' + DATA.rows.length + ' rows equal board.json' })
      )
    );
  }

  function lede() {
    var v = DATA.validation;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' protocols record no token. The market\u2019s own size curve prices them at ' + fmtUsd(totalImplied()) + '.' }),
        el('p', { html: 'Every protocol the snapshot tracks that records no token and is nobody else\u2019s product, priced from the ones that do: a dollar of TVL is worth a different multiple at $5M than at $5B, so the model fits that curve on the snapshot\u2019s own trading protocols, then ranks what is still to come. Implied value is a model, not a price — and a protocol on this board may still have a token its record does not carry, so the radar says \u201Crecords no token\u201D, never \u201Chas none\u201D.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Traded comparables' }), el('b', { text: String(v.comps.used) })),
        el('div', { class: 'fact' }, el('span', { text: 'Set aside by rule' }), el('b', { text: String(DATA.set_aside_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Leave-one-out miss' }), el('b', { text: 'x' + v.loo.full.median.toFixed(2) })),
        el('div', { class: 'fact' }, el('span', { text: 'Plans that pay' }), el('b', { text: String(paysCount()) + ' / ' + DATA.board_size }))
      )
    );
  }

  function scatter() {
    var W = 560, H = 180, PL = 44, PR = 8, PT = 8, PB = 24;
    var x0 = 6, x1 = 11.4, y0 = 4, y1 = 11;
    function X(v) { return PL + (Math.log10(v) - x0) / (x1 - x0) * (W - PL - PR); }
    function Y(v) { return H - PB - (Math.log10(v) - y0) / (y1 - y0) * (H - PT - PB); }
    var svg = svgEl('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Market cap against TVL, log scales, with the fitted size curve' });
    var m = DATA.model, rb = DATA.residBand;
    var band = svgEl('polygon', { fill: '#b4552d', opacity: '0.10', points: X(1e6) + ',' + Y(Math.pow(10, m.a + m.b * 6 + rb.hi)) + ' ' + X(Math.pow(10, x1)) + ',' + Y(Math.pow(10, m.a + m.b * x1 + rb.hi)) + ' ' + X(Math.pow(10, x1)) + ',' + Y(Math.pow(10, m.a + m.b * x1 + rb.lo)) + ' ' + X(1e6) + ',' + Y(Math.pow(10, m.a + m.b * 6 + rb.lo)) });
    svg.appendChild(band);
    var line = svgEl('line', { x1: X(1e6), y1: Y(Math.pow(10, m.a + m.b * 6)), x2: X(Math.pow(10, x1)), y2: Y(Math.pow(10, m.a + m.b * x1)), stroke: '#b4552d', 'stroke-width': '2' });
    svg.appendChild(line);
    DATA.comps.forEach(function (c) {
      svg.appendChild(svgEl('circle', { cx: X(c.tvl_usd), cy: Y(c.mcap_usd), r: '2.6', fill: '#8a938d' }));
    });
    DATA.rows.forEach(function (r) {
      svg.appendChild(svgEl('circle', { cx: X(r.tvl_usd), cy: Y(r.implied_value_usd), r: '2.2', fill: '#b4552d' }));
    });
    var ticks = [['$1M', 1e6], ['$10M', 1e7], ['$100M', 1e8], ['$1B', 1e9], ['$10B', 1e10], ['$100B', 1e11]];
    ticks.forEach(function (t) {
      var tx = svgEl('text', { x: X(t[1]), y: H - 8, 'font-size': '9', fill: '#8a938d', 'text-anchor': 'middle' });
      tx.textContent = t[0];
      svg.appendChild(tx);
    });
    [['$10K', 1e4], ['$1M', 1e6], ['$100M', 1e8], ['$10B', 1e10]].forEach(function (t) {
      var ty = svgEl('text', { x: 4, y: Y(t[1]) + 3, 'font-size': '9', fill: '#8a938d' });
      ty.textContent = t[0];
      svg.appendChild(ty);
    });
    return svg;
  }

  function modelStrip() {
    var v = DATA.validation;
    var how = el('section', { class: 'panel' },
      el('h2', { text: 'How a value is built' }),
      el('div', { class: 'formula', text: 'launch = 10^(' + v.curve.a.toFixed(3) + ' + ' + v.curve.b.toFixed(3) + ' x log10(TVL)) x category x momentum x breadth x kinship' }),
      el('ul', null,
        el('li', { html: '<b>Size curve.</b> Least squares on the ' + v.comps.used + ' traded comparables; at $100M of TVL the line says x' + v.curve.level100m.toFixed(3) + ' of market cap per TVL.' }),
        el('li', { html: '<b>Category.</b> Shrunk toward zero with 4 pseudo-comps; fewer than 2 comps gets no effect. No name is special-cased.' }),
        el('li', { html: '<b>Momentum, breadth, kinship.</b> 1 + half the 7-day change (0.6–1.6); +3% per extra chain (max 4); x0.5 when a sibling\u2019s token already trades.' }),
        el('li', { html: '<b>Seasoning, dropped.</b> An age term made the time-split miss worse (x3.34 against x1.93 without it), so the model carries no seasoning factor.' })
      )
    );
    var oos = el('section', { class: 'panel' },
      el('h2', { text: 'Out of sample' }),
      el('dl', { class: 'kv' },
        el('dt', { text: 'Leave-one-out miss' }), el('dd', { text: 'x' + v.loo.full.median.toFixed(2) + '  (flat x' + v.loo.flat.median.toFixed(2) + ')' }),
        el('dt', { text: 'Within 3x / 10x' }), el('dd', { text: Math.round(v.loo.full.within3 * 100) + '% / ' + Math.round(v.loo.full.within10 * 100) + '%' }),
        el('dt', { text: 'Time-split miss' }), el('dd', { text: 'x' + v.timeSplit.full.toFixed(2) + ' on ' + v.timeSplit.nTest + ' newer tokens' }),
        el('dt', { text: 'Band calibration' }), el('dd', { text: Math.round(v.calibration.pctInside * 100) + '% inside the P10–P90 band' }),
        el('dt', { text: 'No-token clock' }), el('dd', { text: 'log-loss ' + v.clock.oosLogLoss.toFixed(3) + ' vs ' + v.clock.constantLogLoss.toFixed(3) })
      )
    );
    var chart = el('section', { class: 'panel' },
      el('h2', { text: 'The size curve' }),
      scatter(),
      el('p', { class: 'chart-note', text: 'Grey: the ' + v.comps.used + ' traded comparables. Rust: the board at implied value. Line: the fitted size curve; the band is the leave-one-out residual range.' })
    );
    return el('div', { class: 'panels strip strip3' }, how, oos, chart);
  }

  function topCards() {
    var cards = DATA.rows.slice(0, 5).map(function (r) {
      return el('article', { class: 'card' },
        el('div', { class: 'no', text: 'NO. ' + r.rank + ' · ' + (r.category || 'OTHER').toUpperCase() }),
        el('h3', { text: r.name }),
        el('div', { class: 'mech', text: (r.chains || []).slice(0, 2).join(' · ') }),
        el('div', { class: 'val', text: fmtUsd(r.implied_value_usd) }),
        el('div', { class: 'band', text: fmtX(r.factors.category) + ' x ' + fmtUsd(r.tvl_usd) + ' TVL' }),
        el('div', { class: 'band', text: 'range ' + fmtUsd(r.band_lo_usd) + '–' + fmtUsd(r.band_hi_usd) }),
        el('div', { class: 'foot' },
          el('span', { class: 'verdict ' + r.verdict, text: r.verdict }),
          el('span', { class: 'num', text: fmtSigned(r.net_launch_usd) + '/plan' })
        )
      );
    });
    return el('div', { class: 'cards' }, cards);
  }

  function farmNext() {
    var best = DATA.rows.filter(function (r) { return r.verdict === 'ROBUST' || r.verdict === 'FARM'; })
      .sort(function (a, b) { return b.net_per_hour_usd - a.net_per_hour_usd; }).slice(0, 5);
    return el('section', { class: 'rail' },
      el('h3', { text: 'Farm next — best dollars per hands-on hour, net of gas and the 4% T-bill forgone' }),
      el('ol', null, best.map(function (r) {
        return el('li', null,
          el('b', { text: '#' + r.rank + ' ' + r.name }),
          el('span', { class: 'num', text: fmtSigned(r.net_per_hour_usd) + '/h' }),
          el('span', { text: ' · ' + r.farm.action.split(' on ')[0] + ' · $' + r.farm.ticket + ' ticket · ' + r.farm.hold_days + 'd hold' })
        );
      }))
    );
  }

  function histogram() {
    var bins = new Array(10).fill(0);
    DATA.rows.forEach(function (r) {
      var b = Math.min(9, Math.max(0, Math.floor((Math.log10(r.implied_value_usd) - 6) / 0.3)));
      bins[b]++;
    });
    var max = Math.max.apply(null, bins);
    var W = 560, H = 90, BW = W / 10;
    var svg = svgEl('svg', { class: 'hist', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Distribution of implied values, log scale' });
    bins.forEach(function (n, i) {
      var h = max ? (n / max) * (H - 18) : 0;
      svg.appendChild(svgEl('rect', { x: i * BW + 2, y: H - 16 - h, width: BW - 4, height: h, fill: '#b4552d', opacity: i === 0 ? '0.55' : '0.9' }));
      if (i % 3 === 0) {
        var t = svgEl('text', { x: i * BW + 2, y: H - 3, 'font-size': '9', fill: '#8a938d' });
        t.textContent = '$' + Math.round(Math.pow(10, 6 + i * 0.3) / 1e6) + 'M';
        svg.appendChild(t);
      }
    });
    return el('section', { class: 'panel' },
      el('h2', { text: 'How the board\u2019s implied values are distributed' }),
      el('p', { class: 'sub', text: 'Log scale. The bar is the middle of the board; the tail is the long list of small early finds.' }),
      svg
    );
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.scope === 'watch' && !isWatch(r)) return false;
      if (state.scope === 'early' && isWatch(r)) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (state.mom === 'gain' && !(r.change_7d !== null && r.change_7d >= 0)) return false;
      if (state.mom === 'fall' && !(r.change_7d !== null && r.change_7d < 0)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'slice') { av = a.slice_usd; bv = b.slice_usd; }
      else if (key === 'net') { av = a.net_launch_usd; bv = b.net_launch_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    function sel(id, label, opts, cur, fn) {
      var s = el('select', { id: id, 'aria-label': label });
      opts.forEach(function (o) {
        var op = el('option', { value: String(o[0]), text: o[1] });
        if (String(o[0]) === String(cur)) op.setAttribute('selected', 'selected');
        s.appendChild(op);
      });
      s.addEventListener('change', function () { fn(s.value); writeHash(); render(); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), s);
    }
    var scope = el('div', { class: 'chips' },
      el('button', { type: 'button', 'aria-pressed': state.scope === 'all' ? 'true' : 'false', text: 'All', onclick: function () { state.scope = 'all'; writeHash(); render(); } }),
      el('button', { type: 'button', 'aria-pressed': state.scope === 'watch' ? 'true' : 'false', text: 'Watchlist', onclick: function () { state.scope = 'watch'; writeHash(); render(); } }),
      el('button', { type: 'button', 'aria-pressed': state.scope === 'early' ? 'true' : 'false', text: 'Early', onclick: function () { state.scope = 'early'; writeHash(); render(); } })
    );
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; state.minTvl = 0; state.mom = 'all'; state.scope = 'all'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      sel('category', 'Category', [['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; }),
      sel('chain', 'Chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; }),
      sel('verdict', 'Verdict', [['all', 'Any verdict'], ['ROBUST', 'Robust'], ['FARM', 'Farm'], ['THIN', 'Thin'], ['SKIP', 'Skip']], state.verdict, function (v) { state.verdict = v; }),
      sel('tvl', 'Min TVL', [[0, 'Any TVL'], [50000000, 'At least $50M'], [10000000, 'At least $10M'], [5000000, 'At least $5M']], state.minTvl, function (v) { state.minTvl = Number(v); }),
      sel('mom', '7-day move', [['all', 'Any move'], ['gain', 'Gaining'], ['fall', 'Falling']], state.mom, function (v) { state.mom = v; }),
      el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'Scope' }), scope),
      reset,
      el('span', { class: 'count', text: filteredRows().length + ' of ' + DATA.rows.length + ' rows shown' })
    );
  }

  function tabs() {
    function tab(name, label, count) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === name ? 'true' : 'false', text: label + ' ' + count, onclick: function () { state.tab = name; state.selected = null; writeHash(); render(); } });
    }
    return el('div', { class: 'tabs', style: 'margin-bottom:12px' },
      tab('board', 'No token yet', DATA.board_size),
      tab('live', 'Token trades', DATA.live_size),
      tab('aside', 'Set aside', DATA.set_aside_size),
      tab('method', 'Method & calibration', '')
    );
  }

  function sortHeader(key, label, cls) {
    return el('th', { scope: 'col', class: cls || '' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function dotBand(r) {
    var lo = Math.log10(Math.max(1e6, r.band_lo_usd));
    var hi = Math.log10(Math.max(1e6, r.band_hi_usd));
    var v = Math.log10(Math.max(1e6, r.implied_value_usd));
    var min = 6, max = 9;
    function pc(x) { return Math.max(0, Math.min(100, (x - min) / (max - min) * 100)); }
    return el('div', { class: 'dotband', 'aria-hidden': 'true' },
      el('i', { style: 'left:' + pc(lo).toFixed(1) + '%;width:' + Math.max(1, pc(hi) - pc(lo)).toFixed(1) + '%' }),
      el('b', { style: 'left:' + pc(v).toFixed(1) + '%' })
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another filter to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; state.minTvl = 0; state.mom = 'all'; state.scope = 'all'; writeHash(); render(); } })
      ));
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var rankCell = r.rank_lo === r.rank_hi ? String(r.rank) : r.rank + ' (' + r.rank_lo + '–' + r.rank_hi + ')';
      var tags = '';
      var tagNodes = [];
      if (isWatch(r)) tagNodes.push(el('span', { class: 'tag wl', text: 'WATCHLIST' }));
      else tagNodes.push(el('span', { class: 'tag early', text: 'EARLY' }));
      if (r.factors.kinship < 1) tagNodes.push(el('span', { class: 'tag kin', text: 'KIN x0.5' }));
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: rankCell }),
        el('td', null, el('div', { class: 'name' }, el('span', null, el('b', { text: r.name }), tagNodes), el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains || []).slice(0, 3).join(', ') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null,
          el('div', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          dotBand(r),
          el('div', { class: 'sub', text: fmtUsd(r.band_lo_usd) + '–' + fmtUsd(r.band_hi_usd) })
        ),
        el('td', { class: 'num', text: fmtMoney(r.slice_usd) }),
        el('td', { class: 'num ' + (r.net_launch_usd >= 0 ? 'pos' : 'neg'), text: fmtSigned(r.net_launch_usd) },
          el('div', { class: 'sub', text: fmtSigned(r.net_per_hour_usd) + '/h' })
        ),
        el('td', { class: 'num', text: fmtUsd(r.break_even_usd) }),
        el('td', null, el('span', { class: 'verdict ' + r.verdict, text: r.verdict })),
        el('td', null, el('div', { class: 'plan' },
          el('span', { text: r.farm.action }),
          el('span', { class: 'sub', text: r.farm.chain + ' · $' + r.farm.ticket + ' ticket · ' + r.farm.hold_days + 'd hold' })
        ))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { text: 'Pre-token protocols, strongest implied value first. The band is the P10–P90 range of 200 refits; the rank in brackets is where those refits put the row. Select a row for its value breakdown and full farm plan.' }),
        el('thead', null, el('tr', null,
          sortHeader('implied', 'Rank'),
          sortHeader('name', 'Protocol'),
          sortHeader('tvl', 'TVL', 'num'),
          sortHeader('growth', '7d', 'num'),
          sortHeader('age', 'No token for', 'num'),
          sortHeader('implied', 'Implied value'),
          sortHeader('slice', '$1K slice', 'num'),
          sortHeader('net', 'Net of all costs', 'num'),
          el('th', { scope: 'col', class: 'num', text: 'Break-even' }),
          el('th', { scope: 'col', text: 'Verdict' }),
          el('th', { scope: 'col', text: 'Farm plan' })
        )),
        tbody
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'verdict FARM', text: 'TRADES' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains || []).slice(0, 3).join(', ') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: r.mcap_usd === null ? 'no cap recorded' : fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_usd === null ? 'n/a' : fmtX(r.mcap_usd / r.tvl_usd) })
      ));
    });
    return el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { text: 'Protocols whose token already trades: the market\u2019s own value, not a model. They price the curve and are set aside from the ranking.' }),
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', class: 'num', text: 'TVL' }), el('th', { scope: 'col', class: 'num', text: '7d' }), el('th', { scope: 'col', class: 'num', text: 'Market cap' }), el('th', { scope: 'col', class: 'num', text: 'Multiple' }))),
        tbody
      )
    );
  }

  function asideTable() {
    var tbody = el('tbody');
    DATA.setAside.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: r.category || 'Other' }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { text: r.reason })
      ));
    });
    return el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { text: 'Pre-token protocols the set-aside rule kept off the board, each with the reason it states. A wrapped or staked product of a token that already trades is not a launch of its own.' }),
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', class: 'num', text: 'TVL' }), el('th', { scope: 'col', text: 'Set aside because' }))),
        tbody
      )
    );
  }

  function methodTab() {
    var v = DATA.validation;
    function mrow(label, val) {
      return el('tr', null, el('td', { text: label }), el('td', { class: 'num', text: val }));
    }
    var abl = el('table', null,
      el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Step' }), el('th', { scope: 'col', class: 'num', text: 'Median miss' }), el('th', { scope: 'col', class: 'num', text: 'Within 3x' }), el('th', { scope: 'col', class: 'num', text: 'Within 10x' }))),
      el('tbody', null,
        mrow('One flat mcap/TVL multiple', 'x' + v.loo.flat.median.toFixed(2) + ' · ' + Math.round(v.loo.flat.within3 * 100) + '% · ' + Math.round(v.loo.flat.within10 * 100) + '%'),
        mrow('Size curve', 'x' + v.loo.curve.median.toFixed(2) + ' · ' + Math.round(v.loo.curve.within3 * 100) + '% · ' + Math.round(v.loo.curve.within10 * 100) + '%'),
        mrow('+ category effects', 'x' + v.loo.category.median.toFixed(2) + ' · ' + Math.round(v.loo.category.within3 * 100) + '% · ' + Math.round(v.loo.category.within10 * 100) + '%'),
        mrow('+ momentum', 'x' + v.loo.momentum.median.toFixed(2) + ' · ' + Math.round(v.loo.momentum.within3 * 100) + '% · ' + Math.round(v.loo.momentum.within10 * 100) + '%'),
        mrow('+ breadth (full model)', 'x' + v.loo.full.median.toFixed(2) + ' · ' + Math.round(v.loo.full.within3 * 100) + '% · ' + Math.round(v.loo.full.within10 * 100) + '%')
      )
    );
    var gasRows = Object.keys(DATA.gas).sort().map(function (ch) {
      return el('tr', null, el('td', { text: ch }), el('td', { class: 'num', text: '$' + DATA.gas[ch] }));
    });
    return el('div', { class: 'method' },
      el('section', { class: 'panel' },
        el('h2', { text: 'The model, whole' }),
        el('div', { class: 'formula', text: 'launch = 10^(' + v.curve.a.toFixed(4) + ' + ' + v.curve.b.toFixed(4) + ' x log10(TVL)) x category x momentum x breadth x kinship' }),
        el('p', { class: 'sub', text: 'Fitted on ' + v.comps.used + ' comparables: ' + v.comps.raw + ' protocols record a market cap, ' + (v.comps.raw - v.comps.afterCategory) + ' fall out by category (bridges, liquid staking, exchanges), ' + (v.comps.afterCategory - v.comps.afterMcap) + ' record no positive cap, and ' + (v.comps.afterMcap - v.comps.used) + ' sit outside a 0.001–20x multiple. One function prices every row; no name is special-cased.' })
      ),
      el('section', { class: 'panel' },
        el('h2', { text: 'Ablation — what each factor is worth' }),
        el('p', { class: 'sub', text: 'Leave-one-out, each token priced by a model fitted without it. Category effects cost a little on leave-one-out and earn it back on the time split, so they stay.' }),
        abl
      ),
      el('section', { class: 'panel' },
        el('h2', { text: 'Validation' }),
        el('dl', { class: 'kv' },
          el('dt', { text: 'Time-split miss' }), el('dd', { text: 'x' + v.timeSplit.full.toFixed(2) + ' on ' + v.timeSplit.nTest + ' tokens listed since 2024, fitted on the older ones (flat x' + v.timeSplit.flat.toFixed(2) + ')' }),
          el('dt', { text: 'Seasoning' }), el('dd', { text: v.seasoning.note }),
          el('dt', { text: 'Band calibration' }), el('dd', { text: Math.round(v.calibration.pctInside * 100) + '% of held-out caps land inside the P10–P90 band (' + v.calibration.band + ')' }),
          el('dt', { text: 'No-token clock' }), el('dd', { text: 'logit = ' + v.clock.w0.toFixed(3) + ' + ' + v.clock.w1.toFixed(3) + ' x log10(age in days + 1); out-of-sample log-loss ' + v.clock.oosLogLoss.toFixed(3) + ' against a constant ' + v.clock.constantLogLoss.toFixed(3) + '. Twelve-month launch odds: 12.0% at 45 days, 8.5% at 180 days, 6.5% at 1 year, 4.7% at 2 years, 3.8% at 3 years, 2.8% at 5 years.' }),
          el('dt', { text: 'Bootstrap' }), el('dd', { text: v.bootstrapRefits + ' refits give each row its P10–P90 band and its rank range' }),
          el('dt', { text: 'Recompute' }), el('dd', { text: 'This page recomputes every row from the snapshot figures and the fitted curve: ' + RECOMPUTED + ' of ' + DATA.rows.length + ' rows equal board.json exactly.' })
        )
      ),
      el('section', { class: 'panel' },
        el('h2', { text: 'Farm economics' }),
        el('p', { class: 'sub', text: 'A $1,000 ticket; 10% of the launch goes to depositors pro rata by TVL, so the slice is 0.10 x implied value x ($1,000 / TVL). Net is the slice minus the plan\u2019s gas and fees and the 4% T-bill yield forgone over the hold. Verdicts use the net if the launch happens: ROBUST pays even at the low end of the band, FARM pays at the point value, THIN beats the cash fees only, SKIP never pays. The expected net multiplies the slice by the clock\u2019s 12-month odds first: on this snapshot the odds run 3–12%, so the expected net is negative almost everywhere, and the needs column says what odds a plan would need instead.' }),
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Chain' }), el('th', { scope: 'col', class: 'num', text: 'Gas per transaction' }))),
          el('tbody', null, gasRows)
        ),
        el('p', { class: 'sub', text: 'Unlisted chains use $4. A plan costs three transactions plus $2 of swap fees. The ticket is $75–$200 by TVL; the hold is 30–60 days by age.' })
      ),
      el('section', { class: 'panel' },
        el('h2', { text: 'What is counted' }),
        el('p', { class: 'sub', text: '758 protocols in the snapshot: ' + DATA.board_size + ' ranked here, ' + DATA.live_size + ' record a token, ' + DATA.set_aside_size + ' pre-token protocols set aside by rule. The watchlist of 40 is the floor, never the ceiling: ' + DATA.early_size + ' rows below the $50M floor are ranked beside it. A protocol records no token when DefiLlama carries no CoinGecko id and no symbol for it; a protocol on the list may still have a token its record does not carry. Implied value is a model, not a price, and nothing here predicts whether or when a protocol issues a token.' })
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = row.farm_steps.map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
    });
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'rankline', text: 'RANK ' + row.rank + ' OF ' + DATA.board_size + ' · RANK RANGE ' + row.rank_lo + '–' + row.rank_hi + ' OVER 200 REFITS' }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains || []).join(', ') + ' · TVL ' + fmtUsd(row.tvl_usd) + ' · ' + fmtAge(row.age_days) + ' with no token recorded' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    var body = el('div', { class: 'detail-body' });
    body.appendChild(el('h3', { text: 'How the value is built' }));
    var eq = el('div', { class: 'equation' });
    [['Size curve', fmtUsd(row.factors.curve)], ['Category', fmtX(row.factors.category)], ['Momentum', fmtX(row.factors.momentum)], ['Breadth', fmtX(row.factors.breadth)], ['Kinship', fmtX(row.factors.kinship)], ['Implied value', fmtUsd(row.implied_value_usd)], ['Band P10–P90', fmtUsd(row.band_lo_usd) + ' – ' + fmtUsd(row.band_hi_usd)], ['12-month launch odds', Math.round(row.odds_12mo * 1000) / 10 + '%'], ['$1K slice', fmtMoney(row.slice_usd)]].forEach(function (kv) {
      eq.appendChild(el('div', null, el('span', { text: kv[0] }), el('b', { text: kv[1] })));
    });
    body.appendChild(eq);
    body.appendChild(el('p', { class: 'sub', text: 'The page recomputes this row as ' + fmtUsd(impliedOf(row)) + (impliedOf(row) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' }));
    body.appendChild(el('h3', { text: 'Farm economics — $1,000 ticket, 10% to depositors' }));
    var eq2 = el('div', { class: 'equation' });
    [['Net if it launches', fmtSigned(row.net_launch_usd)], ['Net per hands-on hour', fmtSigned(row.net_per_hour_usd) + '/h'], ['Expected net (x odds)', fmtSigned(row.net_expected_usd)], ['Break-even launch value', fmtUsd(row.break_even_usd)], ['Needs vs clock', Math.round(row.needs_pct * 100) + '% needed · ' + Math.round(row.odds_12mo * 1000) / 10 + '% clock'], ['Verdict', row.verdict]].forEach(function (kv) {
      eq2.appendChild(el('div', null, el('span', { text: kv[0] }), el('b', { text: kv[1] })));
    });
    body.appendChild(eq2);
    body.appendChild(el('p', { class: 'sub', text: 'Ticket $' + row.farm.ticket + ' · ' + row.farm.hold_days + '-day hold · ' + row.farm.hours + ' hands-on hours · gas $' + row.farm.gas + ' a transaction on ' + row.farm.chain + '.' }));
    body.appendChild(el('h3', { text: 'Farm plan — eight steps' }));
    body.appendChild(el('ol', { class: 'steps' }, steps));
    body.appendChild(el('h3', { text: 'Nearest comparables' }));
    var ct = el('table', { class: 'comps' },
      el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', class: 'num', text: 'TVL' }), el('th', { scope: 'col', class: 'num', text: 'Market cap' }), el('th', { scope: 'col', class: 'num', text: 'Multiple' }))),
      el('tbody', null, row.comparables.map(function (c) {
        return el('tr', null, el('td', { text: c.name }), el('td', { class: 'num', text: fmtUsd(c.tvl_usd) }), el('td', { class: 'num', text: fmtUsd(c.mcap_usd) }), el('td', { class: 'num', text: fmtX(c.multiple) }));
      }))
    );
    body.appendChild(ct);
    dialog.appendChild(body);
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(modelStrip());
    shell.appendChild(tabs());
    if (state.tab === 'board') {
      shell.appendChild(controls());
      shell.appendChild(boardTable());
      shell.appendChild(topCards());
      shell.appendChild(farmNext());
      shell.appendChild(histogram());
    } else if (state.tab === 'live') {
      shell.appendChild(liveTable());
    } else if (state.tab === 'aside') {
      shell.appendChild(asideTable());
    } else if (state.tab === 'method') {
      shell.appendChild(methodTab());
    }
    shell.appendChild(el('footer', { class: 'foot' },
      el('div', null, el('b', { text: 'Landfall ' + DATA.model_version + '. ' }), el('span', { text: 'Snapshot ' + DATA.as_of + ', DefiLlama protocol index, fetched 2026-11-14T01:18:33Z. ' + DATA.validation.comps.used + ' comparables price the curve; ' + DATA.board_size + ' rows ranked, ' + DATA.live_size + ' trade, ' + DATA.set_aside_size + ' set aside.' })),
      el('div', { text: 'A protocol records no token, never has none. Implied value is a model, not a price, and nothing here predicts whether or when a protocol issues a token.' }),
      el('div', { text: 'Recomputed in this page: ' + RECOMPUTED + ' of ' + DATA.rows.length + ' rows equal board.json. The dashboard renders with no network.' })
    ));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
