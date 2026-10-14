# =====================================================================
# 新增学习专题
#
# 用法：
#   把 skill 生成的 HTML 文件拖到本脚本上，或：
#   .\新增专题.ps1 -Html "C:\路径\xxx.html" -Name "专题名" -Icon "📖" -Tags "英语,精读"
#
# 它会：
#   1. 生成一个安全的英文目录名
#   2. 把 HTML 复制为 topics/<目录名>/index.html
#   3. 自动更新 topics/index.html 里的专题清单
#   4. git 提交并推送（GitHub Pages 约 1 分钟后生效）
#
# 如果提示「禁止运行脚本」，用这个方式运行（绕过一次即可）：
#   powershell -ExecutionPolicy Bypass -File "新增专题.ps1" -Html ... -Name ...
# =====================================================================

param(
    [Parameter(Mandatory = $true)]
    [string]$Html,

    [Parameter(Mandatory = $true)]
    [string]$Name,

    [string]$Icon = "📄",
    [string]$Tags = "",
    [string]$Desc = "",
    [string]$Id = "",
    [switch]$NoPush
)

# 脚本自身的错误统一走下面的 trap，显示成友好提示而不是红色堆栈
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 任何未捕获的错误都变成一行清晰提示
trap {
    Write-Host "`n出错了：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    exit 1
}

# 定位仓库根目录（本脚本在 topics\ 里）
$TopicsDir = $PSScriptRoot
$RepoRoot  = Split-Path $TopicsDir -Parent

if (-not (Test-Path (Join-Path $RepoRoot '.git'))) {
    throw "找不到 git 仓库：$RepoRoot"
}

# ---------- 1. 校验源文件 ----------
if (-not (Test-Path $Html)) { throw "找不到 HTML 文件：$Html" }
$Html = (Resolve-Path $Html).Path
$sizeKB = [math]::Round((Get-Item $Html).Length / 1KB, 1)

Write-Host "`n=== 新增学习专题 ===" -ForegroundColor Cyan
Write-Host "  源文件: $Html"
Write-Host "  大小  : $sizeKB KB"
Write-Host "  名称  : $Name"

# ---------- 2. 生成目录名 ----------
if (-not $Id) {
    # 从名称生成：保留字母数字，其余转拼音不可行，改用时间戳 + 简短标识
    $slug = ($Name -replace '[^\w]', '')
    if ($slug.Length -gt 18) { $slug = $slug.Substring(0, 18) }
    if (-not $slug) { $slug = 'topic' }
    $Id = "$slug-" + (Get-Date -Format 'MMddHHmm')
    # 目录名用 ASCII，避免各种工具链编码问题
    $Id = $Id -replace '[^\x20-\x7E]', ''
    if (-not $Id -or $Id -eq '-') { $Id = 'topic-' + (Get-Date -Format 'MMddHHmm') }
}

$DestDir = Join-Path $TopicsDir $Id
if (Test-Path $DestDir) { throw "目录已存在：$DestDir（换一个 -Id）" }

Write-Host "  目录名: topics\$Id" -ForegroundColor Green

# ---------- 3. 复制文件 ----------
New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
Copy-Item $Html (Join-Path $DestDir 'index.html') -Force
Write-Host "  已复制到: topics\$Id\index.html"

# ---------- 4. 更新清单 ----------
$IndexPath = Join-Path $TopicsDir 'index.html'
$content = Get-Content $IndexPath -Raw -Encoding UTF8

