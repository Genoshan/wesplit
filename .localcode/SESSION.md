# Current Session Status

- **Actualizado**: 2026-11-20
- **Rama**: `feature/dynamic-groups` (33 commits locales + cambios sin commitear). PR final a `main` pendiente de autorización.
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
- Settle up: `POST /api/groups/:id/payments` existe, sin UI y el balance no descuenta pagos.
- Backoffice de `global_role`; cotización diaria vía API.

## Verificación

- `node --check` limpio en `app.js`, `index.js`, `auth.js`, `database.js`, `groups.js`.
- `git diff --check` sin errores de whitespace (solo avisos LF→CRLF conocidos).
- Smoke API con cuentas ficticias: invitación pendiente → aceptación → gasto → edición → baja → balance con inactivo → reactivación → borrado de cuentas. Todo OK.
- UI en navegador: crear grupo, invitar, aceptar desde otra sesión, reparto N con suma validada, desglose y edición. Sin errores de consola. Cuentas de prueba eliminadas.

## Próximos pasos

1. Revisar el diff completo vs `origin/main` (G2–G6, allowlist, borrado de legacy, lote S y lote M).
2. Pedir autorización explícita para `git add` / `commit` / `push` / PR.

## Restricciones vigentes

- Sin `git add`/`commit`/`push`/PR sin autorización explícita.
- Sin leer ni reproducir valores de `server/.env`.
- Los dos hallazgos ALTO de secretos en archivos de log se dejan intactos salvo autorización.
- Sin cambios de dependencias, versiones o upgrade de OpenCode sin autorización.
