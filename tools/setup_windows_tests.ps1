$ErrorActionPreference = 'Stop'

$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtime = Join-Path $root '.runtime'
$php = Join-Path $runtime 'php'
$maria = Join-Path $runtime 'mariadb-11.8.0-winx64'
$data = Join-Path $runtime 'mariadb-data'

New-Item -ItemType Directory -Force -Path $runtime | Out-Null

if (-not (Test-Path -LiteralPath (Join-Path $php 'php.exe'))) {
    $archive = Join-Path $runtime 'php.zip'
    Invoke-WebRequest `
        -Uri 'https://windows.php.net/downloads/releases/latest/php-8.4-nts-Win32-vs17-x64-latest.zip' `
        -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $php -Force
}

if (-not (Test-Path -LiteralPath (Join-Path $maria 'bin\mariadbd.exe'))) {
    $archive = Join-Path $runtime 'mariadb.zip'
    Invoke-WebRequest `
        -Uri 'https://archive.mariadb.org/mariadb-11.8.0/winx64-packages/mariadb-11.8.0-winx64.zip' `
        -OutFile $archive

    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
    $expected = 'c44c882abfb5a3d6b53a028e66fc862e8c6198a5284cb3f442119085cf4809ed'
    if ($actual -ne $expected) {
        throw "MariaDB archive checksum mismatch: expected $expected, got $actual"
    }

    Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
}

if (-not (Test-Path -LiteralPath (Join-Path $data 'my.ini'))) {
    $installer = Join-Path $maria 'bin\mariadb-install-db.exe'
    & $installer --datadir=$data --password=dev --port=3306
    if ($LASTEXITCODE -ne 0) {
        throw "MariaDB test database initialisation failed with exit code $LASTEXITCODE"
    }
}

$phpExe = Join-Path $php 'php.exe'
$extensionDir = Join-Path $php 'ext'
& $phpExe -d "extension_dir=$extensionDir" -d extension=pdo_mysql -d extension=mbstring --version

Write-Output ''
Write-Output 'Windows test runtime is ready. Run: npm run test:php'