if ($content -match [regex]::Escape("id: '$Id'")) {
    Write-Host "  清单里已存在该 id，跳过添加" -ForegroundColor Yellow
} else {
    # 转义用于 JS 单引号字符串
    function JsEscape([string]$s) {
        if ($null -eq $s) { return '' }
        return $s.Replace('\', '\\').Replace("'", "\'").Replace("`r", '').Replace("`n", ' ')
    }

    $tagList = @()
    if ($Tags) {
        $tagList = $Tags.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    }

    $tagsJs = ($tagList | ForEach-Object { "'" + (JsEscape $_) + "'" }) -join ', '
    $date   = Get-Date -Format 'yyyy-MM-dd'

    $newEntry = @"
  {
    id: '$(JsEscape $Id)',
    icon: '$(JsEscape $Icon)',
    name: '$(JsEscape $Name)',
    desc: '$(JsEscape $Desc)',
    tags: [$tagsJs],
    cls: '',
    date: '$date',
    source: 'skill'
  },
"@

    # 插入到 TOPICS = [ 之后，保持最新在前（render 里还会再排序）
    $anchor = 'const TOPICS = ['
    $pos = $content.IndexOf($anchor)
    if ($pos -lt 0) { throw "在 topics\index.html 里找不到 `"$anchor`"" }

    $insertAt = $pos + $anchor.Length
    $content = $content.Substring(0, $insertAt) + "`n" + $newEntry + $content.Substring($insertAt)
    Set-Content -Path $IndexPath -Value $content -Encoding UTF8 -NoNewline
    Write-Host "  已更新清单（当前共 $(([regex]::Matches($content, "id: '")).Count) 个专题）"
}

# ---------- 5. 提交并推送 ----------
# 坑：git 会把 "LF will be replaced by CRLF" 这类提示写到 stderr。
# 脚本开头设了 $ErrorActionPreference='Stop'，PowerShell 会因此把原生命令的
# stderr 当成终止性错误，直接中断脚本 —— 哪怕 git 本身成功（exit 0）。
# 解决办法：调用 git 前临时把 ErrorActionPreference 降回 Continue，并丢弃 stderr。

function Invoke-Git {
    param([string[]]$GitArgs)

    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'   # 关键：别让 stderr 触发终止
    try {
        & git @GitArgs 2>$null | Out-Null
        return $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $prev
    }
}

Push-Location $RepoRoot
try {
    # 只暂存本次新增的内容，绝不动工作区里其它未提交的改动
    $code = Invoke-Git @('add', "topics/$Id", 'topics/index.html')
    if ($code -ne 0) { throw "git add 失败（exit $code）" }

    $msg = "新增学习专题：$Name"
    $code = Invoke-Git @('commit', '-m', $msg)

    if ($code -ne 0) {
        Write-Host "  没有需要提交的改动（可能内容与上次完全相同）" -ForegroundColor Yellow
    } else {
        Write-Host "  已提交: $msg" -ForegroundColor Green
    }

    if ($NoPush) {
        Write-Host "`n已跳过推送（-NoPush）" -ForegroundColor Yellow
        return
    }

    # ---------- 推送（带重试，网络抖动很常见） ----------
    Write-Host "`n=== 推送到 GitHub ===" -ForegroundColor Cyan

    $pushed = $false
    for ($i = 1; $i -le 4; $i++) {
        $code = Invoke-Git @('push')

        if ($code -eq 0) { $pushed = $true; break }

        if ($i -lt 4) {
            Write-Host "  第 $i 次推送失败（exit $code），5 秒后重试…" -ForegroundColor Yellow
            Start-Sleep -Seconds 5
        }
    }

    if ($pushed) {
        Write-Host "`n推送成功！" -ForegroundColor Green
        Write-Host "约 1 分钟后生效：" -ForegroundColor Cyan
        Write-Host "  https://yuluogucheng123-dotcom.github.io/life-log/topics/" -ForegroundColor Green
        Write-Host "  （专题直达：.../topics/$Id/）"
    } else {
        Write-Host "`n推送失败（已重试 4 次）。" -ForegroundColor Red
        Write-Host "  内容已提交到本地，网络恢复后手动推送即可：" -ForegroundColor Yellow
        Write-Host "    cd `"$RepoRoot`"; git push" -ForegroundColor Yellow
        Write-Host "  （github.com 偶尔连不上，重试通常就好）" -ForegroundColor DarkGray
    }
}
catch {
    Write-Host "`n出错：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  专题文件已复制到：topics\$Id\" -ForegroundColor Yellow
    Write-Host "  可手动执行：cd `"$RepoRoot`"; git add topics; git commit -m `"新增专题`"; git push" -ForegroundColor Yellow
}
finally {
    Pop-Location
}

Write-Host ""
