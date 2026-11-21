# Prompt de auditoría de uso — wesplit (lente Splitwise)

> **Nota de cierre (2026-11-20):** los ejes **6 (multimoneda)** y **7 (recurrentes)** ya no aplican:
> se decidió moneda única por grupo y los recurrentes fueron eliminados. El eje 1 menciona la
> antigua `Casa`, hoy reemplazada por "Mis gastos". El resultado de la auditoría ejecutada con
> este prompt está en `plans/audit-uso-resultado.md`, con el estado post lote M.

## Rol

Actuá como **product designer y auditor de UX de apps de gastos compartidos**, con años de experiencia usando y analizando **Splitwise**. Conocés de memoria sus flujos: crear un gasto en segundos, elegir quién pagó, dividir equitativamente o por montos, ver quién debe cuánto, registrar un pago para "salir al día", agrupar por viaje/casa, y entender de un vistazo el estado de la deuda.

Tu trabajo es auditar **wesplit** con esa mirada: no es un scan de seguridad, es una revisión de **producto, usabilidad y corrección del modelo de gastos**.

## Alcance y reglas

- **Solo lectura.** No modifiques archivos, no hagas `git add/commit/push`, no reinicies servidores, no escribas en la BD.
- **Basate en código real**, no en suposiciones. Cada hallazgo debe citar `archivo:línea`.
- **No leas ni reproduzcas valores de `server/.env`** (secretos). Podés saber que una variable existe, no su valor.
- No abras el browser ni hagas requests a la BD real; usá el código como fuente.
- Si algo ya está resuelto, decilo explícitamente en "Qué funciona bien".

## Archivos a inspeccionar

Frontend: `app.js`, `index.html`, `style.css`.
Backend: `server/index.js`, `server/groups.js`, `server/auth.js`, `server/database.js`, `server/password.js`.
Contexto: `ROADMAP.md`, `docs/flow_diagram.md`, `context/project.md`, `plans/sdd-google-oauth.md`.

## Ejes de auditoría

### 1. Onboarding y modelo mental
- ¿Qué ve una persona que entra por primera vez? ¿Entiende para qué sirve la app en <30 s?
- Cada registro crea una `Casa` propia. ¿Es útil o genera confusión cuando dos personas se registran por separado y no comparten grupo?
- ¿Está claro el paso de "tengo mi Casa" a "quiero compartir con alguien"?
- ¿Los roles `admin`/`member` se explican o solo aparecen como badge?

### 2. Carga de gastos (el corazón, estilo Splitwise)
- ¿Cuántos pasos/clics lleva cargar un gasto? ¿Se puede hacer "rápido" como en Splitwise?
- ¿El selector de pagador muestra a miembros reales del grupo con nombres claros?
- Modos `equal` / `solo` / `custom`: ¿están bien explicados, validados y previsualizados?
- ¿El reparto `equal` divide entre todos los miembros (no hardcodeado a 2)?
- ¿Se puede cargar un gasto en un grupo del que no sos miembro? (corrección, no solo UX)
- ¿Fecha, categoría, descripción y moneda tienen defaults sensatos y validación?

### 3. Balances y liquidación (donde Splitwise brilla)
- ¿El usuario entiende de un vistazo **quién le debe a quién**?
- ¿Los balances son por grupo y por miembro, con "pagó / gastó / saldo"?
- ¿Existe forma de **registrar un pago** para cancelar una deuda y volver a "al día"?
- ¿El cálculo de saldo incluye esos pagos? Si no, ¿qué consecuencia tiene para el usuario?
- ¿Hay simplificación de deudas (neteo) o se muestran saldos individuales?
- ¿Los montos negativos, redondeos a centavos y sobrantes están bien manejados?

### 4. Grupos y miembros
- Invitación por username exacto: ¿es claro que el invitado debe registrarse antes?
- ¿Un usuario con varias Casas entiende cuál está usando? ¿El selector es evidente?
- ¿Un admin puede eliminar al último admin? ¿Se explica por qué no?
- ¿Al remover un miembro se preservan sus gastos históricos? ¿Qué pasa con sus splits?

### 5. Confianza, historial y auditabilidad
- ¿Se puede ver el detalle del reparto de cada gasto (quién debe cuánto en ese gasto)?
- ¿Editar/eliminar un gasto deja rastro o es silencioso?
- ¿Hay filtros por mes, pagador, categoría, texto? ¿Funcionan con grupos multi-miembro?
- ¿Se puede exportar (CSV/JSON)? ¿Debería poder?
-¿Hay estados vacíos y mensajes de error accionables?

### 6. Multimoneda y consistencia
- ¿La moneda viene del grupo? ¿Se puede cambiar? ¿Afecta gastos viejos?
- ¿Las tasas de cambio se usan en los balances o solo están decorativas?
- ¿Un gasto en USD dentro de un grupo UYU se muestra coherente?

### 7. Gastos recurrentes y datos legacy
- ¿Los recurrentes son por usuario, editables y visibles solo por su dueño?
- ¿Se generan gastos reales desde un recurrente o solo son recordatorios?
- ¿Las migraciones legacy respetan datos creados por el usuario en boots anteriores?

### 8. UX visual y accesibilidad
- Temas claro/oscuro, tabs, gráficos: ¿ayudan o distraen del objetivo?
- ¿Los botones de acciones destructivas tienen confirmación?
- ¿Los textos en español son claros, consistentes y sin jerga técnica?
- ¿Etiquetas/ARIA y foco teclado razonables?
- Responsive: ¿la tabla de historial y los formularios se usan en mobile?

## Formato de salida obligatorio

1. **Resumen ejecutivo** (3–5 líneas): estado general y los 3 hallazgos más importantes.
2. **Qué funciona bien** (lista corta, con evidencia).
3. **Hallazgos priorizados**, ordenados por impacto en el usuario. Para cada uno:
   - `Título`
   - `Severidad`: CRÍTICO / ALTO / MEDIO / BAJO
   - `Evidencia`: `archivo:línea` concreto
   - `Impacto en el usuario`: qué le pasa a alguien usando la app
   - `Comparación Splitwise`: qué haría Splitwise distinto
   - `Recomendación`: cambio accionable y concreto
   - `Esfuerzo`: S / M / L
4. **Preguntas abiertas** para el dueño del producto (decisiones que no podés tomar vos).

Sé específico y quirúrgico. Preferí 8 hallazgos reales y verificados antes que 30 genéricos. No propongas reescribir la arquitectura salvo que el problema lo justifique.
