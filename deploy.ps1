# =====================================================================
# 生活记录 · 一键部署到 GitHub Pages
#
# 用法：右键本文件 →「使用 PowerShell 运行」
#   或在 PowerShell 里执行：  .\deploy.ps1
#
# 脚本会引导你完成：检查配置 → 提交 → 推送 → 开启 Pages
# =====================================================================

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = '生活记录 · 部署'

function Write-Step($n, $text) {
  Write-Host ""
  Write-Host "  [$n] $text" -ForegroundColor Cyan
}
function Write-Ok($text)   { Write-Host "      √ $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "      ! $text" -ForegroundColor Yellow }
function Write-Err($text)  { Write-Host "      × $text" -ForegroundColor Red }

Clear-Host
Write-Host ""
Write-Host "  ┌────────────────────────────────────────┐" -ForegroundColor DarkCyan
Write-Host "  │   生活记录 · 部署到 GitHub Pages       │" -ForegroundColor DarkCyan
Write-Host "  └────────────────────────────────────────┘" -ForegroundColor DarkCyan

# ---------------------------------------------------------------------
# 1. 检查环境
# ---------------------------------------------------------------------
Write-Step 1 "检查环境"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Err "没有找到 git。请先安装：https://git-scm.com/download/win"
  Read-Host "按回车退出"; exit 1
}
Write-Ok "git 已安装"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
Write-Ok "工作目录：$here"

# ---------------------------------------------------------------------
# 2. 检查 config.js
# ---------------------------------------------------------------------
Write-Step 2 "检查云端配置（config.js）"

$cfgPath = Join-Path $here 'config.js'
$cfg = Get-Content $cfgPath -Raw

$urlMatch = [regex]::Match($cfg, "window\.SUPABASE_URL\s*=\s*'([^']*)'")
$keyMatch = [regex]::Match($cfg, "window\.SUPABASE_ANON_KEY\s*=\s*'([^']*)'")
$hasUrl = $urlMatch.Success -and $urlMatch.Groups[1].Value.Trim() -ne ''
$hasKey = $keyMatch.Success -and $keyMatch.Groups[1].Value.Trim() -ne ''

if ($hasUrl -and $hasKey) {
  Write-Ok "SUPABASE_URL 已填写"
  Write-Ok "SUPABASE_ANON_KEY 已填写"
} else {
  Write-Warn "config.js 还没填写（或只填了一半）"
  Write-Host ""
  Write-Host "      不填也能部署，但那样手机和电脑的数据不会同步。" -ForegroundColor Gray
  Write-Host "      想启用同步：先去 https://supabase.com 建项目，执行 supabase-schema.sql，" -ForegroundColor Gray
  Write-Host "      拿到 Project URL 和 anon key，填进 config.js，再重新运行本脚本。" -ForegroundColor Gray
  Write-Host ""
  $ans = Read-Host "      仍然继续部署吗？(y/N)"
  if ($ans -notmatch '^[Yy]') {
    Write-Host ""
    Write-Host "      已取消。填好 config.js 后再运行本脚本。" -ForegroundColor Yellow
    Read-Host "按回车退出"; exit 0
  }
}

# ---------------------------------------------------------------------
# 3. 确认仓库地址
# ---------------------------------------------------------------------
Write-Step 3 "设置 GitHub 仓库"

$existingRemote = ''
try { $existingRemote = (git remote get-url origin 2>$null) } catch { }

if ($existingRemote) {
  Write-Ok "已配置远程仓库：$existingRemote"
  $repo = $existingRemote
} else {
  Write-Host ""
  Write-Host "      请先在浏览器打开  https://github.com/new" -ForegroundColor White
  Write-Host "      创建一个仓库：" -ForegroundColor White
  Write-Host "        · Repository name 填： life-log" -ForegroundColor Gray
  Write-Host "        · 选 Public（必须是公开，Pages 免费版的要求）" -ForegroundColor Gray
  Write-Host "        · 不要勾选 Add a README" -ForegroundColor Gray
  Write-Host "        · 点 Create repository" -ForegroundColor Gray
  Write-Host ""
  $user = Read-Host "      你的 GitHub 用户名"
  if ([string]::IsNullOrWhiteSpace($user)) { Write-Err "用户名不能为空"; Read-Host "按回车退出"; exit 1 }
  $repo = "https://github.com/$($user.Trim())/life-log.git"
  Write-Ok "将使用：$repo"
}

