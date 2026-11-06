'use strict';

/**
 * surface-pipeline — orquestador de la auditoría de superficie.
 *
 * Corre los tres skills (design-system-enforcer, accessibility-oracle,
 * pixel-diff), normaliza sus hallazgos a findings, aplica el gate y emite un
 * veredicto único con reporte HTML/JSON/console.
 *
 * Regla de oro: cada stage se ejecuta de verdad. Si un skill falla, el stage
 * queda como `error` con su mensaje real — nunca se sustituye por un
 * resultado inventado (ver ROADMAP Fase 1: nada de veredictos fabricados).
 */

const fs = require('fs');
const path = require('path');

const { loadConfig } = require('./config');
const { STAGE_RUNNERS } = require('./stages');
const { computeVerdict } = require('./verdict');
const { consoleReport, jsonReport, htmlReport, writeReport } = require('./report');

class SurfacePipeline {
  constructor(options = {}) {
    this.cwd = options.cwd || process.cwd();
    this.configPath = options.configPath;
    this.format = options.format || 'console';
    this.outputDir = options.outputDir;
    this.only = options.only || null; // array de skills a correr, o null = todos
    this.config = loadConfig(this.configPath);
  }

  stamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }

  /** Ejecuta un stage aislado; captura errores como finding crítico, no como crash. */
  async runStage(stage, ctx) {
    const runner = STAGE_RUNNERS[stage.skill];
    if (!runner) {
      return {
        skill: stage.skill,
        status: 'error',
        blocked: true,
        error: `Skill desconocido: ${stage.skill}`,
        findings: [{
          skill: stage.skill, severity: 'critical', code: 'stage-error',
          message: `Skill no soportado por el pipeline: ${stage.skill}`
        }],
        stats: null
      };
    }

    try {
      return await runner(stage, ctx);
    } catch (err) {
      const onError = this.config.on_stage_error || 'block';
      const severity = onError === 'warn' ? 'warning' : 'critical';
      const code = err.code === 'NO_SPEC' ? 'no-spec' : 'stage-error';
      return {
        skill: stage.skill,
        status: 'error',
        blocked: severity === 'critical',
        error: err.message,
        findings: [{
          skill: stage.skill,
          severity,
          code,
          message: `El stage ${stage.skill} no pudo completarse: ${err.message}`
        }],
        stats: null
      };
    }
  }

  /**
   * Captura stdout/stderr durante la ejecución de un stage para que la salida
   * de los skills hijos no contamine los formatos máquina (json/html).
   * Los logs quedan en `result.logs` por si el caller quiere mostrarlos.
   */
  async _captureStdio(fn) {
    const chunks = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (chunk, ...rest) => { chunks.push(String(chunk)); return true; };
    process.stderr.write = (chunk, ...rest) => { chunks.push(String(chunk)); return true; };
    try {
      return { result: await fn(), logs: chunks.join('') };
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
  }

  async run() {
    const stamp = this.stamp();
    const outputDir = this.outputDir
      || path.resolve(this.cwd, this.config.output.dir || './reports');
    const stampDir = path.join(outputDir, `audit-${stamp}`);

    const stages = (this.config.stages || []).filter(
      (s) => !this.only || this.only.includes(s.skill)
    );

    if (stages.length === 0) {
      throw new Error('No hay stages que ejecutar (revisá `stages` en la config o el filtro --only).');
    }

    const ctx = { cwd: this.cwd, config: this.config, stampDir, stamp };
    const results = [];

    for (const stage of stages) {
      const { result, logs } = await this._captureStdio(() => this.runStage(stage, ctx));
      result.skill = stage.skill;
      result.logs = logs;
      results.push(result);
    }

    const verdict = computeVerdict(results, this.config.gate);
    verdict.projectName = this.config.project.name;

    const generatedAt = new Date().toISOString();
    const model = { results, verdict, generatedAt, config: this.config, stampDir };

    const artifacts = { dir: stampDir };

    // Reportes según formatos configurados (el CLI puede forzar uno).
    const formats = this._resolveFormats();
    try {
      fs.mkdirSync(stampDir, { recursive: true });
      if (formats.includes('json')) {
        artifacts.json = writeReport(jsonReport(model), stampDir, 'report.json');
      }
      if (formats.includes('html')) {
        artifacts.html = writeReport(htmlReport(model), stampDir, 'report.html');
      }
      artifacts.latest = writeReport(htmlReport(model), outputDir, 'latest.html');
    } catch (e) {
      console.warn(`⚠️  No se pudieron escribir reportes: ${e.message}`);
    }

    const report = this.format === 'json'
      ? jsonReport(model)
      : this.format === 'html'
        ? htmlReportWithHint(model, artifacts)
        : consoleReport(model) + this._artifactHint(artifacts);

    return {
      report,
      verdict: verdict.verdict,
      blocking: verdict.blocking,
      warnings: verdict.warnings,
      counts: verdict.counts,
      exitCode: verdict.exitCode,
      strictExitCode: verdict.strictExitCode,
      results,
      artifacts
    };
  }

  _resolveFormats() {
    // El formato explícito del CLI manda; si no, la config; si no, ambos.
    if (this.format === 'json') return ['json'];
    if (this.format === 'html') return ['html'];
    const cfg = this.config.output && this.config.output.formats;
    return Array.isArray(cfg) ? cfg.filter((f) => f === 'json' || f === 'html' || f === 'console') : ['json', 'html'];
  }

  _artifactHint(artifacts) {
    const lines = [''];
    if (artifacts.html) lines.push(`📄 Reporte HTML: ${artifacts.html}`);
    if (artifacts.json) lines.push(`🧾 Reporte JSON: ${artifacts.json}`);
    if (artifacts.latest) lines.push(`🕒 Último: ${artifacts.latest}`);
    return lines.length > 1 ? lines.join('\n') + '\n' : '';
  }
}

function htmlReportWithHint(model, artifacts) {
  const summary = consoleReport(model);
  const hint = artifacts.html ? `\n📄 Reporte HTML escrito en: ${artifacts.html}\n` : '';
  return summary + hint;
}

module.exports = { SurfacePipeline };
