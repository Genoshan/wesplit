# Current Session Status

- **Actualizado**: 2026-11-21
- **Rama**: `chore/final-cleanup` desde `main` (`95bd535`). PR #27 mergeado; OAuth funcionando en prod. Limpieza final de logs y documentación.
- **Servidor**: `http://localhost:4000` (`node index.js` desde `./server/`).

## Estado actual

### Implementado
- Grupos dinámicos con N miembros: alta, borrado, invitación y miembros con estados.
- Autenticación: registro con username/email/password (mínimo 12, `bcryptjs` + rehash legacy) y Google OAuth (allowlist desactivada → cualquier email verificado).
- Roles: `global_role` informativo sin backoffice; `role` por grupo (admin/member) independiente.
- Frontend: pestañas Gastos / Balances / Estadísticas / Miembros; temas claro/oscuro; SRI + CSP; sin handlers inline.
- Pagadores y splits desde miembros reales; `evenSplits()` reparte centavos exactos entre N.
- Seguridad: rate limits, IDOR fixes, seed one-shot, `TRUST_PROXY`/`ALLOWED_ORIGINS`.

### Lote S (completo)
1. Recurrentes eliminados (rutas, tabla, migración y CSS).
2. Moneda única por grupo: tabla `currencies`, seed de tasas y endpoints eliminados; alta de gasto usa `base_currency`.
3. Borrado de gasto con limpieza explícita de `group_splits` + 404 si no existe.
4. Guard de último admin activo.
5. Invitación normalizada (mayúsculas/espacios) y `GET /api/users/search?q=` con `<datalist>`.
6. Grupo personal "Mis gastos" en registro manual y Google; migración `rename-personal-casa-v1`; default por `created_at ASC`.
7. UX/CSS: `--border-color`, `#category-chart`, `min="0.01"`, filtros rotulados, roles en español, sin fallback 50/50, doble request de balance eliminado, `aria-live`.

### Lote M (completo)
1. `group_members.status` (`active`/`pending`/`inactive`) con migración automática.
2. Invitaciones: `GET /api/groups/invitations`, `POST /:id/accept`, `DELETE /:id`; panel en la pestaña Miembros con badge en el header.
3. Baja lógica de miembros + reactivación (`POST /:id/members/:userId/reactivate`); inactivos siguen en balances por su historial.
4. `PUT /api/groups/:id/expenses/:expenseId` con recálculo de splits y moneda forzada del grupo.
5. Modal de edición de gasto en el frontend.
6. Reparto personalizado para N miembros con validación visual de suma en centavos.
7. Desglose de splits por gasto en el historial (`<details>`).
8. Limpieza de membresías huérfanas al borrar una cuenta (evita FK rota entre cuentas de un mismo grupo).

### Eliminado
- Endpoints legacy `/api/expenses`, `/api/expense/:id` (GET/POST/PUT/DELETE) y `resolveLegacyPayer`.
- Recurrentes y tasas de cambio.

### Pendiente diferido
- ~~Settle up: sin UI~~ → integrado: pagos group-scoped (GET/POST/DELETE), balance descontado, historial y CSV.
- Backoffice de `global_role`; cotización diaria vía API.

## Verificación

