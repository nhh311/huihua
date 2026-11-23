Unicode true
!include "MUI2.nsh"

!define APPNAME "绘话"
!define APPEXE "绘话.exe"
!define VERSION "2.0.2"
!define PUBLISHER "绘话"
!define LOGFILE "$TEMP\huihua-install.log"

Name "${APPNAME}"
OutFile "release-tauri\绘话-Setup-${VERSION}.exe"
; 固定安装到 ASCII 路径，避免用户把目录选到 D:\测试文件夹\... 这类
; 带中文/被占用/权限异常的位置。
InstallDir "$LOCALAPPDATA\Programs\Huihua"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
BrandingText "${APPNAME}"

VIProductVersion "2.0.2.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} 安装程序"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "${PUBLISHER}"

!define MUI_ICON "build\icon.ico"
!define MUI_UNICON "build\icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APPEXE}"
!define MUI_FINISHPAGE_RUN_TEXT "运行绘话"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
  FileOpen $0 "${LOGFILE}" w
  FileWrite $0 "start$\r$\n"
  FileClose $0
FunctionEnd

Section "绘话" SEC_MAIN
  SetShellVarContext current
  FileOpen $9 "${LOGFILE}" a
  FileWrite $9 "installdir=$INSTDIR$\r$\n"
  FileClose $9

  CreateDirectory "$INSTDIR"
  IfErrors create_dir_failed
  SetOutPath "$INSTDIR"

  File /nonfatal "/oname=${APPEXE}" "src-tauri\target\release\huihua.exe"
  IfErrors file_failed

  ; 预设库资源必须装在 exe 同级，presets::root 才能找到
  SetOutPath "$INSTDIR\resources"
  File /r /nonfatal "src-tauri\target\release\resources\presets"
  IfErrors file_failed
  SetOutPath "$INSTDIR"

  WriteUninstaller "$INSTDIR\uninstall.exe"
  IfErrors uninstall_failed

  CreateShortcut "$DESKTOP\绘话.lnk" "$INSTDIR\${APPEXE}"
  CreateDirectory "$SMPROGRAMS\绘话"
  CreateShortcut "$SMPROGRAMS\绘话\绘话.lnk" "$INSTDIR\${APPEXE}"
  CreateShortcut "$SMPROGRAMS\绘话\卸载 绘话.lnk" "$INSTDIR\uninstall.exe"

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Huihua" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Huihua" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Huihua" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Huihua" "DisplayIcon" "$INSTDIR\${APPEXE}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Huihua" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Huihua" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Huihua" "NoRepair" 1

  FileOpen $9 "${LOGFILE}" a
  FileWrite $9 "ok$\r$\n"
  FileClose $9
  Goto done

create_dir_failed:
  FileOpen $9 "${LOGFILE}" a
  FileWrite $9 "create-dir-error$\r$\n"
  FileClose $9
  MessageBox MB_ICONSTOP "无法创建安装目录：$\r$\n$INSTDIR"
  Abort

file_failed:
  FileOpen $9 "${LOGFILE}" a
  FileWrite $9 "file-error$\r$\n"
  FileClose $9
  MessageBox MB_ICONSTOP "无法写入文件：$\r$\n$INSTDIR\${APPEXE}$\r$\n请关闭正在运行的绘话，或检查安全软件。"
  Abort

uninstall_failed:
  FileOpen $9 "${LOGFILE}" a
  FileWrite $9 "uninstall-error$\r$\n"
  FileClose $9
  MessageBox MB_ICONSTOP "无法写入卸载程序：$\r$\n$INSTDIR\uninstall.exe"
  Abort

done:
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  nsExec::ExecToLog 'taskkill /IM "${APPEXE}" /F'
  Delete "$INSTDIR\${APPEXE}"
  Delete "$INSTDIR\uninstall.exe"
  RMDir /r "$INSTDIR\resources"
  Delete "$DESKTOP\绘话.lnk"
  Delete "$SMPROGRAMS\绘话\绘话.lnk"
  Delete "$SMPROGRAMS\绘话\卸载 绘话.lnk"
  RMDir "$SMPROGRAMS\绘话"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Huihua"
  DeleteRegKey HKCU "Software\绘话"
SectionEnd
