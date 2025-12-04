[Setup]
AppName=VerifFacture
AppVersion=1.0.0
DefaultDirName={pf}\VerifFacture
DefaultGroupName=VerifFacture
OutputDir=installer\output
OutputBaseFilename=VerifFacture-Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
AppPublisher=JBSK Consulting
SetupIconFile=..\installer\icon.ico
UninstallDisplayIcon={app}\VerifFacture.exe

[Files]
Source: "..\\dist\\VerifFacture.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\\installer\\icon.ico"; DestDir: "{app}"; Flags: ignoreversion


[Icons]
Name: "{group}\VerifFacture"; Filename: "{app}\VerifFacture.exe"; IconFilename: "{app}\icon.ico"
Name: "{commondesktop}\VerifFacture"; Filename: "{app}\VerifFacture.exe"; IconFilename: "{app}\icon.ico"


[Run]
Filename: "{app}\\VerifFacture.exe"; Description: "Lancer VerifFacture"; Flags: nowait postinstall skipifsilent
