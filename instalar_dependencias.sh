#!/bin/bash
# SecureVision AI - Instalador para Linux e macOS

echo "=============================================================================="
echo "       SECUREVISION AI - INSTALADOR DE DEPENDÊNCIAS PYTHON (Linux/macOS)      "
echo "=============================================================================="
echo ""

# Detecta comando python
if command -v python3 &>/dev/null; then
    PYTHON_CMD=python3
elif command -v python &>/dev/null; then
    PYTHON_CMD=python
else
    echo "[ERRO] Python não encontrado. Por favor instale o Python 3.8+."
    exit 1
fi

echo "[OK] Python detectado: $($PYTHON_CMD --version)"
echo ""

echo "[1/3] Atualizando pip..."
$PYTHON_CMD -m pip install --upgrade pip --quiet

echo "[2/3] Instalando requirements.txt..."
$PYTHON_CMD -m pip install -r requirements.txt

echo "[3/3] Validando instalação..."
$PYTHON_CMD -c "import cv2, numpy; print('  -> OpenCV versão:', cv2.__version__); print('  -> NumPy versão:', numpy.__version__)"

echo ""
echo "Instalação concluída com sucesso!"
