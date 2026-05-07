const TIME_BASE_TABLE = [
  1, 2, 4, 5, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 10, 20, 40, 50,
];

const FORMAT_TYPE_SIZE = [2, 16, 16, 32];
const AWA_SAMPLE_RATES = [4000, 8000, 11000, 22050, 44100];
const MWA_FORMAT_TABLE = [4, 5, 1];

const WAVE_FORMAT = {
  SIGNED: 0,
  YAMAHA_ADPCM: 1,
  TWINVQ: 2,
  MP3: 3,
  SIGNED_PCM: 4,
  OFFSET_BINARY_PCM: 5,
};

export function inspectSmaf(arrayBuffer) {
  const parsed = parseSmaf(toBytes(arrayBuffer));
  return {
    isSmaf: true,
    audioChunks: parsed.audioChunks.length,
    notes: parsed.notes.length,
    chunks: parsed.chunks.length,
    warnings: parsed.warnings,
    summary: summarizeParsed(parsed),
  };
}

export function convertSmafToPcm(arrayBuffer, options = {}) {
  const parsed = parseSmaf(toBytes(arrayBuffer));
  const preferredRate = options.sampleRate === "auto" ? null : Number(options.sampleRate);
  const preferredChannels = options.channels === "auto" ? null : Number(options.channels);
  const pieces = [];

  for (const chunk of parsed.audioChunks) {
    const decoded = decodeAudioChunk(chunk);
    if (!decoded) continue;
    pieces.push(decoded);
  }

  let rendered;
  let source;

  if (pieces.length > 0) {
    rendered = concatenatePieces(pieces);
    source = `${pieces.length} SMAF audio chunk${pieces.length === 1 ? "" : "s"}`;
  } else if (parsed.notes.length > 0) {
    rendered = synthesizeNotes(parsed.notes, preferredRate || 44100, preferredChannels || 1);
    source = `${parsed.notes.length} SMAF note${parsed.notes.length === 1 ? "" : "s"} synthesized`;
  } else {
    throw new Error("No decodable SMAF audio chunks or note sequence were found.");
  }

  if (preferredRate && preferredRate !== rendered.sampleRate) {
    rendered = {
      ...rendered,
      pcm: resamplePcm(rendered.pcm, rendered.sampleRate, preferredRate, rendered.channels),
      sampleRate: preferredRate,
    };
  }

  if (preferredChannels && preferredChannels !== rendered.channels) {
    rendered = {
      ...rendered,
      pcm: convertChannels(rendered.pcm, rendered.channels, preferredChannels),
      channels: preferredChannels,
    };
  }

  if (options.normalize) {
    rendered = { ...rendered, pcm: normalizePcm(rendered.pcm) };
  }

  return {
    ...rendered,
    details: {
      source,
      chunks: parsed.chunks.length,
      warnings: parsed.warnings,
    },
  };
}

export function encodeWav(pcm, sampleRate, channels, codec = "pcm_s16le") {
  const dataBytes =
    codec === "pcm_f32le"
      ? float32BytesFromPcm(pcm)
      : codec === "pcm_s24le"
        ? int24BytesFromPcm(pcm)
        : int16BytesFromPcm(pcm);
  const bits = codec === "pcm_f32le" ? 32 : codec === "pcm_s24le" ? 24 : 16;
  const audioFormat = codec === "pcm_f32le" ? 3 : 1;
  const blockAlign = channels * (bits / 8);
  const byteRate = sampleRate * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes.length);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes.length, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, audioFormat, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bits, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes.length, true);
  new Uint8Array(buffer, 44).set(dataBytes);

  return new Uint8Array(buffer);
}

function parseSmaf(bytes) {
  const root = readChunkHeader(bytes, 0, bytes.length);
  if (!root || root.id !== "MMMD") {
    throw new Error("This file does not start with the MMMD SMAF signature.");
  }

  const parsed = {
    audioChunks: [],
    chunks: [],
    notes: [],
    warnings: [],
  };
  const safeEnd = Math.min(root.payloadEnd, bytes.length);
  parseChunkRange(bytes, root.payloadStart, safeEnd, parsed, {
    path: "MMMD",
  });

  return parsed;
}

