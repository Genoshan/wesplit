# Bitácora del Proyecto

Este archivo contiene el registro cronológico de cambios y decisiones relevantes para mantener continuidad entre sesiones.

## Formato

Cada entrada debe seguir este formato:

```markdown
## [YYYY-MM-DD] Título de la sesión

### Contexto
- Qué se estaba haciendo
- Estado anterior

### Cambios realizados
- Archivos modificados
- Funcionalidades implementadas

### Decisiones tomadas
- Qué se decidió y por qué
- Alternativas descartadas

### Estado final
- Qué quedó funcionando
- Qué falta pendiente

### Notas para próxima sesión
- Puntos a retomar
- Contexto para continuar
```

---

## [2026-07-25] Sistema de memoria unificado

### Contexto
- El proyecto tenía dos sistemas de memoria paralelos: `.localcode/` y `memory/`
- Existía duplicación entre archivos (project-rules.md y tech-stack.md repetían AGENTS.md)
- No había un flujo claro de cómo el agente debe mantener la bitácora

### Cambios realizados
- **Creado** `AGENTS.md` en raíz con reglas del proyecto (OpenCode nativo)
- **Actualizado** `CLAUDE.md` para importar `@AGENTS.md` con extras para Claude Code
- **Reescrito** `memory/MEMORY.md` como índice limpio
- **Eliminados** `memory/project-rules.md` y `memory/tech-stack.md` (duplicaban AGENTS.md)
- **Creado** `memory/BITACORA.md` con plantilla para registro de sesiones
- **Creado** PR #6 y mergeado a main

### Decisiones tomadas
- **Modelo de memoria**: Seguir el enfoque nativo de OpenCode (`AGENTS.md`) + Claude Code (`CLAUDE.md` con `@AGENTS.md`)
- **Eliminar duplicación**: Unificar reglas del proyecto en un solo archivo (`AGENTS.md`)
- **Bitácora con checkpoint**: El agente debe actualizar `memory/BITACORA.md` incrementalmente después de cada acción relevante (patrón WAL/checkpoint)

### Estado final
- Sistema de memoria unificado funcionando
- PR #6 mergeado: https://github.com/Genoshan/wesplit/pull/6
- Estructura limpia y sin duplicaciones

### Notas para próxima sesión
- Probar que el sistema de memoria funciona (que el agente lea AGENTS.md y memory/)
- El servidor estaba corriendo en puerto 3000 (PID 20376) - verificar si sigue activo

---

## [2026-07-25] Sistema de checkpoint automático (WAL)

### Contexto
- Habíamos implementado el sistema de memoria unificado
- El usuario preguntó cómo saber cuándo es el "final" de una sesión
- Problema: si la sesión se corta (red, etc), se pierde el contexto

### Cambios realizados
- **Actualizado** `CLAUDE.md` con patrón de checkpoint incremental
- **Actualizado** `AGENTS.md` con reglas de checkpoint
- **Patrón implementado**: WAL (Write-Ahead Logging) / Checkpointing

### Decisiones tomadas
- **Checkpoint incremental**: Actualizar BITACORA.md después de cada acción relevante, no esperar al final
- **No esperar señal del usuario**: el agente decide cuándo es "relevante"
- **Patrón de database**: como WAL en SQLite, escribir antes de que algo falle

### Estado final
- Sistema de checkpoint configurado
- Próxima sesiónarranca con contexto automático

### Notas para próxima sesión
- Probar que el checkpoint funciona después de cada acción
- Verificar que el agente lee BITACORA.md al inicio

---

## [2026-07-25] Integración de temas Bootstrap + corrección SweetAlert2

### Contexto
- El selector de temas (GitHub/Dracula/Nord) se perdió al integrar Bootstrap
- SweetAlert2 dejó de funcionar tras refactorizaciones previas
- El usuario quería integrar temas usando `data-bs-theme` de Bootstrap

### Cambios realizados
- **index.html**: Agregado `<select>` de temas en el header
- **style.css**: 
  - Reemplazado `data-theme` → `data-bs-theme`
  - Mapeado de colores custom a variables Bootstrap (`--bs-body-bg`, `--bs-body-color`, etc.)
  - Fixes para tablas, formularios, cards y SweetAlert2 en temas oscuros
- **app.js**:
  - Cambiado `changeTheme()` para usar `data-bs-theme`
  - Restaurado `Swal.fire('¡Éxito!')` al agregar gasto
  - Agregado `Swal.fire('Error')` en `fetchHistory`
  - Eliminado función muerta `showFormFeedback()`

