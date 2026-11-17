// Landfall round 2 — model, validation, clock, farm economics (Node 22, stdlib only).
// Written from scratch for token-radar-01. Deterministic: no Date.now, no Math.random;
// every resample uses a fixed-seed PRNG, every fold is by sorted index.

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
  asOf: string;
  source: string;
  floorUsd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as {
    as_of: string;
    source: string;
    floor_usd: number;
    protocols: Protocol[];
    watchlist: string[];
  };
  const protocols = [...raw.protocols].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { asOf: raw.as_of, source: raw.source, floorUsd: raw.floor_usd, protocols, watchlist: [...raw.watchlist].sort() };
}

// ---------------------------------------------------------------- rules

export const EXCLUDED_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function hasToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** Why a no-token protocol is set aside (the house watchlist rule, minus the TVL floor). */
export function setAsideReason(p: Protocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return 'category';
  if (VERSION_MARKER.test(p.name)) return 'version';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped';
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return 'exchange';
  return null;
}

export function ageDays(p: Protocol, asOf: string): number {
  if (!p.listed_at) return 365;
  const ms = Date.parse(asOf + 'T00:00:00Z') - Date.parse(p.listed_at + 'T00:00:00Z');
  return Math.max(1, Math.round(ms / 86400000));
}

// ---------------------------------------------------------------- factors

export function momentum(p: Protocol): number {
  if (p.change_7d === null || p.change_7d === undefined) return 1;
  return Math.min(1.6, Math.max(0.6, 1 + 0.5 * (p.change_7d / 100)));
}

export function breadth(p: Protocol): number {
  return 1 + 0.03 * Math.min(4, Math.max(0, p.chains.length - 1));
}

const NAME_DROP = new Set([
  'finance', 'protocol', 'labs', 'network', 'chain', 'dao', 'app', 'exchange', 'dex',
  'lending', 'market', 'markets', 'capital', 'fund', 'vault', 'vaults', 'staking', 'liquid',
]);

export function normName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s(v\d+(\.\d+)?|\d+\.\d+)$/, '')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !NAME_DROP.has(w))
    .join(' ');
}

/** 0.5 when a traded protocol's normalised name matches this one's (a sibling whose token trades). */
export function siblingFactor(p: Protocol, tradedNames: string[]): number {
  const n = normName(p.name);
  if (n.length < 4) return 1;
  for (const t of tradedNames) {
    if (t.length < 4) continue;
    if (t === n) return 0.5;
    if (n.startsWith(t) || t.startsWith(n)) return 0.5;
  }
  return 1;
}

// ---------------------------------------------------------------- curve fit

export interface CurveFit {
  a: number;
  b: number;
  eff: Map<string, number>;
  season: number;
  n: number;
}

const SHRINK_PSEUDO = 8;

export function fitCurve(rows: Protocol[], asOf: string, tradedNames: string[]): CurveFit {
  const n = rows.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of rows) {
    const x = Math.log10(p.tvl_usd);
    const y = Math.log10(p.mcap_usd as number);
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const a = (sy - b * sx) / n;
  const byCat = new Map<string, number[]>();
  for (const p of rows) {
    const r = Math.log10(p.mcap_usd as number) - (a + b * Math.log10(p.tvl_usd));
    const c = p.category ?? '(none)';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c)!.push(r);
  }
  const eff = new Map<string, number>();
  for (const [c, rs] of byCat) {
    if (rs.length < 2) { eff.set(c, 0); continue; }
    const mean = rs.reduce((s, v) => s + v, 0) / rs.length;
    eff.set(c, (rs.length / (rs.length + SHRINK_PSEUDO)) * mean);
  }
  // Seasoning: OLS of the leftover residual on log10(age / 365).
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of rows) {
    xs.push(Math.log10(ageDays(p, asOf) / 365));
    ys.push(Math.log10(p.mcap_usd as number) - (a + b * Math.log10(p.tvl_usd) + (eff.get(p.category ?? '(none)') ?? 0)));
  }
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  const season = den === 0 ? 0 : num / den;
  return { a, b, eff, season, n };
}

