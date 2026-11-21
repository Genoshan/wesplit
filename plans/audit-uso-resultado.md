# Auditoría de uso — wesplit (lente Splitwise)

> **Estado al 2026-11-20 (post lote M):** este documento es el análisis original, no un estado final.
> **Resueltos:** H1 (baja lógica con miembros inactivos que conservan historial y balances + reactivación),
> H3 (endpoints legacy eliminados), H4 (guard de último admin activo), H5 y H7 (cerrados por decisión de
> producto: moneda única por grupo y recurrentes eliminados), H6 (grupo "Mis gastos", default por fecha,
> invitación normalizada con sugerencias **y aceptación/rechazo del invitado**), H8 (modal de edición con
> `PUT` group-scoped), H9 (desglose de splits en el historial y reparto personalizado para N miembros) y
> H10 (CSS/UX: `--border-color`, `#category-chart`, `min`, filtros rotulados, doble request de balance,
> etiqueta "Partes iguales") y H2 (settle up integrado: alta/baja e historial de pagos group-scoped,
> descuento en balances, filtro por rango de fechas y exportación CSV). Los ejes 6 y 7 del prompt
> `audit-uso-splitwise.md` ya no aplican.

Ejecutada el 2026-11-20 con tres auditores de solo lectura (onboarding/grupos, gastos/balances, confianza/UX). Hallazgos verificados personalmente contra el código. No se modificó código de la app ni se escribió en la BD.

## 1. Resumen ejecutivo

El núcleo carga bien gastos con pagadores reales y splits exactos para N miembros, pero el producto **no cierra el ciclo de gastos compartidos**: no se puede registrar un pago para "salir al día" y el balance ignora los pagos que ya existen en la BD. Tres problemas de integridad agravan eso: remover un miembro con historial deja deuda huérfana, el guard de "último admin" vive solo en el front, y las rutas legacy `/api/expense` siguen escribiendo un split del 50% sin asignar la otra mitad. La capa de confianza es débil (sin desglose por gasto, sin edición en UI, borrado físico silencioso) y hay deuda UX concreta y barata de corregir (recurrentes sin pantalla, `--border-color` indefinida, toggle de tema con ID inexistente).

**Top 5 a atacar primero:** H1 (deuda huérfana), H2 (liquidación imposible), H3 (splits legacy incompletos), H4 (grupo acéfalo), H5 (multimoneda cosmética).

## 2. Qué funciona bien (evidencia)

- Pagador y splits desde miembros reales, sin hardcodeo Tin/Noe: `app.js:430-449`, `server/groups.js:43-62`, `server/groups.js:421-424`.
- `evenSplits()` reparte centavos exactos entre N miembros: `server/groups.js:53-62`.
- Balances calculados en servidor como única fuente de verdad: `app.js:553-558`, `server/groups.js:509-569`.
- Validaciones clave en el endpoint principal: monto > 0, pagador miembro, modos válidos, tolerancia de 1¢ en custom: `server/groups.js:395-453`.
- Rate limits, sesiones HTTP-only, CSP, SRI, escape HTML y sin handlers inline: `server/index.js:30-49,60-82`, `app.js:14-18`.
- Seed legacy one-shot que no revive grupos borrados ni sobrescribe datos del usuario: `server/database.js:203-230,249-282,308-326`.
- Filtros de historial (texto, categoría, pagador, mes) conectados: `app.js:507-516,723-739`.
- Confirmaciones sólidas para borrar grupo y borrar cuenta: `app.js:387-395,788-804`.

## 3. Hallazgos priorizados

