# Roadmap Consolidado (Reloj & Local AI Lab)

## 🕒 Proyecto Reloj - Gestión de Gastos Compartidos
*Inspirado en funcionalidades clave de Splitwise. Dos usuarios: Tin y Noe. Divisiones 50/50.*

### 🟢 Fase 1: Fundamentos y Experiencia de Usuario (Core) ✅ COMPLETA
- [x] **Categorizar gastos** (Base de datos, Backend y UI) — 5 categorías
- [x] **Tablas y gráficos** (Visualización de gráficos por categoría y tiempo) — Chart.js doughnut + tabla de historial
- [x] **Búsqueda de gastos** (Filtro rápido en el historial) — Filtro por texto, categoría, pagador y mes
- [x] **Cálculo de saldos totales** (Resumen claro en la pantalla principal) — Panel de deuda mutua + métricas del dashboard
- [x] **CRUD completo** — Editar y eliminar gastos con modal
- [x] **Autenticación** — Login/logout con sessions en cookies HTTP-only
- [x] **Temas visuales** — GitHub, Dracula, Nord con `data-bs-theme`
- [x] **Notificaciones** — SweetAlert2 en todas las acciones de usuario
- [x] **Sistema de memoria** — `.localcode/` + `memory/` con checkpoint automático

### 🟡 Fase 2: Autenticación y Seguridad
- [ ] **Login con Google OAuth**
- [ ] **Login con contraseña** (actual)
- [ ] **2FA (autenticación de dos factores)**
- [ ] **Protección contra fuerza bruta** (actual, ya implementado)

### 🟡 Fase 3: Mejoras de UX y Productividad
- [ ] **Gastos recurrentes** (Suscripciones, alquiler, etc.)
- [ ] **Gastos compartidos con terceros** (Amigos, familia)
- [ ] **Exportar datos** (CSV, JSON)
- [ ] **Búsqueda por fecha/rango**
- [ ] **Edición en línea** de la tabla de historial
- [ ] **Drag & drop** para reordenar historial

### 🟡 Fase 3: Análisis Avanzado
- [ ] **Gráfico temporal** de gastos por mes/semana
- [ ] **Comparativa mes a mes**
- [ ] **Presupuestos por categoría**
- [ ] **Predicciones de gasto**
- [ ] **Divisiones desiguales y por %** (requiere refactor de modelo de datos)

### 🔵 Futuro — No planificado
- [ ] **Sincronización en la nube**
- [ ] **Modo sin conexión**
- [ ] **Conversión de monedas y Multidivisa**
- [ ] **Escaneo de recibos** (OCR)
- [ ] **Importar transacciones** (CSV/Excel)
- [ ] **Desglose de elementos**
- [ ] **Soporte multi-idioma**
- [ ] **Integración de métodos de pago**
- [ ] **Optimización de rendimiento**

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
