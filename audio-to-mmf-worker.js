import { encodeSmafFromPcm, SMAF_PCM_SAMPLE_RATES } from "./smaf-engine.js";

const MAX_MMF_AUDIO_BYTES = 96 * 1024 * 1024;
const DEFAULT_SAMPLE_RATE = 22050;
const TARGET_PEAK = 0.98;
const PROGRESS_STEP_FRAMES = 32768;

self.onmessage = (event) => {
  const message = event.data;
  if (!message || message.type !== "render") return;

  try {
    const result = renderAudioToMmf(message);
    self.postMessage({ id: message.id, result, type: "done" }, [result.mmfBytes.buffer]);
  } catch (error) {
    self.postMessage({
      error: serializeError(error),
      id: message.id,
      type: "error",
    });
  }
};

function renderAudioToMmf(message) {
  const sourceChannels = normalizeChannelData(message.channelData);
  const sourceSampleRate = sanitizeSourceRate(message.sourceSampleRate);
  const sourceFrameCount = resolveSourceFrameCount(message.sourceFrameCount, sourceChannels);
  const sampleRate = sanitizeMmfSampleRate(message.sampleRate);
  const channels = Number(message.channels) === 1 ? 1 : 2;
  const bits = Number(message.bits) === 8 ? 8 : 16;
  const frameCount = Math.max(1, Math.round((sourceFrameCount * sampleRate) / sourceSampleRate));
  const sampleCount = frameCount * channels;
  const estimatedBytes = sampleCount * (bits / 8) + 30;

  if (estimatedBytes > MAX_MMF_AUDIO_BYTES) {
    throw new Error(
      `The MMF would be ${formatBytes(estimatedBytes)}, which is too large for in-browser conversion. Try mono, 8-bit PCM, or a lower sample rate.`,
    );
  }

  postProgress(message.id, 0.02);

  const gain = message.normalize
    ? computeNormalizeGain(sourceChannels, sourceFrameCount, sourceSampleRate, sampleRate, channels, frameCount, message.id)
    : 1;

  const pcm = new Int16Array(sampleCount);
  fillPcm({
    channels,
    frameCount,
    gain,
    id: message.id,
    pcm,
    sampleRate,
    sourceChannels,
    sourceFrameCount,
    sourceSampleRate,
    startProgress: message.normalize ? 0.34 : 0.08,
  });

  postProgress(message.id, 0.82);
  const mmfBytes = encodeSmafFromPcm(pcm, sampleRate, channels, { bits });
  postProgress(message.id, 1);

  return {
    bits,
    channels,
    duration: frameCount / sampleRate,
    mmfBytes,
    sampleRate,
    sourceName: message.name || "audio",
  };
}

function normalizeChannelData(channelData) {
  const channels = Array.isArray(channelData) ? channelData : [];
  const normalized = channels
    .map((channel) => {
      if (channel instanceof Float32Array) return channel;
      if (channel instanceof ArrayBuffer) return new Float32Array(channel);
      if (ArrayBuffer.isView(channel)) {
        return new Float32Array(channel.buffer, channel.byteOffset, Math.floor(channel.byteLength / 4));
      }
      return null;
    })
    .filter(Boolean);

  if (normalized.length === 0 || normalized[0].length === 0) {
    throw new Error("The decoded audio contains no PCM samples.");
  }

  return normalized;
}

function resolveSourceFrameCount(sourceFrameCount, sourceChannels) {
  const channelFrames = sourceChannels.reduce((min, channel) => Math.min(min, channel.length), sourceChannels[0].length);
  const requestedFrames = Math.max(1, Math.floor(Number(sourceFrameCount) || channelFrames));
  return Math.max(1, Math.min(requestedFrames, channelFrames));
}