### H1 — Remover un miembro con historial deja deuda huérfana — CRÍTICO
- **Evidencia:** `server/groups.js:320-323` hace `DELETE FROM group_members` sin consultar `group_expenses`/`group_splits`; `app.js:387-394` confirma solo "¿Eliminar este miembro?". El balance itera solo miembros actuales (`server/groups.js:522-564`) y descarta splits de quien ya no está; el historial sí lo muestra como pagador (`server/groups.js:349-355`).
- **Impacto:** expulsar a quien pagó $20.000 del super deja el gasto en el historial pero su parte fuera del balance: los que quedan "deben menos" y el dinero pagado se contabiliza como regalo. Sin advertencia ni deshacer.
- **Splitwise:** explica qué pasa con los gastos compartidos y ofrece conservar transacciones o eliminarlas, con posibilidad de re-agregar.
- **Recomendación:** mostrar en el confirm cuántos gastos y qué monto tiene el miembro; en servidor, marcar la membresía como inactiva (preservando splits) con asiento de compensación, o transferir sus splits al owner. Como mínimo, bloquear la eliminación si tiene historial hasta definir la política.
- **Esfuerzo:** M.

### H2 — No se puede "salir al día": sin UI de pagos y el balance los ignora — ALTO
- **Evidencia:** `POST /:id/payments` existe (`server/groups.js:574-618`) y la tabla `group_payments` también (`server/database.js:115-127`), pero ningún helper del front llama a payments (`app.js:101-130`) y el tab Balances solo tiene `#balance-detail` (`index.html:192-203`). `GET /:id/balance` lee únicamente expenses + splits (`server/groups.js:527-564`). Tampoco hay deudas bilaterales: solo saldo neto por persona (`server/groups.js:560-562`).
- **Impacto:** después de transferir dinero, el deudor sigue apareciendo como "debe", sin saber a quién pagar. Es la funcionalidad por la que existe Splitwise.
- **Splitwise:** "Settle up" de primera clase: deudas pareadas, pagos totales o parciales, recálculo inmediato e historial de liquidaciones.
- **Recomendación:** botón "Registrar pago" en Balances con `from_user`/`to_user`/monto; incluir `group_payments` en el balance; mostrar sugerencia de liquidación greedy por pares.
- **Esfuerzo:** L.

### H3 — Rutas legacy escriben splits incompletos (mitad del gasto sin asignar) — ALTO
- **Evidencia:** `server/index.js:838` y `server/index.js:919-920` insertan un único split de `parsedAmount / 2`; el endpoint principal usa `evenSplits()` (`server/groups.js:434-437`). `server/index.js:907-910` además omite `currency` del UPDATE.
- **Impacto:** cualquier script o cliente que use `/api/expense` genera un gasto cuya mitad no le toca a nadie; el balance queda con sobrante permanente. Divergencia silenciosa entre dos caminos de escritura.
- **Splitwise:** una sola ruta de escritura; todo gasto cuadra con la suma de sus participaciones.
- **Recomendación:** retirar `/api/expense` (POST/PUT) si no hay consumidores reales, o delegar al mismo `evenSplits` + `resolveMemberId` de `groups.js` e incluir `currency` en el UPDATE.
- **Esfuerzo:** S.

### H4 — El grupo puede quedarse sin admin: guard solo en el front — ALTO
- **Evidencia:** `app.js:353-355` oculta el botón para el último admin, pero `server/groups.js:297-331` solo verifica que el actor sea admin y no se remueva a sí mismo. Además `POST /:id/members` usa `INSERT OR IGNORE` (`server/groups.js:281-284`): no permite promover a un miembro existente, y acepta `role` arbitrario del body (`server/groups.js:249-254`). No hay transferencia de `owner_id`.
- **Impacto:** un admin puede remover al otro admin aunque sea el último; nadie podrá invitar, editar ni borrar el grupo. Callejón sin salida sin migración manual.
- **Splitwise:** siempre mantiene al menos un administrador; al salir el último transfiere control o bloquea la acción con mensaje explícito.
- **Recomendación:** contar admins en el servidor y devolver 400 con mensaje accionable; agregar `PATCH /:id/members/:userId {role}` y selector Admin/Miembro en la UI; transferir `owner_id` al salir el owner.
- **Esfuerzo:** S para el guard, M con promoción y transferencia.

