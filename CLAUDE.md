# Contexto y Reglas de Trabajo

> Actualizado al 2026-11-20. La documentación ya NO vive exclusivamente en `.claude/docs/`; hay archivos importantes en la raíz, `context/`, `docs/`, `plans/` y `memory/`.

## Ubicación y Rutas

- **Directorio raíz del repo**: raíz del proyecto.
- **Rutas relativas**: usar siempre rutas relativas desde la raíz.
- **Verificación**: antes de reportar que un archivo no existe, confirmar con `dir <ruta>` o un glob.
- **Crear documentación donde corresponda**: `AGENTS.md`, `README.md`, `ROADMAP.md`, `REQUIREMENTS.md` y los archivos de personalidad están en la raíz. Las auditorías y planes van en `plans/`.

## Stack & Entorno

- **Backend**: Node.js + Express 5.x
- **Base de datos**: libSQL (`@libsql/client`) sobre `server/database.sqlite`
- **Frontend**: HTML/CSS/JS vanilla
- **Iniciar servidor**: `npm start` desde `./server/` (puerto 4000 por defecto)
- **Dev mode**: `npm run dev` (auto-reload)
- **Linting**: `npm run lint`
- **Sincronización**: `npm run sync`

## Reglas de Comportamiento

- Respuestas concisas enfocadas directamente en código.
- Leer de forma puntual los archivos necesarios; no volcar carpetas enteras de documentación.
- Ante dudas sobre el historial o errores, usar `git log -S "<termino>"`.
- No leer ni reproducir valores de `server/.env`.
- No hacer `git add`/`commit`/`push` sin autorización explícita.

## Ubicación de Documentos del Proyecto

| Documento | Ruta |
|---|---|
| Reglas de trabajo y estado real | `AGENTS.md` |
| Definición del proyecto | `context/project.md` |
| Roadmap vigente | `ROADMAP.md` |
| Requisitos de instalación | `REQUIREMENTS.md` |
| Flujo de carga de gastos | `docs/flow_diagram.md` |
| Auditoría de uso y decisiones | `plans/audit-uso-resultado.md` |
| Prompt reutilizable de auditoría | `plans/audit-uso-splitwise.md` |
| Diseño del login con Google | `plans/sdd-google-oauth.md` |
| Decisiones arquitectónicas | `.localcode/DECISIONS.md` |
| Estado de sesión | `.localcode/SESSION.md` |
| Bitácora cronológica | `memory/BITACORA.md` |
| Índice de memoria | `memory/MEMORY.md` |

Nota: `.claude/docs/` solo contiene una copia antigua del roadmap. `docs/STATE.md`, `context/decisions.md`, `.localcode/ROADMAP.md` y `.claude/docs/troubleshooting.md` **no existen**.

## Mapeo de Documentación Bajo Demanda

- Roadmap y requisitos: `ROADMAP.md`, `REQUIREMENTS.md`
- Estado y decisiones: `.localcode/SESSION.md`, `.localcode/DECISIONS.md`
- Historial: `memory/BITACORA.md`, `memory/MEMORY.md`
- Auditorías: `plans/audit-uso-resultado.md`
