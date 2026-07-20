param(
    [Parameter(Mandatory=$true)]
    [string]$FilePath,

    [Parameter(Mandatory=$true)]
    [string]$SearchString
)

if (-not (Test-Path $FilePath)) {
    Write-Error "Archivo no encontrado: $FilePath"
    exit 1
}

# Leer el archivo en formato raw para preservar espacios y saltos de línea exactos
$content = Get-Content -Path $FilePath -Raw

if ($content -contains $SearchString) {
    Write-Host "SUCCESS: El texto coincide exactamente con el contenido del archivo."
    exit 0
}
else {
    Write-Error "FAILURE: El texto no coincide exactamente. Verifique espacios, saltos de línea o caracteres especiales."
    # Imprimir una pequeña muestra para depuración si falla (opcional)
    # Write-Host "Texto buscado: $SearchString"
    exit 1
}
