@echo off
title JARVIS Assistant
cd /d %~dp0
echo Starting JARVIS...
node .\node_modules\electron\cli.js .
pause
