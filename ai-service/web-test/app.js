const TARGET_SAMPLE_RATE = 16_000
const SILENCE_CHUNK_SAMPLES = 3_200
const SILENCE_CHUNK_COUNT = 4

const elements = {
  connectionDot: document.querySelector("#connectionDot"),
  connectionSummary: document.querySelector("#connectionSummary"),
  workerUrl: document.querySelector("#workerUrl"),
  connectButton: document.querySelector("#connectButton"),
  directionSwitch: document.querySelector("#directionSwitch"),
  directionEyebrow: document.querySelector("#directionEyebrow"),
  recordingHint: document.querySelector("#recordingHint"),
  microphoneSelect: document.querySelector("#microphoneSelect"),
  recordButton: document.querySelector("#recordButton"),
  recordButtonLabel: document.querySelector("#recordButtonLabel"),
  recorderState: document.querySelector("#recorderState"),
  levelFill: document.querySelector("#levelFill"),
  levelValue: document.querySelector("#levelValue"),
  emptyResults: document.querySelector("#emptyResults"),
  turnList: document.querySelector("#turnList"),
  clearResultsButton: document.querySelector("#clearResultsButton"),
  eventLog: document.querySelector("#eventLog"),
  copyEventsButton: document.querySelector("#copyEventsButton"),
  clearEventsButton: document.querySelector("#clearEventsButton"),
  toast: document.querySelector("#toast"),
}

const state = {
  socket: null,
  connection: "idle",
  ready: false,
  recording: false,
  capture: null,
  turns: new Map(),
  eventLines: [],
  sessionId: "",
  clientId: "",
}

class MicrophoneCapture {
  constructor({ deviceId, onChunk, onLevel }) {
    this.deviceId = deviceId
    this.onChunk = onChunk
    this.onLevel = onLevel
    this.audioContext = null
    this.stream = null
    this.sourceNode = null
    this.workletNode = null
  }

  async start() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Trình duyệt không hỗ trợ Web Audio microphone.")
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(this.deviceId
          ? { deviceId: { exact: this.deviceId } }
          : {}),
      },
    })

    this.audioContext = new AudioContextClass()
    await this.audioContext.audioWorklet.addModule("./pcm-audio-processor.js")
    this.sourceNode = this.audioContext.createMediaStreamSource(this.stream)
    this.workletNode = new AudioWorkletNode(
      this.audioContext,
      "vienmeet-lab-pcm-processor",
      {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      },
    )

    const sourceRate = this.audioContext.sampleRate
    this.workletNode.port.onmessage = (event) => {
      const { samples, rms } = event.data
      const downsampled = downsample(
        samples,
        sourceRate,
        TARGET_SAMPLE_RATE,
      )
      const pcm = toPcm16(downsampled)
      this.onChunk(pcm.buffer)
      this.onLevel(Math.min(100, Math.round(rms * 360)))
    }
    this.sourceNode.connect(this.workletNode)

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume()
    }
  }

  stop() {
    if (this.workletNode) {
      this.workletNode.port.onmessage = null
      this.workletNode.disconnect()
    }
    this.sourceNode?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    if (this.audioContext && this.audioContext.state !== "closed") {
      void this.audioContext.close()
    }
    this.workletNode = null
    this.sourceNode = null
    this.stream = null
    this.audioContext = null
  }
}

function selectedSpeaker() {
  return (
    document.querySelector('input[name="direction"]:checked')?.value || "en"
  )
}

function targetLanguage(source) {
  return source === "en" ? "vi" : "en"
}

