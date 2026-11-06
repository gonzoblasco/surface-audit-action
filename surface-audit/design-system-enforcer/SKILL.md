---
name: "design-system-enforcer"
description: "Guardián preventivo del Design System. Intercepta código de componentes antes de mergear y valida contra tokens declarados. Detecta valores hardcodeados, veto 'AI Look' (gradientes decorativos, morado genérico, radios exagerados, padding inflado), y sugiere el token exacto para corrección. Multi-tenant: cualquier proyecto puede declarar su propio design system."
metadata:
  category: "Crew"
  tags:
    - crew
    - auditor
    - design-system
    - accessibility
    - enforcement
    - ci-cd
---

# design-system-enforcer

Ritual preventivo del UI/UX Auditor. No espera a que el código esté mergeado para corregir - 
intercepta, valida y sugiere **antes** del commit. Es la versión automatizada y proactiva del 
`surface-alignment-audit`.

La diferencia: el Auditor revisa el resultado; el Enforcer **previene el error**.

## Cuándo usarla

- Pre-commit hook: validar antes de que el código entre al repositorio.
- CI pipeline: garantía de calidad en PRs.
- Revisión de código: segundo par de ojos automático contra tokens.
- Multi-proyecto: cualquier design system, no solo Kanam.

## Protocolo de enforcement

### 1. Declaración del sistema

Cada proyecto declara su design system en `.kanam/enforcer.config.yaml`:

```yaml
project:
  name: "mi-proyecto"
  design_system_path: "/ruta/a/tokens.md"  # o npm package, o URL remota

rules:
  enforce_tokens: true
  block_hardcoded: true
  ai_look_veto: true
  
  # Whitelist específica del cliente (excepciones documentadas)
  allowed_hex_whitelist: ["#FF0000"]
```

### 2. Extracción de valores

El parser recorre archivos y extrae:

| Tipo de archivo | Qué extrae |
|-----------------|------------|
| `.jsx`, `.tsx` | style props, styled-components, CSS objects |
| `.css`, `.scss` | Propiedades color, spacing, radius, shadow |
| `.styled.*` | Template literals |
| `tailwind.config` | Extensión de tokens |

### 3. Reglas de enforcement

**⚠️ Warning - valor hardcodeado, sugerir token:**

| Detectado | Sugerencia | Ejemplo |
|-----------|------------|---------|
| `#3B82F6` (azul) | `var(--k-interactive-primary)` o equivalente | Buscar el token semántico más cercano por luminancia |
| `#F3F4F6` (gris claro) | `var(--k-bg-main)` o equivalente | Mapeo por contexto de uso |
| `16px` | `var(--k-space-4)` | Match exacto de medida |

**❌ Veto - "AI Look", bloqueo inmediato:**

| Detectado | Razón | Corrección |
|-----------|-------|------------|
| `linear-gradient(...)` | Gradiente decorativo prohibido | Usar token de superficie sólida |
| Color en rango `#8B5CF6`-`#A855F7` | Morado genérico prohibido | Token de brand aprobado |
| `border-radius: 999px` o `> 8px` | Pill-shape exagerado | Máximo `radius-lg` (8px) |
| `padding: 24px` en componentes base | Padding inflado | `space-4` (16px) estándar |
| `box-shadow: 0 8px 30px rgba(...)` | Sombra difusa prohibida | Borde + superficie para separación |

### 4. Veredicto de enforcement

```
✓ ENFORCED: Todo el código usa tokens, sin violaciones.
  El código es coherente con el design system declarado.

⚠️ WARNING: X valores hardcodeados detectados.
  Cada uno tiene sugerencia de token. Mergear pendiente de corrección.

❌ BLOCKED: Y violaciones de principios ("AI Look").
  Mergear bloqueado hasta eliminar gradientes, morados, radios exagerados.
```

## Salida de ejemplo

```bash
$ npx design-enforcer --config .kanam/enforcer.config.yaml

🔍 Analizando 47 archivos...

✓ PASS  src/components/Button.tsx
  - 12 tokens usados correctamente

⚠️ WARN  src/components/Card.tsx
  - Línea 23: `#F3F4F6` hardcodeado → sugerir `var(--k-bg-surface)`
  - Línea 45: `18px` hardcodeado → sugerir `var(--k-space-4)`

❌ BLOCK  src/components/Hero.tsx
  - Línea 12: Gradiente decorativo `linear-gradient(135deg, #667eea 0%, #764ba2 100%)`
    → VETO: Prohibido por principles.md. Usar `var(--k-bg-main)` + borde sutil.
  - Línea 34: Morado genérico `#8B5CF6`
    → VETO: Prohibido. Usar `var(--k-brand-primary)` si es brand, o eliminar.

Resumen: 43 pass, 3 warnings, 1 blocked. 2 sugerencias de token.
```

## Integración con herramientas existentes

| Herramienta | Relación |
|-------------|----------|
| `surface-alignment-audit` | Enforcer previene; Audit valida post-merge. Complementarios. |
| `a11y-at-validation` | Enforcer valida tokens; a11y-at valida anuncios de lector de pantalla. |
| `scripts/check-design-tokens.py` | Enforcer para código nuevo; check-design-tokens para tokens existentes. |
| `scripts/a11y-scan.mjs` | axe-core para páginas vivas; Enforcer para código estático. |

## Estructura de archivos

```
design-system-enforcer/
├── SKILL.md                 # Este archivo
├── src/
│   ├── parser.js            # AST walker para JSX/CSS/SCSS
│   ├── matcher.js           # Cruce valores ↔ tokens
│   ├── config-loader.js     # Carga .kanam/enforcer.config.yaml
│   ├── adapters/
│   │   ├── local-md.js      # Kanam: /design/tokens.md
│   │   ├── npm-pkg.js       # Paquete npm de cliente
│   │   └── remote-api.js    # Tokens-hosted service
│   └── rules/
│       ├── color.js         # Detección y veto de colores
│       ├── layout.js        # Spacing, radius, sizing
│       └── anti-slop.js     # Filtro "AI Look"
├── tests/
│   ├── fixtures/
│   └── parser.test.js
├── examples/
│   ├── pass/                # Componentes que pasan
│   └── fail/                # Componentes vetados (con correcciones)
└── bin/
    └── design-enforcer.js   # CLI wrapper
```

## Red Lines

- **No hardcodear valores de Kanam.** El skill es agnóstico al sistema; solo la configuración lo vincula.
- **No bloquear por opiniones.** Solo bloquea lo que los principios vetan explícitamente.
- **No sugerir sin token.** Cada corrección debe referenciar un token existente o explicar por qué no hay.
- **No aflojar umbrales.** Si un proyecto quiere permitir radios pill, debe explicitarlo en config.

## Deslinde con el Auditor

- **El Enforcer:** código estático, pre-commit, tokens específicos, sugerencias automáticas.
- **El Auditor:** resultado visual, post-merge, contexto de producto, juicio humano.
- En conflicto, el Enforcer cita el token; el Auditor cita la experiencia de usuario.

---

_La mejor corrección es la que nunca se necesita hacer._
