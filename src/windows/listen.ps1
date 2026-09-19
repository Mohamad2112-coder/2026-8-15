param([ValidateSet('continuous','command')][string]$Mode = 'continuous')

try {
  Add-Type -AssemblyName System.Speech
  $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $recognizer.SetInputToDefaultAudioDevice()
  Register-ObjectEvent -InputObject $recognizer -EventName SpeechRecognized -Action {
    $payload = @{ type = 'transcript'; text = $Event.SourceEventArgs.Result.Text; confidence = $Event.SourceEventArgs.Result.Confidence } | ConvertTo-Json -Compress
    [Console]::Out.WriteLine($payload)
    [Console]::Out.Flush()
  } | Out-Null
  $recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  while ($true) {
    Start-Sleep -Milliseconds 100
  }
} catch {
  [Console]::Out.WriteLine((@{ type = 'error'; message = $_.Exception.Message } | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  exit 1
} finally {
  if ($recognizer) { $recognizer.RecognizeAsyncCancel(); $recognizer.Dispose() }
}
