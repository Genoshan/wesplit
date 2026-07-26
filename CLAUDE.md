# Reglas del Proyecto

@AGENTS.md

## Claude Code

### Auto Memory

Guarda notas automáticamente cuando:
- Corrijas un error que Claude haya causado
- Descubras un patrón del codebase que sea útil para futuras sesiones
- Aprendas preferencias del usuario sobre el proyecto

### Archivos de Memoria

Ubicación: `memory/`
- `MEMORY.md` — Índice principal (máx 200 líneas)
- `YYYY-MM-DD.md` — Logs diarios de trabajo
- `*.md` — Notas por tema

### Persistencia

Al finalizar cada sesión importante:
1. Actualizar `memory/MEMORY.md` con resumen
2. Crear log diario en `memory/YYYY-MM-DD.md` si hubo cambios significativos
3. Actualizar `.localcode/SESSION.md` con estado actual
