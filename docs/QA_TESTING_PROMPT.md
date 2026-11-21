# Prompt de QA Testing — WeSplit

> Copiá este prompt completo a un agente/tester. Objetivo: validar **casos de uso completos** de la app, no solo endpoints aislados.

---

## Rol y objetivo

Sos el QA engineer de **WeSplit** (app web de gastos compartidos, frontend vanilla + Bootstrap 5.3, backend Express 5 + libSQL/SQLite).

Tu tarea es ejecutar una **revisión end-to-end** de todas las funcionalidades que ofrece el proyecto, reportando fallos con evidencia y severidad. No modifiques código de producción: limitate a probar y reportar. Si encontrás un bug, no lo arregles; documentalo.

**Fuente de verdad:** el código (`index.html`, `app.js`, `style.css`, `server/*.js`). Los documentos `docs/flow_diagram.md` y `context/project.md` están actualizados a "Mis gastos", invitaciones con aceptación, fechas validadas y moneda única por grupo. Para un recorrido guiado con dos usuarios reales, usá también `docs/E2E_DOS_USUARIOS.md`.

## Reglas obligatorias

1. **Nunca** leas ni muestres `server/.env`, tokens, contraseñas ni secretos. Usá cuentas de prueba descartables.
2. **No** hagas push, merge, PR ni cambios de dependencias/versiones sin autorización explícita.
3. **No** pruebes sobre datos reales del usuario. Si usás el navegador del usuario, solo lectura; para escritura usá un contexto/tab aislado y cuentas `qa_*`.
4. Respetá los límites: global 60 req/min, login 100/15 min, register/profile 10/15 min. Si aparece `429`, esperá o continuá con otro bloque; no reintentés en bucle.
5. Al terminar, **eliminá** todas las cuentas y grupos de prueba (`DELETE /api/profile` con contraseña actual) y cerrá las pestañas que abriste.
6. Todo hallazgo debe incluir: **ID único**, pasos para reproducir, resultado esperado, resultado real, evidencia (texto/estado HTTP/console), severidad (Crítico/Alto/Medio/Bajo) y archivo:línea probable.

## Entorno

```powershell
cd H:\Samsung 850 EVO - SSD\wesplit\server
npm test                 # requiere el server corriendo en :4000
node index.js            # si no está corriendo
```

- URL local: `http://localhost:4000`
- Herramientas disponibles: MCP `browser` (browser aislado) y `browse` (Chrome del usuario), `shell`, `fetch`.
- Tests automáticos existentes: `server/tests/payment.int.test.js` (9 casos) y `server/tests/expense.int.test.js` (9 casos). Total 18/18.

---

## Matriz de casos de uso

### 1. Autenticación y cuenta

| ID | Caso | Pasos | Esperado |
|---|---|---|---|
| AUTH-01 | Registro manual válido | Registrar usuario con password de 12+ caracteres | 200, grupo automático "Mis gastos" creado |
| AUTH-02 | Validaciones | Password de 11, username de 2, email sin `@` | 400 con mensaje específico |
| AUTH-03 | Duplicados | Repetir username y luego email (distinto username) | 409 |
| AUTH-04 | Login/logout | Login correcto, `/api/auth/check`, logout, re-check | Cookie HttpOnly; check 200 antes, 401 después |
| AUTH-05 | Google | `GET /api/google/config`; si `enabled`, probar init/callback (sin credentials reales, solo verificar que no exponer secrets) | Config booleano; flujo sin errores sin estado/ nonce inválidos |
| AUTH-06 | Perfil | `PUT /api/profile` cambiar nombre/email/password; luego login con la nueva password | Cambios persistentes; password vieja falla |
| AUTH-07 | Perfil sin cambios | Guardar sin modificar nada | Mensaje "Sin cambios", sin mutación |
| AUTH-08 | Eliminar cuenta | Crear datos, borrar cuenta con password correcta e incorrecta | Incorrecta → 403; correcta → 200, datos en cascada |
| AUTH-09 | Rate limits | Disparar register 11 veces seguidas | 429 con mensaje en español |

### 2. Grupos

