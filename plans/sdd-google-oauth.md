# SDD - Google OAuth Login

## 1. Objetivo

Agregar autenticacion con Google OAuth como metodo secundario de login al formulario existente, manteniendo el login con contraseña como fallback. El objetivo es simplificar el acceso para Tin y Noe sin eliminar el sistema actual.

**No se agregan roles ni grupos.** Sigue siendo un sistema para 2 usuarios con divisiones 50/50.

## 2. Contexto Actual

### Autenticacion actual
- **Backend**: Express.js en puerto 4000
- **Autenticacion**: Password-based con `USERS` object en memoria (`auth.js`)
- **Sesiones**: Almacenamiento en memoria con `Map()`, no persistente
- **Token**: `session_token` como cookie HTTP-only
- **Usuarios**: `tin` y `noe` con passwords en variables de entorno

### Frontend actual
- Formulario con `<select>` para usuario y `<input>` para password
- `fetch('/api/login')` con body JSON
- `checkAuth()` llama a `GET /api/auth/check` con cookie

### Dependencias actuales
- `express`, `body-parser`, `helmet`, `express-rate-limit`, `@libsql/client`, `dotenv`
- **No tiene** `passport`, `passport-google-oauth20`, `crypto` (en server)

## 3. Diseno

### 3.1 Flujo de Autenticacion

```
[Frontend]                    [Backend]
  |                            |
  |  POST /api/google/init     |
  |--------------------------->|
  |                            |  Generar state nonce
  |                            |  Guardar en session store
  |  { redirectUri: ... }      |  Redirigir a Google
  |<---------------------------|  ?response_type=code
  |                            |  &client_id=...
  |                            |  &state=nonce
  |                            |  &redirect_uri=callback
  |                            |
  |  (Navegador redirige)       |
  |  (Google maneja UI)         |
  |                            |
  |  GET /api/google/callback   |
  |  ?code=XXXX&state=nonce     |
  |<----------------------------|
  |                            |  Verificar state
  |                            |  Intercambiar code por ID
  |                            |  Token (ID + Refresh)
  |                            |  Obtener info del usuario
  |                            |    (email, picture, etc.)
  |                            |
  |                            |  Match por email -> user
  |                            |  Generar session_token
  |                            |  Set cookie
  |  { message, user, payer }  |
  |<---------------------------|
  |                            |
  |  checkAuth()               |
  |  (sigue flujo normal)       |
```

### 3.2 Mapeo de Usuarios

El sistema actual tiene usuarios hardcodeados (`tin`, `noe`). El mapeo sera:

```javascript
// auth.js - Mapeo de email -> usuario interno
const GOOGLE_EMAIL_MAP = {
    'tin@ejemplo.com': { username: 'tin', payer: 'me' },
    'noe@ejemplo.com': { username: 'noe', payer: 'partner' }
};
```

- Los emails de Google se comparan contra esta tabla
- Si el email no esta mapeado -> login denegado
- Si el email es nuevo, se puede agregar manualmente al `.env`

### 3.3 Endpoints Nuevos

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| POST | `/api/google/init` | Inicia el flujo OAuth, devuelve URL de redirect |
| GET | `/api/google/callback` | Callback de Google, verifica state e intercambia code |
| POST | `/api/google/logout` | Limpia cookie y cierra sesion |

### 3.4 Estado y Seguridad

- **State parameter**: Se genera un nonce aleatorio por request, se guarda en memoria con TTL de 10 minutos
- **Code exchange**: Se hace directamente en el servidor (backend-to-backend), nunca expone tokens al frontend
- **No hay refresh tokens en memoria**: Al ser un app de 2 personas, las sesiones expiran a las 24h y el usuario vuelve a loguear
- **Rate limit**: 5 requests por minuto por IP en ambos endpoints nuevos

### 3.5 Frontend

**Login screen** - agregar boton "Google":

```html
<form id="login-form">
  <!-- select usuario, input password, boton actual -->
</form>

<div class="login-divider">o continuar con</div>
<button type="button" id="google-login-btn" class="btn btn-google w-100">
  <img src="..." alt="Google" class="google-icon">
  Continuar con Google
</button>
```

**JS** (`app.js`):