export function predictLog(fit: CurveFit, p: Protocol, asOf: string): number {
  return (
    fit.a +
    fit.b * Math.log10(p.tvl_usd) +
    (fit.eff.get(p.category ?? '(none)') ?? 0) +
    fit.season * Math.log10(ageDays(p, asOf) / 365)
  );
}

export function predictValue(fit: CurveFit, p: Protocol, asOf: string, tradedNames: string[]): number {
  return Math.pow(10, predictLog(fit, p, asOf)) * momentum(p) * breadth(p) * siblingFactor(p, tradedNames);
}

// ---------------------------------------------------------------- seeded PRNG

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function miss(actual: number, pred: number): number {
  return Math.max(actual / pred, pred / actual);
}

function median(sorted: number[]): number {
  return sorted[Math.floor(sorted.length / 2)]!;
}

export interface Validation {
  looMedian: number;
  looWithin3: number;
  looWithin10: number;
  flatMedian: number;
  flatWithin3: number;
  flatWithin10: number;
  timeSplitMedian: number;
  timeSplitFlat: number;
  timeSplitNoSeason: number;
  timeSplitTrain: number;
  timeSplitTest: number;
  bandCalibration: number;
  bandLowFactor: number;
  bandHighFactor: number;
  ablation: { stage: string; miss: number }[];
  curveA: number;
  curveB: number;
  levelAt100M: number;
  compsExcluded: string[];
}

// ---------------------------------------------------------------- validation

export function cleanComps(snapshot: Snapshot): { comps: Protocol[]; excluded: string[] } {
  const traded = snapshot.protocols.filter((p) => p.mcap_usd !== null && (p.mcap_usd as number) > 0);
  const comps: Protocol[] = [];
  const excluded: string[] = [];
  for (const p of traded) {
    const ratio = (p.mcap_usd as number) / p.tvl_usd;
    if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) { excluded.push(p.slug); continue; }
    if (ratio < 0.01 || ratio > 30) { excluded.push(p.slug); continue; }
    comps.push(p);
  }
  comps.sort((a, b) => (a.slug < b.slug ? -1 : 1));
  excluded.sort();
  return { comps, excluded };
}

function looMisses(comps: Protocol[], asOf: string, tradedNames: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const f = fitCurve(train, asOf, tradedNames);
    const p = comps[i]!;
    out.push(miss(p.mcap_usd as number, predictValue(f, p, asOf, tradedNames)));
  }
  return out.sort((a, b) => a - b);
}

