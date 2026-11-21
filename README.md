# wesplit

Gastos compartidos con grupos dinámicos: N miembros por grupo, moneda única, reparto exacto en centavos, balances por miembro, invitaciones con aceptación y baja lógica de participantes.

> Estado al 2026-11-20: rama `feature/dynamic-groups`. PR a `main` pendiente. Sin `push` ni PR automatizados sin autorización explícita.

## Ejecutar

```bash
cd server
npm install
npm start          # http://localhost:4000
```

El frontend es estático (`index.html`, `app.js`, `style.css`) servido por el propio Express. La base de datos es SQLite/Turso local; la configuración sensible vive en `server/.env` (no versionado).

## Documentación

- [ROADMAP.md](ROADMAP.md) — estado actual y pendientes del producto.
- [REQUIREMENTS.md](REQUIREMENTS.md) — requerimientos funcionales y técnicos.
- [TODO_BACKLOG.md](TODO_BACKLOG.md) — tareas resueltas, diferidas y descartadas.
- [context/project.md](context/project.md) — contexto para agentes.
- [AGENTS.md](AGENTS.md) / [CLAUDE.md](CLAUDE.md) — reglas de trabajo en el repositorio.
- [docs/flow_diagram.md](docs/flow_diagram.md) — flujo de la aplicación.
- [plans/audit-uso-resultado.md](plans/audit-uso-resultado.md) — auditoría de UX y estado de cada hallazgo.
- [plans/sdd-google-oauth.md](plans/sdd-google-oauth.md) — diseño original de Google OAuth (implementado con desvíos).
- [.localcode/SESSION.md](.localcode/SESSION.md) / [memory/BITACORA.md](memory/BITACORA.md) — continuidad entre sesiones.

## Decisiones vigentes

- Grupo personal: **Mis gastos**. Grupos compartidos: los nombra el usuario.
- Invitación por username con normalización y sugerencias; aceptación dentro de la app, sin link con token.
- Miembros inactivos conservan historial y balances; se pueden reactivar.
- Moneda única por grupo. Recurrentes y tasas de cambio eliminados.
- `global_role` se conserva como dato informativo, sin backoffice.
- Settle up y cotización diaria quedan diferidos.
