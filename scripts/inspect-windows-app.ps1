param([switch]$Worker)

$script:InspectorFile = $PSCommandPath
$script:ButtonLimit = 100
$script:CheckLimit = 8
$script:NameLimit = 160
$script:ObservationMs = 4000
$script:WorkerMs = 15000

function Get-AppTargets([string]$Executable) {
    $session = [Diagnostics.Process]::GetCurrentProcess().SessionId
    $name = [IO.Path]::GetFileNameWithoutExtension($Executable)
    foreach ($candidate in [Diagnostics.Process]::GetProcessesByName($name)) {
        try {
            if ($candidate.SessionId -ne $session -or $candidate.MainWindowHandle -eq [IntPtr]::Zero) { continue }
            if (![string]::Equals($candidate.MainModule.FileName, $Executable, [StringComparison]::OrdinalIgnoreCase)) { continue }
            [pscustomobject]@{
                processId = $candidate.Id
                started = $candidate.StartTime.ToUniversalTime().Ticks.ToString()
                window = $candidate.MainWindowHandle.ToInt64().ToString()
                executable = $Executable
            }
        } catch {
            # Another process can close or deny access between enumeration and inspection.
        } finally { $candidate.Dispose() }
    }
}

function Get-AppRoot($Target) {
    $process = [Diagnostics.Process]::GetProcessById([int]$Target.processId)
    try {
        $handle = $process.MainWindowHandle
        if ($handle -eq [IntPtr]::Zero -or $handle.ToInt64().ToString() -ne $Target.window -or
            $process.StartTime.ToUniversalTime().Ticks.ToString() -ne $Target.started -or
            $process.SessionId -ne [Diagnostics.Process]::GetCurrentProcess().SessionId -or
            ![string]::Equals($process.MainModule.FileName, $Target.executable, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'The selected window changed.'
        }
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
        if (!$root -or $root.Current.ProcessId -ne $process.Id -or $root.Current.IsOffscreen) {
            throw 'The selected window is unavailable.'
        }
        if (![ReleaseGateWindowState]::IsWindowEnabled($handle)) {
            throw 'The selected window is disabled or waiting for another window.'
        }
        return $root
    } finally { $process.Dispose() }
}

function New-UiaProperty($Property, $Value) {
    [System.Windows.Automation.PropertyCondition]::new($Property, $Value)
}

function Test-ContainsFilePath([string]$Name) {
    return $Name -match '(?i)(?:[a-z]:[\\/]|\\\\[^\\\s]|file:/)'
}

function Get-AppCondition([int]$ProcessId, [switch]$Buttons, [string]$ExactName) {
    $element = [System.Windows.Automation.AutomationElement]
    $parts = [Collections.Generic.List[System.Windows.Automation.Condition]]::new()
    $parts.Add((New-UiaProperty $element::ProcessIdProperty $ProcessId))
    $parts.Add((New-UiaProperty $element::IsControlElementProperty $true))
    $parts.Add((New-UiaProperty $element::IsOffscreenProperty $false))
    $parts.Add((New-UiaProperty $element::IsPasswordProperty $false))
    if ($Buttons) {
        $parts.Add((New-UiaProperty $element::ControlTypeProperty ([System.Windows.Automation.ControlType]::Button)))
    } else {
        # An accessible control name is enough. Never read a text box or document value.
        foreach ($controlType in @([System.Windows.Automation.ControlType]::Edit, [System.Windows.Automation.ControlType]::Document)) {
            $parts.Add([System.Windows.Automation.NotCondition]::new((New-UiaProperty $element::ControlTypeProperty $controlType)))
        }
    }
    if ($PSBoundParameters.ContainsKey('ExactName')) { $parts.Add((New-UiaProperty $element::NameProperty $ExactName)) }
    [System.Windows.Automation.AndCondition]::new($parts.ToArray())
}

function Read-AppButtons($Target) {
    $root = Get-AppRoot $Target
    $scope = [System.Windows.Automation.TreeScope]::Descendants
    $matches = $root.FindAll($scope, (Get-AppCondition $Target.processId -Buttons))
    $rows = @(
        for ($index = 0; $index -lt [Math]::Min($matches.Count, $script:ButtonLimit); $index++) {
            $item = $matches.Item($index)
            $name = [string]$item.Current.Name
            $enabled = $item.Current.IsEnabled
            $short = $name.Length -le $script:NameLimit
            $privatePath = Test-ContainsFilePath $name
            if ($privatePath) { $name = '[File path omitted]' }
            elseif (!$short) { $name = $name.Substring(0, $script:NameLimit) }
            [pscustomobject]@{
                name = $name
                enabled = $enabled
                eligible = $enabled -and $short -and !$privatePath -and ![string]::IsNullOrWhiteSpace($name) -and $name -eq $name.Trim()
                runtimeId = ($item.GetRuntimeId() -join ',')
            }
        }
    )
    return @{ buttons = $rows; total = $matches.Count }
}

function Test-AppAction($Request) {
    $target = $Request.target
    $result = [ordered]@{ button = $Request.button; expected = $Request.expected; outcome = 'inconclusive'; detail = '' }
    $scope = [System.Windows.Automation.TreeScope]::Descendants
    $invocationAttempted = $false
    try {
        $root = Get-AppRoot $target
        $buttonCondition = Get-AppCondition $target.processId -Buttons -ExactName $Request.button
        $matches = $root.FindAll($scope, $buttonCondition)
        if ($matches.Count -ne 1) {
            $result.detail = 'The button was missing or its name matched several visible buttons. No action was taken.'
            return $result
        }
        $button = $matches.Item(0)
        if (($button.GetRuntimeId() -join ',') -ne $Request.runtimeId -or !$button.Current.IsEnabled) {
            $result.detail = 'The selected button changed or became disabled before the check. No action was taken.'
            return $result
        }
        $pattern = $null
        if (!$button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
            $result.detail = 'This button does not expose the Windows Invoke action. No action was taken.'
            return $result
        }
        $expectedCondition = Get-AppCondition $target.processId -ExactName $Request.expected
        if ($root.FindFirst($scope, $expectedCondition)) {
            $result.detail = 'The expected name was already visible before the check. No action was taken.'
            return $result
        }
        $invocationAttempted = $true
        $pattern.Invoke()
        $clock = [Diagnostics.Stopwatch]::StartNew()
        do {
            $root = Get-AppRoot $target
            if ($root.FindFirst($scope, $expectedCondition)) {
                $result.outcome = 'passed'
                $result.detail = 'The expected accessible name was absent before invocation and appeared in the selected window afterwards.'
                return $result
            }
            Start-Sleep -Milliseconds 200
        } while ($clock.ElapsedMilliseconds -lt $script:ObservationMs)
        $result.outcome = 'failed'
        $result.detail = 'The button accepted invocation. The expected accessible name did not appear in the selected window within four seconds.'
    } catch {
        $result.detail = if ($invocationAttempted) {
            'The selected window closed, became disabled, changed or stopped exposing its controls. A separate dialogue may have opened. The action may already have occurred.'
        } else {
            'The selected window or button could not be inspected. No action was taken.'
        }
    }
    return $result
}

function Invoke-AppWorker($Request) {
    # A separate MTA process keeps a stalled accessibility provider bounded and away from the picker UI.
    $settings = [Diagnostics.ProcessStartInfo]::new()
    $settings.FileName = Join-Path $PSHOME 'powershell.exe'
    $settings.Arguments = '-NoLogo -NoProfile -NonInteractive -Mta -ExecutionPolicy Bypass -File "' + $script:InspectorFile + '" -Worker'
    $settings.UseShellExecute = $false
    $settings.CreateNoWindow = $true
    $settings.RedirectStandardInput = $true
    $settings.RedirectStandardOutput = $true
    $settings.RedirectStandardError = $true
    $settings.StandardOutputEncoding = [Text.Encoding]::UTF8
    $child = [Diagnostics.Process]::Start($settings)
    try {
        $stdout = $child.StandardOutput.ReadToEndAsync()
        $stderr = $child.StandardError.ReadToEndAsync()
        $child.StandardInput.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($Request | ConvertTo-Json -Depth 5 -Compress))))
        $child.StandardInput.Close()
        if (!$child.WaitForExit($script:WorkerMs)) {
            try { $child.Kill() } catch {}
            throw 'Windows did not finish the inspection in time.'
        }
        if ($child.ExitCode -ne 0) { throw 'Windows could not inspect the selected window.' }
        return ($stdout.GetAwaiter().GetResult() | ConvertFrom-Json -ErrorAction Stop)
    } finally { $child.Dispose() }
}

