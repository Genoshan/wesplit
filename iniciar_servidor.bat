@echo off
title Iniciar Servidor de Datos - Reloj

:: Limpieza de puerto previo (Equivalente al manejo de PID en .sh)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000') do taskkill /f /pid %%a >nul 2>&1
timeout /t 2 >nul

echo Iniciando el servidor en el puerto 3000...
echo (Se abrira una nueva ventana para los logs del servidor)


:: Lanzamos el servidor en una ventana separada para que no bloquee este script
start "" node server\index.js

:wait_port
netstat -ano | findstr :3000 >nul
if %errorlevel% == 0 (
    echo Puerto 3000 detectado. Abriendo navegador...
    start "" "http://localhost:3000"
    goto end
)

timeout /t 1 >nul
goto wait_port

:end
echo Todo listo.
pause