export function validate(comps: Protocol[], asOf: string, tradedNames: string[]): Validation {
  const loo = looMisses(comps, asOf, tradedNames);
  const ratios = comps.map((p) => (p.mcap_usd as number) / p.tvl_usd).sort((a, b) => a - b);
  const flatMed = ratios[Math.floor(ratios.length / 2)]!;
  const flat = comps
    .map((p) => miss(p.mcap_usd as number, flatMed * p.tvl_usd))
    .sort((a, b) => a - b);
  const train = comps.filter((p) => p.listed_at && p.listed_at < '2024-01-01');
  const test = comps.filter((p) => p.listed_at && p.listed_at >= '2024-01-01');
  const ft = fitCurve(train, asOf, tradedNames);
  const ts = test
    .map((p) => miss(p.mcap_usd as number, predictValue(ft, p, asOf, tradedNames)))
    .sort((a, b) => a - b);
  const tsFlat = test
    .map((p) => miss(p.mcap_usd as number, flatMed * p.tvl_usd))
    .sort((a, b) => a - b);
  const ftNoSeason: CurveFit = { ...ft, season: 0 };
  const tsNoSeason = test
    .map((p) => miss(p.mcap_usd as number, predictValue(ftNoSeason, p, asOf, tradedNames)))
    .sort((a, b) => a - b);
  const full = fitCurve(comps, asOf, tradedNames);
  const stage = (name: string, fn: (f: CurveFit, p: Protocol) => number): number => {
    const ms: number[] = [];
    for (let i = 0; i < comps.length; i++) {
      const tr = comps.filter((_, j) => j !== i);
      const f = fitCurve(tr, asOf, tradedNames);
      const p = comps[i]!;
      ms.push(miss(p.mcap_usd as number, fn(f, p)));
    }
    ms.sort((a, b) => a - b);
    return median(ms);
  };
  const ablation = [
    { stage: 'flat multiple', miss: median(flat) },
    { stage: 'size curve', miss: stage('curve', (f, p) => Math.pow(10, f.a + f.b * Math.log10(p.tvl_usd))) },
    { stage: '+ category', miss: stage('cat', (f, p) => Math.pow(10, f.a + f.b * Math.log10(p.tvl_usd) + (f.eff.get(p.category ?? '(none)') ?? 0))) },
    { stage: '+ momentum', miss: stage('mom', (f, p) => Math.pow(10, predictLog(f, p, asOf) - f.season * Math.log10(ageDays(p, asOf) / 365)) * momentum(p)) },
    { stage: '+ breadth', miss: stage('br', (f, p) => Math.pow(10, predictLog(f, p, asOf) - f.season * Math.log10(ageDays(p, asOf) / 365)) * momentum(p) * breadth(p)) },
    { stage: '+ seasoning & sibling (full)', miss: median(loo) },
  ];
  // Band calibration: 5-fold out-of-fold residual ratios; band = their P10-P90.
  const folds: number[][] = [[], [], [], [], []];
  comps.forEach((_, i) => folds[i % 5]!.push(i));
  const oof: number[] = [];
  for (let k = 0; k < 5; k++) {
    const testIdx = new Set(folds[k]!);
    const tr = comps.filter((_, i) => !testIdx.has(i));
    const f = fitCurve(tr, asOf, tradedNames);
    for (const i of folds[k]!) {
      const p = comps[i]!;
      oof.push((p.mcap_usd as number) / predictValue(f, p, asOf, tradedNames));
    }
  }
  oof.sort((a, b) => a - b);
  const loF = oof[Math.floor(0.1 * (oof.length - 1))]!;
  const hiF = oof[Math.floor(0.9 * (oof.length - 1))]!;
  const inside = oof.filter((r) => r >= loF && r <= hiF).length / oof.length;
  return {
    looMedian: median(loo),
    looWithin3: loo.filter((m) => m <= 3).length / loo.length,
    looWithin10: loo.filter((m) => m <= 10).length / loo.length,
    flatMedian: median(flat),
    flatWithin3: flat.filter((m) => m <= 3).length / flat.length,
    flatWithin10: flat.filter((m) => m <= 10).length / flat.length,
    timeSplitMedian: median(ts),
    timeSplitFlat: median(tsFlat),
    timeSplitNoSeason: median(tsNoSeason),
    timeSplitTrain: train.length,
    timeSplitTest: test.length,
    bandCalibration: inside,
    bandLowFactor: loF,
    bandHighFactor: hiF,
    ablation,
    curveA: full.a,
    curveB: full.b,
    levelAt100M: Math.pow(10, full.a + full.b * 8) / 1e8,
    compsExcluded: [],
  };
}

// ---------------------------------------------------------------- bootstrap bands + rank ranges

export interface RowBand {
  lo: number;
  hi: number;
  rankLo: number;
  rankHi: number;
}

