# Requisitos para poner en marcha "Reloj"

Este documento detalla todo lo necesario para ejecutar correctamente la aplicación de gestión y visualizar el contenido local.

## 1. Requisitos del Sistema
- **Node.js:** Versión 14.x o superior (recomendado LTS).
- **Navegador Web:** Cualquier navegador moderno (Chrome, Firefox, Edge) que soporte APIs básicas de JS (Fetch, LocalStorage).
- **Sistema Operativo:** Windows/Linux/macOS.

## 2. Instalación del Servidor (Backend)
Para iniciar el servidor interno y habilitar la API:
1. Navega a la carpeta del servidor:
   ```bash
   cd server
   ```
2. Instala las dependencias de Node.js:
   ```bash
   npm install
   ```
3. Inicia el servidor (usará el puerto 3000 por defecto):
   ```bash
   node index.js
   ```

## 3. Configuración de la Base de Datos
La aplicación utiliza **SQLite3**. La base de datos se crea y configura automáticamente al iniciar el servidor:
- El archivo `database.sqlite` se creará en la carpeta `/server` si no existe.
- Se ejecutará un script para crear la tabla `expenses` con las columnas necesarias (ID, fecha, descripción, monto, pagador y categoría).

## 4. Acceso a la Aplicación (Frontend)
Una vez que el servidor esté corriendo:
1. Abre tu navegador en: `http://localhost:3000`
2. El frontend cargará automáticamente los gráficos (Chart.js) y las funcionalidades de ordenamiento (SortableJS).

## 5. Funcionalidades Integradas y Servicios Externos
- **Clima:** La aplicación consulta datos a `api.open-meteo.com`. Requiere conexión a internet para mostrar la temperatura y descripción del clima actual.
- **Reloj:** Funcionamiento local independiente del servidor.
- **Gráficos de Gastos:** Renderizados automáticamente mediante Chart.js al cargar el historial desde la base de datos.

## 6. Scripts de Lanzamiento (Opcionales)
Si prefieres usar los archivos ejecutables incluidos:
- En Windows: `iniciar_servidor.bat`
- En Linux/macOS: `iniciar_servidor.sh`