function parseChunkRange(bytes, start, end, parsed, context) {
  let offset = start;

  while (offset + 8 <= end) {
    const chunk = readChunkHeader(bytes, offset, end);
    if (!chunk) break;

    if (chunk.payloadEnd > end) {
      parsed.warnings.push(`Chunk ${chunk.id} extends past its parent.`);
      break;
    }

    parsed.chunks.push({
      id: chunk.id,
      size: chunk.size,
      path: `${context.path}/${chunk.id}`,
    });
    parseChunk(bytes, chunk, parsed, context);
    offset = chunk.payloadEnd;
  }
}

function parseChunk(bytes, chunk, parsed, context) {
  if (chunk.id.startsWith("ATR")) {
    parsePcmAudioTrack(bytes, chunk, parsed, context);
    return;
  }

  if (chunk.id.startsWith("MTR")) {
    parseScoreTrack(bytes, chunk, parsed, context);
    return;
  }

  if (chunk.id === "MMMG") {
    const offset = chunk.payloadStart + 2;
    parseChunkRange(bytes, offset, chunk.payloadEnd, parsed, {
      ...context,
      formatType: 3,
      durationBaseMs: 1,
      gateBaseMs: 1,
      path: `${context.path}/${chunk.id}`,
    });
    return;
  }

  if (chunk.id === "VOIC") {
    parseChunkRange(bytes, chunk.payloadStart, chunk.payloadEnd, parsed, {
      ...context,
      path: `${context.path}/${chunk.id}`,
    });
    return;
  }

  if (chunk.id === "EXWV") {
    parsed.audioChunks.push({
      id: chunk.id,
      number: -1,
      data: bytes.slice(chunk.payloadStart, chunk.payloadEnd),
      waveType: {
        channels: 1,
        format: WAVE_FORMAT.YAMAHA_ADPCM,
        sampleRate: 8000,
        bits: 4,
      },
    });
    return;
  }

  if (chunk.id === "Mtsp") {
    parseChunkRange(bytes, chunk.payloadStart, chunk.payloadEnd, parsed, {
      ...context,
      path: `${context.path}/${chunk.id}`,
    });
    return;
  }

  if (chunk.id.startsWith("Awa") && context.waveType) {
    parsed.audioChunks.push({
      id: chunk.id,
      number: chunk.id.charCodeAt(3),
      data: bytes.slice(chunk.payloadStart, chunk.payloadEnd),
      waveType: context.waveType,
    });
    return;
  }

  if (chunk.id.startsWith("Mwa") && chunk.payloadStart + 3 <= chunk.payloadEnd) {
    parsed.audioChunks.push({
      id: chunk.id,
      number: chunk.id.charCodeAt(3),
      data: bytes.slice(chunk.payloadStart + 3, chunk.payloadEnd),
      waveType: decodeMwaWaveType(bytes.slice(chunk.payloadStart, chunk.payloadStart + 3)),
    });
    return;
  }

  if (chunk.id === "Mtsq" || chunk.id === "SEQU" || chunk.id === "Mssq") {
    parseSequence(bytes.slice(chunk.payloadStart, chunk.payloadEnd), parsed, context, chunk.id);
  }
}

