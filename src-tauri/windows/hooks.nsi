; FlowDown Windows installer hooks.
;
; The NSIS installer itself is per-machine/elevated. FlowDown remains a
; normal user-level application. The custom association page is declared in
; installer.nsi so it appears after the normal installer pages and immediately
; before the file-copy/install page.

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
    ReadRegStr $0 HKLM "Software\Classes\.torrent" ""
    ${If} $0 == "FlowDown.Torrent"
      DeleteRegKey HKLM "Software\Classes\FlowDown.Torrent"
      DeleteRegKey HKLM "Software\Classes\.torrent"
    ${EndIf}
  ${EndIf}

  ${If} $FlowDownAssociateMagnet != ${BST_CHECKED}
    ReadRegStr $0 HKLM "Software\Classes\magnet" ""
    ${If} $0 == "URL:Magnet Protocol"
      ReadRegStr $1 HKLM "Software\Classes\magnet\shell\open\command" ""
      ${If} $1 == '"$INSTDIR\flowdown.exe" "%1"'
        DeleteRegKey HKLM "Software\Classes\magnet"
      ${EndIf}
    ${EndIf}
  ${EndIf}

FlowDownAssociationPreinstallDone:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Register only what the user selected on the installer page.
  ; magnet.ico and torrent.ico are installed to $INSTDIR via bundle.resources.
  ${If} $FlowDownAssociateTorrent == ${BST_CHECKED}
    WriteRegStr HKLM "Software\Classes\.torrent" "" "FlowDown.Torrent"
    WriteRegStr HKLM "Software\Classes\FlowDown.Torrent" "" "BitTorrent File"
    WriteRegStr HKLM "Software\Classes\FlowDown.Torrent\DefaultIcon" "" "$INSTDIR\torrent.ico"
    WriteRegStr HKLM "Software\Classes\FlowDown.Torrent\shell\open\command" "" '"$INSTDIR\flowdown.exe" "%1"'
  ${EndIf}

  ${If} $FlowDownAssociateMagnet == ${BST_CHECKED}
    WriteRegStr HKLM "Software\Classes\magnet" "" "URL:Magnet Protocol"
    WriteRegStr HKLM "Software\Classes\magnet" "URL Protocol" ""
    WriteRegStr HKLM "Software\Classes\magnet\DefaultIcon" "" "$INSTDIR\magnet.ico"
    WriteRegStr HKLM "Software\Classes\magnet\shell\open\command" "" '"$INSTDIR\flowdown.exe" "%1"'
  ${EndIf}

  System::Call 'shell32::SHChangeNotify(i, i, i, i) (0x08000000, 0, 0, 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Remove only registrations that point to this FlowDown installation.
  ReadRegStr $0 HKLM "Software\Classes\.torrent" ""
  ${If} $0 == "FlowDown.Torrent"
    DeleteRegKey HKLM "Software\Classes\FlowDown.Torrent"
    DeleteRegKey HKLM "Software\Classes\.torrent"
  ${EndIf}

  ReadRegStr $0 HKLM "Software\Classes\magnet\shell\open\command" ""
  ${If} $0 == '"$INSTDIR\flowdown.exe" "%1"'
    DeleteRegKey HKLM "Software\Classes\magnet"
  ${EndIf}

  ; Remove dedicated icon files.
  Delete "$INSTDIR\magnet.ico"
  Delete "$INSTDIR\torrent.ico"

  System::Call 'shell32::SHChangeNotify(i, i, i, i) (0x08000000, 0, 0, 0)'
!macroend
