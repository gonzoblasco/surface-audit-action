'use strict';

/**
 * Configuración unificada del Surface Audit Pipeline.
 *
 * Un solo archivo (`.kanam/pipeline.config.yaml`) declara los stages (uno por
 * skill), el gate de veredicto y la salida. El pipeline no hardcodea nada del
 * proyecto: si falta config, usa defaults conservadores.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DEFAULT_CONFIG = {
  project: { name: 'unknown' },
  stages: [
    { skill: 'design-system-enforcer', path: './src' },
    { skill: 'accessibility-oracle', base_url: 'http://localhost:3000', paths: ['/'] },
    { skill: 'pixel-diff', mode: 'comp' }
  ],
  // Política de veredicto. Cada entrada matchea por severidad o por código.
  gate: {
    block_on: ['critical', 'stage-error'],
    warn_on: ['warning', 'misaligned']
  },
  output: {
    dir: './reports',
    formats: ['console', 'html', 'json']
  },
  // Qué hacer si un stage explota: 'block' (default) o 'warn'.
  on_stage_error: 'block'
};

function loadConfig(configPath) {
  const target = configPath || path.resolve(process.cwd(), '.kanam/pipeline.config.yaml');
  let loaded = {};

  if (fs.existsSync(target)) {
    try {
      loaded = yaml.load(fs.readFileSync(target, 'utf8')) || {};
    } catch (e) {
      throw new Error(`Config de pipeline inválida (${target}): ${e.message}`);
    }
  } else {
    console.warn(`⚠️  No se encontró config de pipeline (${target}); usando defaults.`);
  }

  return {
    ...DEFAULT_CONFIG,
    ...loaded,
    project: { ...DEFAULT_CONFIG.project, ...(loaded.project || {}) },
    gate: { ...DEFAULT_CONFIG.gate, ...(loaded.gate || {}) },
    output: { ...DEFAULT_CONFIG.output, ...(loaded.output || {}) }
  };
}

/**
 * Resuelve la raíz de un skill hermano. Por defecto son vecinos de este skill
 * dentro de `skills/`, de modo que el pipeline es autocontenido. Se puede
 * override con `skillPaths` en la config para ubicaciones no estándar.
 */
function resolveSkillRoot(name, config = {}) {
  const custom = config.skillPaths && config.skillPaths[name];
  if (custom) return path.resolve(custom);
  return path.resolve(__dirname, '..', '..', name);
}

module.exports = { DEFAULT_CONFIG, loadConfig, resolveSkillRoot };
