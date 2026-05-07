import {
  BasicMIDI,
  SoundBankLoader,
  SpessaSynthProcessor,
  SpessaSynthSequencer,
} from "https://esm.sh/spessasynth_core@4.2.13";

const BLOCK_SIZE = 128;
const BLOCKS_PER_PROGRESS = 64;
const DEFAULT_SAMPLE_RATE = 44100;
const DEFAULT_TAIL_SECONDS = 2;
const MAIN_SOUND_BANK_ID = "soundcool-main";
const MAX_RENDER_BYTES = 512 * 1024 * 1024;

self.onmessage = async (event) => {
  const message = event.data;
  if (!message || message.type !== "render") return;

  try {
    const result = await renderMidi(message);
    self.postMessage({ id: message.id, result, type: "done" }, [result.wavBytes.buffer]);
  } catch (error) {
    self.postMessage({
      error: serializeError(error),
      id: message.id,
      type: "error",
    });
  }
};

async function renderMidi(message) {
  const sampleRate = sanitizeSampleRate(message.sampleRate);
  const channels = Number(message.channels) === 1 ? 1 : 2;
  const tailSeconds = sanitizeTailSeconds(message.tailSeconds);
  const midi = BasicMIDI.fromArrayBuffer(message.midiBuffer, message.name || "sequence.mid");

  const loopStart = midi.midiTicksToSeconds(midi.loop.start);
  const loopEnd = midi.midiTicksToSeconds(midi.loop.end);
  const loopDuration = Number.isFinite(loopStart) && Number.isFinite(loopEnd) ? Math.max(0, loopEnd - loopStart) : 0;
  const duration = Math.max(0.25, Number(midi.duration) || 0.25) + tailSeconds + loopDuration * 0;
  const frameCount = Math.max(BLOCK_SIZE, Math.ceil(sampleRate * duration));
  const estimatedBytes = frameCount * (Float32Array.BYTES_PER_ELEMENT * 2 + Int16Array.BYTES_PER_ELEMENT * channels);

  if (estimatedBytes > MAX_RENDER_BYTES) {
    throw new Error(
      `This MIDI render is too large for in-browser conversion (${Math.ceil(estimatedBytes / 1024 / 1024)} MB).`,
    );
  }

  const synth = new SpessaSynthProcessor(sampleRate, {
    enableEffects: true,
    enableEventSystem: false,
  });

  try {
    const soundBank = SoundBankLoader.fromArrayBuffer(message.sf2Buffer);
    synth.soundBankManager.addSoundBank(soundBank, MAIN_SOUND_BANK_ID, Number(midi.bankOffset) || 0);
    await synth.processorInitialized;
    synth.setMasterParameter("autoAllocateVoices", true);

    const sequencer = new SpessaSynthSequencer(synth);
    sequencer.loopCount = 0;
    sequencer.loadNewSongList([midi]);
    sequencer.play();

    const left = new Float32Array(frameCount);
    const right = new Float32Array(frameCount);
    renderToBuffers(synth, sequencer, left, right, message.id);

    const wavBytes = floatStereoToPcm16Wav(left, right, sampleRate, channels);
    postProgress(message.id, 1);
    return {
      channels,
      duration: frameCount / sampleRate,
      midiName: midi.getName?.() || message.name || "sequence",
      sampleRate,
      wavBytes,
    };
  } finally {
    synth.destroySynthProcessor?.();
  }
}

function renderToBuffers(synth, sequencer, left, right, id) {
  const frameCount = left.length;
  const finalBlockStart = Math.max(0, frameCount - BLOCK_SIZE);
  let index = 0;

  while (index < finalBlockStart) {
    for (let block = 0; block < BLOCKS_PER_PROGRESS && index < finalBlockStart; block += 1) {
      sequencer.processTick();
      synth.process(left, right, index, BLOCK_SIZE);
      index += BLOCK_SIZE;
    }
    postProgress(id, Math.min(0.98, index / frameCount));
  }

  if (index < frameCount) {
    sequencer.processTick();
    synth.process(left, right, index, frameCount - index);
  }
}

function floatStereoToPcm16Wav(left, right, sampleRate, channels) {
  const frameCount = left.length;
  const pcm = new Int16Array(frameCount * channels);

  for (let frame = 0; frame < frameCount; frame += 1) {
    if (channels === 1) {
      pcm[frame] = floatToInt16((left[frame] + right[frame]) * 0.5);
    } else {
      const offset = frame * 2;
      pcm[offset] = floatToInt16(left[frame]);
      pcm[offset + 1] = floatToInt16(right[frame]);
    }
  }

  return pcm16ToWavBytes(pcm, sampleRate, channels);
}

function pcm16ToWavBytes(pcm, sampleRate, channels) {
  const dataBytes = new Uint8Array(pcm.buffer);
  const buffer = new ArrayBuffer(44 + dataBytes.length);
  const view = new DataView(buffer);
  const output = new Uint8Array(buffer);
  const blockAlign = channels * 2;

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes.length, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes.length, true);
  output.set(dataBytes, 44);

  return output;
}

function floatToInt16(value) {
  const sample = Math.max(-1, Math.min(1, value || 0));
  return sample < 0 ? sample * 32768 : sample * 32767;
}

function sanitizeSampleRate(value) {
  const sampleRate = Number(value) || DEFAULT_SAMPLE_RATE;
  return sampleRate >= 8000 && sampleRate <= 192000 ? Math.round(sampleRate) : DEFAULT_SAMPLE_RATE;
}

function sanitizeTailSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 10 ? seconds : DEFAULT_TAIL_SECONDS;
}

function postProgress(id, progress) {
  self.postMessage({
    id,
    progress: Math.max(0, Math.min(1, progress)),
    type: "progress",
  });
}

function serializeError(error) {
  return {
    message: error?.message || String(error),
    stack: error?.stack || "",
  };
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}