- `node --check` limpio en `app.js`, `index.js`, `auth.js`, `database.js`, `groups.js`.
- `git diff --check` sin errores de whitespace (solo avisos LF→CRLF conocidos).
- Smoke API con cuentas ficticias: invitación pendiente → aceptación → gasto → edición → baja → balance con inactivo → reactivación → borrado de cuentas. Todo OK.
- UI en navegador: crear grupo, invitar, aceptar desde otra sesión, reparto N con suma validada, desglose y edición. Sin errores de consola. Cuentas de prueba eliminadas.
- Merge de `origin/main`: pagos, CSV y filtro por fechas portados al modelo group-scoped. `npx jest tests/payment.int.test.js`: 9/9. Smoke UI con cuentas ficticias (alta, listado, baja, balances y sin errores de consola). Cuentas limpiadas.
- Fix de tema (#20): toggle con etiqueta explícita y CSS muerto eliminado; verificado claro ↔ oscuro en navegador.
- Botón de tema como ícono (🌙/☀️), fuera del dropdown de usuario y al lado de `+ Grupo`; verificado en navegador.
- Rediseño del tema claro con paleta Bootstrap 5 estándar: fondo blanco `#ffffff`, primario azul `#0d6efd`, éxito verde `#198754`, peligro rojo `#dc3545`, grises `--bs-*`; `html` hereda el fondo; botón de pago conserva verde Bootstrap. Tema oscuro intacto (verificado estilos computados).
- Tema claro refinado estilo **Dashboard SaaS** (referencia Dribbble de Apoorv Arora): cards con radio 14px y sombras suaves, balance 16px, inputs/botones 10px, tab activa con fondo `#f8f9fa`, tipografía de montos más marcada. Todo acotado a `[data-bs-theme="splitwise"]`; oscuro sin cambios.
- `index.html` incluye `<meta name="darkreader-lock">` y el CSS usa `color-scheme: only light/dark` para que Dark Reader / auto-dark no pisen el tema.
- Variables `-bs-*` del bloque oscuro completadas: encabezados de tabla legibles (fix de "Liquidaciones").
- QA: `docs/QA_TESTING_PROMPT.md` (prompt reutilizable) y `docs/QA_REVIEW_2026-11-21.md` (resultados). Jest 9/9 y E2E manual OK.
- Correcciones de QA (completas): persistencia de grupo (`seg_group`), validación estricta de fecha en gastos, escape de fórmulas en CSV, comodines LIKE escapados, moneda única en pagos, estado sin grupos, aclaración de pagador inactivo y docs actualizados.
- Tests: 18/18 (`payment.int.test.js` + `expense.int.test.js`). QA review en `docs/QA_REVIEW_2026-11-21.md`.
- Versión 1.0.0: `package.json`, meta `app-version` en `index.html`, `console.info` en `app.js` y `/api/version` con commit/branch reales de Render (`startedAt` estable; antes `buildTime` era la hora de cada request). Verificar en prod con `/api/version` o DevTools → Console.
- PR #21 mergeado por el usuario (15:29Z) y PR #22 mergeado (15:50Z, squash → `6984902`). Producción deployada con v1.0.0: `/api/version` = `version 1.0.0`, `commit 6984902`, `branch main`.
- Paleta 3 del diseño (Verde Splitwise / navy) aplicada solo al tema claro: `#fefefe`, `#24303a`, `#27c95c`, `#1e5e4e`, `#268874`. Bootstrap 5.3 fija los colores de `.btn` en `--bs-btn-*`, por eso se agregaron overrides acotados a `[data-bs-theme="splitwise"]`. Verificado: claro usa la paleta nueva; oscuro idéntico a la línea base (botón primario sigue `rgb(13,110,253)`). Sin cambios de layout.

- PR #23 mergeado (16:09:34Z) como `681bc88`. Auto-deploy no disparado → el usuario hizo **Manual Deploy**, que terminó a las 16:20:57Z compilando `1bf5c9b` (ya con PR #24 incluido).
- `npm audit --omit=dev` en `server/` daba 4 vulnerabilities (2 moderate, 1 high, 1 critical): `proxy-addr` 2.0.7 (critical, vía express; relevante porque `TRUST_PROXY` está activo), `body-parser` 2.3.0 (high), `qs` 6.15.3 y `ip-address` 10.3.1 (moderate). Con autorización del usuario se aplicó `npm audit fix` en `server/`: **0 vulnerabilidades en producción**; quedan 18 moderadas solo de Jest (dev, no desplegadas). `package.json` intacto, solo `server/package-lock.json`. Tests 18/18.

## Verificación final en producción (16:21Z)

- `/api/version`: `version 1.0.0`, `commit 1bf5c9b`, `branch main`, `startedAt 16:20:55Z`.
- `/style.css`: contiene `#27c95c` y `--bs-btn-bg` → paleta 3 desplegada.
- Log de build de Render: `found 0 vulnerabilities` → fix de dependencias desplegado.

## Favicon (2026-11-21)

- El usuario generó el arte con Gemini/Nano Banana (1024×1024, paleta respetada, símbolo 567×567 centrado en 228,228).
- Se convirtió a `favicon.ico` multi-tamaño (16/32/48/64, PNG con alpha), fondo transparente y recorte con 8% de padding. El server ya permite `/favicon.ico`, así que no se tocó el backend.
- `<link rel="icon" type="image/x-icon" href="/favicon.ico">` agregado al `<head>` de `index.html`. Commit `a319674`, PR #25 abierto, pusheado.
- Verificado en local: ICO 4 entradas válidas, `GET /favicon.ico` → 200 `image/vnd.microsoft.icon`, HTML con el link.
- Docs `docs/E2E_DOS_USUARIOS.md` (12 casos para 2 personas) y correcciones a `docs/QA_TESTING_PROMPT.md` siguen **sin commitear** a propósito.

## OAuth en prod (2026-11-21, 17:00–17:15Z)

- Render: se agregó `GOOGLE_REDIRECT_URI=https://wesplit-k5rc.onrender.com/api/google/callback` → `/api/google/init` pasó de 500 a 200. El usuario agregó la misma URI en Google Console.
- Render: se agregó `TRUST_PROXY=1` por el warning `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` de express-rate-limit (latente desde el primer deploy; lo disparó una request de verificación). Tras el deploy las requests no vuelven a loguear el warning.
- Bloqueo persistente: `{"error":"El email de Google no está verificado"}` 401. PR #26 (`70105f3`) aceptaba el string `"true"` de `tokeninfo` pero **no alcanzó**: el fix estaba desplegado (`96b9f4c`) y el error seguía.
- PR #27 (`b8b00f2`): verificación contra `userinfo` (OIDC, booleano) además de `tokeninfo`, aceptando `email_verified`/`verified_email` en ambas formas. Agrega logs `[GOOGLE DEBUG]` **temporales** solo de nombres de campos y tipos (sin valores/tokens/emails). Tests 18/18.
- **Resuelto**: con el PR #27 desplegado, el flujo funcionó con el correo del usuario. Aclaró que **siempre usó el mismo email**, así que se descarta que la cuenta tuviera el email sin verificar: la diferencia fue pasar la verificación a `userinfo` (OIDC), que sí expone el flag booleano, mientras `tokeninfo` no lo hacía de forma utilizable para esa cuenta. El login matcheó por email con el usuario ya existente y recuperó sus datos anteriores (no se creó uno nuevo). Quedan los logs temporales `[GOOGLE DEBUG]` pendientes de limpieza.

## Limpieza final (2026-11-21)

- Usuario aprobó un único PR con: eliminación de los logs temporales `[GOOGLE DEBUG]` de `server/auth.js`, actualización de `README.md`, `ROADMAP.md`, `AGENTS.md`, `TODO_BACKLOG.md` y `plans/sdd-google-oauth.md`, y commit de `docs/E2E_DOS_USUARIOS.md` + correcciones de `docs/QA_TESTING_PROMPT.md`.
- El código de verificación robusta (`googleVerifiedFlag`, `userinfo`) se conserva intacto; solo se sacan los logs.

## Próximos pasos

1. Mergear el PR de limpieza y **Manual Deploy** en Render.
2. Verificar que `/api/version` reporte el commit nuevo y que no aparezcan líneas `[GOOGLE DEBUG]` en los logs tras un login con Google.
3. Roadmap: Fase 1 y 2 completas. Diferidos: backoffice, gráfico temporal, 2FA/notificaciones e indicador de carga. Nada bloqueante.

## Restricciones vigentes

- `git add`/`commit`/`push` y creación de PR autorizados por el usuario; el usuario mergea los PR en la web.
- Sin leer ni reproducir valores de `server/.env`.
- Los dos hallazgos ALTO de secretos en archivos de log se dejan intactos salvo autorización.
- Sin cambios de dependencias, versiones o upgrade de OpenCode sin autorización (excepto el fix auditado autorizado para este PR).
