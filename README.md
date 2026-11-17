# Landfall — token launch radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![make.fun · rank](https://make.fun/badge/token-radar-01/sipemburu23/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![make.fun · reward](https://make.fun/badge/token-radar-01/sipemburu23/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Every protocol the snapshot tracks that records no token and is nobody else's
product, priced from the ones that do. The market's own size curve prices
them: a dollar of TVL is worth a different multiple at $5M than at $5B, so the
model fits that curve on the snapshot's own trading protocols, then ranks what
is still to come.

## What it is

- **The board** — ~200 pre-token protocols (40 on the watchlist, the rest
  early), ranked by launch value. Each row shows the implied value with a
  P25–P75 dot-band from 200 bootstrap refits, a rank range, a $1,000 farm
  slice, net of all costs, break-even, and a verdict (ROBUST / FARM / THIN /
  SKIP) with a concrete 8-step farm plan.
- **The model** — joint least-squares `log10(mcap) = a + b * log10(TVL)` on
  the snapshot's clean traded comparables, with category effects shrunk
  toward zero (8 pseudo-comps), momentum from the 7-day change, breadth from
  chain count, a sibling discount when a sibling's token already trades, and
  seasoning (age) kept only because it improved the time-split miss
  out of sample.
- **The clock** — kept: a logistic model of launch within 12 months on
  log(age) + category beats the constant baseline by 0.045 log-loss out of
  sample, and drives the farm expected value. It never drives the rank.
- **The dashboard** — a static page (`dashboard/`, no network, no external
  libraries) that recomputes every row from the model in the browser and
  shows how many rows equal `board.json`. Top-5 cards and a Farm Next rail
  sit above the table; traded comparables and set-aside protocols are
  separate tabs, not ranked.

## How it runs

```
node main.ts --input input/snapshot.json
```

Node 22, standard library only, deterministic. Writes `board.json`,
`data.js`, `dashboard/`, `screenshots/` and `dossier.json` to
`$MAKEFUN_OUTPUT_DIR` (default `/output`). All paths resolve through
`import.meta.url`, so it runs from any working directory.

## Verdicts

- **ROBUST** — net above zero even at the P10 band low.
- **FARM** — net above zero at the point estimate.
- **THIN** — beats cash fees only.
- **SKIP** — does not pay.

Farm economics: $1,000 ticket, 10% to depositors, gas per chain, $5 fees,
forgone 4% T-bill yield over a 30-day hold.

## Honesty notes

- An implied value is a model, not a price.
- A protocol on this board may still have a token its record does not carry;
  the radar says "records no token", never "has none".
- The no-token clock and the seasoning term were tested out of sample and
  kept only because they beat their baselines; the numbers are on the
  Method & calibration tab.
