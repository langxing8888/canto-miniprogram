param()
$outDir = Join-Path $PSScriptRoot "miniprogram\assets\audio"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-ToneWav {
    param([string]$Path, [double[]]$Freqs)
    $rate = 16000
    $secPerTone = 0.35
    $samplesPerTone = [int]($rate * $secPerTone)
    $data = New-Object System.Collections.Generic.List[byte]
    foreach ($f in $Freqs) {
        for ($i = 0; $i -lt $samplesPerTone; $i++) {
            $t = $i / $rate
            # 淡入淡出避免爆音
            $env1 = [Math]::Min(1, [Math]::Min($i, $samplesPerTone - $i) / ($rate * 0.02))
            $v = [int]([Math]::Sin(2 * [Math]::PI * $f * $t) * 12000 * $env1)
            $data.AddRange([BitConverter]::GetBytes([int16]$v))
        }
    }
    $dataLen = $data.Count
    $ms = New-Object System.IO.MemoryStream
    $w = New-Object System.IO.BinaryWriter($ms)
    $w.Write([Text.Encoding]::ASCII.GetBytes("RIFF"))
    $w.Write([int32](36 + $dataLen))
    $w.Write([Text.Encoding]::ASCII.GetBytes("WAVEfmt "))
    $w.Write([int32]16); $w.Write([int16]1); $w.Write([int16]1)
    $w.Write([int32]$rate); $w.Write([int32]($rate * 2))
    $w.Write([int16]2); $w.Write([int16]16)
    $w.Write([Text.Encoding]::ASCII.GetBytes("data"))
    $w.Write([int32]$dataLen)
    $w.Write($data.ToArray())
    [IO.File]::WriteAllBytes($Path, $ms.ToArray())
    $w.Dispose(); $ms.Dispose()
    Write-Host "OK $Path ($dataLen bytes)"
}

New-ToneWav -Path (Join-Path $outDir "demo1.wav") -Freqs @(523.25, 659.25)
New-ToneWav -Path (Join-Path $outDir "demo2.wav") -Freqs @(659.25, 783.99)
New-ToneWav -Path (Join-Path $outDir "demo3.wav") -Freqs @(783.99, 523.25)
