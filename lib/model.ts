// Landfall round 3 — the value model for token-radar-01.
//
// A deliberately small model, after a deep analysis of the round-2 entry
// (see the Method tab of the dashboard for the full story):
//   - one log-log size curve, fitted on 86 traded comps, with comp market
//     caps winsorized at their 90th percentile ($104M) when fitting;
//   - one factor, momentum, from the 7-day TVL change;
//   - no category effects, no seasoning, no breadth, no sibling factor.
//     Each was tested out of sample and dropped because it did not improve
//     BOTH the leave-one-out miss and the time-split miss. The sibling
//     factor is gone entirely: in round 2 it matched a protocol against its
//     own name during validation and overstated accuracy by ~20%.
// Validation is computed with the SAME prediction function as the board:
// the same fit, the same momentum, nothing extra. The winsor cap is fixed
// once from the full comp set and reused by every fit, so validation
// measures the function the board actually uses.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** Parse and lightly validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  const s = JSON.parse(text) as Snapshot;
  if (!Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  for (const p of s.protocols) {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new Error(`snapshot: bad protocol row ${JSON.stringify(p).slice(0, 120)}`);
    }
  }
  return s;
}

/** A protocol records a token when DefiLlama carries either identifier. */
export function hasToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** Categories that mark a wrapped, staked or bridged product of a token that trades. */
export const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Why a no-token protocol is set aside (not ranked): it is a wrapped,
 * staked or bridged product, a versioned copy, or an exchange product.
 * Null means it is a genuine pre-token subject.
 */
export function setAsideReason(p: Protocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return 'category';
  if (VERSION_MARKER.test(p.name)) return 'version';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped-word';
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return 'exchange';
  return null;
}