function updateDirectionCopy() {
  const source = selectedSpeaker()
  const target = targetLanguage(source)
  elements.directionEyebrow.textContent =
    `${source === "en" ? "ENGLISH" : "VIETNAMESE"} → ` +
    `${target === "en" ? "ENGLISH" : "VIETNAMESE"}`
  elements.recordingHint.textContent =
    source === "en"
      ? "Ví dụ: “Hello, I would like to test a complete English sentence.”"
      : "Ví dụ: “Xin chào, tôi muốn kiểm tra một câu tiếng Việt hoàn chỉnh.”"

  if (state.ready && state.socket?.readyState === WebSocket.OPEN) {
    state.socket.send(
      JSON.stringify({
        type: "speaker.switch",
        speaker: source,
      }),
    )
    logOutbound("speaker.switch", { speaker: source })
    showToast(`Đã chuyển sang ${source.toUpperCase()} → ${target.toUpperCase()}`)
  }
}

function setConnection(connection, detail) {
  state.connection = connection
  elements.connectionDot.dataset.state = connection
  elements.connectionSummary.textContent = detail

  const isOpen =
    state.socket &&
    (state.socket.readyState === WebSocket.OPEN ||
      state.socket.readyState === WebSocket.CONNECTING)

  elements.connectButton.textContent = isOpen ? "Ngắt kết nối" : "Kết nối AI"
  elements.workerUrl.disabled = Boolean(isOpen)

  if (state.ready && connection === "ready") {
    elements.recordButton.disabled = false
    elements.recordButtonLabel.textContent = state.recording
      ? "Dừng & chốt câu"
      : "Bắt đầu nói"
    elements.recorderState.textContent = state.recording
      ? "Đang gửi PCM16 16 kHz tới AI worker…"
      : "AI đã sẵn sàng. Nói tự nhiên, bấm dừng khi hết câu."
  } else {
    elements.recordButton.disabled = true
    elements.recordButtonLabel.textContent =
      connection === "connecting" ? "AI đang khởi tạo…" : "Chờ AI sẵn sàng"
  }
}

function buildSocketUrl() {
  const raw = elements.workerUrl.value.trim()
  const url = new URL(raw)
  if (!["ws:", "wss:"].includes(url.protocol)) {
    throw new Error("URL phải bắt đầu bằng ws:// hoặc wss://")
  }

  state.sessionId = `speech-lab-${Date.now()}`
  state.clientId =
    typeof crypto.randomUUID === "function"
      ? `browser-${crypto.randomUUID()}`
      : `browser-${Math.random().toString(36).slice(2)}`
  url.searchParams.set("sessionId", state.sessionId)
  url.searchParams.set("clientId", state.clientId)
  return url.toString()
}

function connect() {
  if (
    state.socket &&
    [WebSocket.CONNECTING, WebSocket.OPEN].includes(state.socket.readyState)
  ) {
    disconnect()
    return
  }

  let url
  try {
    url = buildSocketUrl()
  } catch (error) {
    setConnection("error", "URL không hợp lệ")
    showToast(error.message)
    return
  }

  state.ready = false
  setConnection("connecting", "Đang mở AI WebSocket")
  elements.recorderState.textContent =
    "Đã mở socket, đang chờ model readiness…"
  appendEvent("OUT", {
    type: "socket.connect",
    url,
  })

  const socket = new WebSocket(url)
  socket.binaryType = "arraybuffer"
  state.socket = socket

  socket.addEventListener("open", () => {
    if (socket !== state.socket) return
    setConnection("connecting", "Đang kiểm tra model")
    const init = {
      type: "session.init",
      config: {
        languagePair: "vi-en",
        speaker: selectedSpeaker(),
      },
    }
    socket.send(JSON.stringify(init))
    logOutbound(init.type, init)
  })

  socket.addEventListener("message", (event) => {
    if (socket !== state.socket) return
    let message
    try {
      message = JSON.parse(event.data)
    } catch {
      appendEvent("IN", { type: "invalid-json", payload: String(event.data) })
      return
    }
    appendEvent("IN", message)
    handleWorkerEvent(message)
  })

  socket.addEventListener("error", () => {
    if (socket !== state.socket) return
    state.ready = false
    setConnection("error", "Không mở được AI WebSocket")
    elements.recorderState.textContent =
      "Kiểm tra ai-service đang chạy ở đúng host và port."
  })

  socket.addEventListener("close", (event) => {
    if (socket !== state.socket) return
    stopRecording({ flush: false })
    state.ready = false
    state.socket = null
    setConnection(
      event.wasClean ? "idle" : "error",
      event.wasClean ? "Đã ngắt kết nối" : `Socket đóng (${event.code})`,
    )
    elements.recorderState.textContent =
      "Kết nối AI trước khi bắt đầu nói."
    appendEvent("SYS", {
      type: "socket.close",
      code: event.code,
      reason: event.reason || "",
      clean: event.wasClean,
    })
  })
}

