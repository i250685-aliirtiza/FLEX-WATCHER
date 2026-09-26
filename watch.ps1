param(
    [ValidateRange(10, 86400)]
    [int]$Seconds = 300,

    [string]$Semester = "20263",

    [switch]$Email,
    [string]$SmtpUser = "",
    [string]$EmailTo = "",
    [string]$SmtpHost = "smtp.gmail.com",

    [ValidateRange(1, 65535)]
    [int]$SmtpPort = 465
)

$ErrorActionPreference = "Stop"

function Read-PlainTextSecret([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

Write-Host "FLEX Marks Watcher"
Write-Host "Cookie input is hidden and is not saved by this script."
Write-Host "Paste either the ASP.NET_SessionId VALUE or a full Cookie header."
$cookie = Read-PlainTextSecret "Cookie"

if ([string]::IsNullOrWhiteSpace($cookie)) {
    throw "Cookie cannot be empty."
}

$env:FLEX_COOKIE = $cookie
$env:FLEX_SEMESTER_ID = $Semester
$env:FLEX_POLL_MS = ([int64]$Seconds * 1000).ToString()

if ($Email) {
    if ([string]::IsNullOrWhiteSpace($SmtpUser)) {
        $SmtpUser = Read-Host "Sender Gmail / SMTP username"
    }
    if ([string]::IsNullOrWhiteSpace($EmailTo)) {
        $EmailTo = $SmtpUser
    }

    Write-Host "SMTP password input is hidden and is not saved by this script."
    Write-Host "For Gmail, use a Google App Password, not your normal account password."
    $smtpPass = Read-PlainTextSecret "SMTP password"
    if ([string]::IsNullOrWhiteSpace($smtpPass)) {
        throw "SMTP password cannot be empty."
    }

    $env:FLEX_SMTP_USER = $SmtpUser
    $env:FLEX_SMTP_PASS = $smtpPass
    $env:FLEX_EMAIL_TO = $EmailTo
    $env:FLEX_SMTP_HOST = $SmtpHost
    $env:FLEX_SMTP_PORT = $SmtpPort.ToString()
}

try {
    npm start
}
finally {
    Remove-Item Env:FLEX_COOKIE -ErrorAction SilentlyContinue
    Remove-Item Env:FLEX_SEMESTER_ID -ErrorAction SilentlyContinue
    Remove-Item Env:FLEX_POLL_MS -ErrorAction SilentlyContinue

    if ($Email) {
        Remove-Item Env:FLEX_SMTP_USER -ErrorAction SilentlyContinue
        Remove-Item Env:FLEX_SMTP_PASS -ErrorAction SilentlyContinue
        Remove-Item Env:FLEX_EMAIL_TO -ErrorAction SilentlyContinue
        Remove-Item Env:FLEX_SMTP_HOST -ErrorAction SilentlyContinue
        Remove-Item Env:FLEX_SMTP_PORT -ErrorAction SilentlyContinue
    }
}