function Show-AppReview($Target, $Inventory) {
    if (!('ReleaseGatePickerWindow' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ReleaseGatePickerWindow {
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr window, int command);
}
'@
    }
    $appName = [IO.Path]::GetFileName($Target.executable)
    $buttons = @($Inventory.buttons)
    $checks = [Collections.Generic.List[object]]::new()
    $notes = [Collections.Generic.List[string]]::new()
    $notes.Add('The inventory covers visible buttons exposed by Windows UI Automation in the selected main window at the time it was inspected.')
    $notes.Add('A functional result covers only the expected accessible name in that window after the chosen action. Other windows, custom-drawn controls and saved or remote effects require separate evidence.')
    if ($Inventory.total -gt $buttons.Length) { $notes.Add("The inventory lists the first $($buttons.Length) of $($Inventory.total) visible buttons.") }
    if ($buttons.name -contains '[File path omitted]') { $notes.Add('Button names containing file paths were withheld from the inventory and from action testing.') }
    if (!$buttons.Length) { $notes.Add('Windows exposed no visible buttons in this window. Its controls remain untested.') }

    $form = [Windows.Forms.Form]::new()
    $form.Text = "ReleaseGate - $appName"
    $form.StartPosition = 'CenterScreen'
    $form.ClientSize = [Drawing.Size]::new(620, 492)
    $form.MinimumSize = [Drawing.Size]::new(575, 490)
    $form.Font = [Drawing.Font]::new('Segoe UI', 10)
    $form.AutoScaleMode = 'Dpi'
    $form.Add_Shown({
        # Windows may apply the hidden console's startup state to the first managed form.
        # Show only this review window once WinForms has created its handle.
        $null = [ReleaseGatePickerWindow]::ShowWindow($form.Handle, 5)
        $form.Activate()
    })
    $layout = [Windows.Forms.TableLayoutPanel]::new()
    $layout.Dock = 'Fill'
    $layout.ColumnCount = 1
    $null = $layout.ColumnStyles.Add([Windows.Forms.ColumnStyle]::new([Windows.Forms.SizeType]::Percent, 100))
    $layout.RowCount = 7
    $layout.Padding = [Windows.Forms.Padding]::new(12)
    foreach ($size in @('AutoSize','Percent','AutoSize','AutoSize','AutoSize','AutoSize','AutoSize')) {
        $row = [Windows.Forms.RowStyle]::new()
        $row.SizeType = $size
        if ($size -eq 'Percent') { $row.Height = 100 }
        $layout.RowStyles.Add($row) | Out-Null
    }
    $form.Controls.Add($layout)
    function Add-ReviewLabel([string]$Text, [int]$Row) {
        $label = [Windows.Forms.Label]::new()
        $label.Text = $Text
        $label.AutoSize = $true
        $label.Dock = 'Fill'
        $label.Margin = [Windows.Forms.Padding]::new(3, 6, 3, 6)
        $layout.Controls.Add($label, 0, $Row)
        return $label
    }
    $null = Add-ReviewLabel "$($buttons.Length) buttons recorded. Finish to import this inventory, or select a button to test in the running app." 0
    $list = [Windows.Forms.ListBox]::new()
    $list.AccessibleName = 'Discovered buttons'
    $list.HorizontalScrollbar = $true
    $list.Dock = 'Fill'
    $layout.Controls.Add($list, 0, 1)
    foreach ($entry in $buttons) {
        $caption = if ($entry.name) { $entry.name } else { '(Unnamed button)' }
        $duplicates = @($buttons | Where-Object { $_.name -ceq $entry.name }).Count -gt 1
        if (!$entry.enabled) { $caption += '  [disabled]' }
        if ($duplicates) { $caption += '  [shared name]' }
        if ($duplicates -or !$entry.eligible) { $entry.eligible = $false }
        if (!$entry.eligible) { $caption += '  [inventory only]' }
        $list.Items.Add($caption) | Out-Null
    }
    $null = Add-ReviewLabel 'Exact accessible name you expect to appear after activation. Omit file paths.' 2
    $expected = [Windows.Forms.TextBox]::new()
    $expected.AccessibleName = 'Expected accessible name'
    $expected.MaxLength = $script:NameLimit
    $expected.Dock = 'Fill'
    $layout.Controls.Add($expected, 0, 3)
    $verify = [Windows.Forms.Button]::new()
    $verify.AutoSize = $true
    $verify.Text = 'Check selected button...'
    $verify.Enabled = $false
    $layout.Controls.Add($verify, 0, 4)
    $status = Add-ReviewLabel 'No actions tested.' 5
    $actions = [Windows.Forms.FlowLayoutPanel]::new()
    $actions.AutoSize = $true
    $actions.Dock = 'Fill'
    $actions.FlowDirection = 'RightToLeft'
    $layout.Controls.Add($actions, 0, 6)
    $finish = [Windows.Forms.Button]::new()
    $finish.Text = 'Finish inspection'
    $finish.AutoSize = $true
    $finish.DialogResult = 'OK'
    $actions.Controls.Add($finish)
    $cancel = [Windows.Forms.Button]::new()
    $cancel.Text = 'Discard'
    $cancel.AutoSize = $true
    $cancel.DialogResult = 'Cancel'
    $actions.Controls.Add($cancel)
    $form.CancelButton = $cancel
    $update = {
        $verify.Enabled = $list.SelectedIndex -ge 0 -and $buttons[$list.SelectedIndex].eligible -and
            ![string]::IsNullOrWhiteSpace($expected.Text) -and !(Test-ContainsFilePath $expected.Text) -and $checks.Count -lt $script:CheckLimit
    }
    $list.Add_SelectedIndexChanged($update)
    $expected.Add_TextChanged($update)
    $verify.Add_Click({
        if (!$verify.Enabled) { return }
        $entry = $buttons[$list.SelectedIndex]
        $outcome = $expected.Text.Trim()
        $confirm = [Windows.Forms.MessageBox]::Show($form,
            "Activate '$($entry.name)' once in $appName and look for '$outcome'? This performs the real action in the running app.",
            'Confirm this action', 'YesNo', 'Question', 'Button2')
        if ($confirm -ne 'Yes') { return }
        $verify.Enabled = $false
        $form.UseWaitCursor = $true
        $status.Text = 'Checking the selected button...'
        $form.Refresh()
        try {
            $result = Invoke-AppWorker @{ operation = 'check'; target = $Target; button = $entry.name; runtimeId = $entry.runtimeId; expected = $outcome }
        } catch {
            $result = @{ button = $entry.name; expected = $outcome; outcome = 'inconclusive'; detail = 'Windows did not finish the check. The action may already have occurred. No retry was made.' }
        } finally { $form.UseWaitCursor = $false }
        $checks.Add($result)
        $status.Text = "$($checks.Count) of $script:CheckLimit checks recorded. $($result.outcome.ToUpperInvariant()) - $($result.detail)"
        & $update
    })
    try {
        if ($form.ShowDialog() -ne 'OK') { return @{ cancelled = $true } }
        return @{
            application = $appName
            buttons = @(foreach ($entry in $buttons) { @{ name = $entry.name; enabled = $entry.enabled } })
            checks = $checks.ToArray()
            limitations = $notes.ToArray()
        }
    } finally { $form.Dispose() }
}