function parsePcmAudioTrack(bytes, chunk, parsed, context) {
  if (chunk.payloadStart + 6 > chunk.payloadEnd) {
    parsed.warnings.push(`ATR chunk ${chunk.id} is too short.`);
    return;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const formatType = bytes[chunk.payloadStart];
  const sequenceType = bytes[chunk.payloadStart + 1];
  const waveType = decodeAwaWaveType(view.getUint16(chunk.payloadStart + 2, false));
  const durationBaseMs = timeBase(bytes[chunk.payloadStart + 4]);
  const gateBaseMs = timeBase(bytes[chunk.payloadStart + 5]);

  parseChunkRange(bytes, chunk.payloadStart + 6, chunk.payloadEnd, parsed, {
    ...context,
    formatType,
    sequenceType,
    waveType,
    durationBaseMs,
    gateBaseMs,
    path: `${context.path}/${chunk.id}`,
  });
}

function parseScoreTrack(bytes, chunk, parsed, context) {
  if (chunk.payloadStart + 4 > chunk.payloadEnd) {
    parsed.warnings.push(`MTR chunk ${chunk.id} is too short.`);
    return;
  }

  const formatType = bytes[chunk.payloadStart];
  const sequenceType = bytes[chunk.payloadStart + 1];
  const durationBaseMs = timeBase(bytes[chunk.payloadStart + 2]);
  const gateBaseMs = timeBase(bytes[chunk.payloadStart + 3]);
  const statusBytes = FORMAT_TYPE_SIZE[formatType] ?? 0;
  const subchunkStart = Math.min(chunk.payloadStart + 4 + statusBytes, chunk.payloadEnd);

  parseChunkRange(bytes, subchunkStart, chunk.payloadEnd, parsed, {
    ...context,
    formatType,
    sequenceType,
    durationBaseMs,
    gateBaseMs,
    path: `${context.path}/${chunk.id}`,
  });
}

function parseSequence(bytes, parsed, context, id) {
  try {
    if (id === "SEQU" || context.formatType === 3) {
      parsed.notes.push(...parseSequNotes(bytes, context));
    } else if (context.formatType === 0 || id === "Mssq") {
      parsed.notes.push(...parseHandyPhoneNotes(bytes, context));
    } else if (context.formatType === 2) {
      parsed.notes.push(...parseMobileNotes(bytes, context));
    } else if (context.formatType === 1) {
      parsed.warnings.push("Compressed Mobile Standard sequence was skipped.");
    }
  } catch (error) {
    parsed.warnings.push(`Could not parse ${id}: ${error.message}`);
  }
}

function parseHandyPhoneNotes(bytes, context) {
  const reader = new ByteReader(bytes);
  const notes = [];
  let timeMs = 0;
  const durationBaseMs = context.durationBaseMs || 1;
  const gateBaseMs = context.gateBaseMs || durationBaseMs;
  const octaveShift = [0, 0, 0, 0];
  const channelVolume = [96, 96, 96, 96];

  while (reader.remaining > 0) {
    timeMs += readHpsVariableLength(reader) * durationBaseMs;
    if (reader.remaining <= 0) break;
    const e1 = reader.u8();

    if (e1 === 0xff) {
      skipHandyPhoneMeta(reader);
    } else if (e1 !== 0x00) {
      const gateTime = readHpsVariableLength(reader);
      const channel = (e1 & 0xc0) >> 6;
      const octave = (e1 & 0x30) >> 4;
      const localNote = e1 & 0x0f;
      const smafPitch = localNote + [0, 12, 24, 36][octave];
      notes.push({
        channel,
        durationMs: Math.max(gateTime * gateBaseMs, durationBaseMs),
        pitch: clamp(smafPitch + 36 + octaveShift[channel], 12, 120),
        startMs: timeMs,
        velocity: channelVolume[channel],
      });
    } else {
      handleHandyPhoneControl(reader, octaveShift, channelVolume);
    }
  }

  return notes;
}

function parseMobileNotes(bytes, context) {
  const reader = new ByteReader(bytes);
  const notes = [];
  let timeMs = 0;
  const durationBaseMs = context.durationBaseMs || 1;
  const gateBaseMs = context.gateBaseMs || durationBaseMs;
  const channelVolume = new Array(16).fill(96);

  while (reader.remaining > 0) {
    timeMs += readMidiVariableLength(reader) * durationBaseMs;
    if (reader.remaining <= 0) break;
    const status = reader.u8();

    if (status >= 0x80 && status <= 0x8f && reader.remaining >= 2) {
      const channel = status & 0x0f;
      const pitch = reader.u8();
      const gateTime = readMidiVariableLength(reader);
      notes.push(note(timeMs, gateTime * gateBaseMs, pitch, channel, channelVolume[channel]));
    } else if (status >= 0x90 && status <= 0x9f && reader.remaining >= 3) {
      const channel = status & 0x0f;
      const pitch = reader.u8();
      const velocity = reader.u8();
      const gateTime = readMidiVariableLength(reader);
      notes.push(note(timeMs, gateTime * gateBaseMs, pitch, channel, velocity));
    } else if (status >= 0xb0 && status <= 0xbf && reader.remaining >= 2) {
      const channel = status & 0x0f;
      const control = reader.u8();
      const value = reader.u8();
      if (control === 0x07 || control === 0x0b) channelVolume[channel] = value;
    } else if (status >= 0xc0 && status <= 0xdf) {
      reader.skip(status <= 0xcf ? 1 : 1);
    } else if (status >= 0xe0 && status <= 0xef) {
      reader.skip(2);
    } else if (status === 0xf0) {
      reader.skip(readMidiVariableLength(reader));
    } else if (status === 0xff) {
      const type = reader.u8();
      if (type === 0x2f && reader.remaining > 0) reader.skip(1);
      if (type === 0x00) continue;
    } else if (status >= 0xa0 && status <= 0xaf) {
      reader.skip(2);
    }
  }

  return notes;
}

function parseSequNotes(bytes, context) {
  const reader = new ByteReader(bytes);
  const notes = [];
  let timeMs = 0;
  const durationBaseMs = context.durationBaseMs || 1;
  const gateBaseMs = context.gateBaseMs || durationBaseMs;
  const channelVolume = [96, 96, 96, 96];

  while (reader.remaining > 0) {
    timeMs += readMidiVariableLength(reader) * durationBaseMs;
    if (reader.remaining <= 0) break;
    const e1 = reader.u8();

    if (e1 === 0x00 && reader.remaining > 0) {
      const e2 = reader.u8();
      const channel = e2 >> 6;
      const event = e2 & 0x3f;
      if ([0x30, 0x31, 0x32, 0x33, 0x34, 0x36, 0x37, 0x3a, 0x3b].includes(event)) {
        const value = reader.u8();
        if (event === 0x37 || event === 0x3b) channelVolume[channel] = value;
      } else if (event === 0x00) {
        reader.skip(1);
      }
    } else if (e1 === 0xff && reader.remaining > 0) {
      const sig = reader.u8();
      if (sig === 0xf0 && reader.remaining > 0) reader.skip(reader.u8());
    } else {
      const channel = e1 >> 6;
      const pitch = (e1 & 0x0f) + (((e1 >> 4) & 0x03) + 3) * 12;
      const gateTime = readMidiVariableLength(reader);
      notes.push(note(timeMs, gateTime * gateBaseMs, pitch, channel, channelVolume[channel]));
    }
  }

  return notes;
}

function skipHandyPhoneMeta(reader) {
  if (reader.remaining <= 0) return;
  const type = reader.u8();
  if ([0x2f, 0x51, 0x58, 0xf0].includes(type) && reader.remaining > 0) {
    reader.skip(reader.u8());
  } else if (type === 0x00) {
    return;
  }
}

function handleHandyPhoneControl(reader, octaveShift, channelVolume) {
  if (reader.remaining <= 0) return;
  const e2 = reader.u8();
  if (e2 === 0x00) {
    if (reader.remaining > 0) reader.skip(1);
    return;
  }

  const channel = (e2 & 0xc0) >> 6;
  const event = (e2 & 0x30) >> 4;
  const data = e2 & 0x0f;

  if (event === 3 && reader.remaining > 0) {
    const value = reader.u8();
    if (data === 2) {
      octaveShift[channel] = decodeOctaveShift(value);
    } else if (data === 7 || data === 0x0b) {
      channelVolume[channel] = value;
    }
  }
}

function decodeAudioChunk(chunk) {
  const { waveType } = chunk;
  const data = chunk.data;

  if (waveType.format === WAVE_FORMAT.YAMAHA_ADPCM && waveType.bits === 4) {
    return {
      channels: waveType.channels,
      pcm: decodeYamahaAdpcm(data, waveType.channels),
      sampleRate: waveType.sampleRate,
    };
  }

  if (waveType.format === WAVE_FORMAT.SIGNED || waveType.format === WAVE_FORMAT.SIGNED_PCM) {
    return {
      channels: waveType.channels,
      pcm: decodePcm(data, waveType.bits, waveType.channels, true),
      sampleRate: waveType.sampleRate,
    };
  }

  if (waveType.format === WAVE_FORMAT.OFFSET_BINARY_PCM) {
    return {
      channels: waveType.channels,
      pcm: decodePcm(data, waveType.bits, waveType.channels, false),
      sampleRate: waveType.sampleRate,
    };
  }

  return null;
}

function decodeYamahaAdpcm(data, channels) {
  if (channels === 2 && data.length > 1) {
    const half = Math.floor(data.length / 2);
    const left = decodeYamahaMono(data.slice(0, half));
    const right = decodeYamahaMono(data.slice(half));
    const length = Math.min(left.length, right.length);
    const stereo = new Int16Array(length * 2);
    for (let i = 0; i < length; i += 1) {
      stereo[i * 2] = left[i];
      stereo[i * 2 + 1] = right[i];
    }
    return stereo;
  }

  return decodeYamahaMono(data);
}

function decodeYamahaMono(data) {
  const state = { step: 127, last: 0 };
  const pcm = new Int16Array(data.length * 2);
  let out = 0;

  for (const byte of data) {
    pcm[out++] = decodeYamahaNibble(byte & 0x0f, state);
    pcm[out++] = decodeYamahaNibble((byte >> 4) & 0x0f, state);
  }

  return pcm;
}

function decodeYamahaNibble(code, state) {
  const step = state.step;
  let delta = step >> 3;
  if (code & 0x01) delta += step >> 2;
  if (code & 0x02) delta += step >> 1;
  if (code & 0x04) delta += step;

  state.last = clamp16(state.last + ((code & 0x08) ? -delta : delta));
  state.step = adjustYamahaStep(code, step);
  return state.last;
}

function adjustYamahaStep(code, step) {
  switch (code & 0x07) {
    case 0x00:
    case 0x01:
    case 0x02:
    case 0x03:
      step = Math.trunc((step * 115) / 128);
      break;
    case 0x04:
      step = Math.trunc((step * 307) / 256);
      break;
    case 0x05:
      step = Math.trunc((step * 409) / 256);
      break;
    case 0x06:
      step *= 2;
      break;
    case 0x07:
      step = Math.trunc((step * 307) / 128);
      break;
  }

  return clamp(step, 127, 24576);
}

function decodePcm(data, bits, channels, signed) {
  if (bits === 8) {
    const pcm = new Int16Array(data.length);
    for (let i = 0; i < data.length; i += 1) {
      const sample = signed ? (data[i] << 24) >> 24 : data[i] - 128;
      pcm[i] = clamp16(sample << 8);
    }
    return pcm;
  }

  if (bits === 16) {
    const samples = Math.floor(data.length / 2);
    const pcm = new Int16Array(samples);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < samples; i += 1) {
      const value = view.getUint16(i * 2, false);
      pcm[i] = signed ? (value << 16) >> 16 : value - 32768;
    }
    return pcm;
  }

  const decoded = decodeYamahaAdpcm(data, channels);
  return decoded;
}

