---
name: "surface-pipeline"
description: "Orquestador de la auditoría de superficie. Corre design-system-enforcer, accessibility-oracle y pixel-diff en secuencia, normaliza sus hallazgos, aplica un gate de veredicto y emite un único resultado (APROBADO/ADVERTENCIA/RECHAZADO) con reporte HTML/JSON/console y evidencia visual agregada. Úsalo cuando haya que auditar toda la superficie de un producto antes de mergear, o cuando se pida 'un comando, un veredicto'."
metadata:
  category: "Crew"
  tags:
    - crew
    - auditor
    - pipeline
    - orchestration
    - ci-cd
    - design-system
    - accessibility
    - visual-regression
---

# surface-pipeline

El orquestador que convierte tres skills sueltos en **un solo comando, un solo
veredicto**. Es la Fase 2 del roadmap: los skills dejan de correr en aislamiento
y pasan a ser stages de una auditoría de superficie completa.

## Cuándo usarla

- Antes de mergear: auditoría completa de código + accesibilidad + visual.
- CI/CD: un exit code único para el gate de la PR.
- Revisión integral: cuando se quiere el estado de las tres dimensiones de una vez.
- No reemplaza a los skills: los **compone**. Si querés una sola dimensión, corré
  el skill directo (`design-enforcer`, `a11y-oracle`, `pixel-diff`).

## Protocolo de orquestación

### 1. Declaración unificada

Cada proyecto declara sus stages en `.kanam/pipeline.config.yaml`:

```yaml
project:
  name: "kanam-core"

stages:
  - skill: design-system-enforcer
    path: "./src"
  - skill: accessibility-oracle
    base_url: "http://localhost:3000"
    paths: ["/", "/checkout"]
  - skill: pixel-diff
    mode: "comp"
    design: "./design-captures/home.png"
    route: "/"

gate:
  block_on: ["critical", "accessibility-violation", "stage-error"]
  warn_on: ["warning", "misaligned", "ai-look"]

on_stage_error: "block"
output:
  dir: "./reports"
  formats: ["console", "html", "json"]
```

### 2. Ejecución secuencial

| Orden | Stage | Motor real | Salida normalizada |
|-------|-------|-----------|--------------------|
| 1 | `design-system-enforcer` | Regex sobre JSX/TSX/CSS/SCSS | findings `critical`/`warning` con archivo:línea |
| 2 | `accessibility-oracle` | Playwright + axe-core + teclado | findings `critical`/`warning` con ruta y screenshot |
| 3 | `pixel-diff` | Playwright + pixelmatch + ΔE CIEDE2000 | findings `critical`/`warning` con magnitud |

Cada stage corre el **motor real** de su skill. El pipeline no reimplementa
nada: importa `src/` de cada skill hermano y normaliza su salida.

### 3. Gate de veredicto

Un finding matchea el gate por **severidad** (`critical`/`warning`) o por
**código estable** (`accessibility-violation`, `ai-look`, `misaligned`,
`stage-error`, `no-spec`, …). `block_on` gana sobre `warn_on`.

```
✅ APROBADO      → exit 0   (ningún finding bloqueante ni advertencia)
⚠️  ADVERTENCIA  → exit 0   (solo advertencias; con --strict → exit 1)
❌ RECHAZADO     → exit 1   (hay al menos un bloqueo)
```

### 4. Salida

```bash
$ npx audit-surface --config .kanam/pipeline.config.yaml

🔍 SURFACE AUDIT PIPELINE
═══════════════════════════════════════

[1/3] Design System Enforcer    ✓ 47 files, 0 blocks, 3 warnings
[2/3] Accessibility Oracle      ✗ 2 routes, 3 violations, 1 warnings
[3/3] Pixel Diff                ⚠ align 75.0%, 0 critical, 2 misaligned

───────────────────────────────────────
VEREDICTO: ❌ RECHAZADO

Bloqueos (3):
  - [Accessibility Oracle] Focus ring removed or not visible (checkout)
  ...

📄 Reporte HTML: ./reports/audit-2026-10-07T.../report.html
🧾 Reporte JSON: ./reports/audit-2026-10-07T.../report.json
```

Formatos:
- **console** - resumen legible con el veredicto y los hallazgos.
- **json** - modelo estable para integraciones (CI, PR bot).
- **html** - reporte autocontenido con las 3 secciones y evidencia visual en base64.

## API programática

```js
const { SurfacePipeline } = require('surface-pipeline');

const pipeline = new SurfacePipeline({ configPath: '.kanam/pipeline.config.yaml' });
const result = await pipeline.run();

result.verdict;      // 'APROBADO' | 'ADVERTENCIA' | 'RECHAZADO'
result.exitCode;     // 0 | 1
result.blocking;     // findings que bloquean
result.warnings;     // findings que advierten
result.results;      // resultado por stage (crudo + normalizado)
result.artifacts;    // rutas de report.html / report.json / latest.html
```

## Red Lines

- **No fabricar veredictos.** Si un skill falla, el stage queda `error` con su
  mensaje real. Nunca se sustituye por un resultado verde ni inventado.
- **No aflojar umbrales.** El pipeline no relaja las reglas de los skills: las
  orquesta. WCAG AA sigue siendo AA.
- **No hardcodear el proyecto.** Todo el vínculo con el proyecto vive en la
  config; el pipeline es agnóstico.
- **No reportar sin evidencia.** Cada finding apunta a archivo:línea, ruta o
  screenshot. El HTML agrega la evidencia visual.
- **No tragarse errores.** Un stage roto con `on_stage_error: block` bloquea el
  merge - silencio nunca es verde.

## Deslinde con los skills

| Skill | Su trabajo | Lo que el pipeline añade |
|-------|-----------|--------------------------|
| `design-system-enforcer` | Validar tokens en código | Integración como stage 1 |
| `accessibility-oracle` | Auditar WCAG en runtime | Recorrido multi-ruta como stage 2 |
| `pixel-diff` | Medir alineación visual | Integración como stage 3 |
| `surface-alignment-audit` | Juicio humano post-render | El pipeline es automatizable; el Auditor juzga el resultado |

---

_Un comando. Un veredicto. Cero falsos verdes._