function Open-AppInspector {
    if (![Environment]::UserInteractive -or [Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0) {
        return @{ error = 'Start ReleaseGate in your signed-in Windows desktop session to use the application picker.' }
    }
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    [Windows.Forms.Application]::EnableVisualStyles()
    $picker = [Windows.Forms.OpenFileDialog]::new()
    $picker.Title = 'ReleaseGate - choose the executable of your running Windows app'
    $picker.Filter = 'Windows applications (*.exe)|*.exe'
    $picker.CheckFileExists = $true
    $picker.DereferenceLinks = $false
    $picker.Multiselect = $false
    try {
        if ($picker.ShowDialog() -ne 'OK') { return @{ cancelled = $true } }
        $exe = [IO.Path]::GetFullPath($picker.FileName)
    } finally { $picker.Dispose() }
    if ([IO.Path]::GetExtension($exe) -ine '.exe' -or $exe -notmatch '^[A-Za-z]:\\' -or
        [IO.DriveInfo]::new([IO.Path]::GetPathRoot($exe)).DriveType -eq 'Network') {
        return @{ error = 'Choose an executable on a local drive.' }
    }
    while ($true) {
        $targets = @(Get-AppTargets $exe)
        if ($targets.Length -eq 1) { break }
        $message = if ($targets.Length -gt 1) {
            'Several running instances match this file. Leave one instance open and choose Retry.'
        } else {
            'Open this application yourself, restore its main window and choose Retry. If it uses a launcher, choose the executable that owns the window.'
        }
        if ([Windows.Forms.MessageBox]::Show($message, 'Find the running application', 'RetryCancel', 'Information') -ne 'Retry') {
            return @{ cancelled = $true }
        }
    }
    $inventory = Invoke-AppWorker @{ operation = 'inventory'; target = $targets[0] }
    return Show-AppReview $targets[0] $inventory
}

if ($MyInvocation.InvocationName -ne '.') {
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    try {
        if ($Worker) {
            Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class ReleaseGateWindowState {
    private static readonly Timer deadline = new Timer(delegate { Environment.Exit(2); }, null, Timeout.Infinite, Timeout.Infinite);
    public static void SetWorkerDeadline(int milliseconds) {
        deadline.Change(milliseconds, Timeout.Infinite);
    }
    [DllImport("user32.dll")]
    public static extern bool IsWindowEnabled(IntPtr handle);
}
'@
            # The worker must still exit if the operator closes the browser and its parent is stopped.
            [ReleaseGateWindowState]::SetWorkerDeadline($script:WorkerMs)
            # Register the framework's UI Automation proxies for classic Win32 and Windows Forms controls.
            # Initialise the client before registration. The desktop tree is never enumerated.
            $null = [System.Windows.Automation.AutomationElement]::RootElement
            $framework = [Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
            $providers = Join-Path $framework 'WPF\UIAutomationClientsideProviders.dll'
            [System.Windows.Automation.ClientSettings]::RegisterClientSideProviderAssembly([Reflection.AssemblyName]::GetAssemblyName($providers))
            $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))
            $request = $json | ConvertFrom-Json
            $answer = switch ($request.operation) {
                'inventory' { Read-AppButtons $request.target }
                'check' { Test-AppAction $request }
                default { throw 'Unknown operation.' }
            }
        } else { $answer = Open-AppInspector }
        [Console]::WriteLine(($answer | ConvertTo-Json -Depth 5 -Compress))
        if ($answer.error) { exit 1 }
    } catch {
        [Console]::WriteLine('{"error":"Windows could not inspect the selected application. Restore its main window and use the same Windows account and privilege level as the app."}')
        exit 1
    }
}
