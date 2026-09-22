@echo off
chcp 65001 >nul
title SecureVision AI - Inicializador Universal
color 09

:: Garante que o diretório atual seja a pasta onde está este script
cd /d "%~dp0"

echo ==============================================================================
echo                 SECUREVISION AI - INICIALIZADOR DO SISTEMA
echo ==============================================================================
echo.

:: 1. Detecção do comando Python
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

:: Caso a máquina não tenha Python instalado
if "%PYTHON_CMD%"=="" (
    color 0E
    echo [AVISO] Python não detectado nesta máquina.
    echo Abrindo o painel index.html diretamente no seu navegador padrão...
    start "" "index.html"
    echo.
    echo Se a câmera não abrir devido às regras de segurança do seu navegador (file://),
    echo instale o Python em https://www.python.org/downloads/ e execute este arquivo novamente.
    echo.
    pause
    exit /b 0
)

:: 2. Verificação rápida de dependências (OpenCV e NumPy)
%PYTHON_CMD% -c "import cv2, numpy" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    color 0E
    echo [INFO] As bibliotecas do Python ainda não foram instaladas nesta máquina.
    echo Instalando dependências essenciais agora via pip...
    echo.
    %PYTHON_CMD% -m pip install -r requirements.txt
    if %ERRORLEVEL% NEQ 0 (
        color 0C
        echo [ERRO] Falha ao baixar as bibliotecas. Verifique sua conexão.
        pause
        exit /b 1
    )
    echo.
    echo [OK] Bibliotecas instaladas com sucesso!
    echo.
)

color 0B
echo Escolha o modo de execução:
echo.
echo   [1] Abrir Painel Web de Monitoramento 24H (Recomendado - Câmeras liberadas)
echo   [2] Executar Motor de IA Facial Nativo em Python (OpenCV / Tela com Fundo Preto)
echo   [3] Executar AMBOS simultaneamente (Painel Web + Motor Python)
echo   [4] Reinstalar / Atualizar Bibliotecas Python
echo.
set /p OPCAO="Digite a opção desejada [Padrão: 1]: "

if "%OPCAO%"=="" set OPCAO=1
if "%OPCAO%"=="1" goto OPCAO_WEB
if "%OPCAO%"=="2" goto OPCAO_PYTHON
if "%OPCAO%"=="3" goto OPCAO_AMBOS
if "%OPCAO%"=="4" goto OPCAO_INSTALAR

:OPCAO_WEB
cls
echo Iniciando Servidor Seguro Local e abrindo o navegador...
%PYTHON_CMD% servidor_local.py
goto FIM

:OPCAO_PYTHON
cls
echo Iniciando o Motor Nativo de Visão Computacional (OpenCV)...
%PYTHON_CMD% gemini-code-1788908867217.py
goto FIM

:OPCAO_AMBOS
cls
echo Iniciando Servidor Web em segundo plano...
start "SecureVision Web Server" %PYTHON_CMD% servidor_local.py
timeout /t 2 >nul
echo Iniciando Motor Nativo de Visão Computacional (OpenCV)...
%PYTHON_CMD% gemini-code-1788908867217.py
goto FIM

:OPCAO_INSTALAR
cls
call instalar_dependencias.bat
goto FIM

:FIM
pause
