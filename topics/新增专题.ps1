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

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

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
Push-Location $RepoRoot
try {
    git add "topics/$Id" "topics/index.html" 2>&1 | Out-Null

    $msg = "新增学习专题：$Name"
    git commit -m $msg 2>&1 | Out-Null

    if ($LASTEXITCODE -ne 0) {
        Write-Host "  没有需要提交的改动" -ForegroundColor Yellow
    } else {
        Write-Host "  已提交: $msg" -ForegroundColor Green
    }

    if (-not $NoPush) {
        Write-Host "`n=== 推送到 GitHub ===" -ForegroundColor Cyan
        git push 2>&1 | ForEach-Object { "  $_" }

        if ($LASTEXITCODE -eq 0) {
            Write-Host "`n推送成功！" -ForegroundColor Green
            Write-Host "约 1 分钟后生效：" -ForegroundColor Cyan
            Write-Host "  https://yuluogucheng123-dotcom.github.io/life-log/topics/" -ForegroundColor Green
            Write-Host "  （专题直达：.../topics/$Id/）"
        } else {
            Write-Host "`n推送失败，请检查网络或凭据。" -ForegroundColor Red
        }
    } else {
        Write-Host "`n已跳过推送（-NoPush）" -ForegroundColor Yellow
    }
}
finally {
    Pop-Location
}

Write-Host ""