function disconnect() {
  stopRecording({ flush: false })
  state.ready = false
  const socket = state.socket
  if (!socket) return

  if (socket.readyState === WebSocket.OPEN) {
    const closeMessage = { type: "session.close" }
    socket.send(JSON.stringify(closeMessage))
    logOutbound(closeMessage.type, closeMessage)
  }
  window.setTimeout(() => {
    if (socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, "Speech lab disconnected")
    }
  }, 180)
}

function handleWorkerEvent(message) {
  switch (message.type) {
    case "session.ready":
      if (message.ready === true) {
        state.ready = true
        setConnection("ready", "AI sẵn sàng")
        elements.recorderState.textContent =
          "AI đã sẵn sàng. Nói tự nhiên, bấm dừng khi hết câu."
      } else {
        state.ready = false
        setConnection("error", "AI model không sẵn sàng")
        elements.recorderState.textContent =
          "Readiness thất bại. Xem Raw event và terminal AI."
      }
      break
    case "stt.partial":
      updateTurn(message.utteranceId, {
        source: message.text || "",
        sourceLanguage: message.sourceLang || selectedSpeaker(),
        sttFinal: false,
      })
      break
    case "stt.final":
      updateTurn(message.utteranceId, {
        source: message.text || "",
        sourceLanguage: message.sourceLang || selectedSpeaker(),
        sttFinal: true,
      })
      break
    case "translate.partial": {
      const turn = ensureTurn(message.utteranceId)
      if (turn.hasStreamStarted || turn.translationFinal) break
      turn.source ||= message.sourceText || ""
      turn.translation = message.text || ""
      turn.translationStatus = "partial"
      renderTurn(turn)
      break
    }
    case "translate.token": {
      const turn = ensureTurn(message.utteranceId)
      const startingStream =
        !turn.hasStreamStarted || message.reset === true
      turn.translation = startingStream
        ? message.token || ""
        : turn.translation + (message.token || "")
      turn.hasStreamStarted = true
      turn.translationStatus = "streaming"
      turn.tokenCount += 1
      renderTurn(turn)
      break
    }
    case "translate.done":
      updateTurn(message.utteranceId, {
        source: message.sourceText || "",
        translation: message.fullText || "",
        translationFinal: true,
        hasStreamStarted: true,
        translationStatus: "final",
      })
      break
    case "error":
      showToast(`${message.code || "AI_ERROR"}: ${message.message || "Lỗi AI"}`)
      break
    default:
      break
  }
}

async function startRecording() {
  if (!state.ready || state.socket?.readyState !== WebSocket.OPEN) {
    showToast("AI chưa sẵn sàng nhận audio.")
    return
  }

  const capture = new MicrophoneCapture({
    deviceId: elements.microphoneSelect.value,
    onChunk: (chunk) => {
      if (
        state.recording &&
        state.socket?.readyState === WebSocket.OPEN
      ) {
        state.socket.send(chunk)
      }
    },
    onLevel: updateLevel,
  })

  try {
    await capture.start()
    state.capture = capture
    state.recording = true
    elements.recordButton.setAttribute("aria-pressed", "true")
    elements.recordButtonLabel.textContent = "Dừng & chốt câu"
    elements.recorderState.textContent =
      "Đang gửi PCM16 16 kHz tới AI worker…"
    elements.directionSwitch.disabled = true
    await refreshMicrophones()
    appendEvent("SYS", {
      type: "microphone.start",
      deviceId: elements.microphoneSelect.value || "default",
      targetSampleRate: TARGET_SAMPLE_RATE,
      chunkMs: 200,
    })
  } catch (error) {
    capture.stop()
    showToast(
      error.name === "NotAllowedError"
        ? "Bạn chưa cấp quyền microphone cho trình duyệt."
        : error.message || "Không mở được microphone.",
    )
    elements.recorderState.textContent =
      "Không mở được microphone. Kiểm tra quyền trình duyệt."
  }
}

