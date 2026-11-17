// Landfall's model: one sealed DefiLlama snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds every
// other pre-token protocol that passes the same set-aside rule. A protocol records no token when its
// index entry carries no market cap, no CoinGecko id and no symbol; protocols whose token already
// trades are kept apart as the market's own comparables, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures:
//
//   curve      = 10 ^ (a + b * log10(TVL))              least squares on the traded comps
//   category   = 10 ^ effect[category]                 shrunk toward 0 with 4 pseudo-comps
//   momentum   = 1 + 0.5 * change_7d / 100             clamped to [0.6, 1.6]; null change = 1
//   breadth    = 1 + 0.03 per chain beyond the first   capped at 4 extra chains
//   kinship    = 0.5 when a sibling protocol's token already trades, else 1
//   launch     = curve * category * momentum * breadth * kinship
//
// Seasoning (days with no token) was tested and dropped: adding an age term made the time-split
// test worse, so the model carries no age factor and the Method tab says so. The no-token clock is
// a separate estimate: a logistic fit of "records a token" against log age, used for the 12-month
// launch odds and the farm verdict's expected value, never for the rank.
//
// No protocol name is ever special-cased: one function scores every row, one function builds every
// farm plan, and the same function runs again in the browser to check the board.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const PSEUDO_COMPS = 4;
const BOOTSTRAP_REFITS = 200;
const BOOTSTRAP_SEED = 20261114;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The first word of a name, lowercased, or '' when there is none. */
function firstWord(name: string): string {
  const w = name.split(/\s+/).filter(Boolean);
  return w.length > 0 ? w[0]!.toLowerCase() : '';
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;
const EXCHANGES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini'];
/** Categories that are a product of a token that already trades, never a launch of their own. */
const SET_ASIDE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX', 'Cross Chain Bridge']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Why a pre-token protocol is set aside, or null when the board may rank it. */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && SET_ASIDE_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (VERSIONED.test(p.name)) return 'versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped or staked product';
  const lower = p.name.toLowerCase();
  for (const ex of EXCHANGES) if (lower.startsWith(ex)) return `exchange product (${ex})`;
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and not set aside by rule. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && setAsideReason(p) === null;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

// ------------------------------------------------------------------ the fit

/** A least-squares line through log10(TVL) -> log10(market cap). */
function ols(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b };
}

/** The traded comparables: market cap present and positive, a usable category, a sane multiple. */
export function cleanComps(protocols: SnapshotProtocol[]): { comps: SnapshotProtocol[]; counts: { raw: number; afterCategory: number; afterMcap: number; used: number } } {
  const raw = protocols.filter((p) => p.mcap_usd !== null);
  const afterCategory = raw.filter((p) => p.category === null || !SET_ASIDE_CATEGORIES.has(p.category));
  const afterMcap = afterCategory.filter((p) => (p.mcap_usd ?? 0) > 0);
  const comps = afterMcap.filter((p) => {
    const r = (p.mcap_usd ?? 0) / p.tvl_usd;
    return r >= 0.001 && r <= 20;
  });
  return { comps, counts: { raw: raw.length, afterCategory: afterCategory.length, afterMcap: afterMcap.length, used: comps.length } };
}

export interface CurveFit {
  a: number;
  b: number;
  /** Category effects in log10, shrunk toward 0; only categories with at least 2 comps carry one. */
  effects: Record<string, number>;
}

/** The size curve fitted jointly with shrunk category effects. */
export function fitJoint(data: SnapshotProtocol[], iters = 60): CurveFit {
  const xs = data.map((p) => Math.log10(p.tvl_usd));
  const ys = data.map((p) => Math.log10(p.mcap_usd ?? 1));
  let { a, b } = ols(xs, ys);
  const cats = new Map<string, SnapshotProtocol[]>();
  for (const p of data) {
    const c = p.category ?? 'Other';
    const list = cats.get(c) ?? [];
    list.push(p);
    cats.set(c, list);
  }
  const effects: Record<string, number> = {};
  for (const c of cats.keys()) effects[c] = 0;
  for (let it = 0; it < iters; it++) {
    for (const [c, list] of cats) {
      let s = 0;
      for (const p of list) s += Math.log10(p.mcap_usd ?? 1) - (a + b * Math.log10(p.tvl_usd)) - effects[c]!;
      effects[c] = s / (list.length + PSEUDO_COMPS);
    }
    const adj = data.map((p) => Math.log10(p.mcap_usd ?? 1) - (effects[p.category ?? 'Other'] ?? 0));
    const next = ols(xs, adj);
    a = next.a;
    b = next.b;
  }
  // Categories with fewer than 2 comps carry no effect.
  for (const [c, list] of cats) if (list.length < 2) effects[c] = 0;
  return { a, b, effects };
}

