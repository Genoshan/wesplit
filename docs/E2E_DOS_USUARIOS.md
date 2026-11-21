# E2E para dos personas — WeSplit

> Recorrido manual para validar la app **de punta a punta** con dos cuentas reales.
> Pedile a un amigo que haga el rol **B** vos hacé el rol **A**.
> URL: **https://wesplit-k5rc.onrender.com/**

---

## Antes de empezar (importante)

1. Usen **navegadores distintos** o una ventana normal + una incógnito, para no mezclar sesiones.
2. Usen **usuarios de prueba descartables** (ej. `e2e_tu_nombre` y `e2e_amigo`) con contraseñas de **12+ caracteres**. No usen emails reales.
3. No hagan Many intentos seguidos: registro y perfil están limitados a **10 por 15 min**; login a **100 por 15 min**; API en general a **60 por minuto**.
4. Cada caso tiene **ID**, quién lo ejecuta y qué tienen que ver ambos. Si algo falla, anotá el ID, qué esperabas y qué pasó (con captura o texto del mensaje).
5. Al final, hagan el **caso 12 (limpieza)** para no dejar datos de prueba.

---

## Caso 1 — Alta de cuentas

| | |
|---|---|
| **A** | Registrate: `Crear cuenta nueva` →Nombre completo, Username, Contraseña (12+), Email → `Crear cuenta`. |
| **B** | Lo mismo, con otro username y otro email. |
| **Esperado** | Ingresan al tablero. En el selector de grupo aparece **Mis gastos** (se crea automáticamente). El badge al lado del título muestra ese grupo. |
| **Extra** | Cierren sesión (`dropdown del usuario → 🚪 Salir`) y vuelvan a entrar con usuario/contraseña. Debe funcionar. |

## Caso 2 — Grupo compartido

| | |
|---|---|
| **A** | `+ Grupo` → nombre `Viaje E2E`, moneda base `UYU` → `Crear`. |
| **A** | Recargá la página (F5). |
| **Esperado** | Sigue seleccionado **Viaje E2E** (la elección se guarda en el navegador). El badge del header muestra el grupo nuevo. |

## Caso 3 — Invitación y aceptación

| | |
|---|---|
| **A** | Pestaña **Miembros** → `Invitar miembro`. Escribí las primeras letras del username de B: deben aparecer sugerencias al escribir **2 o más letras** (con 1 no). Elegí el username exacto → `Invitar`. |
| **A** | Esperado: mensaje «📨 Invitación enviada. El usuario debe aceptarla desde la pestaña Miembros.» y una fila de invitación pendiente. |
| **B** | Recargá. En el header debe aparecer el botón **Invitaciones** con un badge. Entrá a **Miembros** → botón `Aceptar`. |
| **A** | Recargá **Miembros**. El username de B debe figurar como activo (sin badge «Pendiente»). |
| **B** | El selector de grupo ahora debe mostrar **Viaje E2E** además de Mis gastos. Seleccionalo. |
| **Esperado** | Ambos están en el mismo grupo y cada uno ve los mismos datos. |

## Caso 4 — Gasto con partes iguales

| | |
|---|---|
| **A** | En **Gastos**: Fecha = hoy, Descripción = `Cena`, Monto = `100`, Categoría = `Alimentación`, Pagó = `Vos`, Split = `Partes iguales` → `Agregar gasto`. |
| **A** | Esperado: el desglose muestra 50 / 50. Aparece `Cena` en el historial con moneda UYU. |
| **B** | Recargá. Debe ver el mismo gasto `Cena` en el historial de **Viaje E2E**. |
| **A y B** | Pestaña **Balances**: A ve «le deben 50», B ve «debe 50» (montos en UYU). |

## Caso 5 — Reparto «Solo pagué yo» y centavos exactos

| | |
|---|---|
| **A** | Gasto `Taxi`, monto `10.01`, Split = `Solo pagué yo` → `Agregar gasto`. |
| **A** | Esperado: el desglose muestra todo para A. Los balances **no cambian** (A sigue con 50, B con 50). |
| **A** | Gasto `Desayuno`, monto `10`, Split = `Montos exactos`: poné `6` al primero y `4` al segundo → `Agregar gasto`. |
| **A** | Probá ahora `6.01` y `4`: debe aparecer el aviso **«Reparto incompleto»** y no se crea el gasto. Corregilo a `6`/`4` y recién ahí agregalo. |
| **A** | Borrá `Desayuno` (botón Eliminar del historial). Quedan `Cena` y `Taxi`. |