| ID | Caso | Pasos | Esperado |
|---|---|---|---|
| GRP-01 | Crear grupo | `+ Grupo` → nombre + moneda (UYU/USD/EUR/ARS/BRL) → Crear | Grupo nuevo seleccionado, badge actualizado |
| GRP-02 | Validar moneda | API con moneda de 2 o 4 letras | 400 |
| GRP-03 | Cambiar grupo | Seleccionar otro grupo en el dropdown | Se recargan gastos, pagos, balances, miembros |
| GRP-04 | Persistencia | Recargar la página con un grupo no-default seleccionado | La selección se restaura desde `localStorage['seg_group']`. |
| GRP-05 | Editar grupo (admin) | `PUT /api/groups/:id` con nombre/moneda | 200 |
| GRP-06 | Editar grupo (no admin) | Lo mismo con miembro | 403 "Solo el owner puede editar el grupo" |
| GRP-07 | Eliminar grupo | Menú usuario → Eliminar grupo → confirmar en modal | Redirige a otro grupo; sin registros huérfanos |
| GRP-08 | Último grupo | Eliminar el único grupo | UI sin crash; estados vacíos controlados |

### 3. Miembros e invitaciones

| ID | Caso | Pasos | Esperado |
|---|---|---|---|
| MEM-01 | Invitar usuario existente | Miembros → Invitar miembro → username exacto | Mensaje de invitación enviada; fila "Invitación pendiente" |
| MEM-02 | Sugerencias | Escribir 1 y 2+ letras en `#invite-username` | 1 letra no busca; 2+ muestra datalist |
| MEM-03 | Usuario inexistente | Invitar username no registrado | Error "El usuario debe registrarse primero" |
| MEM-04 | Auto-invitación / duplicado | Invitarse; invitar a alguien ya activo o pendiente | 400 |
| MEM-05 | Aceptar invitación | Usuario invitado → pestaña Miembros → Aceptar | Estado active, grupo aparece en su dropdown |
| MEM-06 | Rechazar / cancelar | Rechazar invitación y cancelar como admin | Invitación desaparece (404 al reintentar) |
| MEM-07 | IDOR invitaciones | Aceptar/rechazar la invitación de otro usuario | 404 |
| MEM-08 | Dar de baja / reactivar | Admin da de baja a un miembro; verifica balances; reactiva | Estado inactive, historial/balances conservados; reactivación 200 |
| MEM-09 | Último admin | Intentar dar de baja al último admin activo | 400 |
| MEM-10 | Auto-remoción | Admin intenta removerse a sí mismo | 400 |

### 4. Gastos (CRUD + reparto)

| ID | Caso | Pasos | Esperado |
|---|---|---|---|
| EXP-01 | Gasto simplest | Un miembro, `equal`, monto 100,50, fecha válida | Aparece en historial con moneda del grupo y "Pagaste" |
| EXP-02 | Reparto equal con resto | Monto 0,01 entre 3 miembros | Suma de partes exacta (centavos distribuidos) |
| EXP-03 | Reparto solo | Payer distinto del usuario actual | Toda la parte al pagador |
| EXP-04 | Reparto custom | Partes que suman exacto, +1 cent, +2 cents | Exacto y +1 → OK; +2 → "Reparto incompleto" |
| EXP-05 | Custom inválido | Parte negativa, duplicada, miembro inexistente | 400 |
| EXP-06 | Montos inválidos | 0, negativo, `NaN`, string, más de 2 decimales vía API | 400 (o documentar si acepta >2 decimales) |
| EXP-07 | Fechas | API con fecha "no-fecha"; UI con `date-from > date-to` | API devuelve 400 (`isValidDateString`); UI muestra "sin coincidencias" para el rango invertido |
| EXP-08 | Editar gasto | Modal → cambiar monto/descripción/categoría/pagador/reparto | Historial y balances se recalculan |
| EXP-09 | Eliminar gasto | Confirmar y cancelar el Swal | Confirmar borra gasto y sus splits; cancelar no muta |
| EXP-10 | Doble submit | Doble click rápido en "Agregar gasto" | Solo un gasto creado |
| EXP-11 | Payer inactivo | Editar gasto cuyo pagador está inactivo | No se pierde el historial |

### 5. Pagos y balances

| ID | Caso | Pasos | Esperado |
|---|---|---|---|
| PAY-01 | Pago válido | `Cambiar a Pago` → monto, fecha, De, Para, descripción → Registrar | Fila en "Historial de pagos" con "De → Para" |
| PAY-02 | Monto/fecha inválidos | Negativo, auto-pago, fecha `2026-99-99` | 400 |
| PAY-03 | Participantes | Usuario inexistente, inactivo o pending como De/Para | 400 |
| PAY-04 | Grupo de un miembro | Abrir formulario de pago en "Mis gastos" | Submit deshabilitado |
| PAY-05 | Balance | Pagar 30 de A a B | A: "le deben 30"; B: "debe 30" |
| PAY-06 | Eliminar pago | Confirmar / cancelar Swal | Balance vuelve al estado anterior; cancelar no muta |
| PAY-07 | Moneda | Pago con `currency` distinta en el body | Se ignora el body: se almacena y muestra la `base_currency` del grupo |
| PAY-08 | Autorización | Pago en grupo ajeno, sin sesión | 403 / 401 |

