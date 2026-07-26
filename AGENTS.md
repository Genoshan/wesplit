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

## Referencias

- Estado actual: `.localcode/SESSION.md`
- Decisiones: `.localcode/DECISIONS.md`
- Roadmap: `.localcode/ROADMAP.md` o `ROADMAP.md`
