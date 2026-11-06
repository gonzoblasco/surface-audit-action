'use strict';

/**
 * Stage adapters: cada uno corre un skill y normaliza su salida a findings.
 *
 * Contrato de finding: { skill, severity, code, message, ...detalle }
 *  - severity: 'critical' | 'warning' | 'info'
 *  - code:     identificador estable para el gate (ej. 'accessibility-violation')
 *
 * Los adapters usan el motor real de cada skill. Si un skill no expone arrays
 * de detalle, se sintetiza un finding agregado desde sus stats — nunca se
 * inventa evidencia.
 */

const path = require('path');
const { resolveSkillRoot } = require('./config');

function rel(cwd, p) {
  if (!p) return p;
  return path.isAbsolute(p) ? p : path.resolve(cwd, p);
}

// ─────────────────────────── Design System Enforcer ───────────────────────────

function inferEnforcerCode(message = '') {
  const m = message.toLowerCase();
  if (m.includes('gradiente')) return 'ai-look';
  if (m.includes('morado')) return 'ai-look';
  if (m.includes('borde exagerado') || m.includes('radio')) return 'ai-look';
  if (m.includes('padding')) return 'ds-padding';
  return 'hardcoded-value';
}

async function runEnforcerStage(stage, ctx) {
  const root = resolveSkillRoot('design-system-enforcer', ctx.config);
  const { DesignSystemEnforcer } = require(path.join(root, 'src', 'enforcer.js'));

  const targetPath = rel(ctx.cwd, stage.path || stage.target || './src');
  const configPath = stage.config
    ? rel(ctx.cwd, stage.config)
    : path.resolve(ctx.cwd, '.kanam/enforcer.config.yaml');

  const enforcer = new DesignSystemEnforcer({
    configPath,
    format: stage.format || 'console',
    autoFix: !!stage.fix
  });

  const result = await enforcer.analyze(targetPath);

  // Preferimos los arrays reales si el skill los expone; si no, derivamos del
  // mismo motor (métodos públicos) para no perder detalle.
  let violations = result.violations;
  let warnings = result.warnings;
  if (!Array.isArray(violations) || !Array.isArray(warnings)) {
    violations = [];
    warnings = [];
    for (const file of enforcer.findFiles(targetPath)) {
      const r = enforcer.analyzeFile(file);
      violations.push(...r.violations);
      warnings.push(...r.warnings);
    }
  }

  const findings = [];

  // Guard de cobertura: 0 archivos escaneados NO es "aprobado", es "no medí".
  // Sin este corte, un path inexistente (por ejemplo un directorio gitignored
  // en CI) devolvía 0 findings y un veredicto APROBADO: el falso verde más
  // barato de producir y el más caro de descubrir. Verificado 2026-11-06:
  // en un checkout limpio, `projects/preflight/src` no existe (projects/ está
  // gitignored) y el pipeline aprobaba sin haber leído un solo archivo.
  const filesScanned = result.stats && typeof result.stats.files === 'number'
    ? result.stats.files
    : null;

  if (filesScanned === 0) {
    findings.push({
      skill: 'design-system-enforcer',
      severity: 'critical',
      code: 'stage-no-files',
      file: null,
      line: null,
      message: `El stage no escaneó ningún archivo en ${targetPath}. Un stage vacío no aprueba: o el path no existe, o está gitignored, o la extensión no aplica.`,
      suggestion: 'Revisar stage.path en .kanam/pipeline.config.yaml. Si el target es válido y no tiene código analizable, sacar el stage de la config en vez de dejarlo pasar en silencio.'
    });
  }

  for (const v of violations) {
    findings.push({
      skill: 'design-system-enforcer',
      severity: 'critical',
      code: inferEnforcerCode(v.message),
      file: v.file,
      line: v.line,
      message: v.message,
      suggestion: v.suggestion || null
    });
  }
  for (const w of warnings) {
    findings.push({
      skill: 'design-system-enforcer',
      severity: 'warning',
      code: inferEnforcerCode(w.message),
      file: w.file,
      line: w.line,
      message: w.message,
      suggestion: w.suggestion || null
    });
  }

  return {
    skill: 'design-system-enforcer',
    status: filesScanned === 0 ? 'error' : (result.blocked ? 'blocked' : (warnings.length ? 'warn' : 'pass')),
    blocked: !!result.blocked || filesScanned === 0,
    report: result.report,
    findings,
    stats: result.stats,
    target: targetPath
  };
}

