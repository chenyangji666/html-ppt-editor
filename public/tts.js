/**
 * tts.js — TTS 语音朗读模块
 * 基于 Web Speech API，读取 aside.notes 文本
 */
const TTS = (() => {
  let speaking = false;
  let paused = false;
  let currentUtterance = null;
  let autoPlay = false;
  let onSlideEnd = null;
  let progressTimer = null;
  let startTime = 0;
  let estimatedDuration = 0;

  function getVoice() {
    const voices = speechSynthesis.getVoices();
    return voices.find(v => v.lang.startsWith('zh')) ||
           voices.find(v => v.lang.startsWith('en')) ||
           voices[0];
  }

  function estimateDuration(text) {
    // 中文约 150 字/秒，英文约 200 字符/秒，取混合值
    const len = text.length;
    const charsPerSec = 180;
    return Math.max(1, len / charsPerSec) * 1000;
  }

  function startProgressTracking(text) {
    startTime = Date.now();
    estimatedDuration = estimateDuration(text);
    updateProgress(0);
    progressTimer = setInterval(() => {
      if (!speaking || paused) return;
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, (elapsed / estimatedDuration) * 100);
      updateProgress(pct);
    }, 200);
  }

  function stopProgressTracking() {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    updateProgress(0);
  }

  function updateProgress(pct) {
    const fill = document.getElementById('tts-fill');
    if (fill) fill.style.width = pct + '%';
  }

  function speak(text, onEnd) {
    stop();
    if (!text || !text.trim()) { if (onEnd) onEnd(); return; }

    const utterance = new SpeechSynthesisUtterance(text.trim());
    utterance.voice = getVoice();
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onstart = () => {
      speaking = true; paused = false;
      updateUI('speaking');
      startProgressTracking(text);
    };
    utterance.onend = () => {
      speaking = false; paused = false;
      stopProgressTracking();
      updateProgress(100);
      setTimeout(() => updateProgress(0), 500);
      updateUI('idle');
      if (onEnd) onEnd();
    };
    utterance.onerror = () => {
      speaking = false;
      stopProgressTracking();
      updateUI('idle');
    };

    currentUtterance = utterance;
    speechSynthesis.speak(utterance);
  }

  function stop() {
    speechSynthesis.cancel();
    speaking = false;
    paused = false;
    currentUtterance = null;
    stopProgressTracking();
    updateUI('idle');
  }

  function togglePause() {
    if (!speaking) return;
    if (paused) {
      speechSynthesis.resume(); paused = false; updateUI('speaking');
    } else {
      speechSynthesis.pause(); paused = true; updateUI('paused');
    }
  }

  function speakSlideNotes(notesText, onFinish) {
    speak(notesText, onFinish);
  }

  function setAutoPlay(enabled, slideEndCallback) {
    autoPlay = enabled;
    onSlideEnd = slideEndCallback;
  }

  function updateUI(state) {
    const btn = document.getElementById('tts-play-btn');
    const status = document.getElementById('tts-status');
    if (!btn || !status) return;
    switch (state) {
      case 'speaking': btn.textContent = '⏸'; status.textContent = '朗读中...'; break;
      case 'paused': btn.textContent = '▶'; status.textContent = '已暂停'; break;
      default: btn.textContent = '▶'; status.textContent = '就绪'; break;
    }
  }

  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = () => {};
  }

  return { speak, stop, togglePause, speakSlideNotes, setAutoPlay, get speaking() { return speaking; } };
})();
