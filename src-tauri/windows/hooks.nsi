; FlowDown Windows installer hooks.
;
; Supports both per-user and per-machine installation modes via SHCTX.
; The custom association page is declared in installer.nsi so it appears after
; the directory selection page and immediately before the file-copy/install page.

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var FlowDownAssociationDialog
Var FlowDownTorrentCheckbox
Var FlowDownMagnetCheckbox
Var FlowDownAssociateTorrent
Var FlowDownAssociateMagnet
Var FlowDownAssociationPageShown

Function FlowDownAssociationsPage
  ; Do not show this interactive page for passive/silent installs or updates.
  Call SkipIfPassive
  StrCpy $FlowDownAssociationPageShown 1

  nsDialogs::Create 1018
  Pop $FlowDownAssociationDialog
  ${If} $FlowDownAssociationDialog == error
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "File Associations" "Choose what FlowDown should handle on this computer."

  ${NSD_CreateLabel} 0 0 100% 28u "You can choose whether FlowDown should open .torrent files and magnet links. These choices can be changed later in Windows Settings."
  Pop $0

  ${NSD_CreateCheckbox} 0 40u 100% 12u "Use FlowDown for .torrent files"
  Pop $FlowDownTorrentCheckbox
  ${NSD_Check} $FlowDownTorrentCheckbox

  ${NSD_CreateCheckbox} 0 58u 100% 12u "Use FlowDown for magnet links"
  Pop $FlowDownMagnetCheckbox
  ${NSD_Check} $FlowDownMagnetCheckbox

  nsDialogs::Show
FunctionEnd

Function FlowDownAssociationsPageLeave
  ${NSD_GetState} $FlowDownTorrentCheckbox $FlowDownAssociateTorrent
  ${NSD_GetState} $FlowDownMagnetCheckbox $FlowDownAssociateMagnet
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  ; In passive/silent/update mode the interactive association page is skipped,
  ; so leave existing registrations untouched.
  ${If} $FlowDownAssociationPageShown != 1
    Goto FlowDownAssociationPreinstallDone
  ${EndIf}

  ; If the user unchecked an association during an upgrade/reinstall, remove
  ; only FlowDown's own registration. Never overwrite another application's
  ; association.
  ${If} $FlowDownAssociateTorrent != ${BST_CHECKED}
    ReadRegStr $0 SHCTX "Software\Classes\.torrent" ""
    ${If} $0 == "FlowDown.Torrent"
      DeleteRegKey SHCTX "Software\Classes\FlowDown.Torrent"
      DeleteRegKey SHCTX "Software\Classes\.torrent"
    ${EndIf}
  ${EndIf}

  ${If} $FlowDownAssociateMagnet != ${BST_CHECKED}
    ReadRegStr $0 SHCTX "Software\Classes\magnet" ""
    ${If} $0 == "URL:Magnet Protocol"
      ReadRegStr $1 SHCTX "Software\Classes\magnet\shell\open\command" ""
      ${If} $1 == '"$INSTDIR\flowdown.exe" "%1"'
        DeleteRegKey SHCTX "Software\Classes\magnet"
      ${EndIf}
    ${EndIf}
  ${EndIf}

