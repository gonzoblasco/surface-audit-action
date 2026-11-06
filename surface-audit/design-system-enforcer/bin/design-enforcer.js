#!/usr/bin/env node

/**
 * design-system-enforcer CLI
 * Uso: npx design-enforcer [options] <path>
 */

const { program } = require('commander');
const { DesignSystemEnforcer } = require('../src/enforcer');
const path = require('path');

program
  .name('design-enforcer')
  .description('Guardián preventivo del Design System')
  .version('1.0.0')
  .argument('[path]', 'Ruta a analizar', './src')
  .option('-c, --config <path>', 'Ruta al archivo de configuración', '.kanam/enforcer.config.yaml')
  .option('-f, --format <type>', 'Formato de salida (json|markdown|console)', 'console')
  .option('--fix', 'Intentar auto-corregir valores hardcodeados', false)
  .parse();

const options = program.opts();

const targetPath = program.args[0] || './src';

async function main() {
  const enforcer = new DesignSystemEnforcer({
    configPath: path.resolve(process.cwd(), options.config),
    format: options.format,
    autoFix: options.fix
  });

  const results = await enforcer.analyze(path.resolve(process.cwd(), targetPath));
  
  console.log(results.report);
  process.exit(results.blocked ? 1 : 0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
