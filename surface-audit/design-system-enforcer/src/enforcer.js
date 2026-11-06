const fs = require('fs');
const path = require('path');
const { LocalMdAdapter } = require(path.join(__dirname, 'adapters/local-md'));

class DesignSystemEnforcer {
  constructor(options = {}) {
    this.configPath = options.configPath;
    this.format = options.format || 'console';
    this.autoFix = options.autoFix || false;
    this.config = this.loadConfig();
    
    // Inicializar stats
    this.stats = {
      files: 0,
      pass: 0,
      warnings: 0,
      violations: 0
    };
    
    // Inicializar adaptador según tipo de design system
    if (this.config.project.design_system_path) {
      const { LocalMdAdapter } = require(path.join(__dirname, 'adapters/local-md'));
      const adapter = new LocalMdAdapter(this.config.project.design_system_path);
      this.tokens = adapter.loadTokens();
    } else {
      this.tokens = {};
    }
  }

  loadConfig() {
    const defaultConfig = {
      project: { name: 'unknown' },
      rules: {
        enforceTokens: true,
        blockHardcoded: true,
        aiLookVeto: true,
      },
      whitelist: { hex: [] },
      // Paths que no se escanean. Un linter de design system necesita esto por
      // la misma razon que eslint tiene .eslintignore: el propio motor contiene
      // las cadenas que busca (la tabla de morados prohibidos, el detector de
      // `linear-gradient(`) y los tests contienen fixtures que disparan a
      // proposito. Sin exclude, el auto-scan del skill reporta sus definiciones
      // de reglas como violaciones. Verificado 2026-11-06: 5 bloqueos, los 5 en
      // enforcer.js / color.js / enforcer.test.js.
      // Acepta globs (`**/tests/**`) o substrings de path sin wildcard.
      exclude: []
    };

    const defaultConfigPath = path.resolve(process.cwd(), '.kanam/enforcer.config.yaml');
    
    if (!fs.existsSync(this.configPath || defaultConfigPath)) {
      console.warn('⚠️ No config found, using defaults');
      return defaultConfig;
    }

    try {
      const content = fs.readFileSync(this.configPath || defaultConfigPath, 'utf8');
      const loaded = require('js-yaml').load(content);
      return { ...defaultConfig, ...loaded };
    } catch (e) {
      console.error('Error loading config:', e.message);
      return defaultConfig;
    }
  }

  async analyze(targetPath) {
    const violations = [];
    const warnings = [];
    
    const files = this.findFiles(targetPath);
    
    for (const file of files) {
      const fileViolations = this.analyzeFile(file);
      violations.push(...fileViolations.violations);
      warnings.push(...fileViolations.warnings);
    }
    
    return {
      report: this.generateReport(violations, warnings),
      blocked: violations.length > 0,
      stats: {
        files: files.length,
        pass: files.length - (violations.length + warnings.length),
        warnings: warnings.length,
        violations: violations.length
      }
    };
  }

  /**
   * Analiza una lista EXPLÍCITA de archivos, sin recorrer directorios.
   *
   * Es el modo que usa el pre-commit (`--staged`): el HOOK decide qué archivos
   * entran (su scope vive ahí, no en el skill), y acá solo se validan. Un path
   * que ya no existe en el índice, o cuya extensión no es analizable, se ignora
   * en silencio: no es un hallazgo, es un archivo que no aplica.
   *
   * A diferencia de analyze(), devuelve también los arrays de violations y
   * warnings para que el caller pueda armar su propio resumen.
   */
  analyzeFiles(filePaths = []) {
    const extensions = ['.jsx', '.tsx', '.css', '.scss', '.js'];
    const violations = [];
    const warnings = [];
    let analyzed = 0;

    for (const file of filePaths) {
      if (!file) continue;
      if (!extensions.includes(path.extname(file))) continue;
      if (!fs.existsSync(file)) continue;
      analyzed += 1;
      const r = this.analyzeFile(file);
      violations.push(...r.violations);
      warnings.push(...r.warnings);
    }

    const stats = {
      files: analyzed,
      pass: Math.max(0, analyzed - (violations.length + warnings.length)),
      warnings: warnings.length,
      violations: violations.length
    };

    return {
      report: this.generateReport(violations, warnings, stats),
      blocked: violations.length > 0,
      violations,
      warnings,
      stats
    };
  }

