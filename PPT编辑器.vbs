Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\12860\Desktop\HTML\editor"
WshShell.Run "node server.js", 0, False
WshShell.Run "http://localhost:3000"