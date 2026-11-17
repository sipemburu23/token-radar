# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sipemburu23/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sipemburu23/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Landfall — a token launch radar for make.fun's "Build the best token launch radar" bounty ($1,325). 198 protocols that record no token, priced by one log-log size curve fitted on 86 traded comps, with honest out-of-sample validation and a $1,000 farm plan for every row.

## The model

One curve, one factor, nothing else:

- **Size curve** — log10(market cap) = 2.9082 + 0.5387 · log10(TVL), fitted on 86 traded comps (mcap/TVL 0.01–30, no Bridge/CEX/Liquid Staking categories). Comp market caps are winsorized at their 90th percentile ($104M) *when fitting only*. At $100M of TVL the curve pays ×0.165 of TVL.
- **Momentum only** — 1 + 0.5 × (7-day TVL change), clamped to 0.6–1.6. Category effects, seasoning, breadth and the sibling factor were each tested out of sample and dropped: none improved both the leave-one-out miss and the time-split miss. There is no sibling factor in this build at all — in round 2 it matched a protocol against its own name during validation and overstated accuracy by ~20%.
- **The clock** — logistic has-token ~ log(age) + category over all 758 protocols. Out-of-sample log-loss 0.624 against a constant 0.688: a real signal, but weak, so it is an *informational* 12-month launch-odds column only. It never ranks a row and never sets a verdict on its own; it multiplies the expected slice and orders Farm Next.

## Validation, stated honestly

Validation uses the *same* prediction function as the board — same fit, same momentum, nothing extra. Leave-one-out median miss **×2.98** (51% within 3×, 85% within 10×). Time-split — fit on tokens listed before 2024, test on the newer ones — median miss **×2.00** (67% within 3×). A flat multiple for every protocol misses by ×3.80 leave-one-out and ×3.64 on the time-split. Each row carries a P10–P90 band from 200 bootstrap refits; the band is wide (P10–P90 residual factors 0.18×–8.28×) and the honest cross-fitted coverage is 77.9% (the by-construction figure is 80.2% and is not presented as precision). Ranks 1–12 are exact under the 200 refits.

## The board

- **198 rows**: 40 watchlist + 158 early protocols that record no token; 144 more are set aside by rule (wrapped/staked/bridged products, versioned copies, exchange products); 416 traded protocols are the comps.
- **Total implied value $2.33B.** Top 5: Sentora Curator $99.8M, Steakhouse Financial $97.5M, Gauntlet $75.1M, Veda $69.6M, USDD $58.0M.
- **Farm economics**: a $1,000 ticket; slice = 10% × implied × ($1,000 / TVL); net = slice × 12-month odds − gas − $5 bridge fees − the 4% T-bill yield forgone over 30 days. Verdicts: ROBUST 9 / FARM 5 / THIN 7 / SKIP 177. The top rows read SKIP, and that is correct per the economics — so the top-5 cards lead with the **break-even deposit** instead: Sentora needs $161,806, Steakhouse $69,336, Gauntlet $51,579, Veda $45,926, USDD $24,748. Farm Next (best dollars per hands-on hour): GoonFi +$13.03/h, Tessera V +$6.98/h, Temple +$4.67/h.
- **Dashboard** (`dashboard/`, 37 KB total, no network): the board with filters and sorting, top-5 cards, Farm Next rail, a log-log scatter, the Method & calibration tab, and a detail view with an 8-step farm plan per protocol. Every row's implied value is recomputed in the browser from the curve and the snapshot figures — the header badge shows 198/198 rows equal to board.json.
- Implied value is a model, not a price. A launch is not promised, and a SKIP at $1,000 is the economics talking, not a judgement on the protocol.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22+, standard library only. `main.ts` reads the sealed snapshot, builds the board, writes `board.json` and `data.js`, copies `dashboard/` and `screenshots/` to the output directory, and writes `dossier.json` last with the vendored make.fun library. It fails loudly (non-zero exit) if the board would fail the gate. Run it twice into two output directories and diff them: the outputs are byte-identical.

---

<sub>Entered on [make.fun](https://make.fun/?ref=f6p8nnb7&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