### Decisiones tomadas
- **Bootstrap native**: Usar `data-bs-theme` en vez de `data-theme` custom para mejor integración
- **Variables dual**: Mantener variables custom (`--text-primary`, `--card-bg`) + variables Bootstrap (`--bs-body-bg`)
- **SweetAlert2 consistente**: Todas las acciones de usuario usan popups, no texto inline

### Estado final
- Rama `feature/bootstrap-themes` pusheada
- PR pendiente: https://github.com/Genoshan/wesplit/pull/new/feature/bootstrap-themes
- 3 temas funcionando: GitHub Light, Dracula, Nord

### Notas para próxima sesión
- Crear PR y mergear a main
- Considerar limpiar HTML/CSS del `#form-feedback` (ya no se usa)

---

## [2026-07-29] Verificación de estado del repositorio

### Contexto
- Inicio de nueva sesión
- SESSION.md y BITACORA.md estaban desactualizados (última entrada PR #7)
- Necesidad de verificar estado real del repositorio

### Cambios realizados
- **Verificado** todos los PRs (#1-#10) vía `gh pr list`
- **Confirmado** que todos están mergeados
- **Actualizado** `.localcode/SESSION.md` con estado real
- Último PR mergiado: #10 (Turso migration) — 2026-07-27

### Decisiones tomadas
- Usar `gh pr list` como fuente de verdad en vez de confiar en archivos locales desactualizados
- Nunca asumir estado del proyecto sin verificar en remoto

### Estado final
- Main sincronizado con origin/main
- Todos los PRs #1-#10 mergeados
- Documentación local actualizada

### Notas para próxima sesión
- Considerar actualizar ROADMAP.md con features de Turso
- Server requiere env vars: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, AUTH_TIN, AUTH_NOE

---

## [2026-07-30] Fix: Login funciona pero dashboard no aparece

### Contexto
- El POST /api/login devuelve 200 con `{message: 'Login exitoso', user: 'tin'}`
- El dashboard UI no se renderiza después del login
- El usuario reporta "nada de nada" en la consola inicialmente

### Cambios realizados
- **index.html (línea 246)**: Agregado `<script src="bootstrap.bundle.min.js">` CDN
  - El HTML cargaba Bootstrap CSS pero NO el JS
  - `initApp()` en app.js:610 creaba `new bootstrap.Modal(editModal)` → ReferenceError
- **index.html (línea 246)**: Removido atributo `integrity` del script de Bootstrap
  - El hash SHA-384 no coincidía con el CDN → "Failed to find a valid digest" → recurso bloqueado
- **app.js (líneas 403-433)**: Removidos logs de debug de `checkAuth()` y `loginUser()`

### Decisiones tomadas
- **Debug incremental**: Agregar logs progresivamente hasta encontrar la línea exacta del error
  - `[CHECKAUTH] Calling GET` → status 401/200 → data → `bootstrap is not defined`
- **SRI integrity**: Removido hash para evitar bloqueos en entornos locales
- **Limpieza**: Removidos todos los logs temporales de debug

### Estado final
- Dashboard se muestra correctamente tras login
- `bootstrap.Modal` disponible para `#editModal`
- SweetAlert2 funcionando

### Notas para próxima sesión
- Server corriendo en puerto 4000 (PID 22180)
- Considerar agregar el hash SRI correcto de bootstrap.bundle.min.js
- Crear PR #11 para mergear `feature/expense-crud` a main

---

## [2026-07-30] Commit y push de fix login + edit/delete expenses

### Contexto
- Sesión anterior resolvió problema de login y agregó features de edición/eliminación
- Necesidad de guardar el estado antes de continuar

### Cambios realizados
- **Git commit** `70f22e1` en `feature/expense-crud`:
  - Fix: Dashboard now renders after login (Bootstrap JS bundle added)
  - Feature: Edit/delete expenses via PUT/DELETE endpoints
  - Feature: Edit modal with form
  - Clean up debug logs
- **Git push** a `origin/feature/expense-crud`
- **Actualizado** `.localcode/SESSION.md` con estado actualizado
- **Actualizada** `memory/BITACORA.md` con checkpoint

### Estado final
- Todos los cambios commiteados y pusheados
- Rama lista para PR: `feature/expense-crud`
- Main en `198b751` (Turso migration + security hardening)
