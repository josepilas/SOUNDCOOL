import { convertSmafToPcm, encodeWav, inspectSmaf } from "./smaf-engine.js";
import { renderMidiWithSoundFont } from "./midi-engine.js";

const CDN = {
  ffmpeg: "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js",
  jszip: "https://esm.sh/jszip@3.10.1",
  lucide: "https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/esm/lucide.js",
  util: "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js",
  coreBase: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm",
};

const FORMAT_CONFIG = {
  mp3: {
    mime: "audio/mpeg",
    qualityLabel: "Bitrate",
    qualityOptions: [
      ["96k", "96 kbps"],
      ["128k", "128 kbps"],
      ["192k", "192 kbps"],
      ["256k", "256 kbps"],
      ["320k", "320 kbps"],
    ],
    defaultQuality: "128k",
  },
  ogg: {
    mime: "audio/ogg",
    qualityLabel: "Quality",
    qualityOptions: [
      ["3", "Vorbis q3"],
      ["5", "Vorbis q5"],
      ["7", "Vorbis q7"],
      ["9", "Vorbis q9"],
    ],
    defaultQuality: "5",
  },
  wav: {
    mime: "audio/wav",
    qualityLabel: "PCM",
    qualityOptions: [
      ["pcm_s16le", "16-bit"],
      ["pcm_s24le", "24-bit"],
      ["pcm_f32le", "32-bit float"],
    ],
    defaultQuality: "pcm_s16le",
  },
};

const els = {
  audioPreview: document.querySelector("#audioPreview"),
  channelSelect: document.querySelector("#channelSelect"),
  clearButton: document.querySelector("#clearButton"),
  convertButton: document.querySelector("#convertButton"),
  downloadLink: document.querySelector("#downloadLink"),
  dropMeta: document.querySelector("#dropMeta"),
  dropTitle: document.querySelector("#dropTitle"),
  dropZone: document.querySelector("#dropZone"),
  enginePill: document.querySelector("#enginePill"),
  fileDetails: document.querySelector("#fileDetails"),
  fileInput: document.querySelector("#fileInput"),
  fileList: document.querySelector("#fileList"),
  fileName: document.querySelector("#fileName"),
  fileStatus: document.querySelector("#fileStatus"),
  fileStrip: document.querySelector("#fileStrip"),
  formatRadios: [...document.querySelectorAll('input[name="format"]')],
  logList: document.querySelector("#logList"),
  modeRadios: [...document.querySelectorAll('input[name="mode"]')],
  normalizeToggle: document.querySelector("#normalizeToggle"),
  progressBar: document.querySelector("#progressBar"),
  progressValue: document.querySelector("#progressValue"),
  qualityLabel: document.querySelector("#qualityLabel"),
  qualitySelect: document.querySelector("#qualitySelect"),
  resultBox: document.querySelector("#resultBox"),
  resultDetails: document.querySelector("#resultDetails"),
  resultName: document.querySelector("#resultName"),
  sampleRateSelect: document.querySelector("#sampleRateSelect"),
  sf2Input: document.querySelector("#sf2Input"),
  sf2Panel: document.querySelector("#sf2Panel"),
  sf2Status: document.querySelector("#sf2Status"),
  sourceTitle: document.querySelector("#sourceTitle"),
  statusText: document.querySelector("#statusText"),
  visualizer: document.querySelector("#visualizer"),
};

const state = {
  busy: false,
  conversionSeed: 3,
  ffmpeg: null,
  iconsReady: false,
  lastLogs: [],
  midiFiles: [],
  mode: "smaf",
  outputUrls: [],
  progress: 0,
  progressBase: 0,
  progressSpan: 100,
  sf2Buffer: null,
  sf2File: null,
  smafFiles: [],
};

boot();

function boot() {
  setupIcons();
  setupEvents();
  updateQualityOptions();
  setMode("smaf", { keepFiles: true });
  setProgress(0);
  drawVisualizer();
}

async function setupIcons() {
  try {
    const { createIcons, icons } = await import(CDN.lucide);
    createIcons({ icons });
    state.iconsReady = true;
  } catch {
    state.iconsReady = false;
  }
}

