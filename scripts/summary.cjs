'use strict';

/**
 * summary.cjs - escribe el resumen del run en $GITHUB_STEP_SUMMARY.
 *
 * Sin reporte no se inventa nada: se dice que no hubo reporte. Un resumen
 * vacío se lee igual que un aprobado.
 */

const fs = require('fs');
const path = require('path');
const { render } = require('./markdown.cjs');

const [reportsDir] = process.argv.slice(2);
const out = process.env.GITHUB_STEP_SUMMARY;

function write(text) {
  if (out) fs.appendFileSync(out, text + '\n');
  else process.stdout.write(text + '\n');
}

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
  write('## 🎨 Surface Audit\n\nNo se emitió reporte. Un audit que no corre no es un aprobado.');
  process.exit(0);
}

try {
  write(render(JSON.parse(fs.readFileSync(reportPath, 'utf8'))));
} catch (e) {
  write(`## 🎨 Surface Audit\n\nNo se pudo leer el reporte: ${e.message}`);
}