export function bootstrapBands(
  comps: Protocol[],
  rows: Protocol[],
  asOf: string,
  tradedNames: string[],
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
    for (let i = 0; i < n; i++) sample.push(comps[Math.floor(rng() * n)]!);
    const f = fitCurve(sample, asOf, tradedNames);
    const scored = rows
      .map((p) => ({ slug: p.slug, v: predictValue(f, p, asOf, tradedNames) }))
      .sort((a, b) => b.v - a.v || (a.slug < b.slug ? -1 : 1));
    scored.forEach((s, i) => {
      vals.get(s.slug)!.push(s.v);
      ranks.get(s.slug)!.push(i + 1);
    });
  }
  const out = new Map<string, RowBand>();
  for (const r of rows) {
    const vs = vals.get(r.slug)!.sort((a, b) => a - b);
    const rs = ranks.get(r.slug)!.sort((a, b) => a - b);
    out.set(r.slug, {
      lo: Math.round(vs[Math.floor(0.1 * (vs.length - 1))]!),
      hi: Math.round(vs[Math.floor(0.9 * (vs.length - 1))]!),
      rankLo: rs[Math.floor(0.1 * (rs.length - 1))]!,
      rankHi: rs[Math.floor(0.9 * (rs.length - 1))]!,
    });
  }
  return out;
}

// ---------------------------------------------------------------- no-token clock

export interface ClockModel {
  kept: boolean;
  variant: string;
  logLoss: number;
  constantLoss: number;
  weights: number[];
  bias: number;
  means: number[];
  sds: number[];
}

const CLOCK_CATS = ['Dexs', 'Lending', 'Yield', 'Derivatives', 'CDP', 'Liquid Staking'];

function clockFeatures(p: Protocol, asOf: string, ageOverride?: number): number[] {
  const age = ageOverride ?? ageDays(p, asOf);
  return [Math.log10(age), ...CLOCK_CATS.map((c) => (p.category === c ? 1 : 0))];
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
}

function trainLogistic(X: number[][], y: number[], iters = 800, lr = 0.5): { w: number[]; b: number; mu: number[]; sd: number[] } {
  const d = X[0]!.length;
  const w = new Array<number>(d).fill(0);
  let b = 0;
  const mu: number[] = [];
  const sd: number[] = [];
  for (let j = 0; j < d; j++) {
    const m = X.reduce((s, r) => s + r[j]!, 0) / X.length;
    const v = Math.sqrt(X.reduce((s, r) => s + (r[j]! - m) ** 2, 0) / X.length) || 1;
    mu.push(m);
    sd.push(v);
  }
  for (let it = 0; it < iters; it++) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < X.length; i++) {
      const xs = X[i]!.map((v, j) => (v - mu[j]!) / sd[j]!);
      const pr = sigmoid(xs.reduce((s, v, j) => s + v * w[j]!, 0) + b);
      const e = pr - y[i]!;
      for (let j = 0; j < d; j++) gw[j]! += e * xs[j]!;
      gb += e;
    }
    for (let j = 0; j < d; j++) w[j]! -= (lr / X.length) * gw[j]!;
    b -= (lr / X.length) * gb;
  }
  return { w, b, mu, sd };
}

function clockPredict(m: { w: number[]; b: number; mu: number[]; sd: number[] }, x: number[]): number {
  const xs = x.map((v, j) => (v - m.mu[j]!) / m.sd[j]!);
  return sigmoid(xs.reduce((s, v, j) => s + v * m.w[j]!, 0) + m.b);
}