function refreshIcons() {
  if (!state.iconsReady) return;
  import(CDN.lucide)
    .then(({ createIcons, icons }) => createIcons({ icons }))
    .catch(() => {
      state.iconsReady = false;
    });
}

function setupEvents() {
  els.fileInput.addEventListener("change", () => {
    handlePrimaryFiles([...els.fileInput.files]);
  });

  els.sf2Input.addEventListener("change", () => {
    const [file] = els.sf2Input.files;
    if (file) handleSf2File(file);
  });

  els.clearButton.addEventListener("click", () => clearSelection());
  els.convertButton.addEventListener("click", convertFiles);

  els.modeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked) setMode(radio.value);
    });
  });

  els.formatRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      state.format = getFormat();
      updateQualityOptions();
      updateConvertButton();
    });
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("dragging");
    });
  });

  els.dropZone.addEventListener("drop", (event) => {
    handleDroppedFiles([...event.dataTransfer.files]);
  });
}

function setMode(mode, options = {}) {
  state.mode = mode;

  if (!options.keepFiles) {
    clearSelection({ keepMode: true });
  }

  els.sourceTitle.textContent = mode === "midi" ? "SoundFont and MIDI" : "Source files";
  els.sf2Panel.hidden = mode !== "midi";
  els.fileInput.accept =
    mode === "midi"
      ? ".mid,.midi,.rmi,audio/midi,audio/x-midi"
      : ".mmf,application/vnd.smaf,audio/x-smaf";
  els.dropTitle.textContent = mode === "midi" ? "Select MIDI files" : "Select .mmf files";
  els.dropMeta.textContent =
    mode === "midi" ? "Drop MIDI files, plus SF2 if you want" : "Drop one or many SMAF files";

  updateSourceUi();
  updateConvertButton();
}

async function handlePrimaryFiles(files) {
  revokeOutput();

  if (state.mode === "midi") {
    const midiFiles = files.filter(isMidiFile);
    const sf2Files = files.filter(isSoundFontFile);

    if (sf2Files.length > 0) {
      await handleSf2File(sf2Files[0]);
    }

    if (midiFiles.length > 0 || sf2Files.length === 0) {
      state.midiFiles = midiFiles;
    }
    if (files.length > midiFiles.length + sf2Files.length) {
      addLog("Some dropped files were ignored because they are not MIDI or SF2 files.");
    }
    addLog(midiFiles.length > 0 ? `${midiFiles.length} MIDI file(s) queued.` : "No MIDI files selected.");
    updateSourceUi();
    updateConvertButton();
    return;
  }

  const smafFiles = files.filter(isSmafFile);
  state.smafFiles = [];

  for (const file of smafFiles) {
    const buffer = await file.arrayBuffer();
    const magic = readMagic(buffer);
    let info = null;
    let detail = magic === "MMMD" ? "SMAF signature" : "unconfirmed signature";

    if (magic === "MMMD") {
      try {
        info = inspectSmaf(buffer);
        detail = info.summary;
      } catch (error) {
        detail = error.message;
      }
    }

    state.smafFiles.push({ buffer, detail, file, info, valid: magic === "MMMD" });
  }

  if (files.length > smafFiles.length) {
    addLog("Some selected files were ignored because they are not .mmf files.");
  }

  addLog(smafFiles.length > 0 ? `${smafFiles.length} SMAF file(s) queued.` : "No SMAF files selected.");
  updateSourceUi();
  updateConvertButton();
}

async function handleSf2File(file) {
  revokeOutput();
  state.sf2File = file;
  state.sf2Buffer = await file.arrayBuffer();
  addLog(`SoundFont loaded: ${file.name}`);
  updateSourceUi();
  updateConvertButton();
}

function handleDroppedFiles(files) {
  const hasMidiModeFile = files.some((file) => isMidiFile(file) || isSoundFontFile(file));
  if (hasMidiModeFile && state.mode !== "midi") {
    els.modeRadios.find((radio) => radio.value === "midi").checked = true;
    setMode("midi");
  }

  handlePrimaryFiles(files);
}

function clearSelection(options = {}) {
  revokeOutput();
  state.midiFiles = [];
  state.sf2Buffer = null;
  state.sf2File = null;
  state.smafFiles = [];
  els.fileInput.value = "";
  els.sf2Input.value = "";

  if (!options.keepMode) {
    state.mode = getMode();
  }

  setProgress(0);
  setStatus("Waiting", "muted");
  addLog("Input cleared.");
  updateSourceUi();
  updateConvertButton();
}

