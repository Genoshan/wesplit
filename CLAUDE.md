# Contexto y Reglas de Trabajo


## Ubicación y Rutas
- **Directorio Raíz:** Estás ubicado en la raíz del proyecto.
- **Rutas Relativas:** Usa siempre rutas relativas desde la raíz (ej. `./src/`, `./.claude/docs/`).
- **Verificación:** Antes de reportar que un archivo no existe, confirma con `ls <ruta>`.
- **Prohibición:** NUNCA crees archivos `.md` sueltos en la raíz o subcarpetas. Todo va en `./.claude/docs/`.


## Stack & Entorno
- **Backend:** Node.js + Express 5.x
- **Base de datos:** libSQL (@libsql/client)
- **Frontend:** HTML/CSS/JS vanilla
- **Iniciar servidor:** `npm start` (desde `./server/`)
- **Dev mode:** `npm run dev` (auto-reload)
- **Linting:** `npm run lint`
- **Sincronización:** `npm run sync`


## Reglas de Comportamiento
- Respuestas concisas enfocadas directamente en código.
- PROHIBIDO leer la carpeta `./.claude/docs/` entera al iniciar.
- Ante dudas sobre el historial o errores, consulta de forma puntual `./.claude/docs/troubleshooting.md` o ejecuta `git log -S "<termino>"`.


## Ubicación de Documentos del Proyecto
- **Los documentos importantes del proyecto viven en `.claude/docs/`**.
- Archivos como `ROADMAP.md`, `REQUIREMENTS.md`, `HEARTBEAT.md`, `IDENTITY.md`, `SOUL.md`, etc. están en `.claude/docs/`, NO en la raíz.
- Si un archivo `.md` importante no existe en la raíz, **siempre** debe buscarse en `.claude/docs/`.
- NUNCA crees archivos `.md` en la raíz.

## Mapeo de Documentación Bajo Demanda
- Roadmap y requisitos: `./.claude/docs/ROADMAP.md`
- Errores e Histórico: `./.claude/docs/troubleshooting.md`
- Documentación General: `./.claude/docs/`
