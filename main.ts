// Landfall round 2 — token-radar-01 entry (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every pre-token protocol with the model in
// lib/model.ts, writes the ranked board to /output/board.json, the dashboard's
// data to /output/data.js, copies dashboard/ and screenshots/ to /output, and
// writes /output/dossier.json last with the vendored make.fun library.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`landfall: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dash = copyDir(join(here, 'dashboard'), join(out, 'dashboard'));
if (dash.length < 3) fail(`dashboard/ holds ${dash.length} files: hand in index.html + app.css + app.js`);
const shots = copyDir(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} images: hand in 3, the board, a detail view and a filtered view`);
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

const v = radar.validation;
process.stdout.write(
  `landfall: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.counts.early} early, ${radar.counts.setAside} set aside, ${radar.counts.comps} comps)\n` +
    `landfall: curve log10(mcap) = ${radar.curve.a.toFixed(4)} + ${radar.curve.b.toFixed(4)} * log10(TVL), level at $100M TVL x${radar.curve.levelAt100M.toFixed(4)}, season ${radar.curve.season.toFixed(3)}\n` +
    `landfall: LOO median miss x${v.looMedian.toFixed(2)} (flat x${v.flatMedian.toFixed(2)}), time-split x${v.timeSplitMedian.toFixed(2)} (flat x${v.timeSplitFlat.toFixed(2)}, no-season x${v.timeSplitNoSeason.toFixed(2)}), band calibration ${(v.bandCalibration * 100).toFixed(0)}%\n` +
    `landfall: clock ${radar.clock.kept ? 'kept' : 'DROPPED'} (${radar.clock.variant}) log-loss ${radar.clock.logLoss.toFixed(3)} vs constant ${radar.clock.constantLoss.toFixed(3)}\n` +
    `landfall: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dash.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
