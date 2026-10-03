# JB Flow — assemblage de app/app.js sur un PC Windows sans Node (V26.45)
# Usage : powershell -ExecutionPolicy Bypass -File build.ps1
# Les tests se lancent ensuite en ouvrant app/tests/moteur.html dans le navigateur.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$parts = Get-ChildItem (Join-Path $root 'src\app') -Filter '*.js' | Where-Object { $_.Name -match '^\d+-' } | Sort-Object Name
if (-not $parts) { throw 'Aucun fichier source dans src\app' }
$sb = New-Object System.Text.StringBuilder
foreach ($p in $parts) { [void]$sb.Append([IO.File]::ReadAllText($p.FullName)) }
[IO.File]::WriteAllText((Join-Path $root 'app\app.js'), $sb.ToString(), (New-Object Text.UTF8Encoding($false)))
Write-Host ("Assemblage : {0} fichiers -> app\app.js" -f $parts.Count)
Write-Host 'Ouvrez maintenant app\tests\moteur.html : le bandeau doit etre vert avant toute mise en ligne.'
