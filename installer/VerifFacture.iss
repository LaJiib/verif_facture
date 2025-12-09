[Setup]
AppName=VerifFacture
AppVersion=1.0.1
DefaultDirName={commonpf}\VerifFacture
DefaultGroupName=VerifFacture
OutputDir=installer\output
OutputBaseFilename=VerifFacture-Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
AppPublisher=JBSK Consulting
SetupIconFile=..\installer\icon.ico
UninstallDisplayIcon={app}\VerifFacture.exe
PrivilegesRequired=none

[Files]
Source: "..\\dist\\VerifFacture.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\\installer\\icon.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\\dist\\migrate_add_ligne_statut.exe"; DestDir: "{app}"; Flags: ignoreversion


[Icons]
Name: "{group}\VerifFacture"; Filename: "{app}\VerifFacture.exe"; IconFilename: "{app}\icon.ico"
Name: "{commondesktop}\VerifFacture"; Filename: "{app}\VerifFacture.exe"; IconFilename: "{app}\icon.ico"


[Run]
Filename: "{app}\\VerifFacture.exe"; Description: "Lancer VerifFacture"; Flags: nowait postinstall skipifsilent

[Code]
var
  DbPage: TInputDirWizardPage;
  DbPath: string;

procedure InitializeWizard;
begin
  DbPage := CreateInputDirPage(wpSelectDir, 'Base de données', 'Sélectionnez la base SQLite à migrer (défaut AppData).', '', False, '');
  DbPath := ExpandConstant('{localappdata}\\VerifFacture\\data');
  DbPage.Add('Dossier de la base (invoices.db) :');
  DbPage.Values[0] := DbPath;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  FullDb: string;
  OldExe: string;
begin
  if CurStep = ssInstall then
  begin
    OldExe := ExpandConstant('{app}\\VerifFacture.exe');
    if FileExists(OldExe) then
    begin
      Log(Format('Suppression ancien exe: %s', [OldExe]));
      DeleteFile(OldExe);
    end;
  end;

  if CurStep = ssPostInstall then
  begin
    FullDb := AddBackslash(DbPage.Values[0]) + 'invoices.db';
    Log(Format('Migration DB -> %s', [FullDb]));
    if not Exec(ExpandConstant('{app}\\migrate_add_ligne_statut.exe'),
                '"' + FullDb + '"',
                '',
                SW_SHOW, ewWaitUntilTerminated, ResultCode) then
    begin
      Log(Format('Échec lancement migration, code=%d', [ResultCode]));
    end
    else
    begin
      Log(Format('Migration terminée, code=%d', [ResultCode]));
    end;
  end;
end;
