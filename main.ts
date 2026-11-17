// Landfall round 3 — a token launch radar (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// scores every pre-token protocol with the model in lib/model.ts, writes the
// ranked board to /output/board.json, and copies this repository's
// dashboard/ and screenshots/ to /output. Last, it writes /output/dossier.json,
// the summary the judge reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read
// /output/data.js, which this program writes from the same board.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// Every path is resolved from import.meta.url, never from the working
// directory: the grader runs this file from another folder.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

/** The snapshot file: --input <file> or --input <dir>/snapshot.json. */
function snapshotPath(): string {
  const input = arg('--input', '/input');
  if (input.endsWith('.json')) return input;
  return join(input, 'snapshot.json');
}

/** Copy a directory tree of plain files; returns the relative paths copied. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  const out: string[] = [];
  const stack: string[] = [''];
  while (stack.length > 0) {
    const rel = stack.pop()!;
    for (const entry of readdirSync(rel === '' ? from : join(from, rel), { withFileTypes: true })) {
      const p = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        mkdirSync(join(to, p), { recursive: true });
        stack.push(p);
      } else if (entry.isFile()) {
        copyFileSync(join(from, p), join(to, p));
        out.push(p);
      }
    }
  }
  return out.sort();
}

function fail(message: string): never {
  process.stderr.write(`main.ts: ${message}\n`);
  process.exit(1);
}

function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  const snapText = readFileSync(snapshotPath(), 'utf8');
  const snapshot = parseSnapshot(snapText);
  const radar = buildRadar(snapshot);

  // Fail loudly before writing anything if the board would fail the gate.
  const issue = boardIssue(radar);
  if (issue) fail(`board would fail the gate: ${issue}`);

  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, 'dashboard'), { recursive: true });
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });

  // The board: the ranked rows, in rank order.
  const boardJson = `${JSON.stringify({ rows: radar.rows }, null, 2)}\n`;
  writeFileSync(join(outDir, 'board.json'), boardJson, 'utf8');
  const boardSize = statSync(join(outDir, 'board.json')).size;
  if (boardSize > 8 * 1024 * 1024) fail(`board.json is ${boardSize} bytes, over the 8 MiB cap`);

  // The dashboard data: the same rows, plus everything the page renders.
  writeFileSync(join(outDir, 'data.js'), dataScript(radar), 'utf8');

  // The page itself.
  const dash = copyFiles(join(here, 'dashboard'), join(outDir, 'dashboard'));
  if (!dash.includes('index.html')) fail('dashboard/index.html is missing');
  if (!dash.some((p) => p.endsWith('.css'))) fail('dashboard has no .css file');
  if (!dash.some((p) => p.endsWith('.js'))) fail('dashboard has no .js file');

  // The screenshots, checked for the size cap before the dossier is built.
  const shots = copyFiles(join(here, 'screenshots'), join(outDir, 'screenshots'));
  if (shots.length < 3 || shots.length > 4) fail(`screenshots: ${shots.length} files, need 3 or 4`);
  for (const s of shots) {
    if (!IMAGE_NAME.test(s)) fail(`screenshot name ${s} is not a plain file name`);
    const size = statSync(join(outDir, 'screenshots', s)).size;
    if (size > SCREENSHOT_CAPS.max_bytes) fail(`screenshot ${s} is ${size} bytes, over the 512 KiB cap`);
  }

  // The dossier, last: it is a summary of the dashboard and screenshots.
  const dossier = buildDossier(outDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4 * 1024 * 1024 },
  });
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  const dossierSize = statSync(join(outDir, 'dossier.json')).size;
  if (dossierSize > 1.5 * 1024 * 1024) fail(`dossier is ${dossierSize} bytes, over the 1.5 MiB cap`);

  // One line of honest accounting to stdout.
  const top = radar.rows[0];
  process.stdout.write(
    [
      `rows=${radar.rows.length}`,
      `watchlist=${radar.snapshot.watchlist.length}`,
      `comps=${radar.comps.length}`,
      `set_aside=${radar.setAside.length}`,
      `curve a=${radar.fit.a.toFixed(4)} b=${radar.fit.b.toFixed(4)} level100m=${radar.level100M.toFixed(4)}`,
      `loo=x${radar.loo.median.toFixed(3)}`,
      `timesplit=x${radar.ts.median.toFixed(3)}`,
      `band_honest=${(radar.band.honest * 100).toFixed(1)}%`,
      `clock_oos=${radar.clock.logLossOos.toFixed(4)} vs const=${radar.clock.logLossConst.toFixed(4)}`,
      `total_implied=$${(radar.totalImplied / 1e9).toFixed(2)}B`,
      `top1=${top.name} $${top.implied_value_usd.toLocaleString('en-US')}`,
      `verdicts=${JSON.stringify(radar.verdictCounts)}`,
      `dossier=${dossierSize} bytes`,
    ].join(' '),
  );
  process.stdout.write('\n');
}

main();
