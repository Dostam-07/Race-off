Add-Type -AssemblyName System.Drawing;

# Square app icons (192/512) from the flag favicon + maskable variant with padding
$src = [System.Drawing.Image]::FromFile('public\favicon.png');
foreach ($size in 192, 512) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size);
  $g = [System.Drawing.Graphics]::FromImage($bmp);
  $g.InterpolationMode = 'HighQualityBicubic';
  $g.SmoothingMode = 'HighQuality';
  $g.DrawImage($src, 0, 0, $size, $size);
  $g.Dispose();
  $bmp.Save("public\icon-$size.png", [System.Drawing.Imaging.ImageFormat]::Png);
  $bmp.Dispose();
}
# maskable icon: flag drawn at 72% centre, solid dark-blue background
$bmp = New-Object System.Drawing.Bitmap(512, 512);
$g = [System.Drawing.Graphics]::FromImage($bmp);
$g.Clear([System.Drawing.Color]::FromArgb(255, 10, 20, 54));
$inner = 368;
$g.InterpolationMode = 'HighQualityBicubic';
$g.SmoothingMode = 'HighQuality';
$g.DrawImage($src, [int]((512 - $inner) / 2), [int]((512 - $inner) / 2), $inner, $inner);
$g.Dispose();
$bmp.Save('public\icon-maskable.png', [System.Drawing.Imaging.ImageFormat]::Png);
$bmp.Dispose();
$src.Dispose();

# OG image 1200x630: beach screenshot background, dark overlay, logo centred
$bg = [System.Drawing.Image]::FromFile('docs\shot-beach.png');
$logo = [System.Drawing.Image]::FromFile('public\logo-raceoff.png');
$bmp = New-Object System.Drawing.Bitmap(1200, 630);
$g = [System.Drawing.Graphics]::FromImage($bmp);
$g.InterpolationMode = 'HighQualityBicubic';
# crop away HUD margins (left/right 240, top/bottom 180 of a 1280x720 shot)
$crop = New-Object System.Drawing.Bitmap([int]($bg.Width - 480), [int]($bg.Height - 360));
$cg = [System.Drawing.Graphics]::FromImage($crop);
$cg.DrawImage($bg, 0, 0, [System.Drawing.Rectangle]::new(240, 180, $bg.Width - 480, $bg.Height - 360), [System.Drawing.GraphicsUnit]::Pixel);
$cg.Dispose();
$bg.Dispose();
$bg = $crop;
# cover-crop the background
$scale = [Math]::Max(1200 / $bg.Width, 630 / $bg.Height);
$bw = [int]($bg.Width * $scale); $bh = [int]($bg.Height * $scale);
$g.DrawImage($bg, [int]((1200 - $bw) / 2), [int]((630 - $bh) / 2), $bw, $bh);
# dark veil
$veil = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(140, 8, 16, 44));
$g.FillRectangle($veil, 0, 0, 1200, 630);
# logo centred at 62% width
$lw = 740; $lh = [int]($logo.Height * $lw / $logo.Width);
$g.DrawImage($logo, [int]((1200 - $lw) / 2), [int]((630 - $lh) / 2), $lw, $lh);
$g.Dispose();
$bmp.Save('public\og-image.png', [System.Drawing.Imaging.ImageFormat]::Png);
$bmp.Dispose();
$bg.Dispose();
$logo.Dispose();
Get-ChildItem public\icon-*.png, public\og-image.png | Select-Object Name, @{N='KB';E={[math]::Round($_.Length/1KB)}};