## Caso 6 — Editar gasto y recalcular

| | |
|---|---|
| **A** | En el historial, botón **Editar** de `Cena` → cambiá el monto a `80` → `Guardar cambios`. |
| **A y B** | Esperado: el historial muestra 80 y los balances pasan a **40** (A: «le deben 40», B: «debe 40»). El modal aclara que se muestran miembros inactivos para conservar el historial. |

## Caso 7 — Pago entre miembros

| | |
|---|---|
| **B** | Botón **Cambiar a Pago** (arriba del formulario). Monto `40`, Fecha = hoy, De = B, Para = A, Descripción = `Pago de prueba` → `Registrar pago`. |
| **A y B** | Esperado: aparece una fila en **Historial de pagos** con «De B → Para A» y monto 40 UYU. El cartel del formulario dice que la moneda es la del grupo. |
| **A y B** | Pestaña **Balances**: ambos deben decir **al día**. |
| **B** | Eliminá el pago (botón Eliminar de la tabla) → los balances vuelven a 40. Volvé a registrarlo para dejarlo al día. |

## Caso 8 — Filtros, CSV y estadísticas

| | |
|---|---|
| **A** | En `Buscar...` escribí `cena` en minúsculas → debe aparecer solo `Cena`. |
| **A** | Buscá `zzzz` → mensaje «No hay gastos que coincidan con los filtros». |
| **A** | Probá el filtro por categoría `Alimentación`, por pagador y por mes. |
| **A** | Poné **Fecha desde** mayor que **Fecha hasta** → sin resultados (no error). |
| **A** | Borrá los filtros y confirmá que **Balances** y **Estadísticas** siguen mostrando todos los datos (los filtros solo afectan al historial). |
| **A** | `Exportar CSV` → se descarga un archivo `wesplit-<id>-<fecha>.csv` con gastos y pagos. |
| **A** | Pestaña **Estadísticas** → el doughnut por categoría se dibuja sin errores. |

## Caso 9 — Tema, sesión y persistencia

| | |
|---|---|
| **A** | Botón 🌙 al lado de `+ Grupo` (fuera del menú del usuario). Al tocarlo debe pasar a ☀️ y el fondo a oscuro; al volver, a claro con verde `#27c95c`. |
| **A** | Recargá: se mantiene el tema elegido **y** el grupo **Viaje E2E**. |
| **B** | Elegí el tema opuesto. Cada navegador debe recordar el suyo, sin afectar al otro. |
| **Ambos** | Abran DevTools → Console: debe aparecer `WeSplit v1.0.0 · <commit> · main` y **ningún error JS**. |

## Caso 10 — Baja y reactivación de miembro

| | |
|---|---|
| **A** | Pestaña **Miembros** → `Dar de baja` al usuario B → confirmar. |
| **A** | Esperado: B aparece con badge **Inactivo**. El historial y los balances se conservan (no se pierde `Cena`). |
| **A** | Intentar dar de baja otra vez no debe estar disponible; en su lugar aparece `Reactivar`. Tocarlo → B vuelve a activo. |
| **B** | Recargá y confirmá que sigue viendo el grupo y el historial. |

## Caso 11 — Aislamiento entre grupos

| | |
|---|---|
| **B** | Creá un grupo propio `Privado B` y cargá un gasto de `999`. |
| **A** | Recargá y revisá su selector de grupos: **no debe aparecer** `Privado B` ni el gasto de 999. |
| **B** | Volvé a `Viaje E2E` y confirmá que siguen los datos compartidos. |

## Caso 12 — Limpieza (no saltear)

1. **B**: salí del grupo compartido si podés; si no, el admin lo elimina.
2. **A**: dropdown del usuario → `🗑️ Eliminar grupo actual` sobre `Viaje E2E` → confirmar.
3. **B**: borrá `Privado B` igual.
4. **Ambos**: `⚙️ Mi perfil` → completá la contraseña actual → eliminar cuenta.
5. Verificá que al querer entrar con esos usuarios ya no se pueda.

---

## Cómo reportar un hallazgo

```markdown
ID: E2E-03
Caso: Aceptación de invitación
Quién lo vio: B
Esperado: el botón Invitaciones muestra el badge y aparece Aceptar
Real: el botón no aparece tras recargar
Evidencia: captura / mensaje de consola / HTTP 404
```

Si querés, pegame acá los resultados y armamos el informe con severidad y pasos de reproducción.