function updateSourceUi() {
  const items = [];
  let title = "";
  let detail = "";
  let status = "Ready";
  let showStrip = false;

  if (state.mode === "midi") {
    showStrip = state.midiFiles.length > 0 || Boolean(state.sf2File);
    title = `${state.midiFiles.length} MIDI file${state.midiFiles.length === 1 ? "" : "s"}`;
    detail = state.sf2File
      ? `${state.sf2File.name} · ${formatBytes(state.sf2File.size)}`
      : "Select one SF2 soundfont";
    status = state.sf2File && state.midiFiles.length > 0 ? "Ready" : "Missing";
    els.sf2Status.textContent = state.sf2File ? trimFileName(state.sf2File.name) : "No SF2 selected";
    els.dropTitle.textContent =
      state.midiFiles.length > 0 ? `${state.midiFiles.length} MIDI file${state.midiFiles.length === 1 ? "" : "s"}` : "Select MIDI files";
    els.dropMeta.textContent = state.sf2File ? "SF2 ready" : "Add an SF2 soundfont";

    if (state.sf2File) {
      items.push({ detail: formatBytes(state.sf2File.size), name: state.sf2File.name });
    }

    for (const file of state.midiFiles) {
      items.push({ detail: formatBytes(file.size), name: file.name });
    }
  } else {
    showStrip = state.smafFiles.length > 0;
    title = `${state.smafFiles.length} SMAF file${state.smafFiles.length === 1 ? "" : "s"}`;
    detail = `${formatBytes(totalSize(state.smafFiles.map((entry) => entry.file)))} · batch ready`;
    status = state.smafFiles.length > 0 ? "Ready" : "Waiting";
    els.dropTitle.textContent =
      state.smafFiles.length > 0 ? `${state.smafFiles.length} SMAF file${state.smafFiles.length === 1 ? "" : "s"}` : "Select .mmf files";
    els.dropMeta.textContent =
      state.smafFiles.length > 0 ? "Batch loaded" : "Drop one or many SMAF files";

    for (const entry of state.smafFiles) {
      items.push({ detail: entry.detail, name: entry.file.name });
    }
  }

  els.fileStrip.hidden = !showStrip;
  els.clearButton.disabled = state.busy || !showStrip;
  els.fileName.textContent = title;
  els.fileDetails.textContent = detail;
  els.fileStatus.textContent = status;
  els.fileStatus.classList.toggle("error", status === "Missing");
  renderFileList(items);
  refreshIcons();
}

function renderFileList(items) {
  els.fileList.replaceChildren(
    ...items.map((item) => {
      const row = document.createElement("li");
      const name = document.createElement("span");
      const detail = document.createElement("span");
      name.textContent = item.name;
      detail.textContent = item.detail;
      row.append(name, detail);
      return row;
    }),
  );
}

function updateQualityOptions() {
  const config = FORMAT_CONFIG[getFormat()];
  els.qualityLabel.textContent = config.qualityLabel;
  els.qualitySelect.replaceChildren(
    ...config.qualityOptions.map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === config.defaultQuality;
      return option;
    }),
  );
}

function updateConvertButton() {
  const canConvert =
    state.mode === "midi"
      ? Boolean(state.sf2File && state.sf2Buffer && state.midiFiles.length > 0)
      : state.smafFiles.length > 0;
  els.convertButton.disabled = state.busy || !canConvert;
}

