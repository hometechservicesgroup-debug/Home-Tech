param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\assets\pwa'))

Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

function New-HomeTechIcon([int]$Size, [string]$Path, [bool]$Maskable) {
  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::FromArgb(9, 11, 18))
  $margin = if ($Maskable) { [int]($Size * .13) } else { [int]($Size * .055) }
  $rect = [System.Drawing.Rectangle]::new($margin, $margin, $Size - 2*$margin, $Size - 2*$margin)
  $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, [System.Drawing.Color]::FromArgb(123,137,255), [System.Drawing.Color]::FromArgb(47,168,224), 45)
  $graphics.FillRectangle($brush, $rect)
  $white = [System.Drawing.Pen]::new([System.Drawing.Color]::White, [int]($Size*.052))
  $white.StartCap = [System.Drawing.Drawing2D.LineCap]::Round; $white.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $house = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $house.AddLines([System.Drawing.Point[]]@(
    [System.Drawing.Point]::new([int]($Size*.27),[int]($Size*.51)),
    [System.Drawing.Point]::new([int]($Size*.50),[int]($Size*.31)),
    [System.Drawing.Point]::new([int]($Size*.73),[int]($Size*.51))
  ))
  $graphics.DrawPath($white, $house)
  $graphics.DrawLine($white, [int]($Size*.34), [int]($Size*.48), [int]($Size*.34), [int]($Size*.70))
  $graphics.DrawLine($white, [int]($Size*.66), [int]($Size*.48), [int]($Size*.66), [int]($Size*.70))
  $graphics.DrawLine($white, [int]($Size*.34), [int]($Size*.70), [int]($Size*.66), [int]($Size*.70))
  $accent = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255,214,111), [int]($Size*.046))
  $accent.StartCap = [System.Drawing.Drawing2D.LineCap]::Round; $accent.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($accent, [int]($Size*.43), [int]($Size*.59), [int]($Size*.57), [int]($Size*.59))
  $graphics.DrawLine($accent, [int]($Size*.50), [int]($Size*.52), [int]($Size*.50), [int]($Size*.66))
  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $accent.Dispose(); $white.Dispose(); $house.Dispose(); $brush.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}

New-HomeTechIcon 192 (Join-Path $OutputDirectory 'icon-192.png') $false
New-HomeTechIcon 512 (Join-Path $OutputDirectory 'icon-512.png') $false
New-HomeTechIcon 512 (Join-Path $OutputDirectory 'icon-maskable-512.png') $true