async function stopRecording({ flush = true } = {}) {
  if (!state.recording && !state.capture) return
  state.recording = false
  state.capture?.stop()
  state.capture = null
  updateLevel(0)
  elements.recordButton.setAttribute("aria-pressed", "false")
  elements.recordButtonLabel.textContent = state.ready
    ? "Bắt đầu nói"
    : "Chờ AI sẵn sàng"
  elements.directionSwitch.disabled = false

  if (
    flush &&
    state.ready &&
    state.socket?.readyState === WebSocket.OPEN
  ) {
    elements.recorderState.textContent =
      "Đã dừng mic, đang gửi khoảng lặng để AI chốt trọn câu…"
    const silence = new Int16Array(SILENCE_CHUNK_SAMPLES).buffer
    for (let index = 0; index < SILENCE_CHUNK_COUNT; index += 1) {
      if (state.socket?.readyState !== WebSocket.OPEN) break
      state.socket.send(silence.slice(0))
      await sleep(55)
    }
    appendEvent("SYS", {
      type: "microphone.stop",
      flushSilenceMs: 800,
    })
    elements.recorderState.textContent =
      "Đã chốt audio. Đợi STT final và bản dịch…"
  }
}

function ensureTurn(utteranceId) {
  const id = utteranceId || `unknown-${state.turns.size + 1}`
  if (!state.turns.has(id)) {
    state.turns.set(id, {
      id,
      number: state.turns.size + 1,
      source: "",
      translation: "",
      sourceLanguage: selectedSpeaker(),
      sttFinal: false,
      translationFinal: false,
      translationStatus: "idle",
      hasStreamStarted: false,
      tokenCount: 0,
      element: null,
    })
  }
  return state.turns.get(id)
}

function updateTurn(utteranceId, patch) {
  const turn = ensureTurn(utteranceId)
  Object.assign(turn, patch)
  renderTurn(turn)
}

function renderTurn(turn) {
  elements.emptyResults.hidden = true
  if (!turn.element) {
    const article = document.createElement("article")
    article.className = "turn"
    article.dataset.utteranceId = turn.id
    article.innerHTML = `
      <div class="turn-meta">
        <span class="turn-number"></span>
        <span class="turn-direction"></span>
        <span class="turn-state"></span>
      </div>
      <div class="turn-content">
        <div class="result-cell">
          <div class="result-label"><span>STT / SOURCE</span><span class="stt-state"></span></div>
          <p class="source-text"></p>
        </div>
        <div class="result-cell">
          <div class="result-label"><span>TRANSLATION STREAM</span><span class="token-count"></span></div>
          <p class="translation-text"></p>
        </div>
      </div>
    `
    elements.turnList.prepend(article)
    turn.element = article
  }

  const source = turn.sourceLanguage || selectedSpeaker()
  turn.element.dataset.final = String(turn.translationFinal)
  turn.element.dataset.translationStatus = turn.translationStatus
  turn.element.querySelector(".turn-number").textContent = String(
    turn.number,
  ).padStart(2, "0")
  turn.element.querySelector(".turn-direction").textContent =
    `${source.toUpperCase()} → ${targetLanguage(source).toUpperCase()}`
  turn.element.querySelector(".turn-state").textContent =
    turn.translationFinal ? "DONE" : "LIVE"
  turn.element.querySelector(".stt-state").textContent = turn.sttFinal
    ? "FINAL"
    : "PARTIAL"
  turn.element.querySelector(".token-count").textContent =
    turn.translationStatus === "partial"
      ? "PARTIAL"
      : `${turn.tokenCount} DELTA`
  turn.element.querySelector(".source-text").textContent = turn.source
  turn.element.querySelector(".translation-text").textContent =
    turn.translation
}