### H5 — Multimoneda cosmética: tasas no impactan el balance y cambiar la base reinterpreta el histórico — ALTO
- **Evidencia:** tasas sembradas (`server/database.js:288-306`), CRUD admin (`server/index.js:585-626`) y comentario que afirma que "alimentan los balances de TODOS los grupos" (`server/index.js:576`). Pero `server/groups.js:527-564` suma `ge.amount` sin conversión y `app.js:70-83` formatea con `currentGroupCurrency`; las tasas solo se usan en el summary legacy que el front no llama (`server/index.js:671-724`). Cambiar `base_currency` (`server/groups.js:204-207`) reinterpreta gastos que guardaron su moneda al crearse (`server/groups.js:419`).
- **Impacto:** cambiar una tasa no hace nada; cambiar la moneda base muestra todos los gastos antiguos como si estuvieran en la moneda nueva. Se pierde confianza en los números.
- **Splitwise:** cada gasto guarda moneda y tipo de cambio; balances se calculan en la moneda base con conversión visible.
- **Recomendación:** aplicar `currencies.rate` en `GET /:id/balance` usando `ge.currency` + base del grupo, o quitar el CRUD de tasas para no generar expectativa falsa. Congelar/convertir el histórico al cambiar base.
- **Esfuerzo:** L.

### H6 — "Casa" por cuenta e invitación opaca: el modelo mental no se comunica — ALTO
- **Evidencia:** todo registro crea `Casa` (`server/index.js:140-149`, `server/auth.js:492-503`); el default se elige por orden alfabético (`server/auth.js:540`) y `app.js:138-141` lo selecciona. Invitación por username exacto (`server/groups.js:271`) sin normalizar caja (`app.js:371` solo `.trim()`); el modal lo explica recién abierto (`index.html:247-250`). `context/project.md:6-12` y `ROADMAP.md:25` siguen describiendo un MVP sin grupos.
- **Impacto:** dos personas que comparten vivienda registran gastos en "Casas" distintas y no ven deuda entre ellas, sin entender por qué. Invitar requiere saber el handle ajeno por otro canal.
- **Splitwise:** no crea grupos por defecto; el alta pregunta con quién vas a dividir y guía la creación del primer grupo; invita por email, link o código con sugerencias.
- **Recomendación:** nombre inequívoco para el grupo personal ("Tus gastos") o empty state con "Crear grupo"/"Unirme"; normalizar username en front y server; microcopy de primer ingreso; ordenar default por `created_at`; actualizar docs.
- **Esfuerzo:** S (copy + normalización), M (empty state).

### H7 — Recurrentes inalcanzables y migración sin dueño — ALTO
- **Evidencia:** CRUD en `server/index.js:436-539`, tabla en `server/database.js:156-166` y CSS en `style.css:892-1007`, pero `index.html:94-108` no tiene pestaña y `app.js` nunca llama a `/api/recurring`. `next_due_date` solo se guarda y se lee: no hay scheduler que inserte en `group_expenses`. La migración `server/database.js:343-350` agrega `user_id` **sin backfill**, y las consultas filtran por ese campo (`server/index.js:438,485,524`): las filas viejas quedan con `NULL`, invisibles para todos.
- **Impacto:** funcionalidad inaccesible; los recurrentes legacy desaparecen para todos sin borrarse físicamente. Además `payer` solo acepta `me`/`partner` (`server/index.js:457,510`), modelo de dos personas ya superado.
- **Splitwise:** los recurrentes se listan, editan y se convierten en gastos reales en su fecha, con opción de omitir uno.
- **Recomendación:** backfill determinístico de `user_id` en la migración; pestaña "Recurrentes" usando los endpoints existentes; acción "Registrar ahora" que llame al POST de gasto resolver pagador contra miembros reales. Si no hay generación automática, rotularlos "recordatorios".
- **Esfuerzo:** M (backfill + UI), L (generación automática).

