# SOUNDCOOL

Browser-based frontend for decoding, converting, rendering, and generating legacy mobile audio formats entirely on the client side.

SOUNDCOOL combines SMAF/MMF parsing, MIDI + SoundFont rendering, and browser-native audio conversion into a lightweight multimedia workstation focused on retro mobile audio preservation and local processing.

---

# Features

## SMAF / MMF Support

SOUNDCOOL supports advanced browser-side decoding and extraction of `.mmf` / SMAF files.

### Supported capabilities

- Batch upload for `.mmf` / SMAF files
- Yamaha ADPCM decoding
- PCM audio extraction
- Embedded chunk parsing
- Automatic conversion to playable PCM audio
- Simplified sequence reconstruction for note-based SMAF files
- Browser-native playback preparation
- Local processing with no upload required

### Supported SMAF chunk families

The parser currently supports multiple chunk structures commonly found in mobile-era SMAF containers:

- `MMMD`
- `ATR*`
- `Awa*`
- `MTR*`
- `Mtsp`
- `Mwa*`
- `EXWV`

The parser architecture is inspired by the structure and parsing behavior found in the `vavi-sound` project, adapted for browser-native execution using modern Web APIs.

### SMAF Processing Flow

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

Sequence-only SMAF files without embedded PCM streams may also generate simplified synthesized playback.

---

## MIDI + SoundFont Rendering

SOUNDCOOL includes full browser-side MIDI rendering using uploaded soundfonts.

### Supported soundfont formats

- `SF2`
- `SF3`
- `DLS`

### MIDI rendering features

- Batch MIDI rendering
- Dedicated rendering worker
- Non-blocking synthesis pipeline
- Real-time browser-side rendering
- Local rendering without server processing
- Direct PCM stream generation

Rendering is powered by `SpessaSynth Core` running inside a dedicated Web Worker.

### MIDI Rendering Flow

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

## Audio → MMF / SMAF Conversion

SOUNDCOOL also supports converting modern audio formats into minimal SMAF/MMF PCM containers.

### Supported input formats

- `MP3`
- `OGG`
- `WAV`

### Audio conversion pipeline

The application:

1. Decodes audio through the Web Audio API
2. Performs channel mixing
3. Resamples audio when necessary
4. Applies normalization
5. Generates SMAF PCM structures
6. Writes a minimal `MMMD/ATR0/Awa0` SMAF container

Heavy processing is delegated to dedicated Web Workers to avoid UI blocking during longer conversions.

### Optimization Notes

Smaller MMF outputs are typically achieved using:

- Mono audio
- Lower sample rates
- 8-bit PCM encoding

---

# Export Formats

## Supported output formats

| Format | Encoding Method |
|--------|--------|
| WAV | Direct PCM output |
| MP3 | FFmpeg.wasm |
| OGG | FFmpeg.wasm |
| MMF | Custom SMAF PCM writer |

---

# Batch Processing

SOUNDCOOL supports simultaneous processing of multiple files.

### Batch features

- Multiple file uploads simultaneously
- Automatic ZIP packaging for multi-file exports
- Direct single-file download behavior
- Original filename preservation

### Examples

```text
SEGA.mmf   -> SEGA.wav
Theme.mid  -> Theme.mp3
tone.mp3   -> tone.mmf
```

---

# Technical Architecture

## Browser-Only Processing

All processing occurs locally inside the browser.

### Files are never:

- Uploaded
- Transmitted
- Stored remotely

### Advantages

- Offline support
- Improved privacy
- Lower latency
- Faster local batch processing
- No backend dependency

---

# Technologies Used

SOUNDCOOL uses modern browser technologies including:

- Web Workers
- WebAssembly
- FFmpeg.wasm
- Typed Arrays
- AudioBuffer APIs
- Blob/File APIs
- Client-side ZIP generation
- Web Audio API

---

# Running Locally

Serve the project through a local HTTP server and open `index.html`.

## Python

```bash
python -m http.server 5173
```

Then open:

```text
http://localhost:5173
```

---

# Project Goals

SOUNDCOOL primarily exists as:

1. A retro mobile audio preservation tool
2. A browser-native multimedia experiment
3. A lightweight local audio workstation for legacy formats
4. A proof-of-concept for advanced browser-side multimedia processing

The project intentionally avoids backend dependencies and performs all heavy processing client-side.

---

# Limitations

## SMAF / MMF Complexity

SMAF is not a fully standardized format and may contain widely varying internal structures.

Some files may include:

- Yamaha ADPCM streams
- PCM audio
- Note sequences
- Hybrid structures
- Proprietary chunks

### Consequences

- Compatibility may vary between files
- Sequence reconstruction may be approximate
- Certain proprietary chunks may be ignored
- Instrument mapping may not always match intended playback

---

## MIDI Instrument Mapping

Some SMAF instruments do not map directly to General MIDI standards.

This may result in:

- Incorrect instruments
- Altered playback timbre
- Simplified synthesized playback

---

# References

## vavi-sound

Reference implementation and structural inspiration for SMAF parsing behavior.

Repository:
https://github.com/umjammer/vavi-sound

---

## SpessaSynth

Browser-side MIDI synthesizer used for SoundFont rendering.

Repository:
https://github.com/spessasus/SpessaSynth
