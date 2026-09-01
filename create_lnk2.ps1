$ws = New-Object -ComObject WScript.Shell
$sourceLnk = $ws.CreateShortcut("C:\Users\12860\Desktop\PPT编辑器新.lnk")
$targetLnk = $ws.CreateShortcut("C:\Users\12860\Desktop\PPT编辑器.lnk")
$targetLnk.TargetPath = "C:\Users\12860\Desktop\HTML\editor\启动编辑器.bat"
$targetLnk.WorkingDirectory = "C:\Users\12860\Desktop\HTML\editor"
$targetLnk.IconLocation = $sourceLnk.IconLocation
$targetLnk.Save()
Write-Host "Done - icon copied"