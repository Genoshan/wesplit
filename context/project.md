# Proyecto: WeSplit — Gastos compartidos

> Actualizado al 2026-11-21. La definición original (MVP de dos personas sin login) quedó obsoleta; este archivo describe el estado real.

## Objetivo del proyecto

Aplicación web de gastos compartidos inspirada en Splitwise, para uso doméstico pero con soporte para **grupos con N miembros reales**.

## Alcance actual

- **Usuarios**: registro con username/email/password (mínimo 12 caracteres, `bcryptjs` con rehash legacy) y login con Google OAuth (cualquier email verificado; la allowlist está desactivada en `.env`).
- **Grupos**: cada registro crea automáticamente un grupo `Mis gastos` propio, con el creador como admin. Un usuario puede pertenecer a varios grupos y cambiar entre ellos desde el selector del header; el grupo elegido se recuerda al recargar.
- **Invitaciones**: por username exacto, sin link. El invitado debe estar registrado antes y **debe aceptar** la invitación desde la pestaña Miembros; mientras tanto queda como `pending` y no ve los datos del grupo.
- **Roles**: dos niveles independientes — `users.global_role` (admin/member global) y `group_members.role` (admin/member dentro de cada grupo).
- **Gastos**: modos `equal`, `solo` y `custom`. `evenSplits()` reparte los centavos sobrantes para que la suma de partes sea exacta entre N miembros.
- **Balances**: calculados en servidor (`GET /api/groups/:id/balance`) con `total_paid - total_spent + pagos_net` por miembro.
- **Pagos**: settle up integrado con `GET/POST/DELETE /api/groups/:id/payments`, UI en la pestaña Gastos, historial, descuento en balances y exportación CSV.
- **Moneda**: **moneda única por grupo**, ya implementada. Se eliminaron la tabla `currencies`, el seed de tasas y sus endpoints; el alta de gasto **y de pago** ignoran la moneda enviada y usan `base_currency` del grupo. No hay API de cotización por ahora.
- **Recurrentes**: **eliminados por completo** (rutas, tabla, CSS y documentación) por bajo valor.
- **Frontend**: pestañas Gastos / Balances / Estadísticas / Miembros; temas claro/oscuro; SRI en CDNs y CSP; sin handlers inline.

## Reglas de desarrollo

- Implementar una única historia por vez.
- Antes de modificar código: analizar el estado actual, explicar la solución propuesta, indicar qué archivos se modificarán y esperar aprobación.
- Después de implementar: verificar que el proyecto sigue funcionando y actualizar `.localcode/SESSION.md`, `.localcode/DECISIONS.md` y `memory/BITACORA.md`.
- No hacer `git add`/`commit`/`push` sin autorización explícita.
- No leer ni reproducir valores de `server/.env`.

## Prioridades

1. Simplicidad, legibilidad y velocidad de desarrollo.
2. No agregar funcionalidades futuras ni abstraer componentes sin necesidad.
3. No implementar varias historias en una misma iteración.
4. No inferir requerimientos no expresados.

## Documentación relacionada

- Estado real y reglas de trabajo: `AGENTS.md`
- Roadmap: `ROADMAP.md`
- Flujo de carga de gastos: `docs/flow_diagram.md`
- Auditoría de uso y decisiones: `plans/audit-uso-resultado.md`
- Decisiones arquitectónicas: `.localcode/DECISIONS.md`
