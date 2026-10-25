@echo off
rem 带诊断日志启动（复现白块后把 userData\debug.log 发我）
set XY_DEBUG=1
set ELECTRON_RUN_AS_NODE=
start "" "%~dp0dist\星陨斩杀线-win32-x64\星陨斩杀线.exe"