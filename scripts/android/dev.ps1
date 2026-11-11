# Native Windows Android development. Does not install tools or change execution policy.
[CmdletBinding()]
param(
    [ValidateSet('Doctor', 'Sources', 'Prepare', 'Overlay', 'Lab', 'Debug', 'Verify', 'Release', 'BenchmarkApks', 'DeviceTests')]
    [string]$Mode = 'Doctor',
    [string]$Serial
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$AndroidProject = Join-Path $Repository 'apps/android'
$Vendor = Join-Path $Repository 'vendor/deepseek-harness'
$Doctor = Join-Path $PSScriptRoot 'doctor.mjs'
$Node = (Get-Command node -CommandType Application -ErrorAction Stop).Source

function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    $NativeExitCode = $LASTEXITCODE
    if ($NativeExitCode -ne 0) {
        throw "Command failed with exit code $NativeExitCode. No later build step was run."
    }
}

function Assert-Sources {
    param([string]$Scope)
    Invoke-Checked $Node @($Doctor, '--sources-only', "--scope=$Scope")
}

function Build-Lab {
    Assert-Sources 'lab'
    Invoke-Checked $Node @((Join-Path $PSScriptRoot 'prepare-shared.mjs'))
    Invoke-Checked $Node @((Join-Path $PSScriptRoot 'build-lab.mjs'))
}

function Invoke-Gradle {
    param([string[]]$Tasks)
    $Arguments = @(
        '--project-dir', $AndroidProject,
        '--no-daemon', '--max-workers=2', '--console=plain',
        '-Dorg.gradle.java.installations.auto-download=false'
    ) + $Tasks
    Invoke-Checked (Join-Path $AndroidProject 'gradlew.bat') $Arguments
}

try {
    if ($Mode -eq 'Sources') {
        Invoke-Checked $Node @($Doctor, '--sources-only')
        exit 0
    }
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'This entry point builds Android on native Windows. Use Sources for a portable source check, or the existing Linux server toolchain.'
    }
    Push-Location $Repository
    try {
        switch ($Mode) {
            'Doctor' {
                Invoke-Checked $Node @($Doctor)
            }
            'Prepare' {
                $Git = (Get-Command git -CommandType Application -ErrorAction Stop).Source
                if (-not (Test-Path (Join-Path $Vendor '.git'))) {
                    Invoke-Checked $Git @('submodule', 'update', '--init', '--recursive')
                }
                $Pnpm = (Get-Command pnpm.cmd -CommandType Application -ErrorAction Stop).Source
                Invoke-Checked $Pnpm @('install', '--frozen-lockfile')
                Write-Host 'Dependencies prepared. Overlay materialization is explicit; it is never reset automatically.'
            }
            'Overlay' {
                $Git = (Get-Command git -CommandType Application -ErrorAction Stop).Source
                $Status = @(& $Git '-C' $Vendor 'status' '--porcelain=v1')
                $StatusExit = $LASTEXITCODE
                if ($StatusExit -ne 0) { throw 'Initialize the pinned Harness submodule before applying overlays.' }
                if ($Status.Count -gt 0) {
                    throw 'The Harness worktree is not clean. Preserve its changes first; this script will not reset them. A previously applied overlay may only need verification.'
                }
                Invoke-Checked $Node @((Join-Path $Repository 'scripts/overlay/harness-overlay.mjs'), 'apply')
            }
            'Lab' { Build-Lab }
            'Debug' {
                Assert-Sources 'app'
                Build-Lab
                Invoke-Gradle @(':app:assembleDebug')
            }
            'Verify' {
                Assert-Sources 'app'
                Build-Lab
                Invoke-Gradle @(':app:lintDebug', ':app:testDebugUnitTest', ':app:assembleDebug')
            }
            'Release' {
                Assert-Sources 'app'
                Build-Lab
                Invoke-Gradle @(':app:validateReleaseSigning', ':app:lintRelease', ':app:testReleaseUnitTest', ':app:assembleRelease', ':app:bundleRelease')
            }
            'BenchmarkApks' {
                Assert-Sources 'app'
                Build-Lab
                Invoke-Gradle @(':app:assembleBenchmarkRelease', ':benchmark:assembleBenchmarkRelease')
            }
            'DeviceTests' {
                if ([string]::IsNullOrWhiteSpace($Serial)) {
                    throw 'DeviceTests requires -Serial for an explicitly selected test device; it never chooses the first connected phone.'
                }
                Assert-Sources 'app'
                Build-Lab
                $PreviousSerial = $env:ANDROID_SERIAL
                try {
                    $env:ANDROID_SERIAL = $Serial
                    Invoke-Gradle @(':app:connectedDebugAndroidTest')
                }
                finally { $env:ANDROID_SERIAL = $PreviousSerial }
            }
        }
    }
    finally { Pop-Location }
}
catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 1
}