async function convertFiles() {
  if (state.busy) return;

  const format = getFormat();
  const jobs = state.mode === "midi" ? state.midiFiles : state.smafFiles;
  if (jobs.length === 0) return;

  setBusy(true);
  revokeOutput();
  setProgress(0);
  setStatus("Preparing", "muted");
  setConvertButtonLoading(true);

  const outputs = [];

  try {
    for (let index = 0; index < jobs.length; index += 1) {
      state.progressBase = (index / jobs.length) * 100;
      state.progressSpan = 100 / jobs.length;
      const job = jobs[index];
      const file = state.mode === "midi" ? job : job.file;

      addLog(`Converting ${index + 1}/${jobs.length}: ${file.name}`);
      setStatus(`Converting ${index + 1}/${jobs.length}`, "muted");
      setScopedProgress(0.04);

      const output =
        state.mode === "midi"
          ? await convertMidiFile(job, format)
          : await convertSmafFile(job, format);
      outputs.push(output);
      setScopedProgress(1);
    }

    await presentOutputs(outputs, format);
  } catch (error) {
    setStatus("Failed", "error");
    setEnginePill("error", "Engine failed");
    setProgress(0);
    addLog(formatError(error));
  } finally {
    state.progressBase = 0;
    state.progressSpan = 100;
    els.enginePill.classList.remove("loading");
    setConvertButtonLoading(false);
    setBusy(false);
  }
}

async function convertSmafFile(entry, format) {
  const outputName = outputNameFromInput(entry.file.name, format);

  try {
    setEnginePill("loading", "SMAF parser");
    setStatus("Reading SMAF", "muted");
    setScopedProgress(0.12);

    const pcm = convertSmafToPcm(entry.buffer, {
      channels: els.channelSelect.value,
      normalize: els.normalizeToggle.checked,
      sampleRate: els.sampleRateSelect.value,
    });

    addLog(`Native SMAF: ${pcm.details.source}.`);
    setScopedProgress(0.45);

    if (format === "wav") {
      const wav = encodeWav(pcm.pcm, pcm.sampleRate, pcm.channels, els.qualitySelect.value);
      return {
        blob: new Blob([wav], { type: FORMAT_CONFIG.wav.mime }),
        detail: `${pcm.details.source} · ${pcm.sampleRate} Hz · ${pcm.channels} ch`,
        name: outputName,
      };
    }

    const wav = encodeWav(pcm.pcm, pcm.sampleRate, pcm.channels, "pcm_s16le");
    const encoded = await encodeWaveWithFfmpeg(wav, format);
    return {
      blob: new Blob([encoded], { type: FORMAT_CONFIG[format].mime }),
      detail: `${pcm.details.source} · FFmpeg ${format.toUpperCase()} encoder`,
      name: outputName,
    };
  } catch (error) {
    addLog(`Native SMAF failed for ${entry.file.name}: ${formatError(error)} Trying FFmpeg.`);
    const fallback = await convertWithFfmpegDirect(entry.buffer, format);
    return {
      blob: fallback.blob,
      detail: "FFmpeg SMAF demuxer",
      name: outputName,
    };
  }
}

async function convertMidiFile(file, format) {
  if (!state.sf2Buffer) {
    throw new Error("Select an SF2 soundfont before rendering MIDI.");
  }

  const sampleRate = els.sampleRateSelect.value === "auto" ? 44100 : Number(els.sampleRateSelect.value);
  const channels = els.channelSelect.value === "1" ? 1 : 2;
  const outputName = outputNameFromInput(file.name, format);

  setEnginePill("loading", "Rendering MIDI");
  setStatus("Rendering MIDI", "muted");

  const midiBuffer = await file.arrayBuffer();
  const rendered = await renderMidiWithSoundFont(state.sf2Buffer, midiBuffer, {
    channels,
    name: file.name,
    onProgress: (progress) => setScopedProgress(0.08 + progress * 0.62),
    sampleRate,
  });

  setScopedProgress(0.72);
  addLog(`SF2+MIDI rendered: ${file.name}.`);

  if (format === "wav") {
    return {
      blob: new Blob([rendered.wavBytes], { type: FORMAT_CONFIG.wav.mime }),
      detail: `SF2+MIDI render · ${sampleRate} Hz · ${channels} ch`,
      name: outputName,
    };
  }

  const encoded = await encodeWaveWithFfmpeg(rendered.wavBytes, format);
  return {
    blob: new Blob([encoded], { type: FORMAT_CONFIG[format].mime }),
    detail: `SF2+MIDI render · FFmpeg ${format.toUpperCase()} encoder`,
    name: outputName,
  };
}

