$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and
  $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  return $netTask.Result
}

[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime] | Out-Null
[Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime] | Out-Null

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {
  $enLang = New-Object Windows.Globalization.Language("en-US")
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($enLang)
}

[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

while ($true) {
  $imgPath = [Console]::In.ReadLine()
  if ($null -eq $imgPath -or $imgPath -eq 'EXIT') { break }
  $imgPath = $imgPath.Trim()
  if ($imgPath -eq '') { continue }

  try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($imgPath)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
      $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
      $bitmap = Await ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)) ([Windows.Graphics.Imaging.SoftwareBitmap])
      $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

      # Sort OCR lines vertically and merge columns on the same horizontal row left-to-right
      $lineItems = @()
      foreach ($line in $result.Lines) {
        if ($line.Words -and $line.Words.Count -gt 0) {
          $minX = [double]::MaxValue
          $sumMidY = 0.0
          $sumH = 0.0
          foreach ($w in $line.Words) {
            $r = $w.BoundingRect
            if ($r.X -lt $minX) { $minX = $r.X }
            $sumMidY += ($r.Y + ($r.Height / 2.0))
            $sumH += $r.Height
          }
          $cnt = [double]$line.Words.Count
          $lineItems += [PSCustomObject]@{
            Text   = $line.Text
            MinX   = $minX
            MidY   = $sumMidY / $cnt
            Height = $sumH / $cnt
          }
        } else {
          $lineItems += [PSCustomObject]@{
            Text   = $line.Text
            MinX   = 0.0
            MidY   = 0.0
            Height = 20.0
          }
        }
      }

      if ($lineItems.Count -gt 0) {
        $sorted = $lineItems | Sort-Object @{Expression = 'MidY'; Ascending = $true}, @{Expression = 'MinX'; Ascending = $true}
        $rows = @()
        $currentRow = @()
        $anchorY = $null
        $anchorH = 20.0

        foreach ($item in $sorted) {
          if ($null -eq $anchorY) {
            $currentRow = @($item)
            $anchorY = $item.MidY
            $anchorH = [Math]::Max(12.0, $item.Height)
          } else {
            $tol = [Math]::Max(10.0, ([Math]::Max($anchorH, $item.Height) * 0.65))
            if ([Math]::Abs($item.MidY - $anchorY) -le $tol) {
              $currentRow += $item
            } else {
              $rows += ,@($currentRow)
              $currentRow = @($item)
              $anchorY = $item.MidY
              $anchorH = [Math]::Max(12.0, $item.Height)
            }
          }
        }
        if ($currentRow.Count -gt 0) {
          $rows += ,@($currentRow)
        }

        foreach ($row in $rows) {
          $orderedRow = $row | Sort-Object -Property MinX
          $joined = ($orderedRow | ForEach-Object { $_.Text }) -join ' '
          [Console]::Out.WriteLine($joined)
        }
      }
    } finally {
      $stream.Dispose()
    }
  } catch {
    [Console]::Out.WriteLine("<<AIMEX_OCR_ERR>>")
  }
  [Console]::Out.WriteLine("<<AIMEX_OCR_DONE>>")
  [Console]::Out.Flush()
}
