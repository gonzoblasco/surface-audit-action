'use strict';

/**
 * Reporte unificado: console, JSON y HTML autocontenido.
 *
 * El HTML agrega las tres secciones con la evidencia visual embebida (base64)
 * y un encabezado con el veredicto único.
 */

const fs = require('fs');
const path = require('path');

const SKILL_LABEL = {
  'design-system-enforcer': 'Design System Enforcer',
  'accessibility-oracle': 'Accessibility Oracle',
  'pixel-diff': 'Pixel Diff'
};

const ICON_BY_STATUS = { pass: '✓', warn: '⚠', blocked: '✗', failed: '✗', error: '💥' };

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ───────────────────────────────── console ─────────────────────────────────

function consoleReport({ results, verdict, generatedAt }) {
  const lines = [];
  lines.push('');
  lines.push('🔍 SURFACE AUDIT PIPELINE');
  lines.push('═══════════════════════════════════════');
  lines.push(`Proyecto: ${verdict.projectName || 'unknown'}`);
  lines.push(`Fecha: ${generatedAt}`);
  lines.push('');

  results.forEach((r, i) => {
    const icon = ICON_BY_STATUS[r.status] || '?';
    const n = i + 1;
    let detail = '';
    if (r.skill === 'design-system-enforcer') {
      detail = `${r.stats.files} files, ${r.stats.violations} blocks, ${r.stats.warnings} warnings`;
    } else if (r.skill === 'accessibility-oracle') {
      detail = `${r.stats.routes} routes, ${r.stats.violations} violations, ${r.stats.warnings} warnings`;
    } else if (r.skill === 'pixel-diff') {
      const a = r.stats && r.stats.alignment != null ? `${r.stats.alignment.toFixed(1)}%` : 'n/a';
      detail = `align ${a}, ${(r.stats && r.stats.critical) || 0} critical, ${(r.stats && r.stats.misaligned) || 0} misaligned`;
    }
    lines.push(`[${n}/${results.length}] ${(SKILL_LABEL[r.skill] || r.skill).padEnd(24)} ${icon} ${detail}`);
    if (r.error) lines.push(`        ↳ ERROR: ${r.error}`);
  });

  lines.push('');
  lines.push('───────────────────────────────────────');
  lines.push(`VEREDICTO: ${verdict.verdict === 'RECHAZADO' ? '❌ RECHAZADO' : verdict.verdict === 'ADVERTENCIA' ? '⚠️  ADVERTENCIA' : '✅ APROBADO'}`);

  if (verdict.blocking.length) {
    lines.push('');
    lines.push(`Bloqueos (${verdict.blocking.length}):`);
    for (const f of verdict.blocking) {
      lines.push(`  - [${SKILL_LABEL[f.skill] || f.skill}] ${f.message}${loc(f)}`);
    }
  }
  if (verdict.warnings.length) {
    lines.push('');
    lines.push(`Advertencias (${verdict.warnings.length}):`);
    for (const f of verdict.warnings) {
      lines.push(`  - [${SKILL_LABEL[f.skill] || f.skill}] ${f.message}${loc(f)}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function loc(f) {
  const parts = [];
  if (f.file) parts.push(f.file + (f.line ? `:${f.line}` : ''));
  if (f.route) parts.push(f.route);
  return parts.length ? ` (${parts.join(' ')} )`.replace(' )', ')') : '';
}

// ─────────────────────────────────── JSON ──────────────────────────────────

function jsonReport(model) {
  const { results, verdict, generatedAt, config } = model;
  return JSON.stringify({
    project: config.project,
    generatedAt,
    verdict: verdict.verdict,
    exitCode: verdict.exitCode,
    counts: verdict.counts,
    stages: results.map((r) => ({
      skill: r.skill,
      status: r.status,
      blocked: r.blocked,
      error: r.error || null,
      stats: r.stats || null,
      findings: r.findings || []
    })),
    blocking: verdict.blocking,
    warnings: verdict.warnings
  }, null, 2);
}

// ─────────────────────────────────── HTML ──────────────────────────────────

function imgTag(file) {
  try {
    if (!file || !fs.existsSync(file)) return '';
    const b64 = fs.readFileSync(file).toString('base64');
    return `<img src="data:image/png;base64,${b64}" alt="evidencia" />`;
  } catch {
    return '';
  }
}

function statusBadge(status) {
  const map = { pass: 'ok', warn: 'warn', blocked: 'bad', failed: 'bad', error: 'bad' };
  const cls = map[status] || 'warn';
  return `<span class="badge ${cls}">${status.toUpperCase()}</span>`;
}

function findingsRows(findings) {
  if (!findings || findings.length === 0) {
    return '<tr><td colspan="4" class="muted">Sin hallazgos.</td></tr>';
  }
  return findings.map((f) => `
    <tr class="${f.severity}">
      <td>${escapeHtml(f.severity)}</td>
      <td>${escapeHtml(f.code)}</td>
      <td>${escapeHtml(loc(f) || '—')}</td>
      <td>${escapeHtml(f.message)}${f.suggestion ? `<br /><span class="muted">💡 ${escapeHtml(f.suggestion)}</span>` : ''}</td>
    </tr>`).join('');
}

function evidenceFor(result) {
  const ev = [];
  const a = result.artifacts || {};
  for (const [key, file] of Object.entries(a)) {
    if (typeof file === 'string' && /\.(png|jpg|jpeg)$/i.test(file)) {
      const tag = imgTag(file);
      if (tag) ev.push(`<figure>${tag}<figcaption class="muted">${escapeHtml(result.skill)} · ${escapeHtml(key)}</figcaption></figure>`);
    }
  }
  // Screenshots de accesibilidad viven dentro de findings.
  for (const f of result.findings || []) {
    if (f.screenshot) {
      const tag = imgTag(f.screenshot);
      if (tag) ev.push(`<figure>${tag}<figcaption class="muted">${escapeHtml(f.skill)} · ${escapeHtml(f.rule || 'violación')}</figcaption></figure>`);
    }
  }
  return ev.join('');
}

function htmlReport(model) {
  const { results, verdict, generatedAt, config } = model;
  const bad = verdict.verdict === 'RECHAZADO';
  const warn = verdict.verdict === 'ADVERTENCIA';

  const sections = results.map((r) => `
    <section class="stage">
      <h2>${escapeHtml(SKILL_LABEL[r.skill] || r.skill)} ${statusBadge(r.status)}</h2>
      <p class="muted">${escapeHtml(stageSummary(r))}</p>
      ${r.error ? `<p class="error">Error: ${escapeHtml(r.error)}</p>` : ''}
      <table>
        <thead><tr><th>Severidad</th><th>Código</th><th>Ubicación</th><th>Mensaje</th></tr></thead>
        <tbody>${findingsRows(r.findings)}</tbody>
      </table>
      <div class="evidence">${evidenceFor(r)}</div>
    </section>`).join('');

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Surface Audit — ${escapeHtml(config.project.name)}</title>
<style>
  :root { --ok:#0d9488; --warn:#b7791f; --bad:#b03a2e; --ink:#111318; --bg:#faf9f5; --line:#e2dfd6; }
  body { font-family: Inter, system-ui, -apple-system, sans-serif; margin:0; background:var(--bg); color:var(--ink); }
  header { padding:28px 32px; background:var(--ink); color:var(--bg); }
  header h1 { margin:0; font-size:22px; letter-spacing:.2px; }
  header .sub { opacity:.7; font-size:13px; margin-top:6px; }
  .verdict { display:inline-block; padding:6px 14px; border-radius:8px; font-weight:700; margin-top:14px; }
  .verdict.ok { background:var(--ok); color:#fff; }
  .verdict.warn { background:var(--warn); color:#fff; }
  .verdict.bad { background:var(--bad); color:#fff; }
  .counts { margin-top:10px; font-size:13px; opacity:.85; }
  main { padding:24px 32px; max-width:1100px; }
  .stage { background:#fff; border:1px solid var(--line); border-radius:10px; padding:18px 20px; margin-bottom:20px; }
  .stage h2 { margin:0 0 4px; font-size:16px; display:flex; align-items:center; gap:10px; }
  table { border-collapse:collapse; width:100%; margin-top:10px; }
  th,td { padding:8px 10px; border-bottom:1px solid #efede6; text-align:left; font-size:13px; vertical-align:top; }
  th { background:#f4f4f2; font-weight:600; }
  tr.critical td:first-child { color:var(--bad); font-weight:600; }
  tr.warning td:first-child { color:var(--warn); font-weight:600; }
  .badge { padding:3px 8px; border-radius:6px; font-size:11px; color:#fff; }
  .badge.ok{background:var(--ok);} .badge.warn{background:var(--warn);} .badge.bad{background:var(--bad);}
  .muted { color:#78716c; font-size:12px; }
  .error { color:var(--bad); font-size:13px; }
  .evidence { display:flex; gap:14px; flex-wrap:wrap; margin-top:14px; }
  .evidence figure { margin:0; background:#faf9f5; border:1px solid var(--line); padding:6px; max-width:280px; }
  .evidence img { max-width:100%; display:block; }
  footer { padding:16px 32px; color:#78716c; font-size:12px; }
</style></head>
<body>
<header>
  <h1>🔍 Surface Audit Pipeline</h1>
  <div class="sub">Proyecto: ${escapeHtml(config.project.name)} · ${escapeHtml(generatedAt)}</div>
  <div class="verdict ${bad ? 'bad' : warn ? 'warn' : 'ok'}">
    ${bad ? '❌ RECHAZADO' : warn ? '⚠️ ADVERTENCIA' : '✅ APROBADO'}
  </div>
  <div class="counts">
    ${verdict.counts.blocking} bloqueos · ${verdict.counts.warnings} advertencias · ${verdict.counts.infos} informativos
  </div>
</header>
<main>
  ${sections}
</main>
<footer>Generado por surface-pipeline · evidencia visual embebida (base64)</footer>
</body></html>`;
}

function stageSummary(r) {
  if (r.skill === 'design-system-enforcer') {
    return `${r.stats.files} archivos · ${r.stats.violations} bloques · ${r.stats.warnings} advertencias`;
  }
  if (r.skill === 'accessibility-oracle') {
    return `${r.stats.routes} rutas · ${r.stats.violations} violaciones · ${r.stats.warnings} advertencias`;
  }
  if (r.skill === 'pixel-diff') {
    const a = r.stats && r.stats.alignment != null ? `${r.stats.alignment.toFixed(1)}%` : 'n/a';
    return `alineamiento ${a} · ${(r.stats && r.stats.critical) || 0} críticos · ${(r.stats && r.stats.misaligned) || 0} desalineados`;
  }
  return '';
}

function writeReport(content, dir, basename) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, basename);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

module.exports = { consoleReport, jsonReport, htmlReport, writeReport };
