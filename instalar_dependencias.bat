@echo off
chcp 65001 >nul
title SecureVision AI - Instalador de Dependências Python
color 0B

echo ==============================================================================
echo        SECUREVISION AI - INSTALADOR DE DEPENDÊNCIAS PYTHON
echo ==============================================================================
echo.

:: 1. Verificação da presença do Python
set PYTHON_CMD=
python --version >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set PYTHON_CMD=python
) else (
    py --version >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        set PYTHON_CMD=py
    )
)

if "%PYTHON_CMD%"=="" (
    color 0C
    echo [ERRO] O Python não foi encontrado nesta máquina!
    echo.
    echo Para que o sistema funcione com o motor de visão em qualquer máquina:
    echo 1. Baixe o Python no site oficial: https://www.python.org/downloads/
    echo 2. ATENÇÃO: Marque a opção "Add Python to PATH" durante a instalação.
    echo.
    set /p OPEN_WEB="Deseja abrir o site oficial do Python agora? (S/N): "
    if /i "%OPEN_WEB%"=="S" (
        start https://www.python.org/downloads/
    )
    echo.
    pause
    exit /b 1
)

echo [OK] Python detectado:
%PYTHON_CMD% --version
echo.

:: 2. Atualização do pip
echo [1/3] Atualizando o gerenciador pip...
%PYTHON_CMD% -m pip install --upgrade pip --quiet
echo [OK] pip atualizado.
echo.

:: 3. Instalação das bibliotecas essenciais (OpenCV e NumPy)
echo [2/3] Instalando bibliotecas essenciais (OpenCV, NumPy)...
%PYTHON_CMD% -m pip install -r requirements.txt
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo.
    echo [ERRO] Falha ao instalar dependências. Verifique sua conexão com a internet.
    pause
    exit /b 1
)
echo.

:: 4. Teste de importação
echo [3/3] Validando instalação dos módulos no sistema...
%PYTHON_CMD% -c "import cv2, numpy; print('  -> OpenCV versão:', cv2.__version__); print('  -> NumPy versão:', numpy.__version__)"
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo [ALERTA] Os módulos foram baixados, mas houve erro na importação.
    pause
    exit /b 1
)

echo.
echo ==============================================================================
color 0A
echo        INSTALAÇÃO CONCLUÍDA COM SUCESSO!
echo ==============================================================================
echo.
echo O sistema agora está 100%% pronto para rodar nesta máquina.
echo.
echo Você pode iniciar o projeto de duas formas:
echo   1. Dando dois cliques no arquivo: index.bat (abre o painel web com câmera)
echo   2. Dando dois cliques no arquivo: INICIAR_PROJETO.bat
echo.
pause
