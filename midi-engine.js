const SPESSA_LIB_URL = "https://esm.sh/spessasynth_lib@4.2.15";
const SPESSA_CORE_URL = "https://esm.sh/spessasynth_core@4.2.13";
const SPESSA_WORKLET_URL =
  "https://cdn.jsdelivr.net/npm/spessasynth_lib@4.2.15/dist/spessasynth_processor.min.js";

let spessaModules;

export async function renderMidiWithSoundFont(sf2Buffer, midiBuffer, options = {}) {
  if (!window.OfflineAudioContext) {
    throw new Error("OfflineAudioContext is not available in this browser.");
  }

  const [{ WorkletSynthesizer, audioBufferToWav }, { BasicMIDI }] = await loadSpessaSynth();
  const parsedMidi = BasicMIDI.fromArrayBuffer(midiBuffer, options.name || "sequence.mid");
  const sampleRate = Number(options.sampleRate) || 44100;
  const channels = Number(options.channels) || 2;
  const duration = Math.max(0.25, Number(parsedMidi.duration) || 0.25);
  const renderLength = Math.ceil(sampleRate * (duration + 1));

  const context = new OfflineAudioContext({
    length: renderLength,
    numberOfChannels: channels,
    sampleRate,
  });

  await context.audioWorklet.addModule(SPESSA_WORKLET_URL);

  const synth = new WorkletSynthesizer(context, {
    enableEventSystem: false,
  });
  synth.connect(context.destination);

  await synth.startOfflineRender({
    loopCount: 0,
    midiSequence: parsedMidi,
    soundBankList: [{ bankOffset: 0, soundBankBuffer: sf2Buffer }],
  });

  await synth.isReady;

  let estimatedProgress = 0;
  const progressTimer = window.setInterval(() => {
    estimatedProgress += 0.25 / Math.max(duration, 0.25);
    const progress = Math.max(0, Math.min(0.98, estimatedProgress));
    options.onProgress?.(progress);
  }, 250);

  try {
    const audioBuffer = await context.startRendering();
    options.onProgress?.(1);
    const wavBlob = audioBufferToWav(audioBuffer);
    return {
      duration,
      midiName: parsedMidi.getName?.() || options.name || "sequence",
      sampleRate,
      wavBytes: new Uint8Array(await wavBlob.arrayBuffer()),
    };
  } finally {
    window.clearInterval(progressTimer);
    synth.destroy?.();
  }
}

async function loadSpessaSynth() {
  spessaModules ??= Promise.all([import(SPESSA_LIB_URL), import(SPESSA_CORE_URL)]);
  return spessaModules;
}
