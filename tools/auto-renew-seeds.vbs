Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c cd /d ""C:\Users\crist\Desktop\webosflux"" && node tools/mint-seeds.js --count 30 --pool dist/seeds/seeds.json --out dist/seeds/seeds.json && node tools/push-seeds.js", 0, False