function computeNormalizeGain(sourceChannels, sourceFrameCount, sourceSampleRate, sampleRate, channels, frameCount, id) {
  let peak = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const source = sourcePosition(frame, sourceSampleRate, sampleRate, sourceFrameCount);

    if (channels === 1) {
      peak = Math.max(peak, Math.abs(sampleMono(sourceChannels, source.left, source.right, source.fraction)));
    } else {
      peak = Math.max(
        peak,
        Math.abs(sampleStereo(sourceChannels, 0, source.left, source.right, source.fraction)),
        Math.abs(sampleStereo(sourceChannels, 1, source.left, source.right, source.fraction)),
      );
    }

    if (frame % PROGRESS_STEP_FRAMES === 0) {
      postProgress(id, 0.02 + (frame / frameCount) * 0.3);
    }
  }

  postProgress(id, 0.34);

  if (peak <= 0) {
    return 1;
  }

  return TARGET_PEAK / peak;
}

function fillPcm(options) {
  const progressSpan = 0.78 - options.startProgress;

  for (let frame = 0; frame < options.frameCount; frame += 1) {
    const source = sourcePosition(frame, options.sourceSampleRate, options.sampleRate, options.sourceFrameCount);

    if (options.channels === 1) {
      options.pcm[frame] = floatToInt16(sampleMono(options.sourceChannels, source.left, source.right, source.fraction), options.gain);
    } else {
      const offset = frame * 2;
      options.pcm[offset] = floatToInt16(
        sampleStereo(options.sourceChannels, 0, source.left, source.right, source.fraction),
        options.gain,
      );
      options.pcm[offset + 1] = floatToInt16(
        sampleStereo(options.sourceChannels, 1, source.left, source.right, source.fraction),
        options.gain,
      );
    }

    if (frame % PROGRESS_STEP_FRAMES === 0) {
      postProgress(options.id, options.startProgress + (frame / options.frameCount) * progressSpan);
    }
  }

  postProgress(options.id, 0.78);
}

function sourcePosition(frame, sourceSampleRate, sampleRate, sourceFrameCount) {
  const position = (frame * sourceSampleRate) / sampleRate;
  const left = Math.min(sourceFrameCount - 1, Math.floor(position));
  const right = Math.min(sourceFrameCount - 1, left + 1);
  return {
    fraction: position - left,
    left,
    right,
  };
}

function sampleMono(sourceChannels, left, right, fraction) {
  let sum = 0;
  for (let channel = 0; channel < sourceChannels.length; channel += 1) {
    sum += interpolate(sourceChannels[channel], left, right, fraction);
  }
  return sum / sourceChannels.length;
}

function sampleStereo(sourceChannels, channel, left, right, fraction) {
  const source = sourceChannels[Math.min(channel, sourceChannels.length - 1)];
  return interpolate(source, left, right, fraction);
}

function interpolate(samples, left, right, fraction) {
  const a = samples[left] || 0;
  const b = samples[right] || 0;
  return a + (b - a) * fraction;
}

function floatToInt16(value, gain) {
  const sample = Math.max(-1, Math.min(1, (value || 0) * gain));
  return sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
}

function sanitizeSourceRate(value) {
  const sampleRate = Number(value);
  return Number.isFinite(sampleRate) && sampleRate >= 1000 && sampleRate <= 384000 ? sampleRate : 44100;
}

function sanitizeMmfSampleRate(value) {
  const sampleRate = Number(value) || DEFAULT_SAMPLE_RATE;
  if (SMAF_PCM_SAMPLE_RATES.includes(sampleRate)) {
    return sampleRate;
  }

  return SMAF_PCM_SAMPLE_RATES.reduce((best, candidate) =>
    Math.abs(candidate - sampleRate) < Math.abs(best - sampleRate) ? candidate : best,
  );
}

function postProgress(id, progress) {
  self.postMessage({
    id,
    progress: Math.max(0, Math.min(1, progress)),
    type: "progress",
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function serializeError(error) {
  return {
    message: error?.message || String(error),
    stack: error?.stack || "",
  };
}
