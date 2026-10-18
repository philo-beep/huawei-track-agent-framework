$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$env:PYTHONUTF8 = '1'

try {
    $webAddress = 'http://127.0.0.1:8767/'
    $webServerFile = Join-Path $PSScriptRoot 'backend/marketing/web-server.js'
    if (-not (Test-Path -LiteralPath $webServerFile)) { throw '网页服务文件尚未就绪。' }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '未找到Node.js。' }
    Write-Host '门店增长智能体 · 本地网页'
    Write-Host ('浏览器访问：' + $webAddress)
    Write-Host '在页面按指引填入客户信息，或使用页面标明的快捷键填充合成示例。'
    Write-Host 'IMA已停用；本地知识库与华为官网逐条留源。假设报价不能作为交易报价。'
    $existingService = $null
    try { $existingService = Invoke-RestMethod -Uri ($webAddress + 'api/health') -TimeoutSec 2 } catch {}
    if ($existingService.status -eq 'ok' -and $existingService.ima_enabled -eq $false -and $existingService.model -eq 'qwen2.5vl:7b') {
        Write-Host '本机网页服务已在运行，直接打开上方地址即可，无需重复启动。'
        exit 0
    }
    Write-Host '请保持此窗口打开；关闭窗口将停止本次启动的服务。'
    & node $webServerFile --port 8767
    exit $LASTEXITCODE
}
catch {
    Write-Host ('启动未完成：' + $_.Exception.Message)
    Write-Host '若网页已在运行，可直接访问 http://127.0.0.1:8767/ 。'
    exit 1
}
