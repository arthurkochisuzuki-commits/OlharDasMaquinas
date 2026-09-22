@echo off
chcp 65001 >nul
:: Redireciona diretamente para index.bat
call "%~dp0index.bat"
