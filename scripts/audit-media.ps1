# Run from Windows PowerShell with the Windows OCR language pack, FFmpeg and Node on PATH.
# The recogniser sends text directly to the detector through a private pipe.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$evidence = Join-Path $repo 'capture'
$work = Join-Path $repo '.work'
New-Item -ItemType Directory -Force -Path $work | Out-Null
$frames = (New-Item -ItemType Directory -Path (Join-Path $work ('audit-frames-' + [Guid]::NewGuid()))).FullName

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$ocrType = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$ocr = $ocrType::TryCreateFromUserProfileLanguages()
if (!$ocr) { throw 'Install a Windows OCR language pack before auditing image evidence.' }
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq ('IAsyncOperation' + [char]96 + '1')
} | Select-Object -First 1

function Wait-WinRtResult($operation, [type]$resultType) {
    $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
    $task.GetAwaiter().GetResult()
}

function Read-LocalImage($file, [string]$label) {
    $stream = $null
    $bitmap = $null
    try {
        $source = Wait-WinRtResult ([Windows.Storage.StorageFile]::GetFileFromPathAsync($file.FullName)) ([Windows.Storage.StorageFile])
        $stream = Wait-WinRtResult ($source.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
        $decoder = Wait-WinRtResult ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Wait-WinRtResult ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $result = Wait-WinRtResult ($ocr.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        @{path=$label; status='recognised'; text=$result.Text} | ConvertTo-Json -Compress
    } catch {
        @{path=$label; status='unavailable'; text=''} | ConvertTo-Json -Compress
    } finally {
        if ($bitmap) { $bitmap.Dispose() }
        if ($stream) { $stream.Dispose() }
    }
}

try {
    $images = @(Get-ChildItem -File -Recurse -LiteralPath $evidence | Where-Object { $_.Extension -in '.png','.jpg','.jpeg','.webp' })
    $movies = @(Get-ChildItem -File -Recurse -LiteralPath $evidence | Where-Object { $_.Extension -in '.mp4','.webm' })
    $mediaFrames = @()
    foreach ($movie in $movies) {
        $label = $movie.FullName.Substring($repo.Length + 1).Replace('\', '/')
        $prefix = [Guid]::NewGuid().ToString()
        $pattern = Join-Path $frames ($prefix + '-%06d.png')
        & ffmpeg -nostdin -loglevel error -i $movie.FullName -fps_mode passthrough $pattern
        if ($LASTEXITCODE) { throw ('Frame decoding failed for ' + $label) }
        $decoded = @(Get-ChildItem -File -LiteralPath $frames -Filter ($prefix + '-*.png') | Sort-Object Name)
        if (!$decoded.Count) { throw ('No frames found in ' + $label) }
        for ($i = 0; $i -lt $decoded.Count; $i++) {
            $mediaFrames += @{file=$decoded[$i]; label=$label + '#' + ($i + 1)}
        }
    }
    $safeJson = & {
        foreach ($item in $images) {
            Read-LocalImage $item ($item.FullName.Substring($repo.Length + 1).Replace('\', '/'))
        }
        foreach ($item in $mediaFrames) {
            Read-LocalImage $item.file $item.label
        }
    } | node (Join-Path $PSScriptRoot 'audit-release.mjs') --ocr-stdin
    if ($LASTEXITCODE) { throw 'The image detector failed.' }
    $results = ConvertFrom-Json -InputObject $safeJson
    if ($results.Count -ne $images.Count + $mediaFrames.Count) { throw 'Incomplete image audit.' }
    $flagged = @($results | Where-Object { $_.status -ne 'recognised' -or @($_.counts.PSObject.Properties).Count -gt 0 })
    [ordered]@{images=$images.Count; films=$movies.Count; frames=$mediaFrames.Count; flagged=$flagged} | ConvertTo-Json -Depth 6
    if ($flagged.Count) { exit 1 }
} finally {
    # This directory was created exclusively for this invocation. Remove the decoded copies only.
    if ($frames.StartsWith($work + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        Get-ChildItem -File -LiteralPath $frames -Filter '*.png' | Remove-Item
        Remove-Item -LiteralPath $frames
    }
}