async function presentOutputs(outputs, format) {
  if (outputs.length === 1) {
    const [output] = outputs;
    const url = URL.createObjectURL(output.blob);
    state.outputUrls.push(url);
    setResult({
      downloadName: output.name,
      downloadUrl: url,
      previewUrl: url,
      resultDetails: `${format.toUpperCase()} · ${formatBytes(output.blob.size)} · ${output.detail}`,
      resultName: output.name,
    });
  } else {
    const JSZip = (await import(CDN.jszip)).default;
    const zip = new JSZip();
    for (const output of outputs) {
      zip.file(output.name, output.blob);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    state.outputUrls.push(url);
    setResult({
      downloadName: `SOUNDCOOL-${format}.zip`,
      downloadUrl: url,
      previewUrl: "",
      resultDetails: `${outputs.length} files · ZIP · ${format.toUpperCase()} outputs`,
      resultName: `SOUNDCOOL-${format}.zip`,
    });
  }

  setProgress(100);
  setStatus("Complete", "success");
  setEnginePill("ready", "Engine ready");
  addLog("Conversion complete.");
  refreshIcons();
}

function setResult({ downloadName, downloadUrl, previewUrl, resultDetails, resultName }) {
  els.downloadLink.href = downloadUrl;
  els.downloadLink.download = downloadName;
  els.resultName.textContent = resultName;
  els.resultDetails.textContent = resultDetails;

  if (previewUrl) {
    els.audioPreview.hidden = false;
    els.audioPreview.src = previewUrl;
  } else {
    els.audioPreview.hidden = true;
    els.audioPreview.removeAttribute("src");
  }

  els.resultBox.hidden = false;
}

async function encodeWaveWithFfmpeg(wavBytes, format) {
  const ffmpeg = await ensureEngine();
  const inputFsName = "soundcool-native.wav";
  const outputFsName = `soundcool-native.${format}`;

  await safeDelete(ffmpeg, inputFsName);
  await safeDelete(ffmpeg, outputFsName);
  await ffmpeg.writeFile(inputFsName, wavBytes);

  const args = buildEncodeArgs(inputFsName, outputFsName, format);
  addLog(`ffmpeg ${args.join(" ")}`);
  setStatus(`Encoding ${format.toUpperCase()}`, "muted");
  els.enginePill.classList.add("loading");

  const code = await ffmpeg.exec(args);
  if (code !== 0) {
    throw new Error(`FFmpeg exited with code ${code}.`);
  }

  const data = await ffmpeg.readFile(outputFsName);
  await safeDelete(ffmpeg, inputFsName);
  await safeDelete(ffmpeg, outputFsName);
  return data;
}

async function convertWithFfmpegDirect(inputBuffer, format) {
  const ffmpeg = await ensureEngine();
  const inputFsName = "soundcool-input.mmf";
  const outputFsName = `soundcool-output.${format}`;

  await safeDelete(ffmpeg, inputFsName);
  await safeDelete(ffmpeg, outputFsName);
  await ffmpeg.writeFile(inputFsName, new Uint8Array(inputBuffer));

  const args = buildArgs(inputFsName, outputFsName, format);
  addLog(`ffmpeg ${args.join(" ")}`);
  setStatus("Converting", "muted");
  els.enginePill.classList.add("loading");

  const code = await ffmpeg.exec(args);
  if (code !== 0) {
    throw new Error(`FFmpeg exited with code ${code}.`);
  }

  const data = await ffmpeg.readFile(outputFsName);
  await safeDelete(ffmpeg, inputFsName);
  await safeDelete(ffmpeg, outputFsName);

  return {
    blob: new Blob([data], { type: FORMAT_CONFIG[format].mime }),
  };
}

async function ensureEngine() {
  if (state.ffmpeg) {
    setEnginePill("ready", "Engine ready");
    return state.ffmpeg;
  }

  setEnginePill("loading", "Loading engine");
  setStatus("Loading FFmpeg", "muted");
  addLog("Loading FFmpeg.wasm.");

  const [{ FFmpeg }, { toBlobURL }] = await Promise.all([import(CDN.ffmpeg), import(CDN.util)]);
  const ffmpeg = new FFmpeg();

  ffmpeg.on("log", ({ message }) => {
    if (message) addLog(cleanLog(message));
  });

  ffmpeg.on("progress", ({ progress }) => {
    const nextProgress = Number.isFinite(progress) ? progress : 0;
    setScopedProgress(Math.max(0.04, Math.min(nextProgress, 0.98)));
  });

  await ffmpeg.load({
    classWorkerURL: await createFFmpegWorkerURL(),
    coreURL: await toBlobURL(`${CDN.coreBase}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${CDN.coreBase}/ffmpeg-core.wasm`, "application/wasm"),
  });

  state.ffmpeg = ffmpeg;
  setEnginePill("ready", "Engine ready");
  addLog("FFmpeg.wasm loaded.");
  return ffmpeg;
}

async function createFFmpegWorkerURL() {
  const workerBase = CDN.ffmpeg.replace(/\/index\.js$/, "");
  const response = await fetch(`${workerBase}/worker.js`);

  if (!response.ok) {
    throw new Error(`FFmpeg worker unavailable (${response.status}).`);
  }

  const source = (await response.text()).replace(
    /from\s+"\.\/(const|errors)\.js"/g,
    `from "${workerBase}/$1.js"`,
  );

  return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}

function buildArgs(inputFsName, outputFsName, format) {
  const args = ["-hide_banner", "-y", "-i", inputFsName, "-vn"];
  const filters = [];
  const sampleRate = els.sampleRateSelect.value;
  const channels = els.channelSelect.value;

  if (els.normalizeToggle.checked) {
    filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");
  }

  if (filters.length > 0) {
    args.push("-af", filters.join(","));
  }

  if (channels !== "auto") {
    args.push("-ac", channels);
  }

  if (sampleRate !== "auto") {
    args.push("-ar", sampleRate);
  }

  pushCodecArgs(args, format);
  args.push(outputFsName);
  return args;
}

function buildEncodeArgs(inputFsName, outputFsName, format) {
  const args = ["-hide_banner", "-y", "-i", inputFsName, "-vn"];
  pushCodecArgs(args, format);
  args.push(outputFsName);
  return args;
}

function pushCodecArgs(args, format) {
  if (format === "mp3") {
    args.push("-codec:a", "libmp3lame", "-b:a", els.qualitySelect.value);
  } else if (format === "ogg") {
    args.push("-codec:a", "libvorbis", "-q:a", els.qualitySelect.value);
  } else if (format === "wav") {
    args.push("-codec:a", els.qualitySelect.value);
  }
}

async function safeDelete(ffmpeg, path) {
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // The virtual file may not exist yet.
  }
}

