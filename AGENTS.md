# AGENTS.md - Gastos Compartidos (WeSplit)

Aplicación web simple de gestión de gastos compartidos para dos personas (Tin y Noe). Inspirada en Splitwise.

## Stack Técnico

- **Frontend**: HTML, CSS (custom variables), Vanilla JS
- **Backend**: Node.js con Express 5
- **Base de datos**: SQLite3
- **Puerto**: 3000

## Reglas del Proyecto

1. **Una historia a la vez** — no implementar múltiples funcionalidades en una iteración
2. **Sin funcionalidades extra** — no login, no grupos, no invitaciones
3. **Divisiones 50/50** — todos los gastos se dividen equitativamente
4. **Simplicidad sobre complejidad** — evitar refactorizaciones innecesarias o lógica compleja
5. **No inferir requerimientos no expresados**

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
├── app.js              # Lógica frontend
├── style.css           # Estilos con temas (GitHub, Dracula, Nord)
├── server/
│   ├── index.js        # API REST (GET /api/expenses, POST /api/expense)
│   ├── database.js     # Conexión SQLite
│   └── database.sqlite # Datos persistentes
├── .localcode/         # Estado del proyecto (SESSION, DECISIONS, ROADMAP)
└── memory/             # Memoria del agente (logs diarios, referencias)
```

## Comandos Útiles

```bash
# Instalar dependencias
cd server && npm install

# Iniciar servidor
node server/index.js

# Verificar puerto
netstat -ano | findstr :3000
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
- Roadmap: `.localcode/ROADMAP.md` o `ROADMAP.md`
