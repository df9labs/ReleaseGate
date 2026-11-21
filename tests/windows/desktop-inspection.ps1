# Run in Windows PowerShell 5.1 on a signed-in desktop.
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $project 'scripts\inspect-windows-app.ps1')

$scratch = Join-Path $project ('.work\windows-test-' + [Guid]::NewGuid().ToString('N'))
$executable = Join-Path $scratch 'ReleaseGateDesktopTest.exe'
$fixtureSource = Join-Path $scratch 'Fixture.cs'
$frameworkDir = [Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
[IO.Directory]::CreateDirectory($scratch) | Out-Null

function Start-WindowFixture {
    $process = Start-Process -FilePath $executable -PassThru
    $script:fixture = $process
    if (!$process.WaitForInputIdle(5000)) { throw 'Fixture window did not open.' }
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        $targets = @(Get-AppTargets $executable)
        if ($targets.Length -eq 1 -and $targets[0].processId -eq $process.Id) { return $targets[0] }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'The inspector did not match the disposable fixture by path.'
}

function Stop-WindowFixture {
    if (!$script:fixture) { return }
    try {
        if (!$script:fixture.HasExited) {
            $script:fixture.Kill()
            if (!$script:fixture.WaitForExit(3000)) { throw 'Fixture did not exit.' }
        }
    } finally { $script:fixture.Dispose(); $script:fixture = $null }
}

function Assert-DesktopAction($Target, $Inventory, [string]$Button, [string]$Expected, [string]$Verdict) {
    $entry = @($Inventory.buttons | Where-Object name -ceq $Button)[0]
    if (!$entry) { throw "Missing fixture button '$Button'." }
    $outcome = Invoke-AppWorker @{
        operation = 'check'; target = $Target; runtimeId = $entry.runtimeId; button = $Button; expected = $Expected
    }
    if ($outcome.outcome -ne $Verdict) {
        throw "Expected '$Verdict' for '$Button', received '$($outcome.outcome)'. $($outcome.detail)"
    }
    Write-Output "$Button / $Expected -> $Verdict"
}

try {
    # This fixture performs no file writes, network requests or changes to installed applications.
    [IO.File]::WriteAllText($fixtureSource, @'
using System.Windows;
using System.Windows.Controls;

public static class Fixture {
    [System.STAThread]
    public static void Main() {
        var app = new Application();
        var window = new Window { Title = "ReleaseGate disposable fixture", Width = 400, Height = 350 };
        var panel = new StackPanel();
        var proof = new TextBlock { Text = "Preview opened", Visibility = Visibility.Collapsed };
        var reveal = new Button { Content = "Open preview" };
        reveal.Click += delegate { proof.Visibility = Visibility.Visible; };
        var modal = new Button { Content = "Open dialogue" };
        modal.Click += delegate {
            new Window { Title = "Fixture dialogue", Owner = window, Width = 200, Height = 150 }.ShowDialog();
        };
        var close = new Button { Content = "Exit fixture" };
        close.Click += delegate { window.Close(); };
        foreach (var item in new UIElement[] {
            reveal, new Button { Content = "No change" },
            new Button { Content = "Disabled fixture button", IsEnabled = false },
            new Button { Content = "Hidden fixture button", Visibility = Visibility.Collapsed },
            new Button { Content = "Shared name" }, new Button { Content = "Shared name" },
            new Button { Content = @"Open C:\private\fixture-project" },
            modal, close, proof
        }) { panel.Children.Add(item); }
        window.Content = panel;
        app.Run(window);
    }
}
'@)
    $references = @("/reference:$($frameworkDir)System.Xaml.dll")
    foreach ($assembly in @('PresentationCore', 'PresentationFramework', 'WindowsBase')) {
        $references += "/reference:$($frameworkDir)WPF\$assembly.dll"
    }
    & (Join-Path $frameworkDir 'csc.exe') /nologo /target:winexe "/out:$executable" @references $fixtureSource
    if ($LASTEXITCODE -ne 0) { throw 'Could not compile the disposable Windows fixture.' }

    $target = Start-WindowFixture
    $inventory = Invoke-AppWorker @{ operation = 'inventory'; target = $target }
    if (!@($inventory.buttons | Where-Object { $_.name -ceq 'Disabled fixture button' -and !$_.enabled }).Count -or
        @($inventory.buttons | Where-Object name -ceq 'Hidden fixture button').Count -or
        @($inventory.buttons | Where-Object name -ceq 'Shared name').Count -ne 2 -or
        !@($inventory.buttons | Where-Object { $_.name -ceq '[File path omitted]' -and !$_.eligible }).Count -or
        ($inventory | ConvertTo-Json -Depth 4) -match 'fixture-project') {
        throw 'Inventory did not handle visible, disabled, duplicate and private button names correctly.'
    }
    Assert-DesktopAction $target $inventory 'Shared name' 'Preview opened' 'inconclusive'
    Assert-DesktopAction $target $inventory 'Disabled fixture button' 'Preview opened' 'inconclusive'
    Assert-DesktopAction $target $inventory 'Open preview' 'Open preview' 'inconclusive'
    Assert-DesktopAction $target $inventory 'Open preview' 'Preview opened' 'passed'
    Assert-DesktopAction $target $inventory 'No change' 'Absent outcome' 'failed'
    Assert-DesktopAction $target $inventory 'Open dialogue' 'Outside the selected window' 'inconclusive'
    Stop-WindowFixture

    $target = Start-WindowFixture
    $inventory = Invoke-AppWorker @{ operation = 'inventory'; target = $target }
    Assert-DesktopAction $target $inventory 'Exit fixture' 'Outside the selected window' 'inconclusive'
    Write-Output 'Windows desktop inspection checks passed.'
} finally {
    Stop-WindowFixture
    foreach ($file in @($fixtureSource, $executable)) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
    }
    [IO.Directory]::Delete($scratch)
}
