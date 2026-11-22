# Especificación — Backoffice de WeSplit

> Estado: **Fases 1 y 2 implementadas y testeadas localmente** (rama `feat/admin-phase2`). Fases 3–4 pendientes.
> Decisiones confirmadas por el usuario (2026-11-21): bootstrap por ENV, misma SPA en `/admin`,
> métricas agregadas + administración de usuarios/sesiones/recursos + auditoría.
>
> Nota de implementación: el backoffice vive en una página dedicada `/admin` servida por el mismo
> servidor y con el mismo `style.css`/tema que la app. Así se evita mezclar archivos con el PR de copy.
> El enlace `📊 Backoffice` solo se inyecta en el menú del usuario si `/api/admin/me` confirma el rol.

## 1. Principios

1. **No hay navegador crudo de BD.** El superadmin ve vistas curadas y ejecuta acciones acotadas.
2. **Sin PII innecesaria:** no se muestran password hashes, tokens de sesión ni emails completos.
3. **Toda acción destructiva pide motivo** y queda en auditoría.
4. **Superadmin ≠ admin de grupo.** El admin de grupo sigue mandando solo en su grupo.
5. **Sin telemetría nueva por ahora:** las métricas salen de las tablas existentes.

## 2. Modelo de rol y bootstrap

Se agrega la tabla `superadmins`, **sin tocar el `CHECK` de `users.role`** (eso obligaría a reconstruir la tabla y es riesgoso por las FKs):

```sql
CREATE TABLE IF NOT EXISTS superadmins (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  created_by TEXT NOT NULL DEFAULT 'env-bootstrap'
);
```

- Variable de entorno: `SUPERADMIN_USERNAME` (un solo username por ahora).
- Al arrancar el servidor, si el usuario existe, se hace `INSERT OR IGNORE` en `superadmins`.
- Si todavía no existe, se promueve la próxima vez que se registre o al siguiente reinicio.
- El valor de la ENV **nunca** se imprime ni se muestra en la UI; solo se loguea `"superadmin bootstrap aplicado"`.
- Middleware `requireSuperadmin` → 403 si no está en `superadmins`.

Cambios de esquema adicionales (seguros, `ALTER TABLE ADD COLUMN`):

- `users.status TEXT NOT NULL DEFAULT 'active'` → values en código: `active` / `disabled`.
- `users.auth_provider TEXT NOT NULL DEFAULT 'unknown'` → `manual` / `google` / `unknown` para legados.
- `admin_audit_log (id, actor_id, action, target_type, target_id, reason, created_at)`.

## 3. Superficie

Misma SPA, ruta `/admin`, enlazada solo desde el menú del usuario si es superadmin. Mismo tema claro/oscuro.

Secciones:

| Sección | Contenido |
|---|---|
| Resumen | Métricas agregadas, sin registros individuales |
| Usuarios | Lista/búsqueda, estado, rol, grupos, último acceso; baja/alta y revocar sesiones |
| Recursos | Grupos, gastos, pagos e invitaciones; baja con motivo |
| Auditoría | Historial de acciones del superadmin |

## 4. Métricas (fórmulas sobre tablas actuales)

| Métrica | Definición |
|---|---|
| Altas por día | `COUNT(users) GROUP BY date(created_at)` |
| Usuarios activos | `COUNT(DISTINCT user_id)` en sesiones con `expires_at > ahora`, y activos del día por `sessions.created_at` |
| Google vs manual | `GROUP BY users.auth_provider` |
| Grupos y primer gasto | Grupos creados por día; `% de usuarios con >= 1 gasto en algún grupo` |
| Gastos y pagos | Conteo y suma por día/semana, separando `group_expenses` y `group_payments` |
| Retención D7 / D30 | Usuarios con actividad de sesión en la ventana posterior a su alta |

Todas se devuelven ya agregadas. Ningún endpoint de métricas devuelve filas de usuario.

## 5. Endpoints propuestos (todos bajo `/api/admin/`)

**Lectura**

- `GET /overview` → objeto con todas las métricas.
- `GET /users?search=&status=&limit=` → `id, username, status, role, auth_provider, created_at, last_seen, group_count`.
- `GET /groups`, `/expenses`, `/payments`, `/invitations` → listados curados, paginados.
- `GET /audit` → últimas N acciones.

**Acciones**

- `POST /users/:id/disable` · `POST /users/:id/enable`
- `DELETE /users/:id/sessions` → borra/invalida sesiones del usuario.
- `DELETE /groups/:id` · `DELETE /expenses/:id` · `DELETE /payments/:id` · `DELETE /invitations/:id`
  - Todas requieren body `{ "reason": "..." }` no vacío.
  - Todas escriben en `admin_audit_log`.

