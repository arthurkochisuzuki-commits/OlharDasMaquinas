@echo off
title SecureVision AI - Servidor de Banco de Dados Local (Supabase / SQLite)
color 0A
cls
echo =====================================================================
echo           SECUREVISION AI - BANCO DE DADOS LOCAL CONECTADO
echo =====================================================================
echo.
echo Iniciando motor REST Supabase local com persistencia SQLite...
echo Porta: 8000
echo.
python local_supabase_server.py
pause
