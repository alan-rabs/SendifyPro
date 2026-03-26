@echo off
title Sendify Web - Setup & Run
color 0A

echo ==========================================
echo    Sendify Web - Iniciando Sistema
echo ==========================================
echo.

:: 1. Verificar si Node.js esta instalado
node -v >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Node.js no esta instalado en esta computadora.
    echo [INFO] Por favor, descarga e instala la version LTS desde: https://nodejs.org/
    echo [INFO] Asegurate de marcar la casilla "Add to PATH" durante la instalacion.
    echo.
    pause
    exit /b
)

echo [OK] Node.js detectado.

:: 2. Verificar si es la primera ejecucion (si falta node_modules)
if not exist "node_modules\" (
    color 0E
    echo.
    echo [INFO] Primera ejecucion detectada. 
    echo [INFO] Instalando dependencias y librerias necesarias...
    echo [INFO] Esto puede tardar un par de minutos, por favor espera.
    echo.
    
    call npm install
    
    if %errorlevel% neq 0 (
        color 0C
        echo.
        echo [ERROR] Hubo un problema instalando las dependencias.
        echo [INFO] Revisa tu conexion a internet o intenta ejecutar como Administrador.
        pause
        exit /b
    )
    color 0A
    echo.
    echo [OK] Dependencias instaladas correctamente.
) else (
    echo [OK] Dependencias ya instaladas.
)

:: 3. Iniciar el servidor
echo.
echo ==========================================
echo [INFO] Iniciando el servidor web local...
echo [INFO] Abre tu navegador web y entra a: http://localhost:3000
echo [INFO] NO CIERRES ESTA VENTANA NEGRA mientras uses el bot.
echo ==========================================
echo.

:: Configurar para que el bot inicie automaticamente
set AUTOSTART_BOT=true

:loop
echo [INFO] Verificando puertos...
for /f "tokens=5" %%a in ('netstat -aon ^| find ":3000" ^| find "LISTENING"') do taskkill /f /pid %%a >nul 2>&1
echo [INFO] Iniciando Sendify...
call npm run dev
echo [WARN] El servidor se detuvo. Reiniciando en 3 segundos...
timeout /t 3 /nobreak >nul
goto loop
