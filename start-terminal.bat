@echo off
echo ========================================
echo    LARAGON PROJECT MANAGER
echo    INICIANDO SERVIDOR DE TERMINAL
echo ========================================
echo.
echo 📁 Ubicación: %CD%
echo 🚀 Iniciando servidor en puerto 3002...
echo 🌐 Después abre: index-simple.html
echo ⏹️  Presiona Ctrl+C para detener
echo.
echo ========================================
echo.
node simple-terminal-server.js
echo.
echo Servidor detenido. Presiona cualquier tecla para cerrar...
pause