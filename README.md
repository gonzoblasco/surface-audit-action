# Surface Audit Action

Portero de superficie para pull requests. Audita el código de UI contra los
tokens del Design System y el veto de **AI Look**, y publica un veredicto único
como comentario en el PR.

Nació como el auditor de superficie del ecosistema Kanam. Se publica porque el
mismo problema existe en cualquier repo: nadie se acuerda de revisar que un
color esté tokenizado hasta que ya está en producción.

## Qué detecta

| Regla | Severidad | Ejemplo |
|---|---|---|
| Gradiente decorativo | 🔴 bloquea | `linear-gradient(...)` en una superficie |
| Morado genérico | 🔴 bloquea | `#8B5CF6`, `#A78BFA`, cualquier hue 240-300° |
| Radio exagerado | 🔴 bloquea | `border-radius: 24px` (máximo 8px) |
| Hex hardcodeado | ⚠️ advierte | `color: #f5a524` en vez de un token |
| Padding inflado | ⚠️ advierte | `padding: 40px` |
| Stage sin archivos | 🔴 bloquea | el path no existe o está gitignored: **no aprueba** |

El último es el más importante: un audit que no escaneó nada **no es un
aprobado**, es un audit que no corrió.

## Uso

```yaml
name: Surface Audit
on: [pull_request]

permissions:
  contents: read
  pull-requests: write

jobs:
  surface:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: gonzoblasco/surface-audit-action@v1
        with:
          tokens: design/tokens.md   # opcional
```

Eso es todo. Si el repo no declara config, el action **autodetecta** el
directorio fuente (`src`, `app`, `components`, `styles` o `.`).

## Inputs

| Input | Default | Qué hace |
|---|---|---|
| `config` | `.surface-audit/pipeline.config.yaml` | Config declarada. Si existe, gana sobre todo lo demás |
| `path` | autodetectado | Directorio a auditar, solo si no hay config |
| `tokens` | vacío | Ruta a un `tokens.md` para sugerir el token exacto |
| `fail-on` | `blocking` | `blocking` \| `warning` \| `never` |
| `comment` | `true` | Comentar el veredicto en el PR |
| `artifact` | `true` | Subir reporte HTML + JSON |

## Outputs

`verdict`, `exit-code`, `blocking`, `warnings`, `report-html`.

## Salida

```
0 = APROBADO o ADVERTENCIA     (con fail-on: blocking)
1 = RECHAZADO o error de stage
```

Con `fail-on: warning`, una ADVERTENCIA también falla el check.

## Config declarada

Cuando querés control explícito, agregá `.surface-audit/pipeline.config.yaml`
al repo:

```yaml
project:
  name: "mi-producto"

stages:
  - skill: design-system-enforcer
    path: "src"
    config: ".surface-audit/enforcer.config.yaml"

gate:
  block_on: ["critical", "stage-error"]
  warn_on: ["warning", "ai-look", "hardcoded-value"]
on_stage_error: block
```

Y el enforcer config:

```yaml
project:
  name: "mi-producto"
  design_system_path: "design"   # carpeta con tokens.md

rules:
  enforceTokens: true
  blockHardcoded: true
  aiLookVeto: true

whitelist:
  hex: []          # hex legítimos que no deben advertirse

exclude:
  - "**/*.test.tsx"
  - "src/generated/**"
```

`exclude` no es opcional en la práctica: si auditas el propio motor, va a
encontrar sus propias reglas escritas como string.

## Por qué un solo veredicto

Tres reportes separados (tokens, a11y, pixel) producen tres opiniones y ninguna
decisión. Este action emite **un** veredicto, con evidencia archivo:línea.

## Límites conocidos

- **No audita accesibilidad runtime.** Eso necesita la app levantada y un
  browser; un runner de PR no siempre lo tiene. El action corre solo la lane
  estática a propósito, en vez de simular la otra.
- **No compara contra capturas.** Sin baseline versionado, un pixel-diff mide
  una opinión, no una regresión.
- **Detector por regex, no AST.** Detecta hex y patrones de CSS con precisión
  suficiente para bloquear lo obvio; no entiende CSS-in-JS ni valores
  computados.
- **El path es relativo a la raíz del repo.**

## Desarrollo

```bash
npm ci --prefix surface-audit/surface-pipeline
npm ci --prefix surface-audit/design-system-enforcer

# correr contra un directorio
node surface-audit/surface-pipeline/bin/audit-surface --config <cfg> --only design-system-enforcer
```

## Licencia

MIT.
