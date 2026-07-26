# Reglas del Proyecto

@AGENTS.md

## Claude Code

### Protocolo de Sesión (Checkpoint Automático)

**AL INICIO de cada sesión:**
1. Leer `memory/BITACORA.md` para contexto anterior
2. Leer `.localcode/SESSION.md` para estado actual
3. Saludar al usuario con el contexto recuperado

**DURANTE la sesión (después de cada acción relevante):**
- Después de cada commit, cambio importante o decisión → actualizar BITACORA.md
- No esperar a que el usuario pregunte
- No esperar al "final" de la sesión
- Patrón: **checkpoint incremental** como WAL en bases de datos

**SI el usuario se despide o la sesión termina:**
1. Actualizar BITACORA.md con resumen final
2. Actualizar SESSION.md con estado actual
3. Actualizar MEMORY.md si hay cambios estructurales

### Formato de Bitácora

```markdown
## [YYYY-MM-DD] Título de la sesión

### Contexto
- Qué se estaba haciendo antes

### Cambios realizados
- Archivo A: se modificó X
- Archivo B: se creó Y

### Decisiones tomadas
- Se decidió X porque Y

### Estado final
- Qué quedó funcionando

### Notas para próxima sesión
- Puntos a retomar
```

### Reglas Críticas

1. **Checkpoint después de cada acción relevante** — no esperar al final
2. **NUNCA preguntar si actualizar** — siempre hacerlo
3. **NUNCA preguntar si crear archivo** — crearlo directamente
4. **Si el usuario se despide** → activar protocolo de cierre
5. **Si la sesión se corta** → el último checkpoint tiene el estado

### Auto Memory

Guarda notas automáticamente cuando:
- Corrijas un error que hayas causado
- Descubras un patrón del codebase útil
- Aprendas preferencias del usuario
