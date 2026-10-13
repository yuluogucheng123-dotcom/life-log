# =====================================================================
# 生活记录 · 本机服务器
#
# 双击本文件即可启动。启动后：
#   · 电脑浏览器打开  http://localhost:8788
#   · 手机连同一个 WiFi / 热点后，打开显示的局域网地址
#
# 关掉这个窗口 = 停止服务。
# =====================================================================

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = '生活记录 · 服务运行中'

$port = 8788
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Get-LanIPs {
  $ips = @()
  try {
    $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object {
        $_.IPAddress -notlike '127.*' -and
        $_.IPAddress -notlike '169.254.*' -and
        $_.PrefixOrigin -ne 'WellKnown'
      } | Select-Object -ExpandProperty IPAddress
  } catch {
    # 老系统回退
    $ips = (ipconfig | Select-String 'IPv4' | ForEach-Object {
      ($_ -split ':')[-1].Trim()
    }) | Where-Object { $_ -notlike '127.*' -and $_ -notlike '169.254.*' }
  }
  return $ips | Select-Object -Unique
}

# 找出可用的 Node
function Find-Node {
  $candidates = @()
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $candidates += $cmd.Source }

  $candidates += @(
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
    "C:\Program Files\nodejs\node.exe",
    "C:\Program Files (x86)\nodejs\node.exe",
    "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { return $c }
  }
  return $null
}

$node = Find-Node
if (-not $node) {
  Write-Host ""
  Write-Host "  找不到 Node.js。" -ForegroundColor Red
  Write-Host "  请到 https://nodejs.org 下载安装 LTS 版本后重试。" -ForegroundColor Yellow
  Write-Host ""
  Read-Host "按回车退出"
  exit 1
}

# 端口占用检查
$busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($busy) {
  Write-Host ""
  Write-Host "  端口 $port 已被占用。" -ForegroundColor Yellow
  Write-Host "  可能服务已经在运行了 —— 先在浏览器试试：" -ForegroundColor Gray
  Write-Host "    http://localhost:$port" -ForegroundColor Cyan
  Write-Host ""
  $ans = Read-Host "  要强制重启服务吗？(y/N)"
  if ($ans -match '^[Yy]') {
    $busy | ForEach-Object {
      try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
    }
    Start-Sleep -Milliseconds 800
  } else {
    exit 0
  }
}

Clear-Host
Write-Host ""
Write-Host "  ┌──────────────────────────────────────────────┐" -ForegroundColor DarkCyan
Write-Host "  │            生活记录 · 服务已启动             │" -ForegroundColor DarkCyan
Write-Host "  └──────────────────────────────────────────────┘" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  电脑上打开：" -ForegroundColor White
Write-Host "      http://localhost:$port" -ForegroundColor Green
Write-Host ""

$ips = Get-LanIPs
if ($ips.Count -gt 0) {
  Write-Host "  手机上打开（需连同一个 WiFi）：" -ForegroundColor White
  foreach ($ip in $ips) {
    Write-Host "      http://${ip}:$port" -ForegroundColor Green
  }
  Write-Host ""
  Write-Host "  如果手机打不开，多半是路由器/校园网隔离了设备互访。" -ForegroundColor DarkGray
  Write-Host "  可改用手机开热点、电脑连热点的方式，再试上面的地址。" -ForegroundColor DarkGray
} else {
  Write-Host "  没有检测到局域网地址（可能未连网）。" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  ────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  保持本窗口开着，服务就不会停。" -ForegroundColor DarkGray
Write-Host "  关掉窗口 = 停止服务（数据不会丢，存在浏览器里）。" -ForegroundColor DarkGray
Write-Host "  ────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""

# 启动服务器
$serverJs = Join-Path $root 'server.js'
& $node $serverJs $port

Write-Host ""
Write-Host "  服务已停止。" -ForegroundColor Yellow
Read-Host "按回车关闭"
