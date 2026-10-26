(() => {
  const sampleRate = 16000;
  const frameLength = 400;
  const frameStep = 160;
  const fftLength = 512;
  const filterCount = 26;
  const coefficientCount = 12;

  function fft(real, imaginary) {
    const size = real.length;
    for (let i = 1, j = 0; i < size; i += 1) {
      let bit = size >> 1;
      while (j & bit) {
        j ^= bit;
        bit >>= 1;
      }
      j ^= bit;
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
      }
    }
    for (let length = 2; length <= size; length <<= 1) {
      const angle = (-2 * Math.PI) / length;
      const stepReal = Math.cos(angle);
      const stepImaginary = Math.sin(angle);
      for (let start = 0; start < size; start += length) {
        let weightReal = 1;
        let weightImaginary = 0;
        const half = length >> 1;
        for (let offset = 0; offset < half; offset += 1) {
          const even = start + offset;
          const odd = even + half;
          const oddReal = real[odd] * weightReal - imaginary[odd] * weightImaginary;
          const oddImaginary = real[odd] * weightImaginary + imaginary[odd] * weightReal;
          real[odd] = real[even] - oddReal;
          imaginary[odd] = imaginary[even] - oddImaginary;
          real[even] += oddReal;
          imaginary[even] += oddImaginary;
          const nextReal = weightReal * stepReal - weightImaginary * stepImaginary;
          weightImaginary = weightReal * stepImaginary + weightImaginary * stepReal;
          weightReal = nextReal;
        }
      }
    }
  }

  function resample(input, inputRate) {
    if (inputRate === sampleRate) return input;
    const ratio = inputRate / sampleRate;
    const output = new Float32Array(Math.floor(input.length / ratio));
    for (let index = 0; index < output.length; index += 1) {
      const sourceIndex = index * ratio;
      const left = Math.floor(sourceIndex);
      const fraction = sourceIndex - left;
      output[index] = input[left] * (1 - fraction) + (input[left + 1] ?? input[left]) * fraction;
    }
    return output;
  }

  function makeMelFilters() {
    const hzToMel = (hz) => 2595 * Math.log10(1 + hz / 700);
    const melToHz = (mel) => 700 * (10 ** (mel / 2595) - 1);
    const lowMel = hzToMel(80);
    const highMel = hzToMel(7600);
    const points = Array.from({ length: filterCount + 2 }, (_, index) => {
      const mel = lowMel + ((highMel - lowMel) * index) / (filterCount + 1);
      return Math.floor(((fftLength + 1) * melToHz(mel)) / sampleRate);
    });
    return Array.from({ length: filterCount }, (_, index) => {
      const left = points[index];
      const center = points[index + 1];
      const right = points[index + 2];
      return Array.from({ length: fftLength / 2 + 1 }, (_, bin) => {
        if (bin < left || bin > right) return 0;
        if (bin <= center) return (bin - left) / Math.max(1, center - left);
        return (right - bin) / Math.max(1, right - center);
      });
    });
  }

  function makeVector(audio) {
    const filters = makeMelFilters();
    const frames = [];
    for (let start = 0; start + frameLength <= audio.length; start += frameStep) {
      let power = 0;
      for (let index = 0; index < frameLength; index += 1) power += audio[start + index] ** 2;
      if (Math.sqrt(power / frameLength) < 0.006) continue;

      const real = new Float64Array(fftLength);
      const imaginary = new Float64Array(fftLength);
      for (let index = 0; index < frameLength; index += 1) {
        const current = audio[start + index];
        const previous = audio[Math.max(0, start + index - 1)];
        const emphasized = current - 0.97 * previous;
        const hamming = 0.54 - 0.46 * Math.cos((2 * Math.PI * index) / (frameLength - 1));
        real[index] = emphasized * hamming;
      }
      fft(real, imaginary);
      const spectrum = Array.from({ length: fftLength / 2 + 1 }, (_, bin) => real[bin] ** 2 + imaginary[bin] ** 2);
      const energies = filters.map((filter) => {
        const energy = filter.reduce((total, weight, bin) => total + weight * spectrum[bin], 0);
        return Math.log(Math.max(energy, 1e-10));
      });
      frames.push(Array.from({ length: coefficientCount }, (_, coefficient) => {
        return energies.reduce((total, energy, filterIndex) => {
          return total + energy * Math.cos((Math.PI * coefficient * (filterIndex + 0.5)) / filterCount);
        }, 0);
      }));
    }
    if (frames.length < 20) throw new Error("没有录到足够清晰的语音，请靠近麦克风再试一次。");

    const vector = [];
    for (let coefficient = 1; coefficient < coefficientCount; coefficient += 1) {
      const mean = frames.reduce((sum, frame) => sum + frame[coefficient], 0) / frames.length;
      const variance = frames.reduce((sum, frame) => sum + (frame[coefficient] - mean) ** 2, 0) / frames.length;
      vector.push(mean, Math.sqrt(variance));
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0));
    if (!Number.isFinite(norm) || norm < 1e-8) throw new Error("声音样本无效，请重新录制。");
    return vector.map((value) => value / norm);
  }

  async function captureFeatures(durationMs = 3000) {
    if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      throw new Error("声纹录入需要 HTTPS 安全连接。");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前浏览器无法访问麦克风；请使用支持麦克风的 HTTPS 浏览器。");
    }
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) throw new Error("当前浏览器不支持本地音频分析。");

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    let audioContext;
    try {
      audioContext = new AudioContextConstructor();
      await audioContext.resume();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      const silentOutput = audioContext.createGain();
      silentOutput.gain.value = 0;
      const chunks = [];
      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(silentOutput);
      silentOutput.connect(audioContext.destination);
      await new Promise((resolve) => window.setTimeout(resolve, durationMs));
      processor.disconnect();
      source.disconnect();
      const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const samples = new Float32Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
      }
      return makeVector(resample(samples, audioContext.sampleRate));
    } finally {
      stream.getTracks().forEach((track) => track.stop());
      if (audioContext && audioContext.state !== "closed") await audioContext.close();
    }
  }

  function similarity(first, second) {
    if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length || !first.length) return -1;
    return first.reduce((sum, value, index) => sum + value * second[index], 0);
  }

  window.SpeakerID = Object.freeze({ captureFeatures, similarity });
})();
