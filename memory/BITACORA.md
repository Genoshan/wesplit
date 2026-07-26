# Bitácora del Proyecto

Este archivo contiene el registro cronológico de cambios y decisiones relevantes para mantener continuidad entre sesiones.

## Formato

Cada entrada debe seguir este formato:

```markdown
## [YYYY-MM-DD] Título de la sesión

### Contexto
- Qué se estaba haciendo
- Estado anterior

### Cambios realizados
- Archivos modificados
- Funcionalidades implementadas

### Decisiones tomadas
- Qué se decidió y por qué
- Alternativas descartadas

### Estado final
- Qué quedó funcionando
- Qué falta pendiente

### Notas para próxima sesión
- Puntos a retomar
- Contexto para continuar
```

---

## [2026-07-25] Sistema de memoria unificado

### Contexto
- El proyecto tenía dos sistemas de memoria paralelos: `.localcode/` y `memory/`
- Existía duplicación entre archivos (project-rules.md y tech-stack.md repetían AGENTS.md)
- No había un flujo claro de cómo el agente debe mantener la bitácora

### Cambios realizados
- **Creado** `AGENTS.md` en raíz con reglas del proyecto (OpenCode nativo)
- **Actualizado** `CLAUDE.md` para importar `@AGENTS.md` con extras para Claude Code
- **Reescrito** `memory/MEMORY.md` como índice limpio
- **Eliminados** `memory/project-rules.md` y `memory/tech-stack.md` (duplicaban AGENTS.md)
- **Creado** `memory/BITACORA.md` con plantilla para registro de sesiones
- **Creado** PR #6 y mergeado a main

### Decisiones tomadas
- **Modelo de memoria**: Seguir el enfoque nativo de OpenCode (`AGENTS.md`) + Claude Code (`CLAUDE.md` con `@AGENTS.md`)
- **Eliminar duplicación**: Unificar reglas del proyecto en un solo archivo (`AGENTS.md`)
- **Bitácora con checkpoint**: El agente debe actualizar `memory/BITACORA.md` incrementalmente después de cada acción relevante (patrón WAL/checkpoint)

### Estado final
- Sistema de memoria unificado funcionando
- PR #6 mergeado: https://github.com/Genoshan/wesplit/pull/6
- Estructura limpia y sin duplicaciones

### Notas para próxima sesión
- Probar que el sistema de memoria funciona (que el agente lea AGENTS.md y memory/)
- El servidor estaba corriendo en puerto 3000 (PID 20376) - verificar si sigue activo

---

## [2026-07-25] Sistema de checkpoint automático (WAL)

### Contexto
- Habíamos implementado el sistema de memoria unificado
- El usuario preguntó cómo saber cuándo es el "final" de una sesión
- Problema: si la sesión se corta (red, etc), se pierde el contexto

### Cambios realizados
- **Actualizado** `CLAUDE.md` con patrón de checkpoint incremental
- **Actualizado** `AGENTS.md` con reglas de checkpoint
- **Patrón implementado**: WAL (Write-Ahead Logging) / Checkpointing

### Decisiones tomadas
- **Checkpoint incremental**: Actualizar BITACORA.md después de cada acción relevante, no esperar al final
- **No esperar señal del usuario**: el agente decide cuándo es "relevante"
- **Patrón de database**: como WAL en SQLite, escribir antes de que algo falle

### Estado final
- Sistema de checkpoint configurado
- Próxima sesiónarranca con contexto automático

### Notas para próxima sesión
- Probar que el checkpoint funciona después de cada acción
- Verificar que el agente lee BITACORA.md al inicio

---

## [2026-07-25] Integración de temas Bootstrap + corrección SweetAlert2

### Contexto
- El selector de temas (GitHub/Dracula/Nord) se perdió al integrar Bootstrap
- SweetAlert2 dejó de funcionar tras refactorizaciones previas
- El usuario quería integrar temas usando `data-bs-theme` de Bootstrap

### Cambios realizados
- **index.html**: Agregado `<select>` de temas en el header
- **style.css**: 
  - Reemplazado `data-theme` → `data-bs-theme`
  - Mapeado de colores custom a variables Bootstrap (`--bs-body-bg`, `--bs-body-color`, etc.)
  - Fixes para tablas, formularios, cards y SweetAlert2 en temas oscuros
- **app.js**:
  - Cambiado `changeTheme()` para usar `data-bs-theme`
  - Restaurado `Swal.fire('¡Éxito!')` al agregar gasto
  - Agregado `Swal.fire('Error')` en `fetchHistory`
  - Eliminado función muerta `showFormFeedback()`

### Decisiones tomadas
- **Bootstrap native**: Usar `data-bs-theme` en vez de `data-theme` custom para mejor integración
- **Variables dual**: Mantener variables custom (`--text-primary`, `--card-bg`) + variables Bootstrap (`--bs-body-bg`)
- **SweetAlert2 consistente**: Todas las acciones de usuario usan popups, no texto inline

### Estado final
- Rama `feature/bootstrap-themes` pusheada
- PR pendiente: https://github.com/Genoshan/wesplit/pull/new/feature/bootstrap-themes
- 3 temas funcionando: GitHub Light, Dracula, Nord

### Notas para próxima sesión
- Crear PR y mergear a main
- Considerar limpiar HTML/CSS del `#form-feedback` (ya no se usa)