### H8 — Historial opaco y borrado silencioso — ALTO
- **Evidencia:** `app.js:527-548` muestra solo "Tu parte" aunque el backend entrega splits por gasto (`server/groups.js:365-376`, `server/index.js:764-767`). El confirm de borrado no describe el gasto (`app.js:485-492`) y el borrado es físico (`server/groups.js:493-496`). Existe `PUT /api/expense/:id` (`server/index.js:888`) pero el front nunca lo llama (único `apiPut`: perfil en `app.js:775`). `ROADMAP.md:11` promete "CRUD completo — Editar y eliminar gastos con modal", hoy falso en la UI.
- **Impacto:** en grupo de 3+ no se puede verificar quién debe cuánto en un gasto concreto; un clic equivocado pierde el gasto para siempre; la doc promete edición inexistente.
- **Splitwise:** cada gasto se abre con "pagado por X" y la cuota de cada participante, más registro de actividad con altas/ediciones/bajas y deshacer temporal.
- **Recomendación:** tarjetas expandibles con `expense.splits` y `split_mode`; confirm con descripción/monto/pagador; conectar el PUT a un modal de edición; log liviano de auditoría.
- **Esfuerzo:** S (desglose y confirm), M (edición + log).

### H9 — Modo "Montos exactos" sólo para 2 personas y preview desincronizado — MEDIO
- **Evidencia:** `app.js:603-612` renderiza exactamente dos inputs; `otherMemberUsername()` toma el primer miembro distinto (`app.js:422-425`); `submitExpense()` arma dos splits (`app.js:632-644`). `updateSplitDisplay()` corre una vez en `DOMContentLoaded` (`app.js:721`), antes de cargar miembros, y no se re-invoca desde `renderPayerOptions()` (`app.js:430-449`), que además fuerza `payer.value = mine.username` en cada `loadExpenses()` (`app.js:438-443,294,473`).
- **Impacto:** en grupos de 3+ es imposible repartir entre todos desde la UI; si escribe el monto apenas carga, el preview dice "sos el único miembro"; tras cargar un gasto pagado por otra persona, el selector salta a "Vos" y hay que elegirlo de nuevo.
- **Splitwise:** un input por participante con "restante" en vivo y submit deshabilitado hasta que cuadre; pagador y desglose siempre consistentes.
- **Recomendación:** inputs generados desde `currentGroupMembers`, restante calculado en vivo con la tolerancia de 1¢ del servidor, llamar `updateSplitDisplay()` al terminar `renderMembers()`/`renderPayerOptions()`, preservar la selección del pagador.
- **Esfuerzo:** M.

### H10 — Filtros, gráfico y CSS roto — MEDIO
- **Evidencia:** `populateMonthFilter()` reconstruye el `<select>` sin restaurar el valor elegido (`app.js:404-410`, llamado en `app.js:293`) mientras `historyFilters.month` se mantiene (`app.js:511-514,736-739`); el estado vacío es siempre "No hay gastos registrados" (`app.js:518-520`). `updateChart()` usa `allExpenses`, nunca filtros (`app.js:561-585`). El canvas no tiene `aria-label` (`index.html:214`); el CSS apunta a `#categoryChart` (`style.css:519,790,859`) pero el ID real es `category-chart`. Además `var(--border-color)` se usa en ~20 reglas (`style.css:89,97,106,235,286,309,...`) pero los temas solo definen `--bs-border-color` (`style.css:6,26,43`), y `updateThemeToggle()` busca `#theme-toggle` (`app.js:60-64`) mientras el botón es `#toggle-theme-btn` (`index.html:85`).
- **Impacto:** el combo dice "Todos los meses" pero la lista sigue filtrada; el gráfico muestra otro conjunto de datos sin aviso; bordes inválidos que rompen la jerarquía visual; el botón de tema nunca actualiza ícono ni título.
- **Splitwise:** chips de filtros activos, contador de resultados, "Limpiar filtros", gráficos que respetan el período y jerarquía visual clara.
- **Recomendación:** preservar `monthFilter.value` (o limpiar `historyFilters.month`), distinguir ambos estados vacíos, alimentar el chart desde el conjunto filtrado o rotularlo "Todos los períodos", definir `--border-color: var(--bs-border-color)`, alinear el ID del toggle, agregar `aria-label` al canvas y usar `.chart-empty`.
- **Esfuerzo:** S.