function setBusy(isBusy) {
  state.busy = isBusy;
  els.clearButton.disabled = isBusy || !hasAnyInput();
  els.fileInput.disabled = isBusy;
  els.sf2Input.disabled = isBusy;
  els.modeRadios.forEach((radio) => {
    radio.disabled = isBusy;
  });
  els.formatRadios.forEach((radio) => {
    radio.disabled = isBusy;
  });
  els.qualitySelect.disabled = isBusy;
  els.sampleRateSelect.disabled = isBusy;
  els.channelSelect.disabled = isBusy;
  els.normalizeToggle.disabled = isBusy;
  updateConvertButton();
}

function setConvertButtonLoading(isLoading) {
  els.convertButton.classList.toggle("loading", isLoading);
  const icon = els.convertButton.querySelector("svg");
  if (icon) {
    icon.outerHTML = `<i data-lucide="${isLoading ? "loader-2" : "play"}" aria-hidden="true"></i>`;
    refreshIcons();
  }
}

function setEnginePill(kind, text) {
  els.enginePill.classList.remove("loading", "ready", "error");
  if (kind) els.enginePill.classList.add(kind);
  els.enginePill.querySelector("span").textContent = text;
  const iconName = kind === "error" ? "alert-triangle" : kind === "loading" ? "loader-2" : "activity";
  const icon = els.enginePill.querySelector("svg");
  if (icon) {
    icon.outerHTML = `<i data-lucide="${iconName}" aria-hidden="true"></i>`;
    refreshIcons();
  }
}

function setStatus(text, kind) {
  els.statusText.textContent = text;
  els.statusText.classList.remove("muted", "error", "success");
  if (kind === "success") {
    els.statusText.classList.add("success");
  } else if (kind === "error") {
    els.statusText.classList.add("error");
  } else {
    els.statusText.classList.add("muted");
  }
}