function clearResults() {
  state.turns.clear()
  elements.turnList.replaceChildren()
  elements.emptyResults.hidden = false
}

function appendEvent(direction, payload) {
  const line =
    `${new Date().toLocaleTimeString("vi-VN", { hour12: false })} ` +
    `${direction.padEnd(3)} ${JSON.stringify(payload)}`
  state.eventLines.push(line)
  if (state.eventLines.length > 500) {
    state.eventLines.splice(0, state.eventLines.length - 500)
  }
  elements.eventLog.textContent = state.eventLines.join("\n")
  elements.eventLog.scrollTop = elements.eventLog.scrollHeight
}

function logOutbound(type, payload) {
  appendEvent("OUT", { ...payload, type })
}

function updateLevel(value) {
  elements.levelFill.style.width = `${value}%`
  elements.levelValue.textContent = String(value)
}

async function refreshMicrophones() {
  if (!navigator.mediaDevices?.enumerateDevices) return
  const previous = elements.microphoneSelect.value
  const devices = await navigator.mediaDevices.enumerateDevices()
  const microphones = devices.filter((device) => device.kind === "audioinput")

  elements.microphoneSelect.replaceChildren()
  const defaultOption = new Option("Mặc định của hệ thống", "")
  elements.microphoneSelect.add(defaultOption)
  microphones.forEach((device, index) => {
    elements.microphoneSelect.add(
      new Option(
        device.label || `Microphone ${index + 1}`,
        device.deviceId,
      ),
    )
  })
  if (
    [...elements.microphoneSelect.options].some(
      (option) => option.value === previous,
    )
  ) {
    elements.microphoneSelect.value = previous
  }
}

function downsample(input, sourceRate, targetRate) {
  if (sourceRate === targetRate) return input
  const targetLength = Math.round((input.length * targetRate) / sourceRate)
  const output = new Float32Array(targetLength)
  const ratio = sourceRate / targetRate

  for (let targetIndex = 0; targetIndex < targetLength; targetIndex += 1) {
    const start = Math.floor(targetIndex * ratio)
    const end = Math.min(
      input.length,
      Math.max(start + 1, Math.floor((targetIndex + 1) * ratio)),
    )
    let sum = 0
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
      sum += input[sourceIndex]
    }
    output[targetIndex] = sum / (end - start)
  }
  return output
}

function toPcm16(input) {
  const output = new Int16Array(input.length)
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]))
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  return output
}

function sleep(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

let toastTimer
function showToast(message) {
  window.clearTimeout(toastTimer)
  elements.toast.textContent = message
  elements.toast.classList.add("is-visible")
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible")
  }, 3800)
}

elements.connectButton.addEventListener("click", connect)
elements.recordButton.addEventListener("click", () => {
  if (state.recording) {
    void stopRecording()
  } else {
    void startRecording()
  }
})
elements.directionSwitch.addEventListener("change", updateDirectionCopy)
elements.clearResultsButton.addEventListener("click", clearResults)
elements.clearEventsButton.addEventListener("click", () => {
  state.eventLines = []
  elements.eventLog.textContent = ""
})
elements.copyEventsButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.eventLines.join("\n"))
    showToast("Đã copy raw event log.")
  } catch {
    showToast("Không copy được. Hãy chọn log và copy thủ công.")
  }
})
navigator.mediaDevices?.addEventListener("devicechange", () => {
  void refreshMicrophones()
})
window.addEventListener("beforeunload", disconnect)

updateDirectionCopy()
setConnection("idle", "Chưa kết nối")
void refreshMicrophones()
