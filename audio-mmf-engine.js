const AUDIO_MMF_WORKER_URL = new URL("./audio-to-mmf-worker.js", import.meta.url);
const DEFAULT_RENDER_TIMEOUT_MS = 10 * 60 * 1000;
const COPY_CHUNK_FRAMES = 65536;

let nextRenderId = 1;

export async function renderAudioBufferToMmf(audioBuffer, options = {}) {
  if (!window.Worker) {
    throw new Error("Web Workers are not available in this browser.");
  }

  const worker = new Worker(AUDIO_MMF_WORKER_URL, { type: "module" });
  const id = nextRenderId;
  nextRenderId += 1;

  const channelData = await copyAudioChannels(audioBuffer, options.channels, (progress) => {
    options.onProgress?.(progress * 0.1);
  });
  const transfer = channelData.map((channel) => channel.buffer);
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_RENDER_TIMEOUT_MS;

  try {
    return await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error("Audio to MMF conversion timed out."));
      }, timeoutMs);

      const settle = (callback, value) => {
        window.clearTimeout(timeout);
        callback(value);
      };

      worker.onmessage = (event) => {
        const message = event.data;
        if (!message || message.id !== id) return;

        if (message.type === "progress") {
          options.onProgress?.(0.1 + message.progress * 0.9);
          return;
        }

        if (message.type === "done") {
          settle(resolve, message.result);
          return;
        }

        if (message.type === "error") {
          settle(reject, workerError(message.error));
        }
      };

      worker.onerror = (event) => {
        settle(reject, new Error(event.message || "Audio to MMF worker failed."));
      };

      worker.postMessage(
        {
          bits: options.bits,
          channelData,
          channels: options.channels,
          id,
          name: options.name || "audio",
          normalize: Boolean(options.normalize),
          sampleRate: options.sampleRate,
          sourceFrameCount: audioBuffer.length,
          sourceSampleRate: audioBuffer.sampleRate,
          type: "render",
        },
        transfer,
      );
    });
  } finally {
    worker.terminate();
  }
}

async function copyAudioChannels(audioBuffer, outputChannels, onProgress) {
  const inputChannels = Math.max(1, audioBuffer.numberOfChannels || 1);
  const channelsToCopy = Number(outputChannels) === 1 ? inputChannels : Math.min(inputChannels, 2);
  const channelData = [];
  const totalFrames = Math.max(1, audioBuffer.length);
  const totalUnits = Math.max(1, channelsToCopy * Math.ceil(totalFrames / COPY_CHUNK_FRAMES));
  let completedUnits = 0;

  for (let channel = 0; channel < channelsToCopy; channel += 1) {
    const samples = new Float32Array(audioBuffer.length);
    const source = typeof audioBuffer.copyFromChannel === "function" ? null : audioBuffer.getChannelData(channel);

    for (let offset = 0; offset < totalFrames; offset += COPY_CHUNK_FRAMES) {
      const end = Math.min(totalFrames, offset + COPY_CHUNK_FRAMES);
      if (typeof audioBuffer.copyFromChannel === "function") {
        audioBuffer.copyFromChannel(samples.subarray(offset, end), channel, offset);
      } else {
        samples.set(source.subarray(offset, end), offset);
      }
      completedUnits += 1;
      onProgress?.(completedUnits / totalUnits);
      await yieldToBrowser();
    }

    channelData.push(samples);
  }

  return channelData;
}

function yieldToBrowser() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function workerError(error) {
  const message = error?.message || "Audio to MMF worker failed.";
  const nextError = new Error(message);
  if (error?.stack) {
    nextError.stack = error.stack;
  }
  return nextError;
}
