# SOUNDCOOL

Browser-based frontend for decoding, converting, and rendering legacy mobile audio formats and MIDI soundfont playback entirely on the client side.

**SOUNDCOOL supports:**
- `.mmf` / SMAF decoding and extraction
- MIDI rendering using `SF2`, `SF3`, and `DLS` soundfonts
- Export to `WAV`, `MP3`, and `OGG`
- Local processing with no server upload

The project focuses on retro mobile audio preservation, browser-side audio processing, and lightweight multimedia tooling using modern Web APIs, Web Workers, and WebAssembly.

---

## Features

### SMAF / MMF Support

- Batch upload for `.mmf` / SMAF files
- Yamaha ADPCM and PCM decoding directly in the browser
- Extraction of embedded audio chunks
- Partial reconstruction of sequence-based SMAF tracks
- Automatic conversion to playable PCM audio

**Supported chunk families include:**
- `MMMD`
- `ATR*`
- `Awa*`
- `MTR*`
- `Mtsp`
- `Mwa*`
- `EXWV`

> The parser is inspired by the structure and behavior found in the `vavi-sound` project, but adapted for browser-native execution.

---

### MIDI + SoundFont Rendering

- Batch MIDI rendering
- Support for:
  - `SF2`
  - `SF3`
  - `DLS`
- Dedicated rendering worker thread
- Non-blocking UI during synthesis
- Real-time browser-side audio generation

Rendering is powered by `SpessaSynth Core` running inside a dedicated Web Worker.

---

### Export Formats

**Supported output formats:**
- `WAV`
- `MP3`
- `OGG`

#### Encoding Pipeline

| Format | Method |
|--------|--------|
| WAV | Direct PCM output |
| MP3 | FFmpeg.wasm encoding |
| OGG | FFmpeg.wasm encoding |

---

### Batch Processing

- Multiple input files supported simultaneously
- Automatic ZIP packaging for multi-file exports
- Single-file exports download directly
- Original filenames are preserved exactly

**Examples:**
```text
SEGA.mmf  -> SEGA.wav
Theme.mid -> Theme.mp3
```

---

## Architecture

### MMF / SMAF Flow

```text
MMF / SMAF
    ↓
Custom SMAF Parser
    ↓
Chunk Extraction
    ↓
ADPCM / PCM Decode
    ↓
PCM Audio
    ↓
Optional Encoding
    ↓
WAV / MP3 / OGG
```

> Sequence-only SMAF files may also generate simplified synthesized playback when embedded audio streams are not present.

### MIDI + SF2 Flow

```text
MIDI
    ↓
SpessaSynth Core
    ↓
SoundFont Rendering
    ↓
PCM Stream
    ↓
FFmpeg.wasm (optional)
    ↓
MP3 / OGG / WAV
```

---

## Technical Notes

### Browser-Only Processing

All conversion and rendering happens locally inside the browser.

**Files are:**
- ❌ Not uploaded
- ❌ Not transmitted
- ❌ Not stored remotely

**This allows:**
- ✅ Offline usage
- ✅ Lower latency
- ✅ Improved privacy
- ✅ Direct local batch conversion

---

### Web Technologies Used

- Web Workers
- WebAssembly
- FFmpeg.wasm
- Typed Arrays
- AudioBuffer APIs
- Blob/File APIs
- Client-side ZIP generation

---

## Running Locally

Serve the folder through an HTTP server and open `index.html`.

### Python
```bash
python -m http.server 5173
```

Then open in browser:
```
http://localhost:5173
```

---

## Project Goals

**SOUNDCOOL exists primarily as:**
1. A retro mobile audio preservation tool
2. A browser-native multimedia experiment
3. A lightweight local audio workstation for legacy formats

The project intentionally avoids backend dependencies and performs all heavy processing client-side.

---

## Limitations

### MMF / SMAF Complexity

SMAF is not a single standardized audio structure.

**Some files may contain:**
- Note sequences
- Yamaha ADPCM streams
- PCM audio
- Proprietary chunks
- Hybrid structures

**As a result:**
- Compatibility varies between files
- Some sequence reconstruction may be approximate
- Certain proprietary chunks may be ignored

### MIDI Instrument Mapping

Some SMAF instrument mappings do not directly correspond to General MIDI standards.

**This may result in:**
- Incorrect instruments
- Altered playback timbre
- Simplified playback behavior

---

## References

### vavi-sound
- **Repository:** https://github.com/umjammer/vavi-sound
- Reference implementation and structural inspiration for SMAF parsing behavior.

### SpessaSynth
- **Repository:** https://github.com/spessasus/SpessaSynth
- Browser-side MIDI synthesizer used for SoundFont rendering.
```
