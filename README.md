# SOUNDCOOL

Browser frontend for converting `.mmf`/SMAF files and rendering `SF2 + MIDI` files to `MP3`, `OGG`, or `WAV`.

## Run

Serve this folder over HTTP and open `index.html`.

```powershell
python -m http.server 5173
```

Then open `http://localhost:5173`.

## Features

- Batch upload for `.mmf`/SMAF files.
- Batch upload for MIDI files with one SF2/SF3/DLS soundfont.
- Single-file outputs download directly.
- Multi-file outputs are packaged as a ZIP.
- Output filenames preserve the original base name exactly: `SEGA.mmf` becomes `SEGA.wav`, `Theme.mid` becomes `Theme.mp3`.

## Conversion

For SMAF/MMF, the app first uses its own SMAF parser inspired by the structure used in `vavi-sound`: it reads `MMMD`, finds audio chunks such as `ATR*/Awa*`, `MTR*/Mtsp/Mwa*`, and `EXWV`, decodes Yamaha ADPCM/PCM to PCM in the browser, and synthesizes simple note-only SMAF sequences when there is no embedded audio.

For `SF2 + MIDI`, the app uses SpessaSynth in the browser to render MIDI through the uploaded soundfont. `WAV` can be produced directly; `MP3` and `OGG` use FFmpeg.wasm as the final encoder. Files stay local to the browser.

## References

https://github.com/umjammer/vavi-sound
https://github.com/spessasus/SpessaSynth