// ─────────────────────────── Accessibility Oracle ───────────────────────────

function normalizeRoutes(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return [{ route: '/', critical: true }];
  return paths.map((p) => (typeof p === 'string' ? { route: p, critical: true } : p));
}

function inferA11yCode(v) {
  const rule = String(v.rule || '');
  if (v.severity === 'critical' || v.impact === 'critical' || v.impact === 'serious') {
    return 'accessibility-violation';
  }
  if (rule === 'page-load' || rule === 'axe-error') return 'accessibility-violation';
  return 'a11y-warning';
}

async function runOracleStage(stage, ctx) {
  const root = resolveSkillRoot('accessibility-oracle', ctx.config);
  const { AccessibilityOracle } = require(path.join(root, 'src', 'oracle.js'));

  const routes = normalizeRoutes(stage.paths || stage.routes);
  const baseUrl = stage.base_url || stage.baseUrl || 'http://localhost:3000';

  const oracle = new AccessibilityOracle({
    configPath: stage.config ? rel(ctx.cwd, stage.config) : path.resolve(ctx.cwd, '.kanam/a11y-oracle.config.yaml'),
    baseUrl,
    format: 'json',
    outputDir_path: undefined,
    outputDir: path.join(ctx.stampDir, 'a11y'),
    headless: stage.headless !== false,
    screenshot: stage.screenshot !== false
  });

  const findings = [];
  const perRoute = [];
  let totalViolations = 0;
  let totalWarnings = 0;
  let report = '';

  for (const entry of routes) {
    // El skill hoy NO expone los arrays de violaciones en su resultado
    // (solo en el texto del reporte). Los capturamos interceptando el
    // generador de reporte durante la ÚNICA corrida de esta ruta — evidencia
    // real, sin inventar y sin ejecutar dos veces.
    let rawViolations = [];
    let rawWarnings = [];
    const origGenerate = oracle.generateReport.bind(oracle);
    let res;
    try {
      oracle.generateReport = (v, w, p) => {
        rawViolations = v || [];
        rawWarnings = w || [];
        return origGenerate(v, w, p);
      };
      res = await oracle.run(entry.route);
    } finally {
      oracle.generateReport = origGenerate;
    }

    report += `\n### ${baseUrl}${entry.route}${entry.critical === false ? ' (opcional)' : ''}\n${res.report}`;

    totalViolations += res.stats ? res.stats.violations : rawViolations.length;
    totalWarnings += res.stats ? res.stats.warnings : rawWarnings.length;

    for (const v of rawViolations) {
      findings.push({
        skill: 'accessibility-oracle',
        severity: 'critical',
        code: inferA11yCode(v),
        route: entry.route,
        critical: entry.critical !== false,
        rule: v.rule || null,
        element: v.element || null,
        message: v.message || v.rule || 'violación de accesibilidad',
        impact: v.impact || v.severity || null,
        screenshot: v.screenshot || null
      });
    }
    for (const w of rawWarnings) {
      findings.push({
        skill: 'accessibility-oracle',
        severity: 'warning',
        code: 'a11y-warning',
        route: entry.route,
        rule: w.rule || null,
        element: w.element || null,
        message: w.message || w.rule || 'advertencia de accesibilidad'
      });
    }

    // Fallback: si el skill no expone el array pero reporta violaciones.
    if (rawViolations.length === 0 && res.stats && res.stats.violations > 0) {
      findings.push({
        skill: 'accessibility-oracle',
        severity: 'critical',
        code: 'accessibility-violation',
        route: entry.route,
        critical: entry.critical !== false,
        message: `${res.stats.violations} violación(es) de accesibilidad en ${entry.route} (detalle no expuesto por el skill)`,
        impact: 'critical'
      });
    }

    perRoute.push({ route: entry.route, critical: entry.critical !== false, failed: !!res.failed, stats: res.stats });
  }

  return {
    skill: 'accessibility-oracle',
    status: totalViolations > 0 ? 'failed' : (totalWarnings > 0 ? 'warn' : 'pass'),
    blocked: totalViolations > 0,
    report,
    findings,
    stats: { routes: routes.length, violations: totalViolations, warnings: totalWarnings },
    routes: perRoute,
    baseUrl
  };
}

// ──────────────────────────────── Pixel Diff ────────────────────────────────

