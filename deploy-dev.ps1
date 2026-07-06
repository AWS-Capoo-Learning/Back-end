param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string] $FunctionName
)

$ErrorActionPreference = "Stop"
$Region = "us-east-1"

$Functions = @{
    "getAllProject"         = "modules\image\get-all"
    "upscale-uploadImage"   = "modules\image\upload-image"
    "process-image-upscale" = "modules\image\process-upscale"
    "ProcessStarter"        = "modules\image\process-starter"
    "lambda-auth"           = "modules\auth\authorizer"
    "register_user"         = "modules\auth\register"
    "revoke_token"          = "modules\auth\revoke-token"
    "getAllUser"            = "modules\user\get-all"
    "updateRole"            = "modules\user\update-role"
}

if (-not $Functions.ContainsKey($FunctionName)) {
    throw "Unknown function '$FunctionName'. Valid names: $($Functions.Keys -join ', ')"
}

$SourceDirectory = Join-Path $PSScriptRoot $Functions[$FunctionName]
$ZipPath = Join-Path ([IO.Path]::GetTempPath()) "$FunctionName-$([guid]::NewGuid().ToString('N')).zip"

if (-not (Test-Path (Join-Path $SourceDirectory "index.mjs"))) {
    throw "Missing index.mjs in $SourceDirectory"
}

try {
    # One-time safety: pin Prod to the current code before changing $LATEST.
    $ProdVersion = & aws lambda get-alias `
        --function-name $FunctionName `
        --name Prod `
        --region $Region `
        --query FunctionVersion `
        --output text `
        --no-cli-pager 2>$null

    if ($LASTEXITCODE -eq 0 -and $ProdVersion -eq '$LATEST') {
        Write-Host "Pinning current Prod code before updating Dev..." -ForegroundColor Yellow
        $BaselineVersion = & aws lambda publish-version `
            --function-name $FunctionName `
            --region $Region `
            --query Version `
            --output text `
            --no-cli-pager

        & aws lambda update-alias `
            --function-name $FunctionName `
            --name Prod `
            --function-version $BaselineVersion `
            --region $Region `
            --no-cli-pager | Out-Null
    }

    Write-Host "Packaging $FunctionName..." -ForegroundColor Cyan
    Compress-Archive -Path (Join-Path $SourceDirectory "*") -DestinationPath $ZipPath -Force

    Write-Host "Uploading code..." -ForegroundColor Cyan
    & aws lambda update-function-code `
        --function-name $FunctionName `
        --zip-file "fileb://$ZipPath" `
        --region $Region `
        --no-cli-pager | Out-Null

    if ($LASTEXITCODE -ne 0) {
        throw "Code upload failed."
    }

    & aws lambda wait function-updated `
        --function-name $FunctionName `
        --region $Region

    $DevVersion = & aws lambda publish-version `
        --function-name $FunctionName `
        --region $Region `
        --query Version `
        --output text `
        --no-cli-pager

    & aws lambda update-alias `
        --function-name $FunctionName `
        --name Dev `
        --function-version $DevVersion `
        --region $Region `
        --no-cli-pager | Out-Null

    if ($LASTEXITCODE -ne 0) {
        throw "Dev alias update failed."
    }

    Write-Host "Deployed $FunctionName version $DevVersion to Dev." -ForegroundColor Green
}
finally {
    if (Test-Path $ZipPath) {
        Remove-Item $ZipPath -Force
    }
}