function concatenatePieces(pieces) {
  const sampleRate = pieces[0].sampleRate;
  const channels = Math.max(...pieces.map((piece) => piece.channels));
  const converted = pieces.map((piece) => {
    let pcm = piece.pcm;
    if (piece.sampleRate !== sampleRate) {
      pcm = resamplePcm(pcm, piece.sampleRate, sampleRate, piece.channels);
    }
    if (piece.channels !== channels) {
      pcm = convertChannels(pcm, piece.channels, channels);
    }
    return pcm;
  });
  const total = converted.reduce((sum, pcm) => sum + pcm.length, 0);
  const pcm = new Int16Array(total);
  let offset = 0;

  for (const piece of converted) {
    pcm.set(piece, offset);
    offset += piece.length;
  }

  return { channels, pcm, sampleRate };
}

function synthesizeNotes(notes, sampleRate, channels) {
  const maxMs = Math.min(
    Math.max(...notes.map((item) => item.startMs + item.durationMs), 1000) + 250,
    5 * 60 * 1000,
  );
  const frames = Math.ceil((maxMs / 1000) * sampleRate);
  const mix = new Float32Array(frames * channels);

  for (const item of notes) {
    const start = Math.max(0, Math.floor((item.startMs / 1000) * sampleRate));
    const length = Math.max(1, Math.floor((item.durationMs / 1000) * sampleRate));
    const end = Math.min(frames, start + length);
    const freq = 440 * 2 ** ((item.pitch - 69) / 12);
    const gain = Math.min(0.24, 0.05 + (item.velocity / 127) * 0.16);
    const pan = channels === 2 ? (item.channel % 4) / 3 : 0.5;

    for (let frame = start; frame < end; frame += 1) {
      const local = frame - start;
      const t = local / sampleRate;
      const attack = Math.min(1, local / Math.max(1, sampleRate * 0.008));
      const release = Math.min(1, (end - frame) / Math.max(1, sampleRate * 0.04));
      const env = Math.min(attack, release);
      const tone = Math.sin(2 * Math.PI * freq * t) * 0.82 + Math.sin(4 * Math.PI * freq * t) * 0.18;
      const value = tone * gain * env;

      if (channels === 1) {
        mix[frame] += value;
      } else {
        mix[frame * 2] += value * (1 - pan * 0.55);
        mix[frame * 2 + 1] += value * (0.45 + pan * 0.55);
      }
    }
  }

  const pcm = new Int16Array(mix.length);
  for (let i = 0; i < mix.length; i += 1) {
    pcm[i] = clamp16(Math.round(Math.max(-1, Math.min(1, mix[i])) * 32767));
  }

  return { channels, pcm, sampleRate };
}

