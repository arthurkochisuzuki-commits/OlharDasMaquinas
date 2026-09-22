#!/bin/bash
# SecureVision AI - Inicializador para Linux e macOS

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if command -v python3 &>/dev/null; then
    PYTHON_CMD=python3
elif command -v python &>/dev/null; then
    PYTHON_CMD=python
else
    echo "Python não encontrado. Abrindo index.html no navegador padrão..."
    if command -v xdg-open &>/dev/null; then
        xdg-open index.html
    elif command -v open &>/dev/null; then
        open index.html
    fi
    exit 0
fi

# Inicia servidor local seguro e abre o navegador
$PYTHON_CMD servidor_local.py
