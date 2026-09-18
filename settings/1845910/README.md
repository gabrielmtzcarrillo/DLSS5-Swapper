# Dragon Age: The Veilguard (Steam 1845910) — working DLSS 5 settings

Backup of the configuration that got DLSS Neural Rendering working in this
game, taken 2026-09-17 23:14 (local) from
`C:\Program Files (x86)\Steam\steamapps\common\Dragon Age The Veilguard`.

| | |
|---|---|
| Route | `optiscaler-multipass` (OptiScaler `0.8.3-multipass`, family `presr-multipass`, hook `dxgi.dll`) |
| Renderer | DirectX 12, 64-bit, `Dragon Age The Veilguard.exe` |
| GPU / driver | NVIDIA GeForce RTX 4060 Ti, 616.56 |
| Game DLSS | native `nvngx_dlss.dll` 3.7.10 via Streamline 2.4.10 (left untouched, `replaced: []`) |
| NR model | `nvngx_dlssnr.dll` 310.8.0.0 beside the exe |

## Files

- `OptiScaler.ini` — the live config (the only settings file this route
  keeps; `backend-manager.configPaths` restores it as the route profile).
- `manifest.json` — the app's install manifest at the time, for provenance
  (which files were added, nothing replaced).

## What differs from the OptiScaler defaults

```
[Upscalers]  Dx12Upscaler=ffx   Dx11Upscaler=ffx_12   VulkanUpscaler=ffx
[DLSS]       Enabled=false   UseGenericAppIdWithDlss=true   RenderPresetOverride=false
[DlssNr]     Enabled=true   RunBeforeSR=true   Passes=1   WorkingScale=1.0
             FinishedPicture=false   HdrTransfer=false
             SkinToneEnabled=true   SkinProtection=false   ShowSkinMask=false
             SkinDetail=1.0  SkinColour=1.0  EnvironmentDetail=1.0  EnvironmentColour=1.0
[FrameGen]   Enabled=false   External=true
[DLSSG]      AmpereMfgUnlock=true
[Spoofing]   Dxgi=false
[Plugins]    LoadAsiPlugins=false
[Log]        LogToFile=true   LogLevel=2
[ProcessFilter] TargetProcessName=Dragon Age The Veilguard.exe
```

Why this works where the other routes did not: the game hands NGX an
`R16G16B16A16_TYPELESS` output (DXGI format 9), which the RenoDX add-on
rejects (native/ReShade route), and the Feeder route's command list would not
close on this title (`0x80070057`). The pre-SR multipass build runs the neural
pass *before* upscaling (`RunBeforeSR=true`) on OptiScaler's own FSR path
(`Dx12Upscaler=ffx`), so neither problem is in the way.

## Restore

Install the game on the `optiscaler-multipass` route from the app, then copy
`OptiScaler.ini` over the one in the game folder (or let the app's saved
profile reapply it).
