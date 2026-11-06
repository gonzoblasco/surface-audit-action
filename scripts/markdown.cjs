'use strict';

/**
 * Render markdown de un report.json del surface-pipeline.
 *
 * Vive fuera del action.yml para poder probarlo sin Actions. Recibe el path
 * del reporte y escribe a stdout: el llamador lo redirige a
 * $GITHUB_STEP_SUMMARY o al cuerpo del comentario del PR.
 */

const fs = require('fs');

const MAX_ROWS = Number(process.env.SURFACE_AUDIT_MAX_ROWS || 15);

function icon(verdict) {
  if (verdict === 'APROBADO') return '✅';
  if (verdict === 'ADVERTENCIA') return '⚠️';
  return '❌';
}

function cell(text) {
  return String(text == null ? '-' : text).replace(/\|/g, '\\|').slice(0, 140);
}

function readReport(file) {
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  const root = require('path').dirname(file);
  r._dir = root;
  return r;
}

function render(r, { withMarker = false } = {}) {
  const lines = [];
  if (withMarker) lines.push('<!-- surface-audit -->');

  lines.push(`## ${icon(r.verdict)} Surface Audit — ${r.verdict}`);
  lines.push('');

  if (r.verdict === 'ERROR') {
    lines.push('El pipeline no pudo emitir veredicto. Un stage que no corre bloquea por diseño.');
    return lines.join('\n');
  }

  lines.push(`**${r.counts.blocking}** bloqueantes · **${r.counts.warnings}** advertencias · **${r.counts.total}** total`);
  lines.push('');

  const rows = (r.blocking || []).concat(r.warnings || []);
  if (rows.length === 0) {
    lines.push('_Sin hallazgos._');
  } else {
    lines.push('| Severidad | Archivo | Línea | Hallazgo |');
    lines.push('|---|---|---:|---|');
    for (const f of rows.slice(0, MAX_ROWS)) {
      lines.push(`| ${cell(f.severity)} | \`${cell(f.file)}\` | ${f.line == null ? '-' : f.line} | ${cell(f.message)} |`);
    }
    if (rows.length > MAX_ROWS) {
      lines.push('');
      lines.push(`_Mostrando ${MAX_ROWS} de ${rows.length}._`);
    }
  }

  // Sugerencias de token: lo que convierte un rechazo en un arreglo.
  const withSuggestion = rows.filter((f) => f.suggestion && !/no encontrado|consulta/i.test(f.suggestion));
  if (withSuggestion.length) {
    lines.push('');
    lines.push('<details><summary>Sugerencias de token</summary>');
    lines.push('');
    for (const f of withSuggestion.slice(0, MAX_ROWS)) {
      lines.push(`- \`${cell(f.file)}:${f.line}\` → \`${cell(f.suggestion)}\``);
    }
    lines.push('');
    lines.push('</details>');
  }

  return lines.join('\n');
}

function footer() {
  return '\n<sub>Reglas: Design System tokens + veto AI-look. Sin valores hardcodeados; sin gradientes decorativos; sin morados genéricos; radios y padding del sistema.</sub>';
}

const file = process.argv[2];

function main(reportFile) {
  if (!reportFile) {
    console.error('uso: markdown.cjs <report.json>');
    process.exit(2);
  }
  try {
    process.stdout.write(render(readReport(reportFile)) + '\n');
  } catch (e) {
    console.error(`No se pudo leer el reporte: ${e.message}`);
    process.exit(2);
  }
}

if (require.main === module) main(file);

module.exports = { render, readReport, footer };