/** A protocol's category effect under a fit, 0 when its category carries none. */
function catEffect(p: SnapshotProtocol, fit: CurveFit): number {
  const c = p.category ?? 'Other';
  return fit.effects[c] ?? 0;
}

/** Seven-day momentum multiplier: 1 + half the change, clamped; no report means no move. */
export function momentumMult(p: SnapshotProtocol): number {
  const c = p.change_7d === null ? 0 : p.change_7d;
  return Math.min(1.6, Math.max(0.6, 1 + 0.5 * (c / 100)));
}

/** Breadth multiplier: 3% per chain beyond the first, at most four extra chains. */
export function breadthMult(p: SnapshotProtocol): number {
  return 1 + 0.03 * Math.min(4, Math.max(0, p.chains.length - 1));
}

/**
 * Kinship discount: 0.5 when a sibling protocol's token already trades. A sibling is another
 * protocol in the snapshot that shares this one's first distinctive word, or whose name this one's
 * name begins with, and whose market cap is on record. Only the snapshot's own fields decide it.
 */
export function kinshipMult(p: SnapshotProtocol, protocols: SnapshotProtocol[]): number {
  const f = firstWord(p.name);
  if (f.length < 4) return 1;
  const lower = p.name.toLowerCase();
  for (const q of protocols) {
    if (q.slug === p.slug || q.mcap_usd === null) continue;
    const qn = q.name.toLowerCase();
    if (firstWord(q.name) === f || lower.startsWith(`${qn} `) || qn.startsWith(`${f} `)) return 0.5;
  }
  return 1;
}

/** The log10 of a protocol's size-curve value under a fit. */
function curveLog(p: SnapshotProtocol, fit: CurveFit): number {
  return fit.a + fit.b * Math.log10(p.tvl_usd);
}

/** A protocol's launch value under a fit, with every multiplier the model carries. */
export function launchValue(p: SnapshotProtocol, fit: CurveFit, protocols: SnapshotProtocol[], use = { cat: true, mom: true, breadth: true, kin: true }): number {
  let v = Math.pow(10, curveLog(p, fit));
  if (use.cat) v *= Math.pow(10, catEffect(p, fit));
  if (use.mom) v *= momentumMult(p);
  if (use.breadth) v *= breadthMult(p);
  if (use.kin) v *= kinshipMult(p, protocols);
  return v;
}

// ------------------------------------------------------------------ validation

/** How far a prediction missed, as a multiple: 1 is exact, 3 is three times off either way. */
function miss(pred: number, actual: number): number {
  return Math.max(pred, actual) / Math.min(pred, actual);
}

