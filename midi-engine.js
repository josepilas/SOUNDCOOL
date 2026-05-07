const MIDI_RENDER_WORKER_URL = new URL("./midi-render-worker.js", import.meta.url);
const DEFAULT_RENDER_TIMEOUT_MS = 10 * 60 * 1000;

let nextRenderId = 1;

export async function renderMidiWithSoundFont(sf2Buffer, midiBuffer, options = {}) {
  if (!window.Worker) {
    throw new Error("Web Workers are not available in this browser.");
  }

  const worker = new Worker(MIDI_RENDER_WORKER_URL, { type: "module" });
  const id = nextRenderId;
  nextRenderId += 1;

  const sf2Copy = copyArrayBuffer(sf2Buffer);
  const midiCopy = copyArrayBuffer(midiBuffer);
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_RENDER_TIMEOUT_MS;

  try {
    return await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error("MIDI rendering timed out."));
      }, timeoutMs);

      const settle = (callback, value) => {
        window.clearTimeout(timeout);
        callback(value);
      };

      worker.onmessage = (event) => {
        const message = event.data;
        if (!message || message.id !== id) return;

        if (message.type === "progress") {
          options.onProgress?.(message.progress);
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
        settle(reject, new Error(event.message || "MIDI render worker failed."));
      };

      worker.postMessage(
        {
          channels: options.channels,
          id,
          midiBuffer: midiCopy,
          name: options.name || "sequence.mid",
          sampleRate: options.sampleRate,
          sf2Buffer: sf2Copy,
          tailSeconds: options.tailSeconds,
          type: "render",
        },
        [sf2Copy, midiCopy],
      );
    });
  } finally {
    worker.terminate();
  }
}

function copyArrayBuffer(buffer) {
  return buffer.slice(0);
}

function workerError(error) {
  const message = error?.message || "MIDI render worker failed.";
  const nextError = new Error(message);
  if (error?.stack) {
    nextError.stack = error.stack;
  }
  return nextError;
}
