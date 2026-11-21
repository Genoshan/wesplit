# Roadmap Consolidado (Reloj & Local AI Lab)

## 🕒 Proyecto wesplit - Gestión de Gastos Compartidos
*Inspirado en Splitwise. N miembros por grupo, moneda única por grupo y reparto exacto en centavos.*

> **Estado al 2026-11-21:** PRs #19 a #27 mergeados en `main`, sin PRs abiertos. Producción en `https://wesplit-k5rc.onrender.com` con `version 1.0.0`, 0 vulnerabilidades en producción y 18/18 tests.
> Incluye paleta verde Splitwise/navy en tema claro (tema oscuro intacto), favicon, marcador de versión y Google OAuth funcionando. La sección siguiente refleja el código real.

### 🟢 Fase 1: Fundamentos ✅ COMPLETA
- [x] Categorías, historial con filtros (texto, categoría, pagador, mes), gráfico por categoría.
- [x] Balances por miembro con "pagó / gastó / saldo" (todos los períodos).
- [x] CRUD de gastos: alta, edición con modal y borrado físico con limpieza de splits.
- [x] Autenticación con usuario/contraseña (bcryptjs, mínimo 8 con letra, número y símbolo; login por username o email) y Google OAuth.
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
- [x] Settle up: pagos entre miembros del grupo con historial, alta/baja y descuento en balances.
- [x] Filtro por rango de fechas en el historial y exportación CSV por grupo.

### 🟡 Pendiente / diferido
- [ ] **Backoffice** para `global_role` y administración de cuentas.
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