  findFiles(targetPath) {
    const extensions = ['.jsx', '.tsx', '.css', '.scss', '.js'];
    // Directorios que NO son código del proyecto. Sin este corte el walker
    // entra en `node_modules/` y marca el CSS de terceros (codemirror, etc.):
    // medido 2026-10-07, un scan de `skills/` devolvió decenas de "morado
    // genérico" de dependencias ajenas. Falsos positivos que el dueño del
    // repo no puede arreglar y que volverían inútil el hook. Los generados
    // (`dist/`, `build/`) tampoco se editan a mano: se regeneran del fuente.
    const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.next']);
    const files = [];

    // Excludes declarados en config (ver loadConfig). Se evalúan contra el path
    // normalizado y relativo al cwd, que es como se escriben en el YAML.
    const excludes = Array.isArray(this.config.exclude) ? this.config.exclude : [];
    const isExcluded = (p) => {
      if (excludes.length === 0) return false;
      const norm = path.relative(process.cwd(), p).split(path.sep).join('/');
      return excludes.some((pattern) => {
        const pat = String(pattern).split(path.sep).join('/');
        if (!pat.includes('*')) return norm.includes(pat);
        const escaped = pat
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '\u0000')
          .replace(/\*/g, '[^/]*')
          .replace(/\u0000/g, '.*');
        return new RegExp(`^${escaped}$`).test(norm);
      });
    };