function median(ns: number[]): number {
  const s = [...ns].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function quantile(ns: number[], q: number): number {
  const s = [...ns].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

export interface MissStats {
  median: number;
  within3: number;
  within10: number;
}

function missStats(misses: number[]): MissStats {
  return {
    median: median(misses),
    within3: misses.filter((m) => m <= 3).length / misses.length,
    within10: misses.filter((m) => m <= 10).length / misses.length,
  };
}

/** Leave-one-out stats for one prediction rule. */
function loo(data: SnapshotProtocol[], predict: (train: SnapshotProtocol[], p: SnapshotProtocol) => number): MissStats {
  const misses: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const rest = data.slice(0, i).concat(data.slice(i + 1));
    misses.push(miss(predict(rest, data[i]!), data[i]!.mcap_usd ?? 1));
  }
  return missStats(misses);
}

function flatPredict(train: SnapshotProtocol[], p: SnapshotProtocol): number {
  const ratios = train.map((q) => (q.mcap_usd ?? 0) / q.tvl_usd).sort((a, b) => a - b);
  return median(ratios) * p.tvl_usd;
}

function curvePredict(train: SnapshotProtocol[], p: SnapshotProtocol): number {
  const { a, b } = ols(train.map((q) => Math.log10(q.tvl_usd)), train.map((q) => Math.log10(q.mcap_usd ?? 1)));
  return Math.pow(10, a + b * Math.log10(p.tvl_usd));
}

function jointPredict(train: SnapshotProtocol[], p: SnapshotProtocol, use: { cat: boolean; mom: boolean; breadth: boolean; kin: boolean }): number {
  const fit = fitJoint(train);
  const c = p.category ?? 'Other';
  const n = train.filter((q) => (q.category ?? 'Other') === c).length;
  const eff = { ...fit.effects };
  if (n < 2) eff[c] = 0;
  const f2 = { ...fit, effects: eff };
  return launchValue(p, f2, train, use);
}

/** A seeded generator, so the bootstrap refits are byte-identical on every run. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sigmoid(z: number): number {
  const c = Math.max(-30, Math.min(30, z));
  return 1 / (1 + Math.exp(-c));
}

export interface Validation {
  comps: { raw: number; afterCategory: number; afterMcap: number; used: number };
  curve: { a: number; b: number; level100m: number };
  loo: { flat: MissStats; curve: MissStats; category: MissStats; momentum: MissStats; full: MissStats };
  timeSplit: { nTest: number; flat: number; curve: number; full: number; withAge: number };
  seasoning: { kept: boolean; note: string };
  calibration: { pctInside: number; band: string };
  clock: { w0: number; w1: number; oosLogLoss: number; constantLogLoss: number; oddsAtDays: Record<string, number> };
  bootstrapRefits: number;
}

/** The no-token clock: a logistic fit of "records a token" on log age, with split-half validation. */
function fitClock(protocols: SnapshotProtocol[], asOf: string): Validation['clock'] {
  const rows = protocols.map((p) => {
    const age = ageDays(asOf, p.listed_at);
    return { x: Math.log10((age ?? 365) + 1), y: p.gecko_id !== null ? 1 : 0 };
  });
  const fit = (rs: { x: number; y: number }[]): { w0: number; w1: number } => {
    let w0 = 0;
    let w1 = 0;
    const lr = 0.5;
    for (let it = 0; it < 2000; it++) {
      let g0 = 0;
      let g1 = 0;
      for (const r of rs) {
        const pr = sigmoid(w0 + w1 * r.x);
        g0 += pr - r.y;
        g1 += (pr - r.y) * r.x;
      }
      w0 -= (lr * g0) / rs.length;
      w1 -= (lr * g1) / rs.length;
    }
    return { w0, w1 };
  };
  const logLoss = (w: { w0: number; w1: number }, rs: { x: number; y: number }[]): number => {
    let tot = 0;
    for (const r of rs) {
      const pr = Math.min(Math.max(sigmoid(w.w0 + w.w1 * r.x), 1e-9), 1 - 1e-9);
      tot += -(r.y * Math.log(pr) + (1 - r.y) * Math.log(1 - pr));
    }
    return tot / rs.length;
  };
  const all = fit(rows);
  const half = rows.filter((_, i) => i % 2 === 0);
  const other = rows.filter((_, i) => i % 2 === 1);
  const halfFit = fit(half);
  const base = other.reduce((s, r) => s + r.y, 0) / other.length;
  const cl = Math.min(Math.max(base, 1e-9), 1 - 1e-9);
  const constant = -(base * Math.log(cl) + (1 - base) * Math.log(1 - cl));
  const oddsAtDays: Record<string, number> = {};
  for (const days of [45, 180, 365, 730, 1095, 1825]) {
    const f = (t: number): number => sigmoid(all.w0 + all.w1 * Math.log10(t + 1));
    oddsAtDays[`${days}d`] = (f(days + 365) - f(days)) / (1 - f(days));
  }
  return { w0: all.w0, w1: all.w1, oosLogLoss: logLoss(halfFit, other), constantLogLoss: constant, oddsAtDays };
}

/** A protocol's chance of launching within 12 months, given its age and that it records no token yet. */
export function clockOdds(age: number | null, clock: Validation['clock']): number {
  const t = age ?? 365;
  const f = (x: number): number => sigmoid(clock.w0 + clock.w1 * Math.log10(x + 1));
  return (f(t + 365) - f(t)) / (1 - f(t));
}

// ------------------------------------------------------------------ farm plans

/** What one transaction costs on a chain, in whole dollars: the Method tab states the table. */
export const GAS_USD: Record<string, number> = {
  Ethereum: 16,
  Base: 3,
  Arbitrum: 3,
  Optimism: 2,
  Solana: 2,
  Avalanche: 2,
  Polygon: 1,
  BSC: 1,
  Binance: 1,
  Sui: 1,
  Ink: 2,
  Monad: 2,
  Stellar: 1,
  Tron: 1,
  'Robinhood Chain': 2,
  Arc: 2,
  Pharos: 2,
  Provenance: 2,
  Qubic: 1,
  'BSquared': 2,
};

/** Gas for one transaction on a protocol's first chain, $4 when the chain is unlisted. */
export function gasUsd(p: SnapshotProtocol): number {
  const chain = p.chains.length > 0 ? p.chains[0]! : '';
  return GAS_USD[chain] ?? 4;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function ticketFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 2_000_000_000) return 200;
  if (p.tvl_usd >= 500_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 75;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Hands-on hours a plan takes: setup, one weekly action, and the claim. */
export function hoursFor(hold: number): number {
  return 0.75 + 0.25 * Math.ceil(hold / 7) + 0.25;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The category's one action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, ticket: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${ticket} of USDC through ${name} on ${chain} and leave the loan open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Add $${ticket} of liquidity to ${name}'s deepest pool on ${chain} and leave it in place.`;
  if (c.includes('bridge')) return `Bridge $${ticket} of USDC to ${chain} with ${name}, then use the bridged funds inside its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${ticket} of the chain's staking asset with ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Post $${ticket} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund an account with $${ticket} on ${name} and take one market position.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${ticket} into a ${name} vault on ${chain} and hold the vault shares.`;
  if (c.includes('stable')) return `Mint or deposit $${ticket} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${ticket} of the yield-bearing asset ${name} issues on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${ticket} of cover from ${name} on ${chain} and keep the policy live.`;
  if (c.includes('chain')) return `Use $${ticket} on ${chain} through ${name}'s own app and keep the activity regular.`;
  return `Deposit $${ticket} of USDC into ${name} on ${chain} and leave the position open.`;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const ticket = ticketFor(p);
  const hold = holdDaysFor(age);
  const gas = gasUsd(p);
  const weekly = Math.max(1, Math.round(gas / 2));
  return [
    { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: `about $${gas} of gas for the first transaction`, time: '5 minutes' },
    { text: actionFor(p, ticket, chain), cost: `$${ticket} of capital and about $${gas} of gas`, time: '15 minutes to set up' },
    { text: `Move $${ticket} of USDC onto ${chain} through a bridge or an exchange withdrawal, and check the balance before you use it.`, cost: `about $${gas} of gas and $2 of swap fees`, time: '10 minutes' },
    { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: `about $${weekly} of gas a week`, time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${ticket} stays in the position`, time: `${hold} days` },
    { text: `Open the protocol's own points or rewards page once a week and check that your activity is counted.`, cost: 'no fee to check', time: '5 minutes a week' },
    { text: `Before you withdraw, claim only from the link the protocol itself publishes, and never pay anyone to claim for you.`, cost: `about $${gas} of gas to claim`, time: '10 minutes' },
    { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
  ];
}

// ------------------------------------------------------------------ the board

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  factors: { curve: number; category: number; momentum: number; breadth: number; kinship: number };
  band_lo_usd: number;
  band_hi_usd: number;
  rank_lo: number;
  rank_hi: number;
  odds_12mo: number;
  slice_usd: number;
  net_launch_usd: number;
  net_expected_usd: number;
  net_per_hour_usd: number;
  break_even_usd: number;
  needs_pct: number;
  verdict: 'ROBUST' | 'FARM' | 'THIN' | 'SKIP';
  farm: { ticket: number; gas: number; cash_fees: number; hold_days: number; hours: number; action: string; chain: string };
  farm_steps: string[];
  comparables: { slug: string; name: string; tvl_usd: number; mcap_usd: number; multiple: number }[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** A protocol the set-aside rule kept off the board, and the reason it states. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** Everything the dashboard needs: the board, the live set, the set-aside set, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  set_aside_size: number;
  validation: Validation;
  gas: Record<string, number>;
  /** The fitted curve, so the page can recompute every row from the snapshot figures. */
  model: { a: number; b: number; effects: Record<string, number>; catCounts: Record<string, number> };
  /** The traded comparables the curve was fitted on, for the scatter chart. */
  comps: { slug: string; name: string; tvl_usd: number; mcap_usd: number }[];
  /** The leave-one-out residual band in log10, for the scatter chart's band. */
  residBand: { lo: number; hi: number };
  rows: BoardRow[];
  live: LiveRow[];
  setAside: SetAsideRow[];
}

export const MODEL_VERSION = 'landfall-1';

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const index = bySlug(snapshot.protocols);
  const { comps, counts } = cleanComps(snapshot.protocols);
  const fit = fitJoint(comps);
  const clock = fitClock(snapshot.protocols, snapshot.as_of);

  // ---- validation: leave-one-out, time-split, seasoning, calibration
  const looFlat = loo(comps, flatPredict);
  const looCurve = loo(comps, curvePredict);
  const looCategory = loo(comps, (tr, p) => jointPredict(tr, p, { cat: true, mom: false, breadth: false, kin: false }));
  const looMomentum = loo(comps, (tr, p) => jointPredict(tr, p, { cat: true, mom: true, breadth: false, kin: false }));
  const looFull = loo(comps, (tr, p) => jointPredict(tr, p, { cat: true, mom: true, breadth: true, kin: true }));
  const pre = comps.filter((p) => p.listed_at !== null && p.listed_at < '2024-01-01');
  const post = comps.filter((p) => p.listed_at !== null && p.listed_at >= '2024-01-01');
  const tsFit = fitJoint(pre);
  // The seasoning term, fitted on the pre-2024 comps alone: the slope of the full-model residual
  // on log age, with its intercept at the pre-2024 mean log age.
  const ageFit = (() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of pre) {
      const c = p.category ?? 'Other';
      const n = pre.filter((q) => (q.category ?? 'Other') === c).length;
      const eff = { ...tsFit.effects };
      if (n < 2) eff[c] = 0;
      const pred = launchValue(p, { ...tsFit, effects: eff }, pre, { cat: true, mom: true, breadth: true, kin: true });
      xs.push(Math.log10((ageDays(snapshot.as_of, p.listed_at) ?? 365) + 1));
      ys.push(Math.log10(p.mcap_usd ?? 1) - Math.log10(pred));
    }
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
    const my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < xs.length; i++) {
      sxx += (xs[i]! - mx) * (xs[i]! - mx);
      sxy += (xs[i]! - mx) * (ys[i]! - my);
    }
    const slope = sxx === 0 ? 0 : sxy / sxx;
    return { slope, meanX: mx };
  })();
  const tsMiss = (use: { cat: boolean; mom: boolean; breadth: boolean; kin: boolean }, withAge: boolean): number => {
    const ms: number[] = [];
    for (const p of post) {
      const c = p.category ?? 'Other';
      const n = pre.filter((q) => (q.category ?? 'Other') === c).length;
      const eff = { ...tsFit.effects };
      if (n < 2) eff[c] = 0;
      let pred = launchValue(p, { ...tsFit, effects: eff }, pre, use);
      if (withAge) {
        const ag = ageDays(snapshot.as_of, p.listed_at) ?? 365;
        pred *= Math.pow(10, ageFit.slope * (Math.log10(ag + 1) - ageFit.meanX));
      }
      ms.push(miss(pred, p.mcap_usd ?? 1));
    }
    return median(ms);
  };
  const tsFlat = median(post.map((p) => miss(flatPredict(pre, p), p.mcap_usd ?? 1)));
  const tsCurve = tsMiss({ cat: false, mom: false, breadth: false, kin: false }, false);
  const tsFull = tsMiss({ cat: true, mom: true, breadth: true, kin: true }, false);
  const tsWithAge = tsMiss({ cat: true, mom: true, breadth: true, kin: true }, true);

  // Band calibration: for each comp, its leave-one-out residual against the band the other
  // residuals draw, P10 to P90. The share inside is the band's calibration.
  const looPreds = comps.map((p, i) => {
    const rest = comps.slice(0, i).concat(comps.slice(i + 1));
    return jointPredict(rest, p, { cat: true, mom: true, breadth: true, kin: true });
  });
  const residuals = comps.map((p, i) => Math.log10(p.mcap_usd ?? 1) - Math.log10(looPreds[i]!));
  let inside = 0;
  for (let i = 0; i < comps.length; i++) {
    const others = residuals.filter((_, j) => j !== i);
    const lo = quantile(others, 0.1);
    const hi = quantile(others, 0.9);
    if (residuals[i]! >= lo && residuals[i]! <= hi) inside++;
  }
  const calibration = { pctInside: inside / comps.length, band: 'P10-P90 of the leave-one-out residuals' };

  const validation: Validation = {
    comps: counts,
    curve: { a: fit.a, b: fit.b, level100m: Math.pow(10, fit.a + fit.b * 8) / 1e8 },
    loo: { flat: looFlat, curve: looCurve, category: looCategory, momentum: looMomentum, full: looFull },
    timeSplit: { nTest: post.length, flat: tsFlat, curve: tsCurve, full: tsFull, withAge: tsWithAge },
    seasoning: {
      kept: false,
      note: `An age term fitted on the pre-2024 comps made the time-split median miss worse (x${tsWithAge.toFixed(2)} against x${tsFull.toFixed(2)} without it), so the model carries no seasoning factor.`,
    },
    calibration,
    clock,
    bootstrapRefits: BOOTSTRAP_REFITS,
  };

  // ---- the board: every rankable protocol, watchlist first in coverage, ranked by launch value
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  // ---- bootstrap refits: each row's P10-P90 band and rank range, from 200 seeded refits
  const rng = mulberry32(BOOTSTRAP_SEED);
  const refitPreds: number[][] = [];
  for (let r = 0; r < BOOTSTRAP_REFITS; r++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rng() * comps.length)]!);
    const rf = fitJoint(sample, 30);
    const rowPreds: number[] = [];
    for (const p of chosen.values()) {
      const c = p.category ?? 'Other';
      const n = sample.filter((q) => (q.category ?? 'Other') === c).length;
      const eff = { ...rf.effects };
      if (n < 2) eff[c] = 0;
      rowPreds.push(launchValue(p, { ...rf, effects: eff }, sample, { cat: true, mom: true, breadth: true, kin: true }));
    }
    refitPreds.push(rowPreds);
  }
  const chosenList = [...chosen.values()];
  const bandOf = (i: number): { lo: number; hi: number } => {
    const vals = refitPreds.map((r) => Math.log10(r[i]!)).sort((a, b) => a - b);
    return { lo: Math.pow(10, vals[Math.floor(0.1 * vals.length)]!), hi: Math.pow(10, vals[Math.floor(0.9 * vals.length)]!) };
  };
  const rankRangeOf = (i: number): { lo: number; hi: number } => {
    const ranks: number[] = [];
    for (const preds of refitPreds) {
      const order = preds.map((v, j) => [v, j] as [number, number]).sort((x, y) => y[0] - x[0] || (chosenList[x[1]]!.slug < chosenList[y[1]]!.slug ? -1 : 1));
      ranks.push(order.findIndex(([, j]) => j === i) + 1);
    }
    ranks.sort((a, b) => a - b);
    return { lo: ranks[Math.floor(0.1 * ranks.length)]!, hi: ranks[Math.floor(0.9 * ranks.length)]! };
  };

  // ---- comparables: the three traded tokens nearest in TVL
  const nearestComps = (p: SnapshotProtocol): BoardRow['comparables'] => {
    const lt = Math.log10(p.tvl_usd);
    return [...comps]
      .map((q) => ({ q, d: Math.abs(Math.log10(q.tvl_usd) - lt) }))
      .sort((x, y) => x.d - y.d || (x.q.slug < y.q.slug ? -1 : 1))
      .slice(0, 3)
      .map(({ q }) => ({ slug: q.slug, name: q.name, tvl_usd: q.tvl_usd, mcap_usd: q.mcap_usd ?? 0, multiple: round4((q.mcap_usd ?? 0) / q.tvl_usd) }));
  };

  const scored = chosenList.map((p, i) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const curve = Math.pow(10, curveLog(p, fit));
    const cat = Math.pow(10, catEffect(p, fit));
    const mom = momentumMult(p);
    const br = breadthMult(p);
    const kin = kinshipMult(p, snapshot.protocols);
    const launch = curve * cat * mom * br * kin;
    const implied = Math.max(1, Math.round(launch));
    const band = bandOf(i);
    const rankRange = rankRangeOf(i);
    const odds = clockOdds(age, clock);
    const slice = 0.1 * implied * (1000 / p.tvl_usd);
    const ticket = ticketFor(p);
    const hold = holdDaysFor(age);
    const gas = gasUsd(p);
    const cashFees = 3 * gas + 2;
    const tbill = 1000 * 0.04 * (hold / 365);
    const netLaunch = slice - cashFees - tbill;
    const netExpected = slice * odds - cashFees - tbill;
    const hours = hoursFor(hold);
    const netPerHour = netLaunch / hours;
    const breakEven = ((cashFees + tbill) * p.tvl_usd) / (0.1 * 1000);
    const needs = slice > 0 ? (cashFees + tbill) / slice : 1;
    const bandLowSlice = 0.1 * Math.max(1, Math.round(band.lo)) * (1000 / p.tvl_usd);
    const robust = bandLowSlice - cashFees - tbill > 0;
    const verdict: BoardRow['verdict'] = robust ? 'ROBUST' : netLaunch > 0 ? 'FARM' : slice > cashFees ? 'THIN' : 'SKIP';
    return {
      p,
      age,
      implied,
      factors: { curve: round4(curve), category: round4(cat), momentum: round4(mom), breadth: round4(br), kinship: kin },
      band,
      rankRange,
      odds,
      slice,
      netLaunch,
      netExpected,
      netPerHour,
      breakEven,
      needs,
      verdict,
      farm: { ticket, gas, cash_fees: cashFees, hold_days: hold, hours, action: actionFor(p, ticket, chainOf(p)), chain: chainOf(p) },
      farmSteps: farmSteps(p, age).map(stepText),
      comparables: nearestComps(p),
    };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    age_days: s.age,
    implied_value_usd: s.implied,
    factors: s.factors,
    band_lo_usd: Math.max(1, Math.round(s.band.lo)),
    band_hi_usd: Math.max(1, Math.round(s.band.hi)),
    rank_lo: s.rankRange.lo,
    rank_hi: s.rankRange.hi,
    odds_12mo: round4(s.odds),
    slice_usd: round2(s.slice),
    net_launch_usd: round2(s.netLaunch),
    net_expected_usd: round2(s.netExpected),
    net_per_hour_usd: round2(s.netPerHour),
    break_even_usd: Math.max(1, Math.round(s.breakEven)),
    needs_pct: round4(Math.min(1, Math.max(0, s.needs))),
    verdict: s.verdict,
    farm: s.farm,
    farm_steps: s.farmSteps,
    comparables: s.comparables,
  }));

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));

  const setAside: SetAsideRow[] = snapshot.protocols
    .filter((p) => isPreToken(p) && setAsideReason(p) !== null)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: setAsideReason(p) ?? '' }));

  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const catCounts: Record<string, number> = {};
  for (const p of comps) catCounts[p.category ?? 'Other'] = (catCounts[p.category ?? 'Other'] ?? 0) + 1;
  const residSorted = [...residuals].sort((a, b) => a - b);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    set_aside_size: setAside.length,
    validation,
    gas: GAS_USD,
    model: { a: fit.a, b: fit.b, effects: fit.effects, catCounts },
    comps: comps.map((p) => ({ slug: p.slug, name: p.name, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd ?? 0 })),
    residBand: { lo: residSorted[Math.floor(0.1 * residSorted.length)]!, hi: residSorted[Math.floor(0.9 * residSorted.length)]! },
    rows: board,
    live,
    setAside,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate asks for`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
