# Roadmap Consolidado (Reloj & Local AI Lab)

## 🕒 Proyecto wesplit - Gestión de Gastos Compartidos
*Inspirado en Splitwise. N miembros por grupo, moneda única por grupo y reparto exacto en centavos.*

> **Estado al 2026-11-20:** rama `feature/dynamic-groups`, PR a `main` pendiente de autorización.
> Este roadmap estaba desactualizado; la sección siguiente refleja el código real.

### 🟢 Fase 1: Fundamentos ✅ COMPLETA
- [x] Categorías, historial con filtros (texto, categoría, pagador, mes), gráfico por categoría.
- [x] Balances por miembro con "pagó / gastó / saldo" (todos los períodos).
- [x] CRUD de gastos: alta, edición con modal y borrado físico con limpieza de splits.
- [x] Autenticación con usuario/contraseña (bcryptjs, mínimo 12) y Google OAuth.
- [x] Sesiones en cookie HTTP-only, CSP + SRI, rate limits y guards de acceso.
- [x] Temas claro/oscuro, SweetAlert2 y `.localcode/` + `memory/`.

### 🟢 Fase 2: Grupos dinámicos y seguridad ✅ COMPLETA
- [x] Grupos con N miembros; grupo personal "Mis gastos" creado al registrar.
- [x] Invitación por username con normalización (mayúsculas/espacios) y sugerencias de búsqueda.
- [x] Aceptación/rechazo de invitaciones desde la pestaña Miembros (sin link con token).
- [x] Baja lógica de miembros (inactivos conservan historial y balances) y reactivación.
- [x] Guard de último admin activo; pagadores y splits desde miembros reales.
- [x] Desglose de splits en el historial y reparto personalizado para N miembros.
- [x] Endpoints legacy y tablas de recurrentes/tasas eliminados.

### 🟡 Pendiente / diferido
- [ ] **Settle up**: registrar pagos y que el balance los descuente (API existe, sin UI).
- [ ] **Backoffice** para `global_role` y administración de cuentas.
- [ ] **Exportar datos** (CSV/JSON).
- [ ] **Gráfico temporal** y comparativa mes a mes.
- [ ] **2FA** y notificaciones por email.
- [ ] **Cotización diaria / multimoneda**: descartado por ahora (moneda única por grupo).
- [ ] **Gastos recurrentes**: descartado y eliminado del código.

### 🔵 Futuro — No planificado
- [ ] Sincronización en la nube, modo sin conexión, OCR de recibos, multi-idioma.
- [ ] Escaneo/importación de transacciones y presupuestos por categoría.

---

## 🤖 Local AI Lab - Infraestructura y Desarrollo
*Plan de desarrollo para la investigación y despliegue de IA.*

### 🏗️ Sprint 1: Foundation
- Establecer estructura del laboratorio
- Definir flujos de trabajo
- Configurar repositorio y herramientas

### 🔍 Sprint 2: Research
- Evaluar modelos disponibles
- Analizar casos de uso
- Documentar hallazgos clave

### ✅ Sprint 3: Validation
- Implementar primeros prototipos
- Validar rendimiento local
- Refinar arquitectura

### 🚀 Sprint 4: Production
- Consolidar soluciones viables
- Establecer procesos de mantenimiento
- Preparar despliegue escalable
