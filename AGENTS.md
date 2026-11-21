# AGENTS.md - WeSplit (Gastos compartidos)

Aplicación web de gastos compartidos inspirada en Splitwise. Multiusuario, con grupos dinámicos y N miembros reales.

## Stack Técnico

- **Frontend**: HTML, CSS (custom properties), Vanilla JS
- **Backend**: Node.js con Express 5
- **Base de datos**: libSQL (`@libsql/client`) sobre `server/database.sqlite`
- **Puerto**: 4000 por defecto (`server/index.js:17`)

## Reglas del Proyecto

1. **Una historia a la vez** — no implementar múltiples funcionalidades en una iteración
2. **La app ya no es un MVP de dos personas** — tiene registro/login y grupos (ver "Estado real")
3. **Modos de reparto**: `equal`, `solo`, `custom`; `evenSplits()` reparte centavos exactos entre N miembros
4. **Simplicidad sobre complejidad** — evitar refactorizaciones innecesarias o lógica compleja
5. **No inferir requerimientos no expresados**
6. **Siempre crear rama antes de implementar** — rama `feature/<nombre>`; NUNCA modificar `main` directamente
7. **Sin `git add`/`commit`/`push` sin autorización explícita**
8. **No leer ni reproducir valores de `server/.env`** (secretos)

## Estado real (verificado 2026-11-20)

- **Autenticación**: registro con username/email/password (mínimo 12 caracteres, `bcryptjs` con rehash transparente del formato legacy) y Google OAuth. La allowlist `GOOGLE_AUTHORIZED_EMAILS` está **comentada** en `.env` → entra cualquier email de Google verificado.
- **Grupos**: cada registro crea su propio grupo `Mis gastos` con el creador como admin. Un usuario puede pertenecer a varios grupos, elegir cuál usar y la selección persiste en `localStorage['seg_group']`.
- **Invitación**: por username con normalización y sugerencias; aceptación/rechazo dentro de la app, sin link con token.
- **Roles**: `users.global_role` (admin/member global) y `group_members.role` (admin/member por grupo) son independientes.
- **Frontend**: pestañas Gastos / Balances / Estadísticas / Miembros; temas claro/oscuro; SRI en CDNs + CSP; sin handlers inline.
- **API**: `server/index.js` (`/api/version`, `/api/register`, `/api/login`, `/api/logout`, `/api/profile`, `/api/auth/check`, `/api/google/*`, `/api/users/search`) y `server/groups.js` (`/api/groups/:id`, `/expenses`, `/balance`, `/payments`, `/members`, `/invitations`). No existen `/api/currencies` ni `/api/expenses`.
- **Endpoints legacy eliminados**: `/api/expenses`, `/api/expense/:id` (GET/POST/PUT/DELETE) y el helper `resolveLegacyPayer` ya no existen.
- **Moneda única por grupo**: se eliminaron la tabla `currencies`, el seed de tasas y sus endpoints; el alta de gasto usa siempre `base_currency` del grupo.
- **Recurrentes eliminados**: sin rutas, tabla ni CSS.
- **Grupo personal**: se llama "Mis gastos" (creado al registrar; migración única para grupos legacy con un solo miembro). El default se ordena por fecha de creación.
- **Invitación**: normaliza mayúsculas/espacios y ofrece sugerencias vía `GET /api/users/search?q=`.
- **Settle up**: pagos del grupo integrados con UI, historial, exportación CSV y descuento en balances; la moneda es siempre la `base_currency` del grupo.
- **Lote M implementado**: miembros inactivos (con historial y reactivación), edición de gasto con modal, splits personalizados para N miembros y aceptación de invitaciones.

## Flujo de Desarrollo

1. Analizar el estado actual
2. Explicar la solución propuesta
3. Indicar qué archivos se modificarán
4. Esperar aprobación
5. Implementar
6. Verificar que el proyecto sigue funcionando
7. Actualizar `.localcode/SESSION.md` si cambió el estado de implementación

## Estructura del Proyecto

```
wesplit/
├── index.html          # Interfaz principal
├── app.js              # Lógica frontend (apiGet/apiPost, render, tabs)
├── style.css           # Estilos, temas claro/oscuro
├── server/
│   ├── index.js        # API de auth, Google, monedas, versión
│   ├── groups.js       # API de grupos, gastos, miembros, balances, pagos
│   ├── auth.js         # sesiones, OAuth, getUserGroups
│   ├── database.js     # esquema libSQL, migraciones one-shot, seed
│   ├── password.js     # bcryptjs + rehash legacy
│   └── database.sqlite # Datos persistentes
├── context/project.md  # Definición del proyecto (actualizada)
├── docs/flow_diagram.md# Flujo de carga de gastos (actualizado)
├── plans/              # SDD, auditorías y prompts de auditoría
├── memory/             # MEMORY.md, BITACORA.md, logs diarios
├── .localcode/         # SESSION.md, DECISIONS.md (NO hay ROADMAP.md aquí)
└── ROADMAP.md          # Roadmap vigente (raíz)
```

## Comandos Útiles

```bash
# Instalar dependencias
cd server && npm install

# Iniciar servidor
cd server && npm start

# Verificar puerto
netstat -ano | findstr :4000
```

## Sistema de Memoria y Bitácora

### Archivos de Memoria
- `memory/MEMORY.md` — Índice principal de memoria
- `memory/BITACORA.md` — Registro cronológico de sesiones
- `.localcode/SESSION.md` — Estado actual del proyecto
- `.localcode/DECISIONS.md` — Decisiones arquitectónicas

### Flujo de Bitácora (Checkpoint Automático)

**AL INICIO de cada sesión:**
1. Leer `memory/BITACORA.md` para entender el contexto anterior
2. Leer `.localcode/SESSION.md` para saber el estado actual
3. Saludar al usuario con el contexto recuperado

**DURANTE la sesión (checkpoint incremental):**
- Después de cada commit, cambio importante o decisión → actualizar BITACORA.md
- No esperar a que el usuario pregunte
- No esperar al "final" de la sesión
- Patrón: checkpoint como WAL en bases de datos

**SI el usuario se despide o la sesión termina:**
1. Actualizar BITACORA.md con resumen final
2. Actualizar SESSION.md con estado actual
3. Actualizar MEMORY.md si hay cambios estructurales

**REGLAS CRÍTICAS:**
- Checkpoint después de cada acción relevante — no esperar al final
- NUNCA preguntar "¿actualizo la bitácora?" — SIEMPRE hacerlo
- NUNCA preguntar "¿creo el archivo?" — crearlo directamente
- SI el usuario se despide, activar protocolo de cierre automáticamente

### Ejemplo de Entrada
```markdown
## [2026-07-25] Nombre de la Sesión

### Contexto
- Qué se estaba haciendo antes

### Cambios realizados
- Archivo A: se modificó X
- Archivo B: se creó Y

### Decisiones tomadas
- Se decidió X porque Y
- Alternativa descartada: Z

### Estado final
- Funcionalidad X implementada
- Falta: Y

### Notas para próxima sesión
- Retomar con Y
```

## Referencias

- Estado actual: `.localcode/SESSION.md`
- Decisiones: `.localcode/DECISIONS.md`
- Bitácora: `memory/BITACORA.md`
- Roadmap: `ROADMAP.md`
- Auditoría de uso: `plans/audit-uso-resultado.md`
