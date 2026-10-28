@echo off
rem Abre o espelho do Atlas e do Bernhoeft (só leitura). Feche esta janela para desligar.
cd /d "%~dp0"
start "" http://127.0.0.1:3050
node servidor.js