function resamplePcm(pcm, fromRate, toRate, channels) {
  const fromFrames = Math.floor(pcm.length / channels);
  const toFrames = Math.max(1, Math.round((fromFrames * toRate) / fromRate));
  const output = new Int16Array(toFrames * channels);

  for (let frame = 0; frame < toFrames; frame += 1) {
    const source = (frame * fromRate) / toRate;
    const leftIndex = Math.floor(source);
    const rightIndex = Math.min(fromFrames - 1, leftIndex + 1);
    const frac = source - leftIndex;

    for (let channel = 0; channel < channels; channel += 1) {
      const a = pcm[leftIndex * channels + channel] || 0;
      const b = pcm[rightIndex * channels + channel] || 0;
      output[frame * channels + channel] = Math.round(a + (b - a) * frac);
    }
  }

  return output;
}

function convertChannels(pcm, fromChannels, toChannels) {
  if (fromChannels === toChannels) return pcm;
  const frames = Math.floor(pcm.length / fromChannels);
  const output = new Int16Array(frames * toChannels);

  for (let frame = 0; frame < frames; frame += 1) {
    if (toChannels === 1) {
      let sum = 0;
      for (let channel = 0; channel < fromChannels; channel += 1) {
        sum += pcm[frame * fromChannels + channel] || 0;
      }
      output[frame] = Math.round(sum / fromChannels);
    } else {
      const mono = fromChannels === 1 ? pcm[frame] : Math.round((pcm[frame * fromChannels] + pcm[frame * fromChannels + 1]) / 2);
      output[frame * 2] = fromChannels === 1 ? mono : pcm[frame * fromChannels];
      output[frame * 2 + 1] = fromChannels === 1 ? mono : pcm[frame * fromChannels + 1];
    }
  }

  return output;
}

