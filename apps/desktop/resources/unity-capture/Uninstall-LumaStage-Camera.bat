@echo off
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
  echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\lumastage_uc_unadmin.vbs"
  echo UAC.ShellExecute "cmd.exe", "/c ""%~s0"" %*", "", "runas", 1 >> "%temp%\lumastage_uc_unadmin.vbs"
  "%temp%\lumastage_uc_unadmin.vbs"
  del "%temp%\lumastage_uc_unadmin.vbs"
  exit /B
)
cd /D "%~dp0"
regsvr32 /u /s "UnityCaptureFilter32.dll"
regsvr32 /u /s "UnityCaptureFilter64.dll"
echo Uninstalled.
exit /B 0
