#!/usr/bin/env node
'use strict';

/**
 * collect.cjs - normaliza la salida del audit para GitHub Actions.
 *
 * Corre DENTRO de un step composite: recibe el report.json más reciente y
 * escribe los outputs (verdict, blocking, warnings, report-html) en
 * $GITHUB_OUTPUT, el formato que leen los steps siguientes y los outputs del
 * action.
 *
 * Vive en un script y no inline porque un `node -e` con template literals
 * dentro de un `run: |` se pliega al parsear el YAML del action, y el step
 * termina en exit 1 sin mensaje claro. Medido: primer run real del action en
 * preflight-a11y#1, 2026-11-06.
 *
 * uso: node collect.cjs <reports-dir> <exit-code>
 */

const fs = require('fs');
const path = require('path');

const [reportsDir, exitCode = 'unknown'] = process.argv.slice(2);
const out = process.env.GITHUB_OUTPUT;

function write(key, value) {
  if (!out) {
    console.log(`${key}=${value}`);
    return;
  }
  fs.appendFileSync(out, `${key}=${value}\n`);
}

function log(msg) {
  // stdout de un step composite es visible en el run log.
  console.log(msg);
}

write('exit-code', exitCode);

function newestReport(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('audit-')) continue;
    const p = path.join(dir, entry.name, 'report.json');
    if (fs.existsSync(p)) found.push({ p, mtime: fs.statSync(p).mtimeMs });
  }
  if (!found.length) return null;
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0].p;
}

const reportPath = newestReport(reportsDir);

if (!reportPath) {
  log(`::warning::No se encontró report.json en ${reportsDir || '(sin dir)'}`);
  write('verdict', 'ERROR');
  write('blocking', '0');
  write('warnings', '0');
  process.exit(0);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch (e) {
  log(`::warning::report.json ilegible: ${e.message}`);
  write('verdict', 'ERROR');
  write('blocking', '0');
  write('warnings', '0');
  process.exit(0);
}

const counts = report.counts || {};
write('verdict', report.verdict || 'ERROR');
write('blocking', counts.blocking == null ? 0 : counts.blocking);
write('warnings', counts.warnings == null ? 0 : counts.warnings);

const html = path.join(path.dirname(reportPath), 'report.html');
if (fs.existsSync(html)) write('report-html', html);

log(`Surface Audit: ${report.verdict} (${counts.blocking || 0} bloqueantes, ${counts.warnings || 0} advertencias)`);
