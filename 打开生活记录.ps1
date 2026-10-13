# =====================================================================
# 生活记录 · 一键打开
#
# 双击桌面「生活记录」图标即执行本脚本：
#   1. 检查服务是否在运行
#   2. 没运行就后台启动
#   3. 用默认浏览器打开
# =====================================================================

$ErrorActionPreference = 'SilentlyContinue'
$port = 8788
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = "http://localhost:$port"

function Test-Port {
  param($p)
  $conn = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  return [bool]$conn
}

function Find-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $cands = @(
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
    "C:\Program Files\nodejs\node.exe",
    "C:\Program Files (x86)\nodejs\node.exe",
    "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
  )
  foreach ($c in $cands) { if ($c -and (Test-Path $c)) { return $c } }
  return $null
}

if (-not (Test-Port $port)) {
  $node = Find-Node
  if (-not $node) {
    [System.Windows.Forms.MessageBox]::Show(
      "找不到 Node.js，无法启动服务。`n`n请先安装：https://nodejs.org",
      "生活记录", "OK", "Warning") | Out-Null
    exit 1
  }
  # 后台静默启动
  Start-Process -FilePath $node `
    -ArgumentList "`"$root\server.js`" $port" `
    -WorkingDirectory $root `
    -WindowStyle Hidden

  # 等服务就绪（最多 6 秒）
  for ($i = 0; $i -lt 24; $i++) {
    Start-Sleep -Milliseconds 250
    if (Test-Port $port) { break }
  }
}

Start-Process $url
