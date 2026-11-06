'use strict';

/**
 * Cuerpo del comentario de PR. Wrapper de markdown.cjs con el marcador de
 * idempotencia: el action actualiza el comentario existente en vez de
 * multiplicar uno por push.
 */

const path = require('path');
const { render, readReport } = require('./markdown.cjs');

const file = process.argv[2];
if (!file) {
  console.error('uso: comment.cjs <report.json>');
  process.exit(2);
}

let report;
try {
  report = readReport(file);
} catch (e) {
  console.error(`No se pudo leer el reporte: ${e.message}`);
  process.exit(2);
}

const body = render(report, { withMarker: true })
  + '\n\n<sub>Reglas: Design System tokens + veto AI-look. Reporte completo en el artifact `surface-audit-report`.</sub>';

process.stdout.write(body + '\n');