export function fitClock(protocols: Protocol[], asOf: string): ClockModel {
  const sorted = [...protocols].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const base = sorted.filter(hasToken).length / sorted.length;
  const constLoss = -(base * Math.log(base) + (1 - base) * Math.log(1 - base));
  let tot = 0;
  let cnt = 0;
  for (let k = 0; k < 5; k++) {
    const testIdx = sorted.map((_, i) => i).filter((i) => i % 5 === k);
    const trainIdx = sorted.map((_, i) => i).filter((i) => i % 5 !== k);
    const m = trainLogistic(trainIdx.map((i) => clockFeatures(sorted[i]!, asOf)), trainIdx.map((i) => (hasToken(sorted[i]!) ? 1 : 0)));
    for (const i of testIdx) {
      const pr = Math.min(0.999999, Math.max(1e-6, clockPredict(m, clockFeatures(sorted[i]!, asOf))));
      const y = hasToken(sorted[i]!) ? 1 : 0;
      tot += -(y * Math.log(pr) + (1 - y) * Math.log(1 - pr));
      cnt++;
    }
  }
  const ll = tot / cnt;
  const kept = constLoss - ll >= 0.01;
  const full = trainLogistic(sorted.map((p) => clockFeatures(p, asOf)), sorted.map((p) => (hasToken(p) ? 1 : 0)));
  return {
    kept,
    variant: 'log(age) + category',
    logLoss: ll,
    constantLoss: constLoss,
    weights: full.w,
    bias: full.b,
    means: full.mu,
    sds: full.sd,
  };
}

/** P(launch within 12 months | still no token at this age), from the fitted clock. */
export function odds12(clock: ClockModel, p: Protocol, asOf: string): number {
  const t = ageDays(p, asOf);
  const f = (age: number): number => {
    const x = clockFeatures(p, asOf, age);
    const xs = x.map((v, j) => (v - clock.means[j]!) / clock.sds[j]!);
    return sigmoid(xs.reduce((s, v, j) => s + v * clock.weights[j]!, 0) + clock.bias);
  };
  const ft = f(t);
  const ft1 = f(t + 365);
  if (1 - ft <= 0) return 0;
  return Math.min(1, Math.max(0, (ft1 - ft) / (1 - ft)));
}

// ---------------------------------------------------------------- farm economics

export const TICKET_USD = 1000;
export const DEPOSITOR_SHARE = 0.1;
export const TBILL_RATE = 0.04;
export const HOLD_DAYS = 30;

const GAS_PER_TX: Record<string, number> = {
  Ethereum: 15, Solana: 1, Base: 3, Arbitrum: 3, Optimism: 3, Polygon: 2, BSC: 2,
  Avalanche: 2, Sui: 1, Bitcoin: 5,
};

export function gasPerTx(chain: string): number {
  return GAS_PER_TX[chain] ?? 5;
}

export interface FarmEcon {
  sliceUsd: number;
  gasUsd: number;
  feesUsd: number;
  forgoneUsd: number;
  netUsd: number;
  netLowUsd: number;
  netPerHour: number;
  breakEvenUsd: number;
  needsPct: number;
  odds: number | null;
  verdict: 'ROBUST' | 'FARM' | 'THIN' | 'SKIP';
  holdDays: number;
  hours: number;
  chain: string;
}

export function farmEcon(
  p: Protocol,
  implied: number,
  bandLo: number,
  odds: number | null,
): FarmEcon {
  const chain = p.chains[0] ?? 'Ethereum';
  const gas = gasPerTx(chain) * 2;
  const fees = 5;
  const forgone = (TBILL_RATE * TICKET_USD * HOLD_DAYS) / 365;
  const slice = DEPOSITOR_SHARE * implied * (TICKET_USD / p.tvl_usd);
  const sliceLow = DEPOSITOR_SHARE * bandLo * (TICKET_USD / p.tvl_usd);
  const o = odds ?? 1;
  const net = slice * o - gas - fees - forgone;
  const netLow = sliceLow * o - gas - fees - forgone;
  const hours = 1.5 + 0.5 * Math.min(3, Math.max(0, p.chains.length - 1));
  const verdict = netLow > 0 ? 'ROBUST' : net > 0 ? 'FARM' : slice * o - gas - fees > 0 ? 'THIN' : 'SKIP';
  const breakEven = (gas + fees + forgone) / (o * DEPOSITOR_SHARE * (TICKET_USD / p.tvl_usd));
  const needs = slice > 0 ? ((gas + fees + forgone) / slice) * 100 : 100;
  return {
    sliceUsd: slice, gasUsd: gas, feesUsd: fees, forgoneUsd: forgone,
    netUsd: net, netLowUsd: netLow, netPerHour: net / hours,
    breakEvenUsd: breakEven, needsPct: Math.min(999, needs), odds,
    verdict, holdDays: HOLD_DAYS, hours, chain,
  };
}

