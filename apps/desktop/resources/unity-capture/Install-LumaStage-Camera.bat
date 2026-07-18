@echo off
:: LumaStage bundled Unity Capture installer (MIT, schellingb/UnityCapture)
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
  echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\lumastage_uc_admin.vbs"
  echo UAC.ShellExecute "cmd.exe", "/c ""%~s0"" %*", "", "runas", 1 >> "%temp%\lumastage_uc_admin.vbs"
  "%temp%\lumastage_uc_admin.vbs"
  del "%temp%\lumastage_uc_admin.vbs"
  exit /B
)
cd /D "%~dp0"
echo Installing LumaStage Camera virtual webcam...
regsvr32 /u /s "UnityCaptureFilter32.dll" 2>nul
regsvr32 /u /s "UnityCaptureFilter64.dll" 2>nul
regsvr32 /s "UnityCaptureFilter32.dll" "/i:UnityCaptureName=LumaStage Camera"
if errorlevel 1 regsvr32 "UnityCaptureFilter32.dll" "/i:UnityCaptureName=LumaStage Camera"
regsvr32 /s "UnityCaptureFilter64.dll" "/i:UnityCaptureName=LumaStage Camera"
if errorlevel 1 regsvr32 "UnityCaptureFilter64.dll" "/i:UnityCaptureName=LumaStage Camera"
echo Done. Device name: LumaStage Camera
exit /B 0