    const walk = (dir) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // dir ilegible o inexistente: no es un hallazgo, es ruido.
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
          walk(fullPath);
        } else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
          if (!isExcluded(fullPath)) files.push(fullPath);
        }
      }
    };

    walk(targetPath);
    return files;
  }

  analyzeFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const violations = [];
    const warnings = [];
    
    // Verificar gradientes decorativos
    if (content.includes('linear-gradient(') && content.includes('padding')) {
      violations.push({
        file: path.basename(filePath),
        line: this.findLineNumber(content, 'linear-gradient'),
        message: 'Gradiente decorativo prohibido por principios de diseño. Usar token de superficie sólida.'
      });
    }
    
    // Verificar colores hardcodeados
    const hexPattern = /#([a-f0-9]{6}|[a-f0-9]{3})\b/gi;
    let match;
    let lineNum = 0;
    
    while ((match = hexPattern.exec(content)) !== null) {
      lineNum = content.substring(0, match.index).split('\n').length;
      const value = match[0];
      
      // Check for forbidden purple/magenta range
      const cleanHex = this.normalizeHex(value);
      if (this.isForbiddenPurple(cleanHex)) {
        violations.push({
          file: path.basename(filePath),
          line: lineNum,
          message: `Morado genérico prohibido (${value}). Usar token de brand primary o eliminar.`
        });
        continue;
      }
      
      // If not in whitelist
      if (!this.config.whitelist.hex.includes(cleanHex.toLowerCase())) {
        warnings.push({
          file: path.basename(filePath),
          line: lineNum,
          message: `Valor hexadecimal hardcodeado (${value}). Sugerir uso de token semántico.`,
          suggestion: this.findClosestToken(cleanHex)
        });
      }
    }
    
    // Verificar padding inflado
    if (content.includes('padding: ')) {
      const paddingValue = this.extractValue(content, 'padding: ');
      if (parseInt(paddingValue) > 16) {
        warnings.push({
          file: path.basename(filePath),
          line: this.findLineNumber(content, 'padding: '),
          message: `Padding potencialmente inflado (${paddingValue}px). Verificar uso de token estándar.`,
          suggestion: 'Usar var(--k-space-4) o revisar spacing del sistema.'
        });
      }
    }
    
    // Verificar radius exagerado
    if (content.includes('border-radius: ')) {
      const radiusValue = this.extractValue(content, 'border-radius: ');
      if (parseInt(radiusValue) > 8) {
        violations.push({
          file: path.basename(filePath),
          line: this.findLineNumber(content, 'border-radius: '),
          message: `Borde exagerado detectado (${radiusValue}px). Máximo permitido es var(--k-radius-lg) (8px).`
        });
      }
    }
    
    return { violations, warnings };
  }

  normalizeHex(hex) {
    let h = hex.replace('#', '').toLowerCase();
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    return '#' + h;
  }

  isForbiddenPurple(hex) {
    // Normalizar: quitar '#' y expandir shorthand
    let h = hex.replace('#', '');
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    if (h.length !== 6) return false;

    const r = parseInt(h.substring(0, 2), 16) / 255;
    const g = parseInt(h.substring(2, 4), 16) / 255;
    const b = parseInt(h.substring(4, 6), 16) / 255;

    const { h: hue, s, l } = this.rgbToHsl(r, g, b);

    // Purple hue range: 240-300 grados, con saturación y luminosidad apreciables
    return (hue >= 240 && hue <= 300) && s > 0.4 && l > 0.25;
  }

  rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    
    if (max === min) {
      h = s = 0; // achromatic
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h *= 60;
    }
    
    return { h, s, l };
  }

  extractValue(content, property) {
    const regex = new RegExp(`${property}\\s*([\\d.]+px)`, 'i');
    const match = content.match(regex);
    return match ? parseInt(match[1]) : 0;
  }

  findLineNumber(content, searchText) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(searchText)) {
        return i + 1; // Line numbers are 1-indexed
      }
    }
    return 1;
  }

  findClosestToken(hexValue) {
    // Simplified token finder - in real implementation, this would compare against all tokens
    const commonTokens = {
      '#f3f4f6': 'var(--k-bg-main)',
      '#ffffff': 'var(--k-bg-surface)',
      '#1f2937': 'var(--k-text-main)',
      '#6b7280': 'var(--k-text-muted)',
      '#3b82f6': 'var(--k-interactive-primary)',
      '#10b981': 'var(--k-success)',
      '#f59e0b': 'var(--k-warning)',
      '#dc2626': 'var(--k-danger)'
    };
    
    return commonTokens[hexValue.toLowerCase()] || 'Token no encontrado. Consulta /design/tokens.md';
  }

  getSemanticToken(name) {
    const adapter = new LocalMdAdapter(this.config.project.design_system_path);
    const tokens = adapter.loadTokens();
    return tokens.semantic[name];
  }

  generateReport(violations, warnings, stats = { files: 0, pass: 0, warnings: warnings.length, violations: violations.length }) {
    let output = `\n\n🔍 Design System Enforcement Report\n\n`;
    output += `✅ PASS: ${Math.max(0, stats.files - violations.length - warnings.length)} archivos conformes\n`;
    output += `⚠️ WARNINGS: ${warnings.length}\n`;
    output += `🚨 BLOCKS: ${violations.length}\n\n`;
    
    if (violations.length > 0) {
      output += `\n🚨 Violaciones (bloquean merge):\n`;
      violations.forEach(v => {
        output += `- ${v.file}:${v.line} | ${v.message}\n`;
      });
      output += '\n';
    }
    
    if (warnings.length > 0) {
      output += `\n⚠️ Advertencias (mergeable sujetas a corrección):\n`;
      warnings.forEach(w => {
        output += `- ${w.file}:${w.line} | ${w.message}\n`;
        if (w.suggestion) {
          output += `  Suggestion: ${w.suggestion}\n`;
        }
      });
      output += '\n';
    }
    
    if (violations.length === 0 && warnings.length === 0) {
      output += `\n🎉 Todos los archivos cumplen con el Design System.\n\n`;
    } else {
      output += `\n💡 Recomendación: Ejecuta 'npx design-enforcer --fix' para intentar correcciones automáticas.\n\n`;
    }
    
    return output;
  }
}

module.exports = { DesignSystemEnforcer };