function normalizePcm(pcm) {
  let peak = 0;
  for (const sample of pcm) peak = Math.max(peak, Math.abs(sample));
  if (peak < 1) return pcm;
  const gain = Math.min(8, 30000 / peak);
  const output = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) {
    output[i] = clamp16(Math.round(pcm[i] * gain));
  }
  return output;
}

function decodeAwaWaveType(value) {
  const index = (value & 0x0f00) >> 8;
  return {
    bits: 4 * (((value & 0x00f0) >> 4) + 1),
    channels: (value & 0x8000) ? 2 : 1,
    format: (value & 0x7000) >> 12,
    sampleRate: AWA_SAMPLE_RATES[index] || 8000,
  };
}

function decodeMwaWaveType(bytes) {
  return {
    bits: 4 * ((bytes[0] & 0x0f) + 1),
    channels: (bytes[0] & 0x80) ? 2 : 1,
    format: MWA_FORMAT_TABLE[(bytes[0] & 0x70) >> 4] ?? WAVE_FORMAT.YAMAHA_ADPCM,
    sampleRate: ((bytes[1] & 0xff) << 8) | (bytes[2] & 0xff),
  };
}

function readChunkHeader(bytes, offset, end) {
  if (offset + 8 > end) return null;
  const id = ascii(bytes, offset, 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(offset + 4, false);
  return {
    id,
    offset,
    payloadEnd: offset + 8 + size,
    payloadStart: offset + 8,
    size,
  };
}

function readHpsVariableLength(reader) {
  const d1 = reader.u8();
  if ((d1 & 0x80) !== 0) {
    return (((d1 & 0x7f) + 1) << 7) | reader.u8();
  }
  return d1;
}

function readMidiVariableLength(reader) {
  let value = 0;
  let guard = 0;
  while (reader.remaining > 0 && guard < 4) {
    const byte = reader.u8();
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
    guard += 1;
  }
  return value;
}

function note(startMs, durationMs, pitch, channel, velocity) {
  return {
    channel,
    durationMs: Math.max(durationMs, 10),
    pitch: clamp(pitch, 12, 120),
    startMs,
    velocity: clamp(velocity || 96, 1, 127),
  };
}

function timeBase(code) {
  return TIME_BASE_TABLE[code] > 0 ? TIME_BASE_TABLE[code] : 1;
}

function decodeOctaveShift(value) {
  if (value >= 0x81 && value <= 0x84) return -(value - 0x80) * 12;
  if (value >= 1 && value <= 4) return value * 12;
  return 0;
}

function summarizeParsed(parsed) {
  if (parsed.audioChunks.length > 0) {
    return `${parsed.audioChunks.length} audio chunk${parsed.audioChunks.length === 1 ? "" : "s"}`;
  }
  if (parsed.notes.length > 0) {
    return `${parsed.notes.length} sequence note${parsed.notes.length === 1 ? "" : "s"}`;
  }
  return "SMAF structure detected";
}

function int16BytesFromPcm(pcm) {
  const bytes = new Uint8Array(pcm.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < pcm.length; i += 1) view.setInt16(i * 2, pcm[i], true);
  return bytes;
}

function int24BytesFromPcm(pcm) {
  const bytes = new Uint8Array(pcm.length * 3);
  for (let i = 0; i < pcm.length; i += 1) {
    const value = clamp16(pcm[i]) << 8;
    bytes[i * 3] = value & 0xff;
    bytes[i * 3 + 1] = (value >> 8) & 0xff;
    bytes[i * 3 + 2] = (value >> 16) & 0xff;
  }
  return bytes;
}

function float32BytesFromPcm(pcm) {
  const bytes = new Uint8Array(pcm.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < pcm.length; i += 1) view.setFloat32(i * 4, pcm[i] / 32768, true);
  return bytes;
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

function ascii(bytes, offset, length) {
  let text = "";
  for (let i = 0; i < length; i += 1) text += String.fromCharCode(bytes[offset + i]);
  return text;
}

function toBytes(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clamp16(value) {
  return clamp(value, -32768, 32767);
}

class ByteReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.offset = 0;
  }

  get remaining() {
    return this.bytes.length - this.offset;
  }

  u8() {
    if (this.remaining <= 0) throw new Error("Unexpected end of sequence.");
    return this.bytes[this.offset++];
  }

  skip(count) {
    this.offset = Math.min(this.bytes.length, this.offset + Math.max(0, count));
  }
}