function setScopedProgress(value) {
  setProgress(state.progressBase + state.progressSpan * value);
}

function setProgress(value) {
  state.progress = Math.max(0, Math.min(100, value));
  els.progressValue.textContent = `${Math.round(state.progress)}%`;
  els.progressBar.style.width = `${state.progress}%`;
}

function addLog(message) {
  const safeMessage = String(message || "").trim();
  if (!safeMessage || safeMessage === "Aborted()") return;

  state.lastLogs.unshift(safeMessage);
  state.lastLogs = state.lastLogs.slice(0, 12);

  els.logList.replaceChildren(
    ...state.lastLogs.map((line) => {
      const item = document.createElement("li");
      item.textContent = line;
      return item;
    }),
  );
}

function cleanLog(message) {
  return message.replace(/\s+/g, " ").trim();
}

function formatError(error) {
  const message = error?.message || String(error);
  const context = `${message} ${state.lastLogs.join(" ")}`;
  if (/unknown encoder|encoder .* not found/i.test(context)) {
    return "The requested encoder is not available in the loaded FFmpeg.wasm build.";
  }

  if (/Invalid data|could not find codec|no audio|no such file|stream/i.test(context)) {
    return "The source could not be decoded. It may contain an unsupported SMAF or MIDI payload.";
  }

  return message.startsWith("Error:") ? message : `Error: ${message}`;
}

function revokeOutput() {
  for (const url of state.outputUrls) {
    URL.revokeObjectURL(url);
  }
  state.outputUrls = [];
  els.resultBox.hidden = true;
  els.audioPreview.hidden = false;
  els.audioPreview.removeAttribute("src");
  els.downloadLink.removeAttribute("href");
}

function outputNameFromInput(name, format) {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${format}`;
}

function readMagic(arrayBuffer) {
  try {
    return String.fromCharCode(...new Uint8Array(arrayBuffer).slice(0, 4));
  } catch {
    return "";
  }
}

function getFormat() {
  return els.formatRadios.find((radio) => radio.checked)?.value || "mp3";
}

function getMode() {
  return els.modeRadios.find((radio) => radio.checked)?.value || "smaf";
}

function hasAnyInput() {
  return state.smafFiles.length > 0 || state.midiFiles.length > 0 || Boolean(state.sf2File);
}

function isSmafFile(file) {
  return /\.mmf$/i.test(file.name);
}

function isMidiFile(file) {
  return /\.(mid|midi|rmi)$/i.test(file.name);
}

function isSoundFontFile(file) {
  return /\.(sf2|sf3|dls)$/i.test(file.name);
}

function totalSize(files) {
  return files.reduce((sum, file) => sum + file.size, 0);
}

function trimFileName(name) {
  if (name.length <= 28) return name;
  return `${name.slice(0, 13)}...${name.slice(-10)}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function hashString(input) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) || 1;
}

function drawVisualizer() {
  const canvas = els.visualizer;
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const bars = 72;
  const gap = 4;
  const barWidth = (width - gap * (bars - 1)) / bars;
  const now = performance.now() / 900;
  const active = state.busy ? 1 : 0.34;
  const progressLift = 0.18 + state.progress / 100;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#101414";
  ctx.fillRect(0, 0, width, height);

  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  for (let y = 42; y < height; y += 42) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (let index = 0; index < bars; index += 1) {
    const seeded = Math.sin(index * 13.13 + state.conversionSeed * 0.017) * 0.5 + 0.5;
    const pulse = Math.sin(now * (0.6 + seeded) + index * 0.32) * 0.5 + 0.5;
    const heightRatio = 0.1 + (seeded * 0.46 + pulse * 0.38) * active * progressLift;
    const barHeight = Math.max(8, height * Math.min(heightRatio, 0.92));
    const x = index * (barWidth + gap);
    const y = (height - barHeight) / 2;
    const hueColor = index % 3 === 0 ? "#df4d47" : index % 3 === 1 ? "#0f8f84" : "#d99718";

    ctx.fillStyle = hueColor;
    ctx.globalAlpha = 0.55 + pulse * 0.38;
    roundRect(ctx, x, y, barWidth, barHeight, Math.min(12, barWidth / 2));
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  requestAnimationFrame(drawVisualizer);
}

function roundRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
}
