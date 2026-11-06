'use strict';

/**
 * Veredicto unificado.
 *
 * Los tres skills devuelven hallazgos heterogéneos. El pipeline los normaliza a
 * findings con { skill, severity, code, ... } y el gate decide qué bloquea y
 * qué advierte. Un veredicto único, con evidencia, listo para bloquear merges.
 */

const SEVERITY_ORDER = { critical: 3, warning: 2, info: 1 };

function matches(gateList, finding) {
  if (!Array.isArray(gateList) || gateList.length === 0) return false;
  return gateList.some((g) => g === finding.severity || g === finding.code);
}

/**
 * @param {Array} results  Resultados por stage ({ skill, findings, ... }).
 * @param {object} gate    { block_on, warn_on }.
 * @returns {{verdict, blocking, warnings, infos, counts, exitCode, strictExitCode}}
 */
function computeVerdict(results = [], gate = {}) {
  const blockOn = gate.block_on || ['critical'];
  const warnOn = gate.warn_on || ['warning'];

  const all = [];
  for (const r of results) {
    for (const f of r.findings || []) {
      all.push({ skill: r.skill, ...f, skill: f.skill || r.skill });
    }
  }

  // Un finding bloquea si matchea block_on y no está desactivado por warn_on
  // con mayor prioridad no aplica: block_on gana.
  const blocking = [];
  const warnings = [];
  const infos = [];

  for (const f of all) {
    if (matches(blockOn, f)) blocking.push(f);
    else if (matches(warnOn, f)) warnings.push(f);
    else infos.push(f);
  }

  // Orden estable: lo más severo primero.
  const bySeverity = (a, b) => (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0);
  blocking.sort(bySeverity);
  warnings.sort(bySeverity);

  let verdict;
  if (blocking.length > 0) verdict = 'RECHAZADO';
  else if (warnings.length > 0) verdict = 'ADVERTENCIA';
  else verdict = 'APROBADO';

  return {
    verdict,
    blocking,
    warnings,
    infos,
    counts: {
      blocking: blocking.length,
      warnings: warnings.length,
      infos: infos.length,
      total: all.length
    },
    exitCode: verdict === 'RECHAZADO' ? 1 : 0,
    strictExitCode: verdict === 'APROBADO' ? 0 : 1
  };
}

module.exports = { computeVerdict, matches, SEVERITY_ORDER };
