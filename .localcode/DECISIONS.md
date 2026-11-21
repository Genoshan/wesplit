# Project Decisions
*Log of architectural and technical considerations.*

- [2026-07-16] | **LocalCode Architecture** | Adopted a "State over History" model to solve context decay in long sessions.
- [2026-07-16] | **Storage Strategy** | Selected plain-text files in a .localcode/ directory for human readability and Git compatibility.
- [2026-07-16] | **Protocolo de Contexto** | Se establece el uso estricto del sistema .localcode como la fuente primaria de verdad para evitar la degradación por falta de contexto (context drift). El agente no debe adivinar; debe usar las herramientas y los archivos en .localcode (SESSION, DECISIONS) para mantener la coherencia entre sesiones.
- [2026-07-29] | **Fuente de verdad** | Siempre verificar estado remoto con `gh pr list` antes de confiar en archivos locales. Nunca asumir estado del repositorio sin verificar en GitHub.
- [2026-07-30] | **Rama obligatoria** | Antes de implementar cualquier cambio, crear rama `feature/<nombre>`. Nunca modificar `main` directamente. Regla agregada a AGENTS.md.
- [2026-07-30] | **Auditoría de roadmap** | El roadmap en raíz estaba desactualizado — Fase 1 completa pero marcada como 1/4. Se actualizó reflejando el estado real del proyecto con 9 features implementadas en Fase 1.
- [2026-11-20] | **Grupos dinámicos** | La app pasa de un MVP de dos personas a grupos con N miembros reales; cada registro crea su propio grupo personal `Mis gastos` y el creador es admin. Los grupos compartidos los nombra el usuario. El default se ordena por fecha de creación.
- [2026-11-20] | **Invitación** | Se conserva sin link; se descarta el link con token. Se normalizan mayúsculas/espacios en front y servidor, se agrega búsqueda con sugerencias (`/api/users/search`) y la aceptación/rechazo ocurre dentro de la app, sin token externo. El estado `pending`/`active` se implementó en el lote M junto con `inactive` para bajas.
- [2026-11-20] | **Filtros** | Afectan solo al historial; balances y estadísticas se rotulan explícitamente como "todos los períodos". No se recalculan sobre el filtro.
- [2026-11-20] | **Google OAuth abierto** | `GOOGLE_AUTHORIZED_EMAILS` se deja comentada en `.env`: entra cualquier cuenta de Google con email verificado. El código del allowlist se conserva para poder reactivarlo.
- [2026-11-20] | **Registro dual** | Se permiten en paralelo registro con usuario/password y registro con Google; no se aplica allowlist al registro manual ni se pone cupo de cuentas.
- [2026-11-20] | **Moneda única por grupo** | Se retiran las tasas de cambio y el CRUD de monedas. No se integra API de cotización diaria ahora: es mucho trabajo y poco beneficio.
- [2026-11-20] | **Recurrentes descartados** | Se elimina por completo la funcionalidad (API, tabla, CSS y documentación). No se implementa generación automática ni backfill.
- [2026-11-20] | **Borrado de miembros** | En vez de transferir deudas, se marca al miembro como inactivo conservando sus gastos y splits en el historial y balances.
- [2026-11-20] | **Endpoints legacy retirados** | Se eliminan `/api/expenses`, `/api/expense/:id` (GET/POST/PUT/DELETE) y `resolveLegacyPayer`: no tenían consumidores y escribían un split del 50%.
- [2026-11-20] | **Edición de gastos** | Implementada con modal y `PUT /api/groups/:id/expenses/:expenseId`. Recalcula splits (incluye inactivos para no perder partes históricas) y fuerza la moneda del grupo. El endpoint legacy sigue eliminado.
- [2026-11-20] | **Reparto personalizado** | La UI reemplaza el par fijo "yo / pareja" por un input por miembro del grupo con validación de suma en centavos; el servidor valida montos y miembros.
- [2026-11-20] | **Desglose** | Cada gasto del historial puede expandirse para ver la parte de cada miembro.
- [2026-11-20] | **Liquidación "Settle up"** | Diferida pero queda registrada como pendiente: el endpoint de pagos existe, sin UI y sin impacto en el balance.
- [2026-11-20] | **Sin backoffice** | La administración que importa resuelve por grupo (admins de grupo). `global_role` queda sin uso práctico al retirar el CRUD de tasas.
- [2026-11-20] | **Orden de trabajo** | Priorizar por dificultad de implementación (lote fácil → medio → difícil), con la actualización documental al final.
