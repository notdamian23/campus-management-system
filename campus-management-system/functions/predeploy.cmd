@echo off
setlocal

pushd "%~dp0"
call npm run lint
if errorlevel 1 (
  popd
  exit /b 1
)

call npm run build
if errorlevel 1 (
  popd
  exit /b 1
)

popd
endlocal
exit /b 0
