# Requisitos para poner en marcha WeSplit

> Actualizado al 2026-11-20. Documentación de instalación y arranque del estado actual.

## 1. Requisitos del Sistema

- **Node.js:** 18.x o superior (Express 5.2.1).
- **Navegador:** Chrome, Firefox o Edge moderno (Fetch, LocalStorage, `Intl.NumberFormat`).
- **Sistema operativo:** Windows, Linux o macOS.

## 2. Instalación del Servidor (Backend)

```bash
cd server
npm install
npm start
```

El servidor escucha en el puerto **4000** por defecto (`server/index.js:17`). Para desarrollo con auto-reload: `npm run dev`.

## 3. Configuración de la Base de Datos

El motor es **libSQL** (`@libsql/client`), declarado en `server/package.json`. La base se inicializa sola en `server/database.sqlite` al arrancar (o contra Turso si hay variables de entorno configuradas).

El esquema incluye: `users`, `sessions`, `groups`, `group_members`, `group_expenses`, `group_splits`, `group_payments`, además de las tablas legacy `expenses` y `expense_splits`. Recurrentes y tasas de cambio ya no existen. El seed es **one-shot**: no revive grupos borrados ni sobrescribe datos del usuario.

### Variables de entorno relevantes

| Variable | Uso |
|---|---|
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Conexión a la BD remota |
| `AUTH_TIN`, `AUTH_NOE` | Contraseñas legacy; obligatorias si `NODE_ENV=production` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Habilitan el botón de Google |
| `GOOGLE_AUTHORIZED_EMAILS` | Allowlist; si está ausente o comentada, entra cualquier email verificado |
| `GOOGLE_REDIRECT_URI`, `ALLOWED_ORIGINS` | URIs permitidas en producción |
| `TRUST_PROXY` | Para que los rate limits usen la IP real detrás de un proxy |

Los valores están en `server/.env` (archivo no versionado). **No leer ni reproducir su contenido.**

## 4. Acceso a la Aplicación (Frontend)

Con el servidor corriendo, abrir `http://localhost:4000`. No hace falta un servidor estático separado: Express sirve `index.html`, `style.css`, `app.js` y `favicon.ico`, con una allowlist de archivos estáticos y CSP activo.

## 5. Funcionalidades Integradas

- **Autenticación**: registro con username/email/password (mínimo 12 caracteres) y Google OAuth.
- **Grupos**: cada registro crea un grupo `Mis gastos` propio; invitación por username con normalización y sugerencias de búsqueda.
- **Gastos**: modos `equal`, `solo` y `custom`, con reparto exacto en centavos entre N miembros.
- **Balances**: calculados en servidor por grupo.
- **Gráficos**: Chart.js (doughnut por categoría), cargado desde CDN con SRI.
- **Temas**: claro/oscuro con persistencia.
- **Notificaciones**: SweetAlert2 (también con SRI).

No hay integración con clima (`open-meteo`) ni drag & drop (SortableJS): esas referencias eran del MVP inicial y ya no están en el código.

## 6. Scripts de Lanzamiento (Opcionales)

- Windows: `iniciar_servidor.bat`
- Linux/macOS: `iniciar_servidor.sh`