**Reglas**

- No se puede desactivar ni borrar al propio superadmin.
- Dar de baja un usuario **no borra sus datos**; solo bloquea el login (se chequea `status` en `/api/login` y en el middleware de sesión).
- Las sesiones ya abiertas se invalidan al desactivar.
- Los borrados de recursos usan las mismas cascadas que ya existen; no se agrega papelera todavía.

## 6. Seguridad

- `requireSuperadmin` en **todos** los endpoints `/api/admin/*`.
- Rate limit específico para el backoffice, más estricto que el global.
- Confirmación modal con campo `motivo` para cada acción destructiva.
- Auditoría inmutable: la UI solo puede leer `admin_audit_log`.
- Opcional en fase posterior: 2FA para entrar a `/admin`.

## 7. Fases y criterios de aceptación

1. **Fase 1 — Rol y métricas**
   - Bootstrap por ENV funcionando; `/admin` invisible para no superadmins.
   - `/api/admin/overview` devuelve las métricas agregadas.
2. **Fase 2 — Usuarios y sesiones**
   - Baja/alta sin pérdida de datos; sesiones revocadas; login bloqueado para `disabled`.
3. **Fase 3 — Recursos y auditoría**
   - Borrados con motivo; cada acción aparece en `/api/admin/audit`.
4. **Fase 4 — Refuerzos**
   - 2FA, exportes y alertas (si se decide).

## Verificación local de la Fase 1 (2026-11-21)

- Servidor en `PORT=4002` apuntando a una BD **local descartable** (`TURSO_DATABASE_URL=file:admin-test.db`), sin tocar la BD remota ni leer secretos.
- `SUPERADMIN_USERNAME=adminqa`: bootstrap al registrar y al reiniciar → `/api/admin/me` devuelve `superadmin:true`.
- Usuario normal: `/me` → `false`, `/overview` → **403**; sin sesión → **401**; `/admin` → 200 (la página es pública, el control está en la API).
- `/api/admin/overview` devolvió métricas reales: 4 usuarios, 3 grupos, 2 gastos, 1 pago; altas, origen (`manual`/`unknown`), actividad diaria, montos por moneda, primer gasto (25%) y retención.
- UI verificada en navegador: tarjetas y tablas, enlace solo para superadmin, usuario normal ve "restringida a superadmins", tema `splitwise-dark` respetado en `/admin`.
- `npm test` con `BASE_URL=http://localhost:4002` → **29/29 tests**, 4 suites (se agregó `tests/admin.int.test.js`).
- `node --check` y `git diff --check` limpios.

## Verificación local de la Fase 2 (2026-11-21)

- Rama `feat/admin-phase2` creada desde `origin/main` (ya incluye #31 y #32).
- Servidor en `PORT=4002` contra BD local descartable (`file:admin-test-phase2.db`), sin tocar la BD remota ni leer secretos. `SUPERADMIN_USERNAME=adminqa`.
- `users.status`: la baja bloquea `/api/login` (incluido el fallback legacy y Google), cierra las sesiones abiertas en el middleware y **no borra datos**.
- Endpoints nuevos: `GET /users` (búsqueda, filtro por estado, `isSuperadmin`, sin emails), `POST /users/:id/disable|enable`, `DELETE /users/:id/sessions`, `GET /audit`. Todos pasan por `requireSuperadmin`; las escrituras exigen `reason` no vacío y tienen rate limit propio.
- Reglas aplicadas: nadie puede desactivarse a sí mismo ni a otro superadmin; no se pueden revocar las propias sesiones.
- UI: tabla de usuarios con filtros, badges de estado y superadmin, y modal que pide el motivo antes de cada acción. La auditoría muestra actor, objetivo y motivo.
- `npm test` con `BASE_URL=http://localhost:4002` → **39/39 tests**, 4 suites.
- Smoke en navegador: login como `adminqa`, panel cargado, badge `Superadmin`, 6 eventos de auditoría visibles, sin errores de consola.
- `node --check` y `git diff --check` limpios. Servidor detenido y BD temporal eliminada.

## 8. Decisiones por defecto propuestas

Estos puntos no se preguntaron, pero conviene dejarlos escritos para no improvisar:

- La variable se llama `SUPERADMIN_USERNAME` (si después querés varios, se extiende a lista).
- El superadmin **no puede** impersonar a otro usuario.
- El superadmin **no ve** emails completos en la UI; solo username y fechas.
- Los borrados son **duros** (con las cascadas actuales), sin papelera en esta versión.
- `auth_provider` para cuentas viejas queda `unknown`, no se adivina.

Si aprobás estos defaults, el próximo paso es convertir esta spec en PR de implementación por fases, empezando por la Fase 1.
