try {
  $text = [Console]::In.ReadToEnd().Trim()
  if (-not $text) { exit 0 }

  # Try modern Windows OneCore SpeechSynthesizer first
  try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop
    Add-Type -AssemblyName System.IO -ErrorAction Stop
    [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media, ContentType = WindowsRuntime] | Out-Null
    $synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
    $voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -like '*Mark*' -or $_.DisplayName -like '*David*' } | Select-Object -First 1
    if ($voice) { $synth.Voice = $voice }

    $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
    $op = $synth.SynthesizeTextToStreamAsync($text)
    $task = $asTask.MakeGenericMethod([Windows.Media.SpeechSynthesis.SpeechSynthesisStream]).Invoke($null, @($op))
    $task.Wait()
    $stream = $task.Result

    $netStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
    $player = New-Object System.Media.SoundPlayer($netStream)
    $player.PlaySync()
    $player.Dispose()
    exit 0
  } catch {
    # Fallback to legacy System.Speech SAPI
    Add-Type -AssemblyName System.Speech -ErrorAction Stop
    $speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $speaker.Rate = -1
    $speaker.Volume = 90
    $speaker.Speak($text)
    $speaker.Dispose()
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
