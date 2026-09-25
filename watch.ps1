param(
    [ValidateRange(10, 86400)]
    [int]$Seconds = 60,

    [string]$Semester = "20263"
)

$ErrorActionPreference = "Stop"

Write-Host "FLEX Marks Watcher"
Write-Host "Cookie input is hidden and is not saved by this script."
Write-Host "Paste either the ASP.NET_SessionId VALUE or a full Cookie header."
$secureCookie = Read-Host "Cookie" -AsSecureString

$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureCookie)
try {
    $cookie = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ([string]::IsNullOrWhiteSpace($cookie)) {
    throw "Cookie cannot be empty."
}

$env:FLEX_COOKIE = $cookie
$env:FLEX_SEMESTER_ID = $Semester
$env:FLEX_POLL_MS = ([int64]$Seconds * 1000).ToString()

try {
    npm start
}
finally {
    Remove-Item Env:FLEX_COOKIE -ErrorAction SilentlyContinue
    Remove-Item Env:FLEX_SEMESTER_ID -ErrorAction SilentlyContinue
    Remove-Item Env:FLEX_POLL_MS -ErrorAction SilentlyContinue
}
