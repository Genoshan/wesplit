# Roadmap Consolidado (Reloj & Local AI Lab)

## 🕒 Proyecto Reloj - Gestión de Gastos Compartidos
*Inspirado en funcionalidades clave de Splitwise. Dos usuarios: Tin y Noe. Divisiones 50/50.*

### 🟢 Fase 1: Core ✅ COMPLETA
- [x] Categorizar gastos — 5 categorías (Base de datos, Backend, UI)
- [x] Tablas y gráficos — Chart.js doughnut + tabla de historial
- [x] Búsqueda de gastos — Filtro por texto, categoría, pagador y mes
- [x] Cálculo de saldos totales — Panel de deuda mutua + dashboard
- [x] CRUD completo — Editar/eliminar con modal
- [x] Autenticación — Login con contraseña + Google OAuth, sessions en cookies HTTP-only
- [x] Temas visuales — GitHub, Dracula, Nord con `data-bs-theme`
- [x] Notificaciones — SweetAlert2 en todas las acciones de usuario
- [x] Sistema de memoria — `.localcode/` + `memory/` con checkpoint WAL

### 🟢 Fase 2: Mejoras Implementadas
- [x] **Mobile-first responsive** — 20 fixes (iOS zoom, safe areas, breakpoints progresivos, touch optimization)
- [x] **Gastos recurrentes** — CRUD completo (diario, semanal, quincenal, mensual, trimestral, anual)
- [x] **Protección contra fuerza bruta** — Rate limiting en login y API
- [x] **Endpoint `/api/version`** — Versionamiento visible en UI

### 🟡 Fase 3: UX y Productividad (Pendiente)
- [ ] **Gastos compartidos con terceros** — Amigos, familia
- [ ] **Exportar datos** — CSV, JSON
- [ ] **Búsqueda por fecha/rango**
- [ ] **Edición en línea** de la tabla de historial
- [ ] **Drag & drop** para reordenar historial

### 🟡 Fase 4: Análisis Avanzado (Pendiente)
- [ ] **Gráfico temporal** de gastos por mes/semana
- [ ] **Comparativa mes a mes**
- [ ] **Presupuestos por categoría**
- [ ] **Predicciones de gasto**
- [x] **Divisiones desiguales y por %** — Split flexible (equal/solo/custom) con tabla `expense_splits`

### 🔵 Futuro — No planificado
- [ ] Sincronización en la nube
- [ ] Modo sin conexión
- [ ] Conversión de monedas y Multidivisa
- [ ] Escaneo de recibos (OCR)
- [ ] Importar transacciones (CSV/Excel)
- [ ] Desglose de elementos
- [ ] Soporte multi-idioma
- [ ] Integración de métodos de pago
- [ ] Optimización de rendimiento

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