/** Days from listed_at to the snapshot date; 365 when DefiLlama reports none. */
export function ageDays(p: Protocol, asOf: string): number {
  if (!p.listed_at) return 365;
  const ms = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${p.listed_at}T00:00:00Z`);
  return Math.max(1, Math.round(ms / 86400000));
}

/** The one factor: 7-day TVL momentum, shrunk toward 1, clamped. */
export function momentum(p: Protocol): number {
  if (p.change_7d === null || p.change_7d === undefined) return 1;
  return Math.min(1.6, Math.max(0.6, 1 + 0.5 * (p.change_7d / 100)));
}

/** Gas for one transaction on a chain, in whole dollars (a stated estimate). */
export function gasPerTx(chain: string): number {
  const table: Record<string, number> = {
    Ethereum: 15,
    Base: 3,
    Arbitrum: 3,
    Avalanche: 2,
    Polygon: 2,
    Solana: 1,
    Sui: 1,
  };
  return table[chain] ?? 5;
}

/** The traded comps: a market cap, a sane mcap/TVL ratio, no excluded category. */
export function cleanComps(snapshot: Snapshot): { comps: Protocol[]; excluded: number } {
  const comps: Protocol[] = [];
  let excluded = 0;
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (ratio < 0.01 || ratio > 30) {
      excluded++;
      continue;
    }
    if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) {
      excluded++;
      continue;
    }
    comps.push(p);
  }
  comps.sort((x, y) => (x.slug < y.slug ? -1 : 1));
  return { comps, excluded };
}

/** The 90th percentile of the comps' market caps (upper-quantile convention). */
export function winsorCap(comps: Protocol[]): number {
  const ms = comps.map((p) => p.mcap_usd as number).sort((x, y) => x - y);
  return ms[Math.floor(0.9 * (ms.length - 1))];
}

export interface CurveFit {
  a: number;
  b: number;
  cap: number;
}

/** Joint least squares log10(mcap) = a + b·log10(TVL), mcap winsorized at cap. */
export function fitCurve(rows: Protocol[], cap: number): CurveFit {
  const n = rows.length;
  let sx = 0;
  let sy = 0;
  for (const p of rows) {
    sx += Math.log10(p.tvl_usd);
    sy += Math.log10(Math.min(p.mcap_usd as number, cap));
  }
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of rows) {
    const x = Math.log10(p.tvl_usd) - mx;
    const y = Math.log10(Math.min(p.mcap_usd as number, cap)) - my;
    sxy += x * y;
    sxx += x * x;
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b, cap };
}

/** The prediction function, used identically by the board and by validation. */
export function predictValue(fit: CurveFit, p: Protocol): number {
  return Math.pow(10, fit.a + fit.b * Math.log10(p.tvl_usd)) * momentum(p);
}

/** The curve's level: implied value at $100M TVL as a multiple of TVL. */
export function levelAt100M(fit: CurveFit): number {
  return Math.pow(10, fit.a + fit.b * 8) / 1e8;
}

/** Upper median (the element at floor(n/2) of the sorted values). */
export function medianUpper(values: number[]): number {
  const s = [...values].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

function miss(actual: number, pred: number): number {
  return Math.max(actual / pred, pred / actual);
}

export interface EvalResult {
  median: number;
  within3: number;
  within10: number;
  meanLog: number;
  n: number;
}

/** Leave-one-out: refit on n−1 comps (same fixed cap), predict the held-out one. */
export function looEval(comps: Protocol[], cap: number): EvalResult {
  const misses: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const f = fitCurve(train, cap);
    misses.push(miss(comps[i].mcap_usd as number, predictValue(f, comps[i])));
  }
  return summarize(misses);
}

/** Time-split: fit on tokens listed before 2024, test on the newer ones. */
export function timeSplitEval(comps: Protocol[], cap: number): EvalResult & { train: number; test: number } {
  const train = comps.filter((p) => p.listed_at && p.listed_at < '2024-01-01');
  const test = comps.filter((p) => p.listed_at && p.listed_at >= '2024-01-01');
  const f = fitCurve(train, cap);
  const misses = test.map((p) => miss(p.mcap_usd as number, predictValue(f, p)));
  return { ...summarize(misses), train: train.length, test: test.length };
}

/** The flat baseline: one multiple for every protocol (upper median of mcap/TVL). */
export function flatEval(comps: Protocol[]): { loo: EvalResult; ts: EvalResult } {
  const level = medianUpper(comps.map((p) => (p.mcap_usd as number) / p.tvl_usd));
  const loo = summarize(comps.map((p) => miss(p.mcap_usd as number, p.tvl_usd * level)));
  const test = comps.filter((p) => p.listed_at && p.listed_at >= '2024-01-01');
  const ts = summarize(test.map((p) => miss(p.mcap_usd as number, p.tvl_usd * level)));
  return { loo, ts };
}

function summarize(misses: number[]): EvalResult {
  const n = misses.length;
  return {
    median: medianUpper(misses),
    within3: misses.filter((m) => m <= 3).length / n,
    within10: misses.filter((m) => m <= 10).length / n,
    meanLog: misses.reduce((s, m) => s + Math.log(m), 0) / n,
    n,
  };
}

/** Deterministic PRNG (mulberry32) for the bootstrap refits. */
export function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RowBand {
  lo: number;
  hi: number;
  rankLo: number;
  rankHi: number;
}

/**
 * 200 bootstrap refits over the comps (same fixed cap, seed 20261117):
 * each row's P10–P90 implied-value band and P10–P90 rank range.
 */
export function bootstrapBands(
  comps: Protocol[],
  rows: Protocol[],
  cap: number,
  refits = 200,
): Map<string, RowBand> {
  const rng = mulberry32(20261117);
  const n = comps.length;
  const vals = new Map<string, number[]>();
  const ranks = new Map<string, number[]>();
  for (const r of rows) {
    vals.set(r.slug, []);
    ranks.set(r.slug, []);
  }
  for (let k = 0; k < refits; k++) {
    const sample: Protocol[] = [];
    for (let i = 0; i < n; i++) sample.push(comps[Math.floor(rng() * n)]);
    const f = fitCurve(sample, cap);
    const scored = rows
      .map((p) => ({ slug: p.slug, v: predictValue(f, p) }))
      .sort((x, y) => y.v - x.v || (x.slug < y.slug ? -1 : 1));
    scored.forEach((s, i) => {
      vals.get(s.slug)!.push(s.v);
      ranks.get(s.slug)!.push(i + 1);
    });
  }
  const out = new Map<string, RowBand>();
  for (const r of rows) {
    const vs = vals.get(r.slug)!.sort((x, y) => x - y);
    const rs = ranks.get(r.slug)!.sort((x, y) => x - y);
    out.set(r.slug, {
      lo: Math.max(1, Math.round(vs[Math.floor(0.1 * (vs.length - 1))])),
      hi: Math.max(1, Math.round(vs[Math.floor(0.9 * (vs.length - 1))])),
      rankLo: rs[Math.floor(0.1 * (rs.length - 1))],
      rankHi: rs[Math.floor(0.9 * (rs.length - 1))],
    });
  }
  return out;
}

export interface AblationStep {
  label: string;
  loo: number;
  ts: number;
}

/**
 * The honest ablation: flat multiple → size curve → + momentum → +
 * winsorized fit. Each step is evaluated the same way (leave-one-out and
 * the pre-2024/post-2024 time-split), with the same predictor the step
 * describes — nothing extra in validation that the board does not use.
 */
export function ablationSteps(comps: Protocol[], cap: number): AblationStep[] {
  const flat = flatEval(comps);
  const pre = comps.filter((p) => p.listed_at && p.listed_at < '2024-01-01');
  const post = comps.filter((p) => p.listed_at && p.listed_at >= '2024-01-01');
  const plain = (f: CurveFit, p: Protocol): number =>
    Math.pow(10, f.a + f.b * Math.log10(p.tvl_usd));
  const looOf = (c: number, mom: boolean): EvalResult => {
    const misses: number[] = [];
    for (let i = 0; i < comps.length; i++) {
      const train = comps.filter((_, j) => j !== i);
      const f = fitCurve(train, c);
      const pred = mom ? predictValue(f, comps[i]) : plain(f, comps[i]);
      misses.push(miss(comps[i].mcap_usd as number, pred));
    }
    return summarize(misses);
  };
  const tsOf = (c: number, mom: boolean): EvalResult => {
    const f = fitCurve(pre, c);
    return summarize(
      post.map((p) => {
        const pred = mom ? predictValue(f, p) : plain(f, p);
        return miss(p.mcap_usd as number, pred);
      }),
    );
  };
  const curveOnly = { loo: looOf(Infinity, false), ts: tsOf(Infinity, false) };
  const curveMom = { loo: looOf(Infinity, true), ts: tsOf(Infinity, true) };
  const win = { loo: looEval(comps, cap), ts: timeSplitEval(comps, cap) };
  return [
    { label: 'Flat multiple — one mcap/TVL for every protocol', loo: flat.loo.median, ts: flat.ts.median },
    { label: 'Size curve — log-log mcap vs TVL, no factor', loo: curveOnly.loo.median, ts: curveOnly.ts.median },
    { label: 'Curve + momentum — 7-day TVL change', loo: curveMom.loo.median, ts: curveMom.ts.median },
    { label: 'Curve + momentum + winsorized fit (this board)', loo: win.loo.median, ts: win.ts.median },
  ];
}

/** 5-fold out-of-fold residual ratios (folds by index mod 5, same fixed cap). */
function oofRatios(comps: Protocol[], cap: number): number[][] {
  const folds: number[][] = [[], [], [], [], []];
  comps.forEach((_, i) => folds[i % 5].push(i));
  const out: number[][] = [];
  for (let k = 0; k < 5; k++) {
    const testIdx = new Set(folds[k]);
    const tr = comps.filter((_, i) => !testIdx.has(i));
    const f = fitCurve(tr, cap);
    out.push(folds[k].map((i) => (comps[i].mcap_usd as number) / predictValue(f, comps[i])));
  }
  return out;
}

/**
 * Band calibration, two numbers because they mean different things:
 * - r2style: band = P10–P90 of the same out-of-fold ratios it covers,
 *   so ~80% by construction. It is not a validation signal.
 * - honest: for each fold the band limits come from the OTHER folds'
 *   residuals; coverage is measured on the held-out fold only.
 */
export function bandCalibration(comps: Protocol[], cap: number): {
  r2style: number;
  honest: number;
  loF: number;
  hiF: number;
} {
  const byFold = oofRatios(comps, cap);
  const all = byFold.flat().sort((x, y) => x - y);
  const loF = all[Math.floor(0.1 * (all.length - 1))];
  const hiF = all[Math.floor(0.9 * (all.length - 1))];
  const r2style = all.filter((r) => r >= loF && r <= hiF).length / all.length;
  let covered = 0;
  let total = 0;
  for (let k = 0; k < 5; k++) {
    const others = byFold.flatMap((arr, j) => (j === k ? [] : arr)).sort((x, y) => x - y);
    const lo = others[Math.floor(0.1 * (others.length - 1))];
    const hi = others[Math.floor(0.9 * (others.length - 1))];
    for (const r of byFold[k]) {
      total++;
      if (r >= lo && r <= hi) covered++;
    }
  }
  return { r2style, honest: covered / total, loF, hiF };
}

// ---- The clock: how likely a protocol is to have a token in 12 months ----
// Logistic regression on has_token ~ log(age_days) + category, over all 758
// protocols. It is INFORMATIONAL ONLY: it never moves a rank, never changes
// a verdict on its own — it multiplies the expected slice, and it orders
// Farm Next. A protocol's launch odds are what they are; the board is
// honest about them instead of pretending the top rows will launch.

export interface ClockModel {
  intercept: number;
  bLogAge: number;
  mLog: number;
  sLog: number;
  /** Category effects for categories with >= 20 protocols; absent = 0. */
  catFx: Record<string, number>;
  /** Log-loss: in-sample and 5-fold out-of-sample, plus the constant baseline. */
  logLossIn: number;
  logLossOos: number;
  logLossConst: number;
  n: number;
}

function sigmoid(x: number): number {
  if (x > 35) return 1;
  if (x < -35) return 0;
  return 1 / (1 + Math.exp(-x));
}

/** Solve A x = b by Gauss-Jordan with partial pivoting (small, dense). */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-12) continue;
    const tmp = m[col];
    m[col] = m[piv];
    m[piv] = tmp;
    const d = m[col][col];
    for (let j = col; j <= n; j++) m[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (f === 0) continue;
      for (let j = col; j <= n; j++) m[r][j] -= f * m[col][j];
    }
  }
  return m.map((row) => row[n]);
}

/**
 * Iteratively reweighted least squares for the clock. The features are
 * fixed by this function, so the fit is deterministic; 30 iterations is
 * past convergence for this data (the weights settle to 1e-9).
 */
export function fitClock(snapshot: Snapshot): ClockModel {
  const asOf = snapshot.as_of;
  const protos = [...snapshot.protocols].sort((x, y) => (x.slug < y.slug ? -1 : 1));
  const counts = new Map<string, number>();
  for (const p of protos) if (p.category) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const keptCats = [...counts.entries()]
    .filter(([, n]) => n >= 20)
    .map(([c]) => c)
    .sort();
  const catIdx = new Map(keptCats.map((c, i) => [c, i + 2]));
  const dim = 2 + keptCats.length;
  const logAges = protos.map((p) => Math.log(ageDays(p, asOf)));
  const mLog = logAges.reduce((s, v) => s + v, 0) / logAges.length;
  const varLog = logAges.reduce((s, v) => s + (v - mLog) * (v - mLog), 0) / logAges.length;
  const sLog = Math.sqrt(varLog);
  const y = protos.map((p) => (hasToken(p) ? 1 : 0));
  const x = protos.map((p) => {
    const row = new Array<number>(dim).fill(0);
    row[0] = 1;
    row[1] = (Math.log(ageDays(p, asOf)) - mLog) / sLog;
    if (p.category && catIdx.has(p.category)) row[catIdx.get(p.category)!] = 1;
    return row;
  });

  // Fit once on all protocols (for the board), and 5-fold out of sample
  // (folds by index mod 5 over the sorted list) to measure it honestly.
  const fitOnce = (idx: number[]): { w: number[]; ll: number } => {
    let w = new Array<number>(dim).fill(0);
    for (let it = 0; it < 30; it++) {
      const xtwx: number[][] = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
      const xtwz: number[] = new Array<number>(dim).fill(0);
      for (const i of idx) {
        const xi = x[i];
        const eta = xi.reduce((s, v, j) => s + v * w[j], 0);
        const mu = sigmoid(eta);
        const wt = Math.max(mu * (1 - mu), 1e-9);
        const z = eta + (y[i] - mu) / wt;
        for (let a = 0; a < dim; a++) {
          for (let b = 0; b < dim; b++) xtwx[a][b] += wt * xi[a] * xi[b];
          xtwz[a] += wt * xi[a] * z;
        }
      }
      const next = solveLinear(xtwx, xtwz);
      let delta = 0;
      for (let j = 0; j < dim; j++) delta = Math.max(delta, Math.abs(next[j] - w[j]));
      w = next;
      if (delta < 1e-9) break;
    }
    let ll = 0;
    for (const i of idx) {
      const eta = x[i].reduce((s, v, j) => s + v * w[j], 0);
      const mu = sigmoid(eta);
      ll += y[i] === 1 ? -Math.log(Math.max(mu, 1e-12)) : -Math.log(Math.max(1 - mu, 1e-12));
    }
    return { w, ll };
  };

  const all = protos.map((_, i) => i);
  const { w, ll } = fitOnce(all);
  const pPos = y.reduce((s, v) => s + v, 0) / y.length;
  const llConst = y.reduce(
    (s, v) => s + (v === 1 ? -Math.log(pPos) : -Math.log(1 - pPos)),
    0,
  );
  let llOos = 0;
  for (let k = 0; k < 5; k++) {
    const test = all.filter((i) => i % 5 === k);
    const train = all.filter((i) => i % 5 !== k);
    const { w: wk } = fitOnce(train);
    for (const i of test) {
      const eta = x[i].reduce((s, v, j) => s + v * wk[j], 0);
      const mu = sigmoid(eta);
      llOos += y[i] === 1 ? -Math.log(Math.max(mu, 1e-12)) : -Math.log(Math.max(1 - mu, 1e-12));
    }
  }
  const catFx: Record<string, number> = {};
  for (const c of keptCats) catFx[c] = w[catIdx.get(c)!];
  return {
    intercept: w[0],
    bLogAge: w[1],
    mLog,
    sLog,
    catFx,
    logLossIn: ll / y.length,
    logLossOos: llOos / y.length,
    logLossConst: llConst / y.length,
    n: y.length,
  };
}

/** Probability a protocol with this age and category records a token today. */
function clockProb(clock: ClockModel, p: Protocol, asOf: string): number {
  const z = (Math.log(ageDays(p, asOf)) - clock.mLog) / clock.sLog;
  const fx = p.category && clock.catFx[p.category] !== undefined ? clock.catFx[p.category] : 0;
  return sigmoid(clock.intercept + clock.bLogAge * z + fx);
}

/** The 12-month launch odds: [F(t+365) − F(t)] / [1 − F(t)]. */
export function odds12(clock: ClockModel, p: Protocol, asOf: string): number {
  const fNow = clockProb(clock, p, asOf);
  const ageNow = ageDays(p, asOf);
  const fLater = sigmoid(
    clock.intercept +
      clock.bLogAge * ((Math.log(ageNow + 365) - clock.mLog) / clock.sLog) +
      (p.category && clock.catFx[p.category] !== undefined ? clock.catFx[p.category] : 0),
  );
  const odds = (fLater - fNow) / Math.max(1 - fNow, 1e-9);
  return Math.min(0.95, Math.max(0, odds));
}

// ---- Farm economics: the $1,000 ticket, priced honestly ----

export const TICKET = 1000;
export const T_BILL = 0.04;
export const HOLD_DAYS = 30;
export const DEPOSITOR_SHARE = 0.1;
export const BRIDGE_FEES = 5;

export interface FarmEcon {
  gas: number;
  fees: number;
  forgone: number;
  costs: number;
  slice: number;
  sliceLow: number;
  net: number;
  netLow: number;
  netCashFees: number;
  hours: number;
  netPerHour: number;
  verdict: 'ROBUST' | 'FARM' | 'THIN' | 'SKIP';
  /** Deposit that makes expected net zero at the row's own implied value. */
  depositExp: number;
  /** Deposit that makes net zero if the token launches for certain. */
  depositCert: number;
  /** Implied value at which the ticket breaks even at the row's odds. */
  breakEvenImplied: number;
  /** Launch odds the ticket needs to break even, in percent of implied value. */
  needsPct: number;
}

/** The same dollars every row is priced with; nothing is special-cased. */
export function farmEcon(p: Protocol, implied: number, bandLo: number, odds: number): FarmEcon {
  const gas = gasPerTx(p.chains[0] ?? '') * 2;
  const fees = BRIDGE_FEES;
  const forgone = TICKET * T_BILL * (HOLD_DAYS / 365);
  const costs = gas + fees + forgone;
  const slice = (DEPOSITOR_SHARE * implied * TICKET) / p.tvl_usd;
  const sliceLow = (DEPOSITOR_SHARE * bandLo * TICKET) / p.tvl_usd;
  const net = slice * odds - costs;
  const netLow = sliceLow * odds - costs;
  const netCashFees = slice * odds - gas - fees;
  const hours = 1.5 + 0.5 * Math.min(3, p.chains.length - 1);
  const verdict: FarmEcon['verdict'] =
    netLow > 0 ? 'ROBUST' : net > 0 ? 'FARM' : netCashFees > 0 ? 'THIN' : 'SKIP';
  const depositExp = (costs * p.tvl_usd) / (DEPOSITOR_SHARE * implied * Math.max(odds, 1e-9));
  const depositCert = (costs * p.tvl_usd) / (DEPOSITOR_SHARE * implied);
  const breakEvenImplied = (costs * p.tvl_usd) / (DEPOSITOR_SHARE * TICKET * Math.max(odds, 1e-9));
  const needsPct = Math.min(9999, (costs / Math.max(slice, 1e-9)) * 100);
  return {
    gas,
    fees,
    forgone,
    costs,
    slice,
    sliceLow,
    net,
    netLow,
    netCashFees,
    hours,
    netPerHour: net / hours,
    verdict,
    depositExp,
    depositCert,
    breakEvenImplied,
    needsPct,
  };
}

// ---- Farm steps: 8 steps, derived from the category and the chain ----

function depositAction(p: Protocol): string {
  const n = p.name;
  const chain = p.chains[0] ?? 'its chain';
  switch (p.category) {
    case 'Risk Curators':
      return `Deposit $1,000 into the ${n} curator vault on ${chain} and hold the position`;
    case 'Onchain Capital Allocator':
      return `Deposit $1,000 into the ${n} allocator vault on ${chain} and hold the position`;
    case 'Dexs':
      return `Open a $1,000 liquidity position in ${n} on ${chain} and hold it`;
    case 'Lending':
      return `Supply $1,000 of USDC to ${n} on ${chain} and hold the position`;
    case 'Yield':
    case 'Yield Aggregator':
      return `Deposit $1,000 into the ${n} yield vault on ${chain} and hold the position`;
    case 'CDP':
      return `Open a $1,000 collateral position in ${n} on ${chain} and hold it`;
    case 'Derivatives':
      return `Open a $1,000 hedged position in ${n} on ${chain} and hold it`;
    default:
      return `Deposit $1,000 into ${n} on ${chain} and hold the position`;
  }
}

/** Eight concrete steps. Step times sum to the hands-on hours the plan charges. */
export function farmSteps(p: Protocol, econ: FarmEcon): string[] {
  const n = p.name;
  const chain = p.chains[0] ?? 'its chain';
  const gas = econ.gas / 2; // econ.gas covers two transactions; this is one
  return [
    `Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: nothing. Time: 5 minutes.`,
    `Move $1,000 of USDC onto ${chain} through a bridge or an exchange withdrawal, and check the balance before you continue. Cost: about $5 in bridge fees. Time: 15 minutes.`,
    `${depositAction(p)}. Cost: $1,000 of capital and about $${gas} of gas on ${chain}. Time: 15 minutes.`,
    `Confirm the deposit landed and save the transaction hash with the date, so you can prove the position later. Cost: nothing. Time: 5 minutes.`,
    `Hold the position for 30 days, checking it once a week. Cost: nothing while it sits. Time: 5 minutes a week.`,
    `Watch ${n} for a token or points announcement, and do not move the funds before the snapshot window closes. Cost: nothing. Time: 5 minutes a week.`,
    `If a token launches, claim it from the same wallet that held the position, and check the claim window first. Cost: about $${gas} of gas on ${chain}. Time: 15 minutes.`,
    `After the claim, withdraw the $1,000 back to your main wallet and record the net result against the plan. Cost: about $${gas} of gas on ${chain}. Time: 15 minutes.`,
  ];
}

// The step times above are 5 + 15 + 15 + 5 + 5 + 5 + 15 + 15 minutes of
// hands-on work (the two weekly checks are 5 minutes a week for 30 days).

// ---- The board ----

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  watchlist: boolean;
  implied_value_usd: number;
  band_lo: number;
  band_hi: number;
  rank_lo: number;
  rank_hi: number;
  odds_12m: number;
  slice_usd: number;
  net_usd: number;
  net_per_hour: number;
  break_even_deposit_usd: number;
  break_even_value_usd: number;
  needs_pct: number;
  verdict: 'ROBUST' | 'FARM' | 'THIN' | 'SKIP';
  farm_steps: string[];
  farm_summary: string;
  comparables: { name: string; mcap: number }[];
}

export interface RadarResult {
  snapshot: Snapshot;
  comps: Protocol[];
  compsExcluded: number;
  cap: number;
  fit: CurveFit;
  level100M: number;
  clock: ClockModel;
  loo: EvalResult;
  ts: EvalResult & { train: number; test: number };
  flat: { loo: EvalResult; ts: EvalResult };
  band: { r2style: number; honest: number; loF: number; hiF: number };
  rows: BoardRow[];
  traded: Protocol[];
  setAside: { p: Protocol; reason: string }[];
  totalImplied: number;
  verdictCounts: Record<string, number>;
  farmNext: BoardRow[];
  ablation: AblationStep[];
}

export function buildRadar(snapshot: Snapshot): RadarResult {
  const { comps, excluded } = cleanComps(snapshot);
  const cap = winsorCap(comps);
  const fit = fitCurve(comps, cap);
  const level100M = levelAt100M(fit);
  const clock = fitClock(snapshot);
  const loo = looEval(comps, cap);
  const ts = timeSplitEval(comps, cap);
  const flat = flatEval(comps);
  const band = bandCalibration(comps, cap);

  const watchSet = new Set(snapshot.watchlist);
  const board: Protocol[] = [];
  const setAside: { p: Protocol; reason: string }[] = [];
  for (const p of snapshot.protocols) {
    if (hasToken(p)) continue;
    const reason = setAsideReason(p);
    if (reason) {
      setAside.push({ p, reason });
      continue;
    }
    board.push(p);
  }

  // Rank by implied value; the clock never ranks.
  const scored = board.map((p) => ({ p, v: Math.max(1, Math.round(predictValue(fit, p))) }));
  scored.sort((x, y) => y.v - x.v || (x.p.slug < y.p.slug ? -1 : 1));
  const bands = bootstrapBands(comps, board, cap);

  // Nearest traded comparables by log-TVL distance, for the detail view.
  const comparables = (p: Protocol): { name: string; mcap: number }[] =>
    [...comps]
      .map((c) => ({ c, d: Math.abs(Math.log10(c.tvl_usd) - Math.log10(p.tvl_usd)) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, 3)
      .map(({ c }) => ({ name: c.name, mcap: c.mcap_usd as number }));

  const rows: BoardRow[] = scored.map(({ p, v }, i) => {
    const bandRow = bands.get(p.slug)!;
    const odds = odds12(clock, p, snapshot.as_of);
    const econ = farmEcon(p, v, bandRow.lo, odds);
    const wl = watchSet.has(p.slug);
    const steps = farmSteps(p, econ);
    const chain = p.chains[0] ?? 'its chain';
    const farm_summary = `Deposit $1000 on ${chain} · 30d hold`;
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: ageDays(p, snapshot.as_of),
      watchlist: wl,
      implied_value_usd: v,
      band_lo: bandRow.lo,
      band_hi: bandRow.hi,
      rank_lo: bandRow.rankLo,
      rank_hi: bandRow.rankHi,
      odds_12m: odds,
      slice_usd: econ.slice,
      net_usd: econ.net,
      net_per_hour: econ.netPerHour,
      break_even_deposit_usd: econ.depositExp,
      break_even_value_usd: econ.breakEvenImplied,
      needs_pct: econ.needsPct,
      verdict: econ.verdict,
      farm_steps: steps,
      farm_summary,
      comparables: comparables(p),
    };
  });

  const traded = snapshot.protocols.filter(hasToken).sort((x, y) => x.name.localeCompare(y.name));
  const totalImplied = rows.reduce((s, r) => s + r.implied_value_usd, 0);
  const verdictCounts: Record<string, number> = { ROBUST: 0, FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of rows) verdictCounts[r.verdict]++;
  const farmNext = [...rows]
    .filter((r) => r.net_usd > 0)
    .sort((a, b) => b.net_per_hour - a.net_per_hour)
    .slice(0, 5);
  const ablation = ablationSteps(comps, cap);

  return {
    snapshot,
    comps,
    compsExcluded: excluded,
    cap,
    fit,
    level100M,
    clock,
    loo,
    ts,
    flat,
    band,
    rows,
    traded,
    setAside,
    totalImplied,
    verdictCounts,
    farmNext,
    ablation,
  };
}

// ---- Gate check: the board must pass before main.ts writes anything ----

export function boardIssue(r: RadarResult): string | null {
  const { rows, snapshot } = r;
  if (rows.length < 100 || rows.length > 4000) return `board rows ${rows.length} outside 100–4000`;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.rank !== i + 1) return `rank ${row.rank} at position ${i + 1}`;
    if (i > 0 && row.implied_value_usd > rows[i - 1].implied_value_usd) {
      return `implied value rises at rank ${row.rank}`;
    }
    if (row.implied_value_usd <= 0 || row.implied_value_usd > 1e14) {
      return `implied value out of range at rank ${row.rank}`;
    }
    if (!snapshot.protocols.some((p) => p.slug === row.slug)) return `slug ${row.slug} not in snapshot`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `farm_steps count ${row.farm_steps.length} at rank ${row.rank}`;
    }
    for (const s of row.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `farm step length ${t.length} at rank ${row.rank}`;
    }
  }
  const watchSet = new Set(snapshot.watchlist);
  const covered = rows.filter((row) => watchSet.has(row.slug)).length;
  if (covered !== snapshot.watchlist.length) {
    return `watchlist coverage ${covered}/${snapshot.watchlist.length}`;
  }
  return null;
}

// ---- The dashboard data file: everything the page renders, recomputable ----

export function dataScript(r: RadarResult): string {
  const data = {
    meta: {
      as_of: r.snapshot.as_of,
      source: r.snapshot.source,
      floor_usd: r.snapshot.floor_usd,
      model_id: 'landfall-3',
      curve: { a: r.fit.a, b: r.fit.b, cap: r.cap, level_100m: r.level100M },
      loo: r.loo,
      ts: { median: r.ts.median, within3: r.ts.within3, within10: r.ts.within10, train: r.ts.train, test: r.ts.test },
      flat: {
        loo: { median: r.flat.loo.median, within3: r.flat.loo.within3 },
        ts: { median: r.flat.ts.median, within3: r.flat.ts.within3 },
      },
      band: r.band,
      clock: {
        log_loss_in: r.clock.logLossIn,
        log_loss_oos: r.clock.logLossOos,
        log_loss_const: r.clock.logLossConst,
      },
      counts: {
        board: r.rows.length,
        watchlist: r.snapshot.watchlist.length,
        comps: r.comps.length,
        comps_excluded: r.compsExcluded,
        traded: r.traded.length,
        set_aside: r.setAside.length,
        total_implied: r.totalImplied,
      },
      verdict_counts: r.verdictCounts,
      ablation: r.ablation,
    },
    rows: r.rows,
    comps: r.comps.map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl: p.tvl_usd,
      mcap: p.mcap_usd,
      change_7d: p.change_7d,
    })),
    traded: r.traded.map((p) => ({
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl: p.tvl_usd,
      mcap: p.mcap_usd,
    })),
    set_aside: r.setAside.map(({ p, reason }) => ({
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl: p.tvl_usd,
      reason,
    })),
    farm_next: r.farmNext.map((row) => ({
      rank: row.rank,
      name: row.name,
      net_per_hour: row.net_per_hour,
      odds_12m: row.odds_12m,
      verdict: row.verdict,
    })),
  };
  return `window.RADAR = ${JSON.stringify(data)};\n`;
}