FlowDownAssociationPreinstallDone:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Register only what the user selected on the installer page.
  ; Resolve dedicated torrent icon (checks root, icons subfolder, or falls back to main exe).
  ${If} $FlowDownAssociateTorrent == ${BST_CHECKED}
    StrCpy $0 "$INSTDIR\torrent.ico"
    ${IfNot} ${FileExists} "$0"
      ${If} ${FileExists} "$INSTDIR\icons\torrent.ico"
        StrCpy $0 "$INSTDIR\icons\torrent.ico"
      ${ElseIf} ${FileExists} "$INSTDIR\icons\torrent-file.ico"
        StrCpy $0 "$INSTDIR\icons\torrent-file.ico"
      ${Else}
        StrCpy $0 "$INSTDIR\flowdown.exe,0"
      ${EndIf}
    ${EndIf}

    WriteRegStr SHCTX "Software\Classes\.torrent" "" "FlowDown.Torrent"
    WriteRegStr SHCTX "Software\Classes\.torrent\OpenWithProgids" "FlowDown.Torrent" ""
    WriteRegStr SHCTX "Software\Classes\FlowDown.Torrent" "" "BitTorrent File"
    WriteRegStr SHCTX "Software\Classes\FlowDown.Torrent\DefaultIcon" "" "$0"
    WriteRegStr SHCTX "Software\Classes\FlowDown.Torrent\shell\open\command" "" '"$INSTDIR\flowdown.exe" "%1"'

    WriteRegStr SHCTX "Software\Classes\Applications\flowdown.exe" "FriendlyAppName" "FlowDown"
    WriteRegStr SHCTX "Software\Classes\Applications\flowdown.exe\DefaultIcon" "" "$0"
    WriteRegStr SHCTX "Software\Classes\Applications\flowdown.exe\SupportedTypes" ".torrent" ""
  ${EndIf}

  ; Resolve dedicated magnet icon (checks root, icons subfolder, or falls back to main exe).
  ${If} $FlowDownAssociateMagnet == ${BST_CHECKED}
    StrCpy $0 "$INSTDIR\magnet.ico"
    ${IfNot} ${FileExists} "$0"
      ${If} ${FileExists} "$INSTDIR\icons\magnet.ico"
        StrCpy $0 "$INSTDIR\icons\magnet.ico"
      ${ElseIf} ${FileExists} "$INSTDIR\icons\magnet-link.ico"
        StrCpy $0 "$INSTDIR\icons\magnet-link.ico"
      ${Else}
        StrCpy $0 "$INSTDIR\flowdown.exe,0"
      ${EndIf}
    ${EndIf}

    WriteRegStr SHCTX "Software\Classes\magnet" "" "URL:Magnet Protocol"
    WriteRegStr SHCTX "Software\Classes\magnet" "URL Protocol" ""
    WriteRegStr SHCTX "Software\Classes\magnet\DefaultIcon" "" "$0"
    WriteRegStr SHCTX "Software\Classes\magnet\shell\open\command" "" '"$INSTDIR\flowdown.exe" "%1"'
  ${EndIf}

  System::Call 'shell32::SHChangeNotify(i, i, i, i) (0x08000000, 0, 0, 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Remove only registrations that point to this FlowDown installation.
  ReadRegStr $0 SHCTX "Software\Classes\.torrent" ""
  ${If} $0 == "FlowDown.Torrent"
    DeleteRegKey SHCTX "Software\Classes\FlowDown.Torrent"
    DeleteRegKey SHCTX "Software\Classes\.torrent"
  ${EndIf}

  ReadRegStr $0 SHCTX "Software\Classes\magnet\shell\open\command" ""
  ${If} $0 == '"$INSTDIR\flowdown.exe" "%1"'
    DeleteRegKey SHCTX "Software\Classes\magnet"
  ${EndIf}

  ReadRegStr $0 SHCTX "Software\Classes\Applications\flowdown.exe\shell\open\command" ""
  ${If} $0 == '"$INSTDIR\flowdown.exe" "%1"'
    DeleteRegKey SHCTX "Software\Classes\Applications\flowdown.exe"
  ${EndIf}

  ; Remove dedicated icon files if present.
  Delete "$INSTDIR\magnet.ico"
  Delete "$INSTDIR\torrent.ico"
  Delete "$INSTDIR\icons\magnet.ico"
  Delete "$INSTDIR\icons\torrent.ico"
  Delete "$INSTDIR\icons\magnet-link.ico"
  Delete "$INSTDIR\icons\torrent-file.ico"

  System::Call 'shell32::SHChangeNotify(i, i, i, i) (0x08000000, 0, 0, 0)'
!macroend