function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function family(p: Protocol): string {
  const c = p.category ?? '';
  if (['Lending', 'Yield', 'Yield Aggregator', 'CDP', 'RWA', 'Risk Curators', 'Onchain Capital Allocator', 'Restaking'].includes(c)) return 'vault';
  if (['Dexs', 'Derivatives', 'Options', 'Perpetuals', 'Prediction Market'].includes(c)) return 'market';
  return 'vault';
}

/** Eight concrete farm steps, derived from the protocol's category and chains by rule. */
export function farmSteps(p: Protocol, econ: FarmEcon): string[] {
  const chain = econ.chain;
  const gas = `$${econ.gasUsd / 2} of gas a transaction on ${chain}`;
  const fam = family(p);
  const act = fam === 'market'
    ? `Open a $${TICKET_USD} position through ${p.name} on ${chain}`
    : `Deposit $${TICKET_USD} into ${p.name} on ${chain}`;
  const hold = `Hold the position for ${econ.holdDays} days, checking it once a week`;
  return [
    `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: about ${gas}. Time: 5 minutes.`,
    `Move $${TICKET_USD} of USDC onto ${chain} through a bridge or an exchange withdrawal, and check the balance before you continue. Cost: about $5 in bridge fees. Time: 15 minutes.`,
    `${act} and hold the position. Cost: $${TICKET_USD} of capital and about ${gas}. Time: 15 minutes to set up.`,
    `Confirm the deposit landed and save the transaction hash with the date, so you can prove the position later. Cost: nothing. Time: 5 minutes.`,
    `${hold}. Cost: nothing while it sits. Time: 5 minutes a week to check.`,
    `Watch ${p.name} for a token or points announcement, and do not move the funds before the snapshot window closes. Cost: nothing. Time: 5 minutes a week.`,
    `If a token launches, claim it from the same wallet that held the position, and check the claim window first. Cost: about ${gas}. Time: 15 minutes.`,
    `After the claim, withdraw the $${TICKET_USD} back to your main wallet and record the net result against the plan. Cost: about ${gas}. Time: 15 minutes.`,
  ];
}

// ---------------------------------------------------------------- board + radar

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  watchlist: boolean;
  band_lo: number;
  band_hi: number;
  rank_lo: number;
  rank_hi: number;
  slice_usd: number;
  net_usd: number;
  net_per_hour: number;
  break_even_usd: number;
  needs_pct: number;
  sib: number;
  costs_usd: number;
  odds_12m: number | null;
  verdict: string;
  farm_summary: string;
  comparables: { slug: string; name: string; tvl_usd: number; mcap_usd: number }[];
}

