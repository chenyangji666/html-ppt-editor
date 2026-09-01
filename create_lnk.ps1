$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut("C:\Users\12860\Desktop\PPT编辑器.lnk")
$s.TargetPath = "C:\Users\12860\Desktop\HTML\editor\启动编辑器.bat"
$s.WorkingDirectory = "C:\Users\12860\Desktop\HTML\editor"
$s.Save()
Write-Host "Done"