```javascript
// Nuevo handler
async function loginWithGoogle() {
    try {
        const res = await fetch('/api/google/init', { method: 'POST' });
        if (!res.ok) throw new Error();
        const data = await res.json();
        // data.redirectUrl -> redirect al navegador
        window.location.href = data.redirectUrl;
    } catch (err) {
        Swal.fire('Error', 'No se pudo iniciar sesion con Google.', 'error');
    }
}

// Agregar al DOMContentLoaded
document.getElementById('google-login-btn')?.addEventListener('click', loginWithGoogle);
```

## 4. Dependencias

**No se agregan dependencias externas.** Todo se implementa con:
- `crypto` (modulo nativo de Node.js)
- `https` (modulo nativo) para hacer el exchange de tokens con Google
- `url` (modulo nativo) para construir las URLs

## 5. Variables de Entorno Nuevas

| Variable | Descripcion | Ejemplo |
|----------|-------------|---------|
| `GOOGLE_CLIENT_ID` | Client ID de Google OAuth | `123456-abc123.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Client Secret de Google OAuth | `GOCSPX-xxxxx_yyyyy` |
| `GOOGLE_AUTHORIZED_EMAILS` | Emails permitidos (comma-separated) | `tin@ejemplo.com,noe@ejemplo.com` |
| `GOOGLE_REDIRECT_URI` | URI de callback (opcional, por defecto auto-detect) | `http://localhost:4000/api/google/callback` |

## 6. Configuracion en Google Cloud Console

1. Ir a [Google Cloud Console](https://console.cloud.google.com/)
2. Crear o seleccionar proyecto
3. Habilitar **Google Identity APIs**
4. Configurar **OAuth consent screen**:
   - Tipo: `External`
   - Status: `Testing` (para 2 usuarios no se necesita approval publico)
   - Add testers: `tin@...` y `noe@...`
5. Crear **Credentials** -> OAuth Client ID
   - Type: `Web application`
   - Authorized redirect URIs: `http://localhost:4000/api/google/callback` (dev)
   - Para prod: `https://wesplit.genoshan.com/api/google/callback`
6. Copiar `Client ID` y `Client Secret` al `.env`

## 7. Estructura de Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `server/auth.js` | Funciones `initGoogleAuth()`, `handleGoogleCallback()`, mapeo de emails |
| `server/index.js` | Rutas `/api/google/init`, `/api/google/callback`, `/api/google/logout` |
| `index.html` | Boton Google en login screen + divisor "o continuar con" |
| `style.css` | Estilos para boton Google (icono + texto) |
| `app.js` | Funcion `loginWithGoogle()`, event listener |
| `server/.env` | Nuevas vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_AUTHORIZED_EMAILS` |

## 8. Implementacion Paso a Paso

### Fase 1: Backend
1. Crear funcion `generateState()` en `auth.js` que use `crypto.randomBytes(32)`
2. Crear store en memoria para estados: `const googleStates = new Map()`
3. Implementar `POST /api/google/init`:
   - Validar `GOOGLE_CLIENT_ID` existe
   - Generar state
   - Guardar state con TTL 10min
   - Devolver `{ redirectUrl: googleAuthUrl }`
4. Implementar `GET /api/google/callback`:
   - Validar state (existe y no expiro)
   - Intercambiar code por ID token via Google API
   - Parsear ID token (no se necesita `jsonwebtoken`, solo decode del payload JWT)
   - Obtener email del payload
   - Match contra `GOOGLE_AUTHORIZED_EMAILS`
   - Generar session y set cookie

### Fase 2: Frontend
5. Agregar HTML del boton Google en `index.html`
6. Agregar estilos en `style.css`
7. Agregar `loginWithGoogle()` en `app.js`

### Fase 3: Test y Cleanup
8. Test local con `http://localhost:4000`
9. Limpiar logs debug de `auth.js` si se agregaron
10. Commitear y crear PR

## 9. Consideraciones

- **No persistir sesiones**: Se mantiene el `Map()` en memoria. Al reiniciar el servidor, se pierden las sesiones. Para un setup con pm2 o Docker, esto no es problema.
- **JWT decode**: El ID token de Google es un JWT. Se puede decodear el payload (segundo segment) base64url sin verificar la firma (Google ya lo verifico al devolverlo).
- **Session TTL**: Se mantiene en 24h igual que el sistema actual.
- **Password login sigue activo**: No se elimina el login con contraseña como fallback.
- **Sin base de datos de usuarios**: El mapeo email->usuario es estatico, no hay registro publico.
- **Sin dependencias nuevas**: Se usan modulos nativos de Node.js para no inflar el proyecto.
