/**
 * AudioStreamer handles recording audio from the user's microphone,
 * downsampling it to 16kHz mono, and converting it to 16-bit Signed PCM
 * before streaming it over websockets.
 */
export class AudioStreamer {
  private audioContext: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private scriptNode: ScriptProcessorNode | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null

  private options: {
    sampleRate?: number // Target sample rate (default 16000)
    chunkSize?: number // Processing buffer size (default 4096)
    onAudioChunk: (chunk: ArrayBuffer) => void
    onVolume?: (volume: number) => void
  }

  constructor(options: {
    sampleRate?: number
    chunkSize?: number
    onAudioChunk: (chunk: ArrayBuffer) => void
    onVolume?: (volume: number) => void
  }) {
    this.options = options
  }

  async start() {
    const targetSampleRate = this.options.sampleRate || 16000
    const bufferSize = this.options.chunkSize || 4096

    // Request microphone access
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: targetSampleRate,
        echoCancellation: true,
        noiseSuppression: true,
      },
    })

    const AudioContextClass =
      window.AudioContext ||
      ((window as any).webkitAudioContext as typeof AudioContext)
    this.audioContext = new AudioContextClass()
    const sourceSampleRate = this.audioContext.sampleRate

    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream)
    this.scriptNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1)

    this.scriptNode.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0) // Float32Array representing raw channel data

      // Downsample the buffer from source sample rate to target sample rate
      const downsampledBuffer = this.downsampleBuffer(
        inputData,
        sourceSampleRate,
        targetSampleRate,
      )

      // Convert standard browser float32 audio representation to raw 16-bit Signed PCM
      const pcm16Buffer = this.float32ToInt16(downsampledBuffer)

      // Trigger the callback with raw ArrayBuffer
      this.options.onAudioChunk(pcm16Buffer.buffer as ArrayBuffer)

      // Calculate audio power/volume (Root Mean Square) for visualization
      if (this.options.onVolume) {
        let sum = 0
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i]
        }
        const rms = Math.sqrt(sum / inputData.length)
        // Normalize volume to 0 - 100 range
        const volume = Math.min(Math.round(rms * 100 * 3.5), 100)
        this.options.onVolume(volume)
      }
    }

    this.sourceNode.connect(this.scriptNode)
    this.scriptNode.connect(this.audioContext.destination)
  }

  stop() {
    if (this.scriptNode) {
      this.scriptNode.disconnect()
      this.scriptNode.onaudioprocess = null
      this.scriptNode = null
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop())
      this.mediaStream = null
    }

    if (this.audioContext) {
      if (this.audioContext.state !== 'closed') {
        this.audioContext.close()
      }
      this.audioContext = null
    }
  }

  private downsampleBuffer(
    buffer: Float32Array,
    srcRate: number,
    destRate: number,
  ): Float32Array {
    if (srcRate === destRate) {
      return buffer
    }
    const sampleRateRatio = srcRate / destRate
    const newLength = Math.round(buffer.length / sampleRateRatio)
    const result = new Float32Array(newLength)
    let offsetResult = 0
    let offsetBuffer = 0

    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio)
      let accum = 0
      let count = 0
      for (
        let i = offsetBuffer;
        i < nextOffsetBuffer && i < buffer.length;
        i++
      ) {
        accum += buffer[i]
        count++
      }
      result[offsetResult] = count > 0 ? accum / count : 0
      offsetResult++
      offsetBuffer = nextOffsetBuffer
    }
    return result
  }

  private float32ToInt16(buffer: Float32Array): Int16Array {
    const l = buffer.length
    const buf = new Int16Array(l)
    for (let i = 0; i < l; i++) {
      const s = Math.max(-1, Math.min(1, buffer[i]))
      buf[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    return buf
  }
}