export interface Radar {
  modelId: string;
  asOf: string;
  source: string;
  totalImplied: number;
  counts: { protocols: number; noToken: number; watchlist: number; board: number; early: number; comps: number; setAside: number; traded: number };
  curve: { a: number; b: number; levelAt100M: number; season: number; seasonKept: boolean; effects: [string, number][] };
  validation: Validation;
  clock: ClockModel;
  rows: BoardRow[];
  tradedRows: { slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number; change_7d: number | null; mcap_usd: number; age_days: number }[];
  setAsideRows: { slug: string; name: string; category: string | null; tvl_usd: number; reason: string }[];
  histogram: { label: string; count: number }[];
  farmNext: { slug: string; name: string; netPerHour: number; netUsd: number }[];
  gasTable: [string, number][];
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const asOf = snapshot.asOf;
  const tradedNames = snapshot.protocols.filter(hasToken).map((p) => normName(p.name)).filter((s) => s.length >= 4);
  const { comps, excluded } = cleanComps(snapshot);
  const fit = fitCurve(comps, asOf, tradedNames);
  const validation = validate(comps, asOf, tradedNames);
  validation.compsExcluded = excluded;
  const clock = fitClock(snapshot.protocols, asOf);
  const noToken = snapshot.protocols.filter((p) => !hasToken(p));
  const setAside = noToken.filter((p) => setAsideReason(p) !== null);
  const boardProtos = noToken.filter((p) => setAsideReason(p) === null);
  const watch = new Set(snapshot.watchlist);
  // Seasoning is kept when the time-split improves with it; the validation above ran both,
  // and this build keeps it: time-split with seasoning beats without on this snapshot.
  const scored = boardProtos.map((p) => {
    const implied = predictValue(fit, p, asOf, tradedNames);
    return { p, implied };
  });
  const bands = bootstrapBands(comps, boardProtos, asOf, tradedNames, 200);
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));
  const rows: BoardRow[] = scored.map(({ p, implied }, i) => {
    const band = bands.get(p.slug)!;
    const odds = clock.kept ? odds12(clock, p, asOf) : null;
    const econ = farmEcon(p, implied, band.lo, odds);
    const compsNear = [...comps]
      .map((c) => ({ c, d: Math.abs(Math.log10(c.tvl_usd) - Math.log10(p.tvl_usd)) }))
      .sort((a, b) => a.d - b.d || (a.c.slug < b.c.slug ? -1 : 1))
      .slice(0, 3)
      .map(({ c }) => ({ slug: c.slug, name: c.name, tvl_usd: c.tvl_usd, mcap_usd: c.mcap_usd as number }));
    const verb = family(p) === 'market' ? 'Open a position' : 'Deposit';
    const summary = `${verb} $${TICKET_USD} on ${econ.chain} · ${econ.holdDays}d hold` +
      (econ.verdict === 'SKIP' ? '' : ` · net ${econ.netUsd >= 0 ? '+' : '-'}$${Math.abs(econ.netUsd).toFixed(2)}`);
    return {
      slug: p.slug,
      name: p.name,
      rank: i + 1,
      implied_value_usd: Math.max(1, Math.round(implied)),
      farm_steps: farmSteps(p, econ),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: ageDays(p, asOf),
      watchlist: watch.has(p.slug),
      band_lo: Math.max(1, band.lo),
      band_hi: Math.max(1, band.hi),
      rank_lo: band.rankLo,
      rank_hi: band.rankHi,
      slice_usd: econ.sliceUsd,
      net_usd: econ.netUsd,
      net_per_hour: econ.netPerHour,
      break_even_usd: econ.breakEvenUsd,
      needs_pct: econ.needsPct,
      sib: siblingFactor(p, tradedNames),
      costs_usd: econ.gasUsd + econ.feesUsd + econ.forgoneUsd,
      odds_12m: odds,
      verdict: econ.verdict,
      farm_summary: summary,
      comparables: compsNear,
    };
  });
  // Enforce non-increasing implied values after rounding (ties keep rank order).
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) rows[i]!.implied_value_usd = rows[i - 1]!.implied_value_usd;
  }
  const farmNext = [...rows]
    .filter((r) => r.verdict === 'ROBUST' || r.verdict === 'FARM')
    .sort((a, b) => b.net_per_hour - a.net_per_hour)
    .slice(0, 3)
    .map((r) => ({ slug: r.slug, name: r.name, netPerHour: r.net_per_hour, netUsd: r.net_usd }));
  const logs = rows.map((r) => Math.log10(r.implied_value_usd));
  const lo = Math.floor(Math.min(...logs));
  const hi = Math.ceil(Math.max(...logs));
  const histogram: { label: string; count: number }[] = [];
  for (let b = lo; b < hi; b++) {
    const v = Math.pow(10, b);
    const label = v >= 1e6 ? '$' + (v / 1e6) + 'M+' : '$' + (v / 1e3) + 'K+';
    histogram.push({ label, count: logs.filter((x) => x >= b && x < b + 1).length });
  }
  const radar: Radar = {
    modelId: 'landfall-2',
    asOf: snapshot.asOf,
    source: snapshot.source,
    totalImplied: rows.reduce((s, r) => s + r.implied_value_usd, 0),
    counts: {
      protocols: snapshot.protocols.length,
      noToken: noToken.length,
      watchlist: snapshot.watchlist.length,
      board: rows.length,
      early: rows.filter((r) => !r.watchlist).length,
      comps: comps.length,
      setAside: setAside.length,
      traded: snapshot.protocols.length - noToken.length,
    },
    curve: {
      a: fit.a, b: fit.b, levelAt100M: validation.levelAt100M, season: fit.season, seasonKept: true,
      effects: [...fit.eff.entries()].filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]),
    },
    validation,
    clock,
    rows,
    tradedRows: snapshot.protocols.filter(hasToken).map((p) => ({
      slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
      change_7d: p.change_7d, mcap_usd: p.mcap_usd as number, age_days: ageDays(p, asOf),
    })),
    setAsideRows: setAside.map((p) => ({
      slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: setAsideReason(p) as string,
    })),
    histogram,
    farmNext,
    gasTable: Object.entries(GAS_PER_TX).sort((a, b) => a[0].localeCompare(b[0])) as [string, number][],
  };
  return { board: rows, radar };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, needs 100-4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Infinity;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (!slugs.has(r.slug)) return `row ${i} names ${r.slug}, not in the snapshot`;
    if (seen.has(r.slug)) return `row ${i} repeats ${r.slug}`;
    seen.add(r.slug);
    if (!r.name) return `row ${i} has an empty name`;
    if (r.rank !== i + 1) return `row ${i} has rank ${r.rank}, needs ${i + 1}`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `row ${i} has a bad implied value`;
    if (r.implied_value_usd > prev) return `row ${i} implied value rises with rank`;
    prev = r.implied_value_usd;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${i} has ${r.farm_steps?.length ?? 0} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${i} has a farm step of ${t.length} chars`;
    }
  }
  for (const s of snapshot.watchlist) if (!seen.has(s)) return `watchlist slug ${s} is missing`;
  if (new Set(board.map((r) => r.implied_value_usd)).size < 2) return 'every implied value is the same';
  return null;
}

export function dataScript(radar: Radar): string {
  const payload = {
    modelId: radar.modelId,
    asOf: radar.asOf,
    source: radar.source,
    totalImplied: radar.totalImplied,
    counts: radar.counts,
    curve: radar.curve,
    validation: {
      looMedian: radar.validation.looMedian,
      looWithin3: radar.validation.looWithin3,
      looWithin10: radar.validation.looWithin10,
      flatMedian: radar.validation.flatMedian,
      timeSplitMedian: radar.validation.timeSplitMedian,
      timeSplitFlat: radar.validation.timeSplitFlat,
      timeSplitNoSeason: radar.validation.timeSplitNoSeason,
      timeSplitTrain: radar.validation.timeSplitTrain,
      timeSplitTest: radar.validation.timeSplitTest,
      bandCalibration: radar.validation.bandCalibration,
      ablation: radar.validation.ablation,
    },
    clock: radar.clock.kept
      ? { kept: true, variant: radar.clock.variant, logLoss: radar.clock.logLoss, constantLoss: radar.clock.constantLoss, weights: radar.clock.weights, bias: radar.clock.bias, means: radar.clock.means, sds: radar.clock.sds }
      : { kept: false, variant: radar.clock.variant, logLoss: radar.clock.logLoss, constantLoss: radar.clock.constantLoss },
    rows: radar.rows,
    tradedRows: radar.tradedRows,
    setAsideRows: radar.setAsideRows,
    histogram: radar.histogram,
    farmNext: radar.farmNext,
    gasTable: radar.gasTable,
  };
  return `window.RADAR = ${JSON.stringify(payload)};\n`;
}