async function runPixelDiffStage(stage, ctx) {
  const root = resolveSkillRoot('pixel-diff', ctx.config);
  const { PixelDiff } = require(path.join(root, 'src', 'pixel-diff.js'));

  const mode = stage.mode || 'comp';
  const pixelDiff = new PixelDiff({
    configPath: stage.config ? rel(ctx.cwd, stage.config) : path.resolve(ctx.cwd, '.kanam/pixel-diff.config.yaml'),
    mode,
    format: 'json',
    outputDir: path.join(ctx.stampDir, 'pixel-diff'),
    threshold: stage.threshold !== undefined ? stage.threshold : 1,
    specPath: stage.specs ? rel(ctx.cwd, stage.specs) : path.resolve(ctx.cwd, '.kanam/pixel-diff.specs.yaml')
  });

  const design = stage.design || stage.capture
    ? rel(ctx.cwd, stage.design || stage.capture)
    : null;

  const result = await pixelDiff.run({
    designPath: design,
    baselineDir: stage.baseline ? rel(ctx.cwd, stage.baseline) : null,
    currentDir: stage.current ? rel(ctx.cwd, stage.current) : null,
    tokenSource: stage.tokens ? rel(ctx.cwd, stage.tokens) : null,
    url: stage.url || stage.base_url || 'http://localhost:3000',
    route: stage.route || '/',
    selector: stage.selector || null
  });

  const findings = [];
  let critical = Array.isArray(result.critical) ? result.critical : [];
  let warns = Array.isArray(result.warnings) ? result.warnings : [];

  // PixelDiff.run() hoy no expone los arrays en el resultado, pero escribe un
  // report.json con el detalle real. Lo leemos de vuelta — evidencia real.
  if (critical.length === 0 && warns.length === 0 && result.artifacts && result.artifacts.report) {
    try {
      const parsed = JSON.parse(require('fs').readFileSync(result.artifacts.report, 'utf8'));
      critical = Array.isArray(parsed.critical) ? parsed.critical : [];
      warns = Array.isArray(parsed.warnings) ? parsed.warnings : [];
    } catch { /* nos quedamos con el fallback de stats */ }
  }

  for (const c of critical) {
    findings.push({
      skill: 'pixel-diff',
      severity: 'critical',
      code: 'visual-critical',
      type: c.type || null,
      property: c.property || null,
      expected: c.expected ?? null,
      actual: c.actual ?? c.message ?? null,
      difference: c.difference ?? null,
      deltaE: c.deltaE ?? null,
      message: c.message || `${c.type || 'check'}/${c.property || ''} desalineado`,
      suggestion: c.suggestion || null
    });
  }
  for (const w of warns) {
    findings.push({
      skill: 'pixel-diff',
      severity: 'warning',
      code: 'misaligned',
      type: w.type || null,
      property: w.property || null,
      expected: w.expected ?? null,
      actual: w.actual ?? w.message ?? null,
      difference: w.difference ?? null,
      deltaE: w.deltaE ?? null,
      message: w.message || `${w.type || 'check'}/${w.property || ''} desalineado`,
      suggestion: w.suggestion || null
    });
  }

  // Fallback desde stats si el skill no expone arrays.
  if (critical.length === 0 && result.stats && result.stats.critical > 0) {
    findings.push({
      skill: 'pixel-diff', severity: 'critical', code: 'visual-critical',
      message: `${result.stats.critical} desalineación(es) crítica(s) de pixel-diff (detalle no expuesto)`
    });
  }
  if (warns.length === 0 && result.stats && result.stats.misaligned > 0 && result.stats.critical === 0) {
    findings.push({
      skill: 'pixel-diff', severity: 'warning', code: 'misaligned',
      message: `${result.stats.misaligned} desalineación(es) visual(es) (detalle no expuesto)`
    });
  }

  return {
    skill: 'pixel-diff',
    status: result.shouldBlock ? 'blocked' : (result.misaligned ? 'warn' : 'pass'),
    blocked: !!result.shouldBlock,
    report: result.report,
    findings,
    artifacts: result.artifacts || {},
    stats: result.stats,
    mode,
    alignment: result.stats ? result.stats.alignment : null
  };
}

const STAGE_RUNNERS = {
  'design-system-enforcer': runEnforcerStage,
  'accessibility-oracle': runOracleStage,
  'pixel-diff': runPixelDiffStage
};

module.exports = { STAGE_RUNNERS, runEnforcerStage, runOracleStage, runPixelDiffStage };
