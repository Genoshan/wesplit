# Backlog de marketing / marca — WeSplit

> Hallazgos de la auditoría de copy del 2026-11-21, ordenados por prioridad.
> Rama de trabajo: `chore/marketing-copy-branding`.
> Estado: **P0 y P1 implementados localmente, pendientes de revisión**. P2 queda fuera de alcance.
> Alcance: **solo copy, microcopy y textos de estados**. Sin lógica, permisos, tema, dependencias ni marcador de versión.

## Criterios de prioridad

- **P0 — Alta:** rompe marca o frena el primer ingreso/registro. Riesgo nulo, esfuerzo S.
- **P1 — Media:** refuerza la promesa y hace la app más compartible. Esfuerzo S.
- **P2 — Fuera de alcance:** requiere decisión visual o cambia comportamiento real.

---

## P0 — Ejecutar primero

| ID | Pantalla | Texto actual → texto nuevo | Esfuerzo | Riesgo |
|---|---|---|---|---|
| MKT-01 | `<title>`, login, header | `Gastos Compartidos` → `WeSplit` (y eslogan `Dividí gastos, no discusiones`) | S | Ninguno |
| MKT-02 | Modal Crear cuenta | `Crear cuenta` → `Empezá en 30 segundos`; success → `¡Listo! Ya tenés tu grupo "Mis gastos". Ingresá para verlo.` | S | No cambia política de password |
| MKT-03 | Header del app | `+ Grupo` → `+ Nuevo grupo`; `Grupos` → `Elegir grupo`; `Invitaciones 1` → `1 invitación nueva` | S | No toca el selector con `#id`/miembros |
| MKT-04 | Balances | `Estado de cuentas` → `La cuenta limpia`; `Balances del grupo` → `Quién le debe a quién` | S | Ninguno |
| MKT-05 | Miembros e invitaciones | `Invitar miembro` → `+ Invitar a un amigo`; toast → `¡Listo! Ya sos parte de {grupo}.` | S | No toca permisos ni buscador |

**Orden sugerido:** MKT-01 → MKT-02 → MKT-03 → MKT-05 → MKT-04.
(MKT-05 va antes que MKT-04 porque es el loop de crecimiento: invitar trae usuarios nuevos.)

---

## P1 — Después

| ID | Pantalla | Texto actual → texto nuevo | Esfuerzo | Riesgo |
|---|---|---|---|---|
| MKT-06 | Gastos | `Agregar gasto` → `¿Qué querés registrar?`; CTA → `Guardar gasto`; preview → `La cuenta queda así: cada uno debe X. Sin calcular, sin discutir.` | S | La preview sigue dependiendo de datos reales |
| MKT-07 | Vacíos y errores | Swal `Error` → `No se pudo completar` + `Probá de nuevo en un segundo.`; alinear el alert de `+ Grupo` con MKT-03 | S | Ninguno |
| MKT-08 | Modales | `Crear` → `Crear grupo`; `Guardar cambios` → `Actualizar cuenta`; `Eliminar` → `Eliminar grupo` | S | No prometer borrado fácil en cuentas Google |
| MKT-09 | Estadísticas | `Análisis` → `En qué se va la plata`; `Distribución por categoría` → `Tu gasto, en partes` | S | Solo copy; los colores del chart quedan para P2 |

---

## P2 — Requiere decisión / otro PR

| ID | Hallazgo | Por qué no va acá |
|---|---|---|
| MKT-10 | Colores del doughnut (`#FF6384`, `#36A2EB`, …) no usan la paleta 3 | Cambiarlos obliga a revisar modo oscuro; tocaría `style.css`/`app.js` |
| MKT-11 | Bio de Instagram y hooks de Reels | Sonassets de contenido, no código de la app |
| MKT-12 | "Eliminar cuenta" en usuarios creados con Google | Hoy pide password aleatoria que nadie conoce; es una limitación real, no un texto |

---

## Posicionamiento acordado para el backlog

- Eslogan elegido: **Dividí gastos, no discusiones.**
- Bio sugerida: *Dividí gastos, no discusiones. Grupos, balances y pagos en un link.*

## Verificación local (2026-11-21)

- Servidor levantado con `PORT=4001 node index.js` (sin leer `.env` directamente).
- `BASE_URL=http://localhost:4001 npm test` → **25/25 tests** en 3 suites.
- Smoke funcional en navegador: login, modal de registro, header, tabs, toggle gasto/pago y modales de invitar, nuevo grupo y perfil → todos los textos nuevos se muestran correctamente.
- Cuenta temporal `qa_mkt_*` creada para el smoke y eliminada con `DELETE /api/profile` → 200. Servidor 4001 detenido.

## Reglas para la implementación

1. No crear PR sin aprobación explícita.
2. No leer ni exponer secretos / `.env`.
3. No cambiar dependencias, permisos, modo oscuro ni el marcador de versión (sigue en meta/DevTools/API, nunca en UI).
4. Cada ítem debe quedar con `git diff --check` limpio y sin texto nuevo que contradiga comportamiento real.
