'use strict';

/**
 * pr-comment.cjs - publica o actualiza el comentario del PR.
 *
 * Idempotencia: busca el comentario con el marcador `<!-- surface-audit -->` y
 * lo ACTUALIZA. Sin esto, cada push agrega un comentario nuevo y el PR termina
 * con diez veredictos contradictorios.
 *
 * Un PR desde un fork corre con token de solo lectura: ahí el comentario es un
 * extra, no el veredicto. Se avisa con ::warning y NO se falla: el check lo
 * decide el step de enforce.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { render } = require('./markdown.cjs');

const MARKER = '<!-- surface-audit -->';

const [reportsDir] = process.argv.slice(2);
const { GITHUB_REPOSITORY, PR_NUMBER, GH_TOKEN } = process.env;

function warn(msg) {
  console.log(`::warning::${msg}`);
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

function gh(args, input) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    env: { ...process.env, GH_TOKEN }
  });
}

if (!GITHUB_REPOSITORY || !PR_NUMBER) {
  warn('Sin GITHUB_REPOSITORY/PR_NUMBER: no es un PR, se omite el comentario.');
  process.exit(0);
}

const reportPath = newestReport(reportsDir);

let body;
if (!reportPath) {
  body = [
    MARKER,
    '## ❌ Surface Audit — no pudo emitir veredicto',
    '',
    'El pipeline no generó reporte. Un stage que no corre bloquea por diseño.',
    '',
    '<sub>Revisá los logs del job.</sub>'
  ].join('\n');
} else {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  body = render(report, { withMarker: true })
    + '\n\n<sub>Reporte completo en el artifact `surface-audit-report`.</sub>';
}

fs.mkdirSync(process.env.RUNNER_TEMP || '/tmp', { recursive: true });
const bodyFile = path.join(process.env.RUNNER_TEMP || '/tmp', 'surface-audit-body.md');
fs.writeFileSync(bodyFile, body, 'utf8');

try {
  const raw = gh([
    'api',
    `repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments`,
    '--paginate',
    '--jq',
    `[.[] | select(.body | startswith("${MARKER}")) | .id] | first // empty`
  ]).trim();

  if (raw) {
    gh(['api', '-X', 'PATCH', `repos/${GITHUB_REPOSITORY}/issues/comments/${raw}`, '-F', `body=@${bodyFile}`]);
    console.log(`Comentario actualizado (id ${raw}).`);
  } else {
    gh(['api', '-X', 'POST', `repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments`, '-F', `body=@${bodyFile}`]);
    console.log('Comentario creado.');
  }
} catch (e) {
  warn(`No se pudo comentar en el PR (${String(e.message).split('\n')[0]}). El veredicto se aplica igual por el check.`);
}

process.exit(0);