### H11 — Centavos invisibles, validaciones divergentes y errores técnicos — MEDIO
- **Evidencia:** `currencyDecimals()` da 0 decimales a UYU/ARS/CLP/etc (`app.js:66-83`) aunque el servidor reparte centavos (`server/groups.js:53-62`) → una deuda de 1¢ se muestra "$0 debe" (`app.js:314-323`). `index.html:126` usa `min="1"` pero el servidor acepta monto > 0 (`server/groups.js:395-398`); `server/groups.js:399-401` no valida formato de fecha ni categorías nuevas, que aparecen en el chart pero no son filtrables; la fecha por defecto usa UTC (`app.js:652`). `apiGet` lanza `API ...: 500` y `apiPost/apiDelete` caen a `"Request failed"` (`app.js:102-130`); `loadExpenses()` solo hace `console.error` (`app.js:284-297`).
- **Impacto:** suma de balances que no cuadra, gastos chicos rechazados por el navegador, fechas que rompen el filtro por mes, pantallas con datos viejos o huecos sin explicación ni botón de reintento.
- **Splitwise:** nunca oculta centavos; errores en lenguaje natural con acción clara.
- **Recomendación:** mostrar 2 decimales cuando haya centavos (o redondear al guardar, decisión de producto); `min="0.01"`; reutilizar regex de fecha y lista de categorías; fecha local; traductor central de errores + banner "No pudimos cargar tus gastos. Reintentar".
- **Esfuerzo:** S.

### H12 — Accesibilidad, vocabulario y ruido de red — BAJO
- **Evidencia:** tabs sin `aria-selected`/`aria-controls` iniciales y paneles sin `aria-labelledby` (`index.html:95-108,112,193,206,221`); todos los botones de borrado se llaman "Eliminar" (`app.js:542`); badge muestra `admin`/`member` crudo (`app.js:351`); mensajes de error del servidor dicen "owner" cuando verifican `role === 'admin'` (`server/groups.js:197,233,268,311`); `global_role` se expone (`auth.js:177`, `app.js:136`) pero nunca se usa; `loadExpenses()` llama a `renderBalance()` **y** `renderBalances()` (`app.js:290-291`), que hacen el mismo GET (`app.js:553-558,304`).
- **Impacto:** lectores de pantalla sin estado de pestaña ni identificación del gasto a borrar; jerga en inglés; roles confusos; una request de balance duplicada por carga (riesgo de 429 con el límite de 60/min).
- **Splitwise:** controles con nombres descriptivos y estado anunciado; vocabulario consistente.
- **Recomendación:** completar ARIA, `aria-label="Eliminar gasto <descripción> <monto>"`, traducir roles a "administrador"/"miembro", unificar mensajes a "Admin del grupo", quitar una de las dos llamadas de balance.
- **Esfuerzo:** S.

## 4. Preguntas abiertas (decisiones de producto)

1. ¿Política al remover un miembro con deuda: marcarlo inactivo conservando splits (recomendado) o borrar/transferir sus gastos? (Define H1.)
2. ¿Los pagos son una funcionalidad prioritaria o quedan para el siguiente hito? (H2.)
3. ¿Los endpoints legacy `/api/expense`, `/api/expenses`, `/api/expense/:id` tienen consumidores reales? ¿Se pueden retirar? (H3.)
4. ¿Las tasas de cambio se migran al balance del grupo o son solo datos administrativos? ¿Quién las actualiza? (H5.)
5. ¿Se quiere soporte real de N miembros en el reparto custom, o el producto apunta a grupos de 2? (H9.)
6. ¿Los recurrentes generan gastos automáticamente o son recordatorios? ¿Qué hacemos con las filas legacy sin `user_id`? (H7.)
7. ¿Borrado físico definitivo por privacidad, o auditoría blanda con soft-delete y log? (H8.)
8. ¿Los filtros deben afectar también a balances y estadísticas o solo al historial? (H10.)
9. ¿Cambiar la moneda base de un grupo con histórico es operación soportada? ¿Cómo se convierten los gastos viejos? (H5.)
10. ¿Qué significa `global_role: 'admin'` para el usuario final: solo administración de tasas o debe mostrarse en el perfil? (H12.)

---

*Alcance: solo lectura. Los hallazgos H1, H2, H3, H4 y los defectos CSS/ID de H10 fueron verificados directamente por el agente principal contra el código. No se leyó ni se reprodujo ningún valor de `server/.env`. El servidor real sigue en `http://localhost:4000` sin cambios.*
