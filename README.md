# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sipemburu23/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sipemburu23/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Landfall is a token launch radar: it reads a sealed snapshot of every protocol DefiLlama tracks, finds the ones that record no token and are not a wrapped or staked product of one that trades, and ranks them by what their launch would be worth. Every implied value is fitted from the snapshot's own traded tokens — a log-log size curve of market cap against TVL, with shrunk category effects, seven-day momentum, chain breadth and a kinship discount — and validated out of sample before it is believed. Each row carries a farm plan costed in dollars and minutes, and a no-token clock that estimates the chance of a launch in the next twelve months.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

Node 22 or later, standard library only. The program reads the snapshot, writes the ranked board to `board.json`, the dashboard's data to `data.js`, copies `dashboard/` and `screenshots/` to the output directory, and writes `dossier.json` with the vendored make.fun library. Open `out/dashboard/index.html` in a browser to use the radar.

---

<sub>Entered on [make.fun](https://make.fun/?ref=f6p8nnb7&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
