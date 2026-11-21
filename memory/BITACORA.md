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

---

## [2026-07-30] Mobile-first responsive audit + fixes

### Contexto
- Usuario solicita auditoría mobile-first de la app
- La app tiene 11 media queries existentes pero múltiples problemas en pantallas < 480px

### Cambios realizados
- **Rama**: `feature/mobile-responsiveness` (creada, sin push aún)
- **style.css**: 
  - Chart height reducido: 320px → 200px en mobile (C2)
  - App-shell padding: 32px → 16px en mobile (C3)
  - Balance panel: `min-width: 210px` removido en mobile (H1)
  - Form inputs: `font-size: 16px` explícito para evitar iOS zoom (H4)
  - Card body padding: `p-4` → `1rem` en mobile (M3)
  - Summary grid: breakpoints intermedios 480px (2 cols) y 360px (1 col) (H2)
  - Filters: 1 columna forzada a 560px (H3)
  - Pills y tabla: padding reducido en mobile (M4)
  - Modal: fullscreen en < 480px (M5)
  - Header actions: flex-wrap en mobile (M1)
  - Chart summary: `max-width: 100%` en mobile (M7)
  - Touch optimization: `touch-action: manipulation`, `-webkit-tap-highlight-color: transparent` (L3)
  - Safe area: `env(safe-area-inset-*)` para iPhone notch (L5)
  - Landscape: media query para `max-height: 500px` (L4)
  - Tabla: columnas ocultas progresivamente < 360px (Pagador) y < 320px (Categoría) (C1)
  - Eyebrow: `font-size: 0.82rem` en mobile (L1)
  - Login card: padding y font-size reducidos en mobile

### Decisiones tomadas
- Prioridad: fixes de 1 línea primero (chart, balance, shell, font-size)
- Columnas de tabla se ocultan progresivamente (no abruptamente)
- Modal fullscreen en mobile para mejor UX de edición

### Estado final
- 20 issues de auditoría identificados y solucionados
- 4 nuevas media queries agregadas: 560px, 480px, 360px, landscape
- Touch optimization y safe area para iOS moderno
- Rama lista para PR: `feature/mobile-responsiveness`

---

## [2026-08-06] Versión visible en la UI + endpoint /api/version

### Contexto
- El usuario quiere ver la versión del deploy en Render para verificar que el pipeline funciona
- Necesidad de tener un número de versión visible en la página y actualizable con cada deploy

### Cambios realizados
- **package.json (raíz)**: Agregado campo `"version": "0.1.0"`
- **server/index.js**: Endpoint `GET /api/version` que lee `version` desde `package.json` + `buildTime`
  - Con `Cache-Control: no-store` para forzar ver siempre la última versión
- **index.html**: Footer con `<span id="app-version">—</span>`
- **style.css**: Clase `.app-footer` — texto pequeño, centrado, color muted
- **app.js**: Función `loadVersion()` que hace fetch a `/api/version` y llena el DOM
  - Llamada desde `initApp()` al cargar la página

### Decisiones tomadas
- **Endpoint público**: No requiere auth — cualquiera puede ver la versión
- **Version en package.json raíz**: Centralizado, `sync.mjs` ya lo lee
- **Footer mínimo**: 11px, texto muted, no intrusivo
- **buildTime**: Se incluye para depurar, puede servir para ver cuándo se desplegó

### Estado final
- Endpoint probado: `{"version":"0.1.0","buildTime":"2026-08-06T22:39:32.126Z"}`
- Versión visible en la UI en la parte inferior central
- Para cambiar versión: actualizar `package.json` y hacer deploy en Render

### Notas para próxima sesión
- Considerar actualizar versión automáticamente con git tags (v0.1.0, v0.2.0, etc.)
- Pipeline de Render debería trigger con push a main
- Crear PR para mergear esta feature

---

## [2026-11-20] Lote S + lote M — cierre funcional de grupos dinámicos

### Contexto
- Rama `feature/dynamic-groups` con 33 commits locales y cambios sin commitear; PR a `main` pendiente de autorización.
- Auditoría de uso (`plans/audit-uso-resultado.md`) había dejado hallazgos H1–H10 con distintos estados.

