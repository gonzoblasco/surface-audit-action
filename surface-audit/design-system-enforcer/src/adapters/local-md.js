const fs = require('fs');
const path = require('path');

class LocalMdAdapter {
  constructor(designSystemPath) {
    this.designSystemPath = path.resolve(designSystemPath);
  }

  loadTokens() {
    try {
      const tokensPath = path.join(this.designSystemPath, 'tokens.md');
      
      if (!fs.existsSync(tokensPath)) {
        throw new Error(`Tokens file not found at ${tokensPath}`);
      }

      const content = fs.readFileSync(tokensPath, 'utf8');
      return this.parseTokens(content);
    } catch (error) {
      console.error('Error loading tokens:', error.message);
      return {};
    }
  }

  parseTokens(content) {
    const tokens = {
      colors: {},
      spacing: {},
      radius: {},
      semantic: {}
    };

    // Extraer colores primitivos
    const colorPrimitiveMatch = content.match(/### 1\. Primitivas[\s\S]*?\| Token \| Hex \| Muestra \|[\s\S]*?\|(.*?)\|\s*:---:\s*\|\s*:---:\s*\|`/);
    if (colorPrimitiveMatch) {
      const lines = colorPrimitiveMatch[0].split('\n').slice(3);
      lines.forEach(line => {
        const match = line.match(/\|\s*(\S+)\s*\|\s*(\S+)\s*\|\s*(\S+)\s*\|/);
        if (match) {
          tokens.colors[match[1]] = match[2];
        }
      });
    }

    // Extraer colores semánticos
    const semanticMatch = content.match(/### 2\. Semántica[\s\S]*?\| Intención \| Token \| Referencia \| Uso \|[\s\S]*?\|(.*?)\|\s*:---:\s*\|\s*:---:\s*\|\s*:---:\s*\|`/);
    if (semanticMatch) {
      const lines = semanticMatch[0].split('\n').slice(3);
      lines.forEach(line => {
        const match = line.match(/\|\s*(\S+)\s*\|\s*(\S+)\s*\|\s*(\S+)\s*\|\s*(\S+)\s*\|/);
        if (match) {
          tokens.semantic[match[2]] = match[3];
        }
      });
    }

    // Extraer espaciado
    const spacingMatch = content.match(/### 1\. Espaciado[\s\S]*?\| Token \| Valor \| Uso \|[\s\S]*?\|(.*?)\|\s*:---:\s*\|\s*:---:\s*\|`/);
    if (spacingMatch) {
      const lines = spacingMatch[0].split('\n').slice(3);
      lines.forEach(line => {
        const match = line.match(/\|\s*(\S+)\s*\|\s*(\S+)\s*\|\s*(\S+)\s*\|/);
        if (match) {
          tokens.spacing[match[1]] = match[2];
        }
      });
    }

    // Extraer radios
    const radiusMatch = content.match(/### 2\. Bordes[\s\S]*?\| Token \| Valor \| Uso \|[sS]*?\|(.*?)\|\s*:---:\s*\|\s*:---:\s*\|`/);
    if (radiusMatch) {
      const lines = radiusMatch[0].split('\n').slice(3).slice(0, -1);
      lines.forEach(line => {
        const match = line.match(/\|\s*(\S+)\s*\|\s*(\S+)\s*\|\s*(\S+)\s*\|/);
        if (match) {
          tokens.radius[match[1]] = match[2];
        }
      });
    }

    return tokens;
  }

  // Métodos para obtener tokens específicos
  getSemanticToken(name) {
    return this.tokens.semantic[name] || null;
  }

  getColorToken(name) {
    return this.tokens.colors[name] || null;
  }

  getSpacingToken(name) {
    return this.tokens.spacing[name] || null;
  }

  getRadiusToken(name) {
    return this.tokens.radius[name] || null;
  }
}

module.exports = { LocalMdAdapter };
