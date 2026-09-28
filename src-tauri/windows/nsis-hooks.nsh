!define LINKS_LEGACY_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\NTU Course Assistant"
!define LINKS_LEGACY_UNINSTALL_ROOT "Software\Microsoft\Windows\CurrentVersion\Uninstall"
!define LINKS_LEGACY_DISPLAY_NAME "NTU Course Assistant"
!define LINKS_LEGACY_PUBLISHER "ntu-course-assistant"
!define LINKS_LEGACY_MANUFACTURER_KEY "Software\ntu-course-assistant\NTU Course Assistant"
!define LINKS_LEGACY_EXE "ntu-course-assistant.exe"

!macro NSIS_HOOK_PREINSTALL
  Call LinksValidateLegacyNtuInstall
  Pop $0
  StrCmp $0 0 links_legacy_preinstall_done

  ; This hook expands after Tauri registers its additional NSIS plugin directory.
  nsis_tauri_utils::FindProcessCurrentUser "${LINKS_LEGACY_EXE}"
  Pop $4
  StrCmp $4 0 links_legacy_process_running

  Call LinksUninstallLegacyNtuInstall
  Goto links_legacy_preinstall_done
links_legacy_process_running:
  Call LinksLegacyProcessRunning
links_legacy_preinstall_done:
!macroend

Function LinksLegacyArpKeyExists
  StrCpy $0 0
links_legacy_arp_enum:
  EnumRegKey $1 HKCU "${LINKS_LEGACY_UNINSTALL_ROOT}" $0
  StrCmp $1 "" links_legacy_arp_missing
  StrCmp $1 "NTU Course Assistant" links_legacy_arp_found
  IntOp $0 $0 + 1
  Goto links_legacy_arp_enum
links_legacy_arp_found:
  Push 1
  Return
links_legacy_arp_missing:
  Push 0
FunctionEnd

Function LinksLegacyRetirementFailed
  MessageBox MB_ICONEXCLAMATION|MB_OK "Links Workplace could not safely retire the existing NTU Course Assistant installation. No old application data was changed. Close the setup and resolve the old installation before retrying."
  Abort
FunctionEnd

Function LinksLegacyNotSafelyIdentifiable
  DetailPrint "Legacy not safely identifiable; leaving the existing registration and files unchanged."
  MessageBox MB_ICONEXCLAMATION|MB_OK "An NTU Course Assistant installation was found, but its identity or version is not supported for automatic removal. It has been left unchanged. Uninstall it manually before installing Links Workplace."
  Abort
FunctionEnd

Function LinksLegacyProcessRunning
  DetailPrint "The old NTU Course Assistant process is running; automatic retirement was stopped."
  MessageBox MB_ICONEXCLAMATION|MB_OK "Please close NTU Course Assistant and run Links Workplace setup again. Setup did not close the old application."
  Abort
FunctionEnd

Function LinksLegacyArpKeyStillExists
  StrCpy $0 0
links_legacy_arp_verify_enum:
  EnumRegKey $1 HKCU "${LINKS_LEGACY_UNINSTALL_ROOT}" $0
  StrCmp $1 "" links_legacy_arp_verify_missing
  StrCmp $1 "NTU Course Assistant" links_legacy_arp_verify_found
  IntOp $0 $0 + 1
  Goto links_legacy_arp_verify_enum
links_legacy_arp_verify_found:
  Push 1
  Return
links_legacy_arp_verify_missing:
  Push 0
FunctionEnd

Function LinksValidateLegacyNtuInstall
  SetShellVarContext current
  Call LinksLegacyArpKeyExists
  Pop $0
  StrCmp $0 0 links_legacy_no_install

  ReadRegStr $4 HKCU "${LINKS_LEGACY_UNINSTALL_KEY}" "DisplayName"
  StrCmp $4 "${LINKS_LEGACY_DISPLAY_NAME}" 0 links_legacy_untrusted

  ReadRegStr $4 HKCU "${LINKS_LEGACY_UNINSTALL_KEY}" "DisplayVersion"
  StrCmp $4 "1.3.0" links_legacy_supported
  StrCmp $4 "1.3.1" links_legacy_supported
  Goto links_legacy_untrusted

links_legacy_supported:
  StrCpy $6 $4
  ReadRegStr $4 HKCU "${LINKS_LEGACY_UNINSTALL_KEY}" "Publisher"
  StrCmp $4 "${LINKS_LEGACY_PUBLISHER}" 0 links_legacy_untrusted

  StrCpy $2 "$LOCALAPPDATA\NTU Course Assistant"
  StrCpy $3 "$\"$2$\""
  ReadRegStr $4 HKCU "${LINKS_LEGACY_UNINSTALL_KEY}" "InstallLocation"
  StrCmp $4 $3 0 links_legacy_untrusted

  StrCpy $3 "$\"$2\${LINKS_LEGACY_EXE}$\""
  ReadRegStr $4 HKCU "${LINKS_LEGACY_UNINSTALL_KEY}" "DisplayIcon"
  StrCmp $4 $3 0 links_legacy_untrusted

  StrCpy $3 "$\"$2\uninstall.exe$\""
  ReadRegStr $4 HKCU "${LINKS_LEGACY_UNINSTALL_KEY}" "UninstallString"
  StrCmp $4 $3 0 links_legacy_untrusted

  ReadRegStr $4 HKCU "${LINKS_LEGACY_UNINSTALL_KEY}" "MainBinaryName"
  StrCmp $4 "${LINKS_LEGACY_EXE}" 0 links_legacy_untrusted

  ReadRegStr $4 HKCU "${LINKS_LEGACY_MANUFACTURER_KEY}" ""
  StrCmp $4 "" links_legacy_optional_product_key
  StrCmp $4 $2 0 links_legacy_untrusted
links_legacy_optional_product_key:
  IfFileExists "$2\${LINKS_LEGACY_EXE}" 0 links_legacy_untrusted
  IfFileExists "$2\uninstall.exe" 0 links_legacy_untrusted

  Push 1
  Return

links_legacy_no_install:
  DetailPrint "No NTU Course Assistant uninstall entry found; continuing without legacy cleanup."
  Push 0
  Return

links_legacy_untrusted:
  Call LinksLegacyNotSafelyIdentifiable
  Push 0
  Return
FunctionEnd

Function LinksUninstallLegacyNtuInstall
  DetailPrint "Retiring supported NTU Course Assistant $6 installation."
  ClearErrors
  ExecWait '"$2\uninstall.exe" /S /P _?=$2' $5
  IfErrors links_legacy_uninstall_failed
  StrCmp $5 0 0 links_legacy_uninstall_failed

  Call LinksLegacyArpKeyStillExists
  Pop $4
  StrCmp $4 0 links_legacy_arp_removed
  Goto links_legacy_uninstall_failed
links_legacy_arp_removed:
  IfFileExists "$2\${LINKS_LEGACY_EXE}" links_legacy_uninstall_failed

  ; Tauri's _?= uninstaller mode leaves its running uninstaller stub in place.
  ; Remove only that exact, already-validated program file after ExecWait returns.
  Delete "$2\uninstall.exe"
  IfFileExists "$2\uninstall.exe" links_legacy_uninstall_failed

  IfFileExists "$SMPROGRAMS\NTU Course Assistant.lnk" links_legacy_uninstall_failed
  IfFileExists "$DESKTOP\NTU Course Assistant.lnk" links_legacy_uninstall_failed

  DetailPrint "NTU Course Assistant program identity retired; legacy user data was not accessed."
  Return

links_legacy_uninstall_failed:
  Call LinksLegacyRetirementFailed
  Return
FunctionEnd
