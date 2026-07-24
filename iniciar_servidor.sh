#!/bin/bash

# Título del proceso (en Linux no se usa 'title' igual que en Windows)
echo "Iniciando Servidor de Datos - Reloj"

# Gestión de PID para cierre limpio
PID_FILE=".server.pid"
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if ps -p "$OLD_PID" > /dev/null; then
        echo "Deteniendo instancia anterior (PID: $OLD_PID)..."
        kill "$OLD_PID"
        # Esperar un momento a que se libere el puerto
        sleep 2
    fi
fi

echo "Iniciando el servidor en el puerto 4000..."
echo "(El servidor se iniciará en segundo plano)"

# Cambiar al directorio del script y lanzar Node guardando su PID
cd "$(dirname "$0")"
node server/index.js &
NEW_PID=$!
echo $NEW_PID > "$PID_FILE"

# Bucle para esperar a que el puerto 3000 esté activo
while ! ss -tlnp | grep -q ":4000"; do
    sleep 1
done

echo "Puerto 4000 detectado. Abriendo navegador..."
xdg-open "http://localhost:4000"

echo "Todo listo."