### 6. Filtros, exportación y estadísticas

| ID | Caso | Esperado |
|---|---|---|
| FLT-01 | Búsqueda por descripción (mayúsculas/minúsculas) | 1 coincidencia |
| FLT-02 | Búsqueda sin coincidencias | "No hay gastos que coincidan con los filtros" |
| FLT-03 | Filtro por categoría y pagador | Resultados correctos |
| FLT-04 | Filtro por mes y por rango de fechas | Inclusivo; rango invertido → sin resultados |
| FLT-05 | Los filtros no afectan balances ni estadísticas | Montos totales se mantienen |
| CSV-01 | `Exportar CSV` | Descarga `wesplit-{groupId}-{fecha}.csv` con gastos y pagos |
| CSV-02 | Inyección de fórmulas | Descripción `=SUM(1+1)` → se exporta como `'=SUM(1+1)` (prefijo `'` en valores que empiezan con `=`, `+`, `-` o `@`) |
| STAT-01 | Chart de categorías | Doughnut con datos de todos los períodos |
| STAT-02 | Sin gastos | Estado vacío, sin error en consola |

### 7. UI, tema y accesibilidad

| ID | Caso | Esperado |
|---|---|---|
| UI-01 | Toggle de tema | Botón 🌙/☀️ fuera del dropdown, al lado de `+ Grupo`; `title`/`aria-label` cambian |
| UI-02 | Persistencia | Recargar mantiene el tema (`localStorage['seg_theme']`) |
| UI-03 | Claro | Paleta 3: fondo `rgb(254,254,254)`, texto `rgb(36,48,58)`, primario `rgb(39,201,92)`, éxito `rgb(30,94,78)`; botones usan `--bs-btn-*` con esos colores |
| UI-04 | Oscuro | Body `rgb(26,29,33)`, card `rgb(36,40,48)`, acento `rgb(255,101,47)` |
| UI-05 | Contraste | Placeholder "Buscar..." legible en ambos temas (`--bs-secondary-color`) |
| UI-06 | Tablas en oscuro | Encabezado `rgb(232,233,234)` sobre `rgb(26,29,33)` (no letras negras) |
| UI-07 | Dark Reader | `<meta name="darkreader-lock">` evita que la extensión oscurezca el tema claro |
| UI-08 | Responsive | 375px, 768px, 1440px sin overflow horizontal |
| UI-09 | Consola | Sin errores JS ni warnings de Bootstrap/SweetAlert2 |

### 8. Seguridad y API

| ID | Caso | Esperado |
|---|---|---|
| SEC-01 | Static allowlist | `/server/.env`, `/server/index.js`, `/package.json` → 404; `/style.css` → 200 |
| SEC-02 | XSS | `<img src=x onerror=alert(1)>` en nombre de grupo, descripción, username | Se muestra como texto (`escapeHtml`) |
| SEC-03 | SQL injection | `' OR 1=1--` en búsqueda de usuarios / descripción | Sin filtrado indebido |
| SEC-04 | LIKE wildcards | Buscar `%` → reportar si devuelve todos los usuarios |
| SEC-05 | Body size | Payload >100 kb | 413 |
| SEC-06 | CSP/SRI | Cabeceras Helmet y atributos `integrity` presentes |
| SEC-07 | Sesión | Cookie expirada / usuario borrado → 401 |

---

## Formato de reporte

```markdown
# QA Review — YYYY-MM-DD

## Resumen
- Casos ejecutados: X | Pass: Y | Fail: Z | Bloqueados: W
- Severidad: Crítico N / Alto N / Medio N / Bajo N

## Hallazgos
### [QA-001] Título corto (Alto)
- Pasos: 1) ... 2) ...
- Esperado: ...
- Real: ...
- Evidencia: HTTP 403 / consola / estilo computado ...
- Ubicación probable: app.js:123 / server/groups.js:456

## Casos cubiertos
(lista de IDs con ✅/❌)

## Limpieza
- Cuentas eliminadas: ...
- Pestañas cerradas: sí/no
```

## Priorización sugerida

1. **P0**: auth, autorización/IDOR, pérdida de datos en cascada, cálculo de balances.
2. **P1**: splits (centavos), pagos, edición/eliminación, toggles de confirmación.
3. **P2**: filtros, CSV, gráfico, responsive, contraste de tema.
4. **P3**: rate limits, wildcards de búsqueda, inyección CSV.
