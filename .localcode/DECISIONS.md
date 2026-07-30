# Project Decisions
*Log of architectural and technical considerations.*

- [2026-07-16] | **LocalCode Architecture** | Adopted a "State over History" model to solve context decay in long sessions.
- [2026-07-16] | **Storage Strategy** | Selected plain-text files in a .localcode/ directory for human readability and Git compatibility.
- [2026-07-16] | **Protocolo de Contexto** | Se establece el uso estricto del sistema .localcode como la fuente primaria de verdad para evitar la degradación por falta de contexto (context drift). El agente no debe adivinar; debe usar las herramientas y los archivos en .localcode (SESSION, DECISIONS, ROADMAP, CONTEXT_MAP) para mantener la coherencia entre sesiones.
- [2026-07-29] | **Fuente de verdad** | Siempre verificar estado remoto con `gh pr list` antes de confiar en archivos locales. Nunca asumir estado del repositorio sin verificar en GitHub.
