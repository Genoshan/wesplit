# Backlog de Mejoras - wesplit

Estado al 2026-11-20. Los ítems resueltos se conservan marcados para no reabrirlos por accidente.

## ✅ Resueltos

- [x] Validación de monto positivo y `min="0.01"` en el formulario; validación en backend.
- [x] `trim()` y normalización de username en invitaciones; búsqueda con sugerencias.
- [x] Reemplazo de `alert()` por SweetAlert2 y `aria-live` en resultados de invitación.
- [x] Guard de último admin activo al dar de baja miembros.
- [x] Eliminación física de gastos con limpieza explícita de `group_splits`.
- [x] Desglose de splits en el historial y reparto exacto para N miembros.
- [x] Edición de gastos con modal y `PUT /api/groups/:id/expenses/:expenseId`.
- [x] Aceptación de invitaciones (`pending`/`active`) y baja lógica (`inactive`).
- [x] Filtros rotulados como "solo historial"; balances y gráfico "todos los períodos".
- [x] CSP + SRI, escapeo de HTML, rate limits y protección de IDOR.
- [x] Historial con filtros, resumen de deudas y estados vacíos.

## 🟡 Pendiente / diferido

- [ ] **Settle up**: UI para `POST /api/groups/:id/payments` y descuento de pagos en el balance.
- [ ] **Backoffice**: administración de `global_role` y cuentas.
- [ ] **Exportar datos** (CSV/JSON).
- [ ] **Gráfico temporal** y comparativa mes a mes.
- [ ] **Indicador de carga** en acciones lentas del formulario y de invitaciones.
- [ ] **2FA** y notificaciones por email.

## ⚪ Descartado (no reabrir sin nueva decisión)

- Gastos recurrentes: eliminados por completo (API, tabla, CSS y docs).
- Tasas de cambio y multimoneda por gasto: se usa moneda única por grupo.
- Link de invitación con token: se conserva invitación por username con aceptación en la app.
- Cupo de cuentas / allowlist de Google: registro manual y Google siguen abiertos.
