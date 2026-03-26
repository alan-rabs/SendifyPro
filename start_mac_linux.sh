#!/bin/bash
echo "=========================================="
echo "   Sendify Web - Iniciando Sistema"
echo "=========================================="
echo ""

# 1. Verificar si Node.js esta instalado
if ! command -v node &> /dev/null
then
    echo "[ERROR] Node.js no esta instalado en esta computadora."
    echo "[INFO] Por favor, descarga e instala la version LTS desde: https://nodejs.org/"
    exit 1
fi

echo "[OK] Node.js detectado."

# 2. Verificar si es la primera ejecucion (si falta node_modules)
if [ ! -d "node_modules" ]; then
    echo ""
    echo "[INFO] Primera ejecucion detectada."
    echo "[INFO] Instalando dependencias y librerias necesarias..."
    echo "[INFO] Esto puede tardar un par de minutos, por favor espera."
    echo ""
    
    npm install
    
    if [ $? -ne 0 ]; then
        echo ""
        echo "[ERROR] Hubo un problema instalando las dependencias."
        echo "[INFO] Revisa tu conexion a internet o intenta ejecutar con sudo."
        exit 1
    fi
    echo ""
    echo "[OK] Dependencias instaladas correctamente."
else
    echo "[OK] Dependencias ya instaladas."
fi

# 3. Iniciar el servidor
echo ""
echo "=========================================="
echo "[INFO] Iniciando el servidor web local..."
echo "[INFO] Abre tu navegador web y entra a: http://localhost:3000"
echo "[INFO] NO CIERRES ESTA TERMINAL mientras uses el bot."
echo "=========================================="
echo ""

npm run dev
