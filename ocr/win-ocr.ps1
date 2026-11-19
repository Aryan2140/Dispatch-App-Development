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
[Windows.Storage.FileAccessMode,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapPixelFormat,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapAlphaMode,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapTransform,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapInterpolationMode,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.ExifOrientationMode,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.ColorManagementMode,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrResult,Windows.Media.Ocr,ContentType=WindowsRuntime] | Out-Null
[Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime] | Out-Null

$engine = $null
try {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
} catch {}

if ($null -eq $engine) {
  foreach ($tag in @("en-AU", "en-GB", "en-US", "en")) {
    try {
      $lang = New-Object Windows.Globalization.Language($tag)
      if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($lang)) {
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
        if ($null -ne $engine) { break }
      }
    } catch {}
  }
}

if ($null -eq $engine) {
  try {
    $avail = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages
    if ($avail -and $avail.Count -gt 0) {
      $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($avail[0])
    }
  } catch {}
}

if ($null -eq $engine) {
  [Console]::Error.WriteLine("No Windows OCR language packs are installed on this system (install English OCR pack in Windows Settings > Time & Language > Language).")
}

try {
  [Console]::InputEncoding = [System.Text.Encoding]::UTF8
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

while ($true) {
  $imgPath = [Console]::In.ReadLine()
  if ($null -eq $imgPath -or $imgPath -eq 'EXIT') { break }
  $imgPath = $imgPath.Trim()
  if ($imgPath -eq '') { continue }

  if ($null -eq $engine) {
    [Console]::Out.WriteLine("<<AIMEX_OCR_NO_LANG>>")
    [Console]::Out.WriteLine("<<AIMEX_OCR_DONE>>")
    [Console]::Out.Flush()
    continue
  }

  try {
    $fullPath = [System.IO.Path]::GetFullPath($imgPath)
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($fullPath)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $bitmap = $null
    try {
      $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])

      $maxDim = 2600
      try {
        $maxDim = [int][Windows.Media.Ocr.OcrEngine]::MaxImageDimension
        if ($maxDim -le 0) { $maxDim = 2600 }
      } catch {}

      $origW = [double]$decoder.OrientedPixelWidth
      $origH = [double]$decoder.OrientedPixelHeight
      $rawW = [double]$decoder.PixelWidth
      $rawH = [double]$decoder.PixelHeight
      $longest = [Math]::Max($origW, $origH)

      $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
      if ($longest -gt $maxDim -and $longest -gt 0) {
        $scale = $maxDim / $longest
        $transform.ScaledWidth = [uint32][Math]::Max(1, [Math]::Round($rawW * $scale))
        $transform.ScaledHeight = [uint32][Math]::Max(1, [Math]::Round($rawH * $scale))
        $transform.InterpolationMode = [Windows.Graphics.Imaging.BitmapInterpolationMode]::Cubic
      } elseif ($longest -lt 1800 -and $longest -gt 0) {
        $scale = [Math]::Min(2.2, ([Math]::Min([double]$maxDim, 2200.0)) / $longest)
        if ($scale -gt 1.05) {
          $transform.ScaledWidth = [uint32][Math]::Round($rawW * $scale)
          $transform.ScaledHeight = [uint32][Math]::Round($rawH * $scale)
          $transform.InterpolationMode = [Windows.Graphics.Imaging.BitmapInterpolationMode]::Cubic
        }
      }

      $bitmap = Await ($decoder.GetSoftwareBitmapAsync(
        [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
        [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied,
        $transform,
        [Windows.Graphics.Imaging.ExifOrientationMode]::RespectExifOrientation,
        [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage
      )) ([Windows.Graphics.Imaging.SoftwareBitmap])

      $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

      # Collect bounding box geometry for every OCR line so columns stay cleanly separated
      $lineItems = @()
      foreach ($line in $result.Lines) {
        if ($line.Words -and $line.Words.Count -gt 0) {
          $minX = [double]::MaxValue
          $maxX = 0.0
          $minY = [double]::MaxValue
          $maxY = 0.0
          $sumMidY = 0.0
          $sumH = 0.0
          foreach ($w in $line.Words) {
            $r = $w.BoundingRect
            if ($r.X -lt $minX) { $minX = $r.X }
            if (($r.X + $r.Width) -gt $maxX) { $maxX = ($r.X + $r.Width) }
            if ($r.Y -lt $minY) { $minY = $r.Y }
            if (($r.Y + $r.Height) -gt $maxY) { $maxY = ($r.Y + $r.Height) }
            $sumMidY += ($r.Y + ($r.Height / 2.0))
            $sumH += $r.Height
          }
          $cnt = [double]$line.Words.Count
          $lineItems += [PSCustomObject]@{
            Text   = $line.Text
            MinX   = $minX
            MaxX   = $maxX
            MinY   = $minY
            MaxY   = $maxY
            MidY   = $sumMidY / $cnt
            Height = $sumH / $cnt
          }
        } else {
          $lineItems += [PSCustomObject]@{
            Text   = $line.Text
            MinX   = 0.0
            MaxX   = 100.0
            MinY   = 0.0
            MaxY   = 20.0
            MidY   = 10.0
            Height = 20.0
          }
        }
      }

      if ($lineItems.Count -gt 0) {
        $sorted = $lineItems | Sort-Object @{Expression = 'MidY'; Ascending = $true}, @{Expression = 'MinX'; Ascending = $true}
        $rows = @()
        $currentRow = @()
        $anchorY = $null
        $anchorMinY = 0.0
        $anchorMaxY = 0.0
        $anchorH = 20.0

        foreach ($item in $sorted) {
          if ($null -eq $anchorY) {
            $currentRow = @($item)
            $anchorY = $item.MidY
            $anchorMinY = $item.MinY
            $anchorMaxY = $item.MaxY
            $anchorH = [Math]::Max(8.0, $item.Height)
          } else {
            $minH = [Math]::Max(8.0, [Math]::Min($anchorH, $item.Height))
            $tol = [Math]::Max(4.0, $minH * 0.42)
            $vOverlap = [Math]::Min($anchorMaxY, $item.MaxY) - [Math]::Max($anchorMinY, $item.MinY)
            $sameRowBand = ([Math]::Abs($item.MidY - $anchorY) -le $tol) -and ($vOverlap -ge ($minH * 0.35))

            $stacksVertically = $false
            if ($sameRowBand) {
              $itemW = [Math]::Max(1.0, ($item.MaxX - $item.MinX))
              foreach ($r in $currentRow) {
                $rW = [Math]::Max(1.0, ($r.MaxX - $r.MinX))
                $hOverlap = [Math]::Min($r.MaxX, $item.MaxX) - [Math]::Max($r.MinX, $item.MinX)
                if ($hOverlap -gt ([Math]::Min($rW, $itemW) * 0.25)) {
                  $stacksVertically = $true
                  break
                }
              }
            }

            if ($sameRowBand -and -not $stacksVertically) {
              $currentRow += $item
            } else {
              $rows += ,@($currentRow)
              $currentRow = @($item)
              $anchorY = $item.MidY
              $anchorMinY = $item.MinY
              $anchorMaxY = $item.MaxY
              $anchorH = [Math]::Max(8.0, $item.Height)
            }
          }
        }
        if ($currentRow.Count -gt 0) {
          $rows += ,@($currentRow)
        }

        foreach ($row in $rows) {
          $orderedRow = @($row | Sort-Object -Property MinX)
          $sb = New-Object System.Text.StringBuilder
          for ($k = 0; $k -lt $orderedRow.Count; $k++) {
            if ($k -gt 0) {
              $prev = $orderedRow[$k - 1]
              $curr = $orderedRow[$k]
              $gap = $curr.MinX - $prev.MaxX
              $colThreshold = [Math]::Max($prev.Height, $curr.Height) * 2.5
              if ($gap -gt $colThreshold) {
                [void]$sb.Append("`t")
              } else {
                [void]$sb.Append(" ")
              }
            }
            [void]$sb.Append($orderedRow[$k].Text)
          }
          [Console]::Out.WriteLine($sb.ToString())
        }
      }
    } finally {
      if ($null -ne $bitmap) { try { $bitmap.Dispose() } catch {} }
      if ($null -ne $stream) { try { $stream.Dispose() } catch {} }
    }
  } catch {
    [Console]::Error.WriteLine("Windows OCR failed on '$imgPath': $($_.Exception.Message)")
    [Console]::Out.WriteLine("<<AIMEX_OCR_ERR>>")
  }
  [Console]::Out.WriteLine("<<AIMEX_OCR_DONE>>")
  [Console]::Out.Flush()
}