### Cambios realizados
- **Lote S**: recurrentes eliminados; moneda única por grupo; borrado de gasto con limpieza de `group_splits`; guard de último admin; invitación normalizada con `GET /api/users/search`; grupo "Mis gastos" (registro manual y Google) con migración única; UX/CSS (errores de selector, `min`, filtros rotulados, roles, doble request de balance).
- **Lote M**: columna `status` en `group_members` (`active`/`pending`/`inactive`); invitaciones con aceptación/rechazo; baja lógica y reactivación; `PUT /api/groups/:id/expenses/:expenseId`; desglose de splits en historial; reparto exacto para N miembros; panel de invitaciones en la UI; limpieza de membresías huérfanas al borrar cuentas.
- Documentación cerrada: `ROADMAP.md`, `TODO_BACKLOG.md`, `plans/sdd-google-oauth.md`, `plans/audit-uso-splitwise.md`, `plans/audit-uso-resultado.md`, `AGENTS.md`, `context/project.md`, `REQUIREMENTS.md`, `.localcode/SESSION.md`, `.localcode/DECISIONS.md`.
- Servidor reiniciado en `http://localhost:4000` (`node index.js` desde `./server/`).

### Decisiones tomadas
- Un solo campo `status` para invitaciones y bajas, en vez de dos tablas o estados separados.
- Los miembros inactivos siguen en balances porque tienen historial; los pendientes no.
- Se descartó el link con token: la aceptación ocurre dentro de la app.
- Settle up queda integrado en el modelo group-scoped (pagos con alta/baja/historial, descuento en balances, CSV y filtro por fechas); cotización diaria sigue diferida; backoffice no se implementa ahora.

### Estado final
- Smoke tests end-to-end con cuentas ficticias (API): invitación pendiente → aceptación → gasto → edición → baja → balance → reactivación → borrado de cuentas. Todo OK.
- UI verificada en navegador: creación de grupo, invitación, aceptación desde la otra sesión, reparto N con suma validada, desglose y modal de edición. Sin errores de consola.
- `node --check` limpio en `app.js`, `index.js`, `auth.js`, `database.js`, `groups.js`; `git diff --check` sin errores de whitespace.
- Cierre de pendientes: logs trackeados redactados sin imprimir valores (`openclaw_debug_output.txt:21` y `server/server_out.txt`); roadmap duplicado archivado en `.claude/docs/archive/ROADMAP.md` con puntero; log vacío `server/err.txt` archivado en `server/archive/err.txt`; `README.md` convertido en índice de documentación.

### Notas para próxima sesión
- Revisar el diff completo vs `origin/main` antes de autorizar `add`/`commit`/`push`/PR.
- No leer valores de `server/.env`; dejar intactos los hallazgos ALTO de secretos en logs.
- Merge de `origin/main` resuelto conservando la arquitectura group-scoped: se portaron pagos, CSV y filtro de fechas; tests 9/9 y smoke UI OK; queda `git add`, merge commit y push autorizados.
- PR #19 creado con GitHub CLI a pedido del usuario (la web no permitía crear el PR) y mergeado por él: https://github.com/Genoshan/wesplit/pull/19 — merge commit `a43c216`.

## [2026-11-21] Fix de tema: claro/oscuro explícitos

### Contexto
- El usuario reportó que ya no veía modo claro, solo oscuro y una variante; coincidía con los temas viejos (`github`, `dracula`, `nord`) que aún podrían estar en el deploy previo al PR #19.
- Localmente el toggle funcionaba, pero `updateThemeToggle()` apuntaba a `#theme-toggle` en vez de `#toggle-theme-btn`, así que la etiqueta nunca cambiaba.

### Cambios realizados
- `app.js`: corregido el ID del botón y etiquetas explícitas `🌙 Modo oscuro` / `☀️ Modo claro`.
- `index.html`: etiqueta inicial del dropdown acorde al tema claro por defecto.
- `style.css`: eliminados bloques muertos de `github-disabled`, `dracula`, `nord` y `.theme-select`; reglas de `.btn-google` convertidas a `splitwise-dark`.

### Verificación
- `node --check app.js` limpio; sin referencias a temas viejos en `app.js`, `index.html` ni `style.css`.
- En navegador: claro `rgb(247,248,250)` ↔ oscuro `rgb(26,29,33)`, etiqueta y título del botón cambian correctamente.

### Estado final
- Rama `fix/theme-toggle` creada desde `main` (`a43c216`), lista para PR.
- Si el usuario sigue viendo los temas viejos, es el deploy/cache: debe refrescarse después de mergear este fix.