# ---------------------------------------------------------------------
# 4. 提交
# ---------------------------------------------------------------------
Write-Step 4 "提交文件"

if (-not (Test-Path (Join-Path $here '.git'))) {
  git init | Out-Null
  Write-Ok "已初始化 git 仓库"
} else {
  Write-Ok "git 仓库已存在"
}

# 忽略规则
$ignorePath = Join-Path $here '.gitignore'
@'
# 测试与临时文件
_*.js
_*.html
_*.txt
*.log

# 系统文件
.DS_Store
Thumbs.db
desktop.ini
'@ | Set-Content -Path $ignorePath -Encoding UTF8
Write-Ok "已写入 .gitignore"

git add -A
$status = git status --porcelain
if ([string]::IsNullOrWhiteSpace($status)) {
  Write-Ok "没有新改动需要提交"
} else {
  git commit -m "更新生活记录应用" | Out-Null
  Write-Ok "已提交改动"
}

git branch -M main 2>$null

# ---------------------------------------------------------------------
# 5. 推送
# ---------------------------------------------------------------------
Write-Step 5 "推送到 GitHub"

if (-not $existingRemote) {
  git remote add origin $repo
}

Write-Host "      正在推送…（首次会弹出登录窗口，用浏览器授权即可）" -ForegroundColor Gray
try {
  git push -u origin main
  Write-Ok "推送成功"
} catch {
  Write-Err "推送失败"
  Write-Host ""
  Write-Host "      常见原因：" -ForegroundColor Yellow
  Write-Host "        · 仓库还没创建 → 先去 https://github.com/new 建一个" -ForegroundColor Gray
  Write-Host "        · 没登录 GitHub → 重新运行脚本并在弹窗里授权" -ForegroundColor Gray
  Write-Host "        · 仓库名不是 life-log → 在 $repo 里改对" -ForegroundColor Gray
  Read-Host "按回车退出"; exit 1
}

# ---------------------------------------------------------------------
# 6. 给出网址并尝试自动开启 Pages
# ---------------------------------------------------------------------
Write-Step 6 "开启 GitHub Pages"

$repoUrl = ($repo -replace '\.git$', '')
$pagesUrl = ($repoUrl -replace 'https://github.com/', 'https://') + '.github.io/life-log/'

Write-Host ""
Write-Host "      打开下面的地址，开启 Pages：" -ForegroundColor White
Write-Host "        $repoUrl/settings/pages" -ForegroundColor Cyan
Write-Host ""
Write-Host "      设置方式：" -ForegroundColor White
Write-Host "        Source        →  Deploy from a branch" -ForegroundColor Gray
Write-Host "        Branch        →  main" -ForegroundColor Gray
Write-Host "        目录          →  / (root)" -ForegroundColor Gray
Write-Host "        然后点 Save" -ForegroundColor Gray
Write-Host ""

$open = Read-Host "      现在帮你打开这个页面吗？(Y/n)"
if ($open -notmatch '^[Nn]') {
  Start-Process "$repoUrl/settings/pages"
}

Write-Host ""
Write-Host "  ┌────────────────────────────────────────┐" -ForegroundColor DarkGreen
Write-Host "  │  完成！等 1~2 分钟后，你的网址是：     │" -ForegroundColor DarkGreen
Write-Host "  └────────────────────────────────────────┘" -ForegroundColor DarkGreen
Write-Host ""
Write-Host "      $pagesUrl" -ForegroundColor Green
Write-Host ""
Write-Host "  手机：用 Safari 打开 → 分享 → 添加到主屏幕" -ForegroundColor White
Write-Host "  电脑：用 Edge/Chrome 打开 → 地址栏右侧安装图标" -ForegroundColor White
Write-Host ""
Write-Host "  两端用同一个邮箱注册/登录，数据就会自动同步。" -ForegroundColor White
Write-Host ""

$test = Read-Host "  现在打开网址看看吗？(Y/n)"
if ($test -notmatch '^[Nn]') { Start-Process $pagesUrl }

Write-Host ""
Read-Host "按回车关闭"
