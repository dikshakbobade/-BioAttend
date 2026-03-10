import { useState, useRef, useEffect, useCallback } from 'react';
import api from '../services/api';

// ──────────────────────────────────────────────────────────────
// State machine
// ──────────────────────────────────────────────────────────────
const S = {
  IDLE: 'IDLE',
  DETECTING: 'DETECTING',
  SCANNING: 'SCANNING',
  PROCESSING: 'PROCESSING',
  RESULT: 'RESULT',
  COOLDOWN: 'COOLDOWN',
};

const DETECTING_MS = 5000;
const SCAN_INTERVAL = 300;
const SCAN_FRAMES = 8;
const RESULT_MS = 6000;
const COOLDOWN_MS = 4000;
const MOTION_INTERVAL = 400;
const MOTION_THRESH = 25;

// ──────────────────────────────────────────────────────────────
// Inline keyframe styles (injected once)
// ──────────────────────────────────────────────────────────────
const KIOSK_STYLES = `
@keyframes k-spin { to { transform: rotate(360deg); } }
@keyframes k-ping { 0% { transform: scale(1); opacity: 1; } 75%, 100% { transform: scale(2.2); opacity: 0; } }
@keyframes k-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
@keyframes k-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
@keyframes k-glow { 0%, 100% { box-shadow: 0 0 20px rgba(59,130,246,0.3); } 50% { box-shadow: 0 0 40px rgba(59,130,246,0.6); } }
@keyframes k-scan-line { 0% { top: 10%; } 100% { top: 90%; } }
@keyframes k-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
@keyframes k-fade-in { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
@keyframes k-slide-up { from { opacity: 0; transform: translateY(40px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes k-ring-pulse { 0% { transform: scale(1); opacity: 0.6; } 50% { transform: scale(1.15); opacity: 0.2; } 100% { transform: scale(1); opacity: 0.6; } }
@keyframes k-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
@keyframes k-eye-blink {
  0%, 40%, 100% { clip-path: ellipse(50% 50% at 50% 50%); }
  45%, 55% { clip-path: ellipse(50% 5% at 50% 50%); }
}
.k-animate-in { animation: k-fade-in 0.5s ease-out both; }
.k-slide-up { animation: k-slide-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) both; }
.k-shimmer {
  background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%);
  background-size: 200% 100%;
  animation: k-shimmer 2s infinite;
}
`;

export default function AttendanceKiosk() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const prevFrameRef = useRef(null);
  const streamRef = useRef(null);
  const stateTimerRef = useRef(null);
  const motionTimerRef = useRef(null);
  const scanIntervalRef = useRef(null);

  const [state, setState] = useState(S.IDLE);
  const [isStreaming, setIsStreaming] = useState(false);
  const [result, setResult] = useState(null);
  const [detectCountdown, setDetectCountdown] = useState(5);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [scanPct, setScanPct] = useState(0);
  const [todayLogs, setTodayLogs] = useState([]);
  const [showPanel, setShowPanel] = useState(false);

  // ── Inject Styles ────────────────────────────────────────────
  useEffect(() => {
    const id = 'kiosk-keyframes';
    if (!document.getElementById(id)) {
      const s = document.createElement('style');
      s.id = id;
      s.textContent = KIOSK_STYLES;
      document.head.appendChild(s);
    }
  }, []);

  // ── Clock ────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Boot ─────────────────────────────────────────────────────
  useEffect(() => {
    startCamera();
    fetchLogs();
    return () => { stopCamera(); clearTimers(); };
  }, []);

  // ── State Driver ─────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(stateTimerRef.current);
    switch (state) {
      case S.IDLE:
        setResult(null); setScanPct(0); setDetectCountdown(5);
        startMotion();
        break;
      case S.DETECTING:
        speak('Please hold still');
        setDetectCountdown(5);
        let cd = 5;
        const cdTimer = setInterval(() => {
          cd--;
          setDetectCountdown(cd);
          if (cd <= 0) clearInterval(cdTimer);
        }, 1000);
        stateTimerRef.current = setTimeout(() => {
          clearInterval(cdTimer);
          setState(S.SCANNING);
        }, DETECTING_MS);
        return () => clearInterval(cdTimer);
      case S.SCANNING:
        speak('Please blink naturally');
        startCapture();
        break;
      case S.PROCESSING:
        break;
      case S.RESULT:
        stopMotion();
        stateTimerRef.current = setTimeout(() => setState(S.COOLDOWN), RESULT_MS);
        break;
      case S.COOLDOWN:
        setResult(null);
        stateTimerRef.current = setTimeout(() => {
          prevFrameRef.current = null;
          setState(S.IDLE);
        }, COOLDOWN_MS);
        break;
    }
    return () => clearTimeout(stateTimerRef.current);
  }, [state]);

  // ── Helpers ──────────────────────────────────────────────────
  const clearTimers = () => {
    clearTimeout(stateTimerRef.current);
    clearInterval(motionTimerRef.current);
    clearInterval(scanIntervalRef.current);
  };

  const stopMotion = () => { clearInterval(motionTimerRef.current); motionTimerRef.current = null; };

  const speak = (text) => {
    try {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 0.9; u.pitch = 1.1; u.volume = 0.85;
        window.speechSynthesis.speak(u);
      }
    } catch (_) { }
  };

  const fetchLogs = async () => {
    try { setTodayLogs((await api.get('/verification/today')).data || []); } catch { }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; setIsStreaming(true); }
    } catch { /* no cam */ }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsStreaming(false);
  };

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return null;
    const v = videoRef.current, c = canvasRef.current;

    // Force 480p for ultra-fast processing
    const TARGET_W = 640;
    const TARGET_H = 480;

    c.width = TARGET_W;
    c.height = TARGET_H;

    const ctx = c.getContext('2d');
    // Draw and scale if necessary
    ctx.drawImage(v, 0, 0, TARGET_W, TARGET_H);

    // Reduced quality to 0.5 to shrink payload size significantly
    return c.toDataURL('image/jpeg', 0.5).split(',')[1];
  }, []);

  // ── Motion ───────────────────────────────────────────────────
  const startMotion = useCallback(() => {
    stopMotion();
    motionTimerRef.current = setInterval(() => {
      if (!videoRef.current || !canvasRef.current) return;
      const v = videoRef.current, c = canvasRef.current;
      if (!v.videoWidth) return;
      c.width = 160; c.height = 120;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(v, 0, 0, 160, 120);
      const cur = ctx.getImageData(0, 0, 160, 120);
      if (prevFrameRef.current) {
        let diff = 0;
        for (let i = 0; i < cur.data.length; i += 16)
          diff += Math.abs(cur.data[i] - prevFrameRef.current.data[i]);
        if (diff / (cur.data.length / 16) > MOTION_THRESH) {
          setState(S.DETECTING);
          stopMotion();
        }
      }
      prevFrameRef.current = cur;
    }, MOTION_INTERVAL);
  }, []);

  // ── Scanning ─────────────────────────────────────────────────
  const startCapture = useCallback(() => {
    const frames = []; let n = 0; setScanPct(0);
    scanIntervalRef.current = setInterval(() => {
      const f = captureFrame();
      if (f) frames.push(f);
      n++;
      setScanPct(Math.round((n / SCAN_FRAMES) * 100));
      if (n >= SCAN_FRAMES) {
        clearInterval(scanIntervalRef.current);
        processAttendance(frames);
      }
    }, SCAN_INTERVAL);
  }, [captureFrame]);

  // ── Backend Call ──────────────────────────────────────────────
  const processAttendance = async (frames) => {
    setState(S.PROCESSING);
    try {
      const main = frames[frames.length - 1];
      const liveness = frames.slice(0, -1);
      const { data } = await api.post('/verification/auto-attend', {
        image_base64: main, liveness_frames: liveness,
      });
      if (data.success) {
        setResult({
          type: 'success', action: data.action,
          name: data.employee_name, code: data.employee_code,
          confidence: data.confidence_score, message: data.message,
          timestamp: data.timestamp,
        });
        speak(data.action === 'CHECK_IN'
          ? `Welcome ${data.employee_name}. Checked in.`
          : `Goodbye ${data.employee_name}. Checked out.`);
        fetchLogs();
      } else {
        setResult({ type: 'error', message: data.message });
        speak(data.message || 'Verification failed.');
      }
    } catch (err) {
      const d = err.response?.data;
      let msg = 'Server error. Please try again.';
      if (d) { msg = typeof d.detail === 'string' ? d.detail : d.message || msg; }
      setResult({ type: 'error', message: msg });
      speak('Error. Please try again.');
    }
    setState(S.RESULT);
  };


  // ── Derived ──────────────────────────────────────────────────
  const fmt = (d) => d ? new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
  const inCount = todayLogs.filter(l => l.checked_in).length;
  const outCount = todayLogs.filter(l => l.checked_out).length;

  // Progress ring
  const R = 70, C = 2 * Math.PI * R;
  const strokeOff = C * (1 - scanPct / 100);

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{
      height: '100vh', width: '100vw', background: '#030712', color: '#fff',
      fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
      overflow: 'hidden', position: 'relative', userSelect: 'none',
    }}>
      {/* ═══ Camera Feed ═══ */}
      <video ref={videoRef} autoPlay playsInline muted style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        objectFit: 'cover', transform: 'scaleX(-1)',
      }} />
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Cinematic vignette + gradient */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `
          radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.7) 100%),
          linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, transparent 20%, transparent 60%, rgba(0,0,0,0.8) 100%)
        `,
      }} />

      {/* State-specific color wash */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', transition: 'background 0.8s ease',
        background: state === S.DETECTING ? 'radial-gradient(circle at center, rgba(250,204,21,0.12) 0%, transparent 70%)'
          : state === S.SCANNING ? 'radial-gradient(circle at center, rgba(6,182,212,0.12) 0%, transparent 70%)'
            : state === S.PROCESSING ? 'radial-gradient(circle at center, rgba(139,92,246,0.12) 0%, transparent 70%)'
              : state === S.RESULT && result?.type === 'success' ? 'radial-gradient(circle at center, rgba(16,185,129,0.12) 0%, transparent 70%)'
                : 'none',
      }} />

      {/* ═══ Top Bar — Floating Glass ═══ */}
      <div style={{
        position: 'absolute', top: 16, left: 16, right: 16, zIndex: 30,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px', borderRadius: 20,
        background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(24px) saturate(1.4)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 14,
            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 16px rgba(99,102,241,0.4)',
          }}>
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="#fff" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.03em', color: '#fff' }}>
              BioAttend
            </div>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase',
              background: 'linear-gradient(90deg, #818cf8, #6366f1)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              Automatic Kiosk
            </div>
          </div>
        </div>

        {/* Stats + Time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Counters */}
          {[
            { label: 'IN', count: inCount, color: '#34d399', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.2)' },
            { label: 'OUT', count: outCount, color: '#fb923c', bg: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.2)' },
          ].map(({ label, count, color, bg, border }) => (
            <div key={label} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px',
              borderRadius: 12, background: bg, border: `1px solid ${border}`,
            }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
              <span style={{ fontSize: 15, fontWeight: 800, color }}>{count}</span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>{label}</span>
            </div>
          ))}

          {/* Activity toggle */}
          <button onClick={() => setShowPanel(!showPanel)} style={{
            width: 38, height: 38, borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)',
            background: showPanel ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            transition: 'all 0.2s',
          }}>
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke={showPanel ? '#818cf8' : '#9ca3af'} strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Divider */}
          <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.08)' }} />

          {/* Clock */}
          <div style={{ textAlign: 'right' }}>
            <div style={{
              fontSize: 22, fontWeight: 800, fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              letterSpacing: '0.05em', fontVariantNumeric: 'tabular-nums',
              background: 'linear-gradient(to bottom, #fff, rgba(255,255,255,0.7))',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: 500 }}>
              {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ CENTER CONTENT ═══ */}
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', zIndex: 10, pointerEvents: 'none',
      }}>

        {/* ── IDLE ── */}
        {state === S.IDLE && isStreaming && (
          <div className="k-animate-in" style={{ textAlign: 'center' }}>
            {/* Concentric rings */}
            <div style={{ position: 'relative', width: 200, height: 200, margin: '0 auto' }}>
              {[200, 170, 140].map((size, i) => (
                <div key={i} style={{
                  position: 'absolute',
                  left: '50%', top: '50%',
                  width: size, height: size,
                  transform: 'translate(-50%, -50%)',
                  borderRadius: '50%',
                  border: `${i === 2 ? 2 : 1}px solid rgba(99,102,241,${0.15 + i * 0.15})`,
                  animation: `k-ring-pulse ${2 + i * 0.5}s ease-in-out infinite`,
                }} />
              ))}
              {/* Scan icon */}
              <div style={{
                position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
                width: 80, height: 80, borderRadius: '50%',
                background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.2))',
                backdropFilter: 'blur(8px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid rgba(99,102,241,0.3)',
                animation: 'k-float 3s ease-in-out infinite',
              }}>
                <svg width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="rgba(165,180,252,0.9)" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
            </div>

            <h1 style={{
              marginTop: 32, fontSize: 36, fontWeight: 900, letterSpacing: '-0.04em',
              background: 'linear-gradient(135deg, #c7d2fe 0%, #818cf8 40%, #6366f1 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              textShadow: 'none', lineHeight: 1.1,
            }}>
              Step Forward
            </h1>
            <p style={{
              marginTop: 10, fontSize: 14, color: 'rgba(255,255,255,0.45)',
              fontWeight: 500, letterSpacing: '0.02em',
            }}>
              The system will recognize you automatically
            </p>
          </div>
        )}

        {/* ── DETECTING ── */}
        {state === S.DETECTING && (
          <div className="k-slide-up" style={{ textAlign: 'center' }}>
            <div style={{ position: 'relative', width: 200, height: 200, margin: '0 auto' }}>
              {/* Spinning outer ring */}
              <svg width="200" height="200" viewBox="0 0 200 200" style={{
                position: 'absolute', animation: 'k-spin 4s linear infinite',
              }}>
                <circle cx="100" cy="100" r="95" fill="none" stroke="rgba(250,204,21,0.15)" strokeWidth="2" />
                <circle cx="100" cy="100" r="95" fill="none" stroke="rgba(250,204,21,0.7)"
                  strokeWidth="3" strokeLinecap="round"
                  strokeDasharray="80 517" />
              </svg>
              {/* Counter in center */}
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{
                  fontSize: 56, fontWeight: 900, fontFamily: "'JetBrains Mono', monospace",
                  background: 'linear-gradient(to bottom, #fef08a, #facc15)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                }}>
                  {detectCountdown}
                </span>
                <span style={{ fontSize: 10, color: 'rgba(250,204,21,0.6)', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                  seconds
                </span>
              </div>
            </div>

            <h1 style={{
              marginTop: 28, fontSize: 32, fontWeight: 900, letterSpacing: '-0.03em',
              color: '#fef08a',
            }}>
              Face Detected
            </h1>
            <p style={{
              marginTop: 8, fontSize: 14, color: 'rgba(253,224,71,0.5)', fontWeight: 500,
            }}>
              Hold still — preparing scan...
            </p>
          </div>
        )}

        {/* ── SCANNING ── */}
        {state === S.SCANNING && (
          <div className="k-slide-up" style={{ textAlign: 'center' }}>
            <div style={{ position: 'relative', width: 200, height: 200, margin: '0 auto' }}>
              {/* Progress ring */}
              <svg width="200" height="200" viewBox="0 0 200 200" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="100" cy="100" r={R} fill="none" stroke="rgba(6,182,212,0.1)" strokeWidth="4" />
                <circle cx="100" cy="100" r={R} fill="none" stroke="url(#scanGrad)"
                  strokeWidth="5" strokeLinecap="round"
                  strokeDasharray={C} strokeDashoffset={strokeOff}
                  style={{ transition: 'stroke-dashoffset 0.25s ease' }}
                />
                <defs>
                  <linearGradient id="scanGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#06b6d4" />
                    <stop offset="100%" stopColor="#22d3ee" />
                  </linearGradient>
                </defs>
              </svg>
              {/* Percent */}
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{
                  fontSize: 48, fontWeight: 900, fontFamily: "'JetBrains Mono', monospace",
                  background: 'linear-gradient(to bottom, #67e8f9, #06b6d4)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                }}>
                  {scanPct}%
                </span>
              </div>
            </div>

            <h1 style={{
              marginTop: 28, fontSize: 32, fontWeight: 900, letterSpacing: '-0.03em',
              color: '#67e8f9',
            }}>
              Blink Naturally
            </h1>
            <p style={{ marginTop: 8, fontSize: 14, color: 'rgba(103,232,249,0.5)', fontWeight: 500 }}>
              Scanning facial micro-movements...
            </p>

            {/* Badge */}
            <div style={{
              marginTop: 24, display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '8px 18px', borderRadius: 100,
              background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.2)',
              backdropFilter: 'blur(12px)',
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%', background: '#22d3ee',
                animation: 'k-pulse 1.5s infinite',
              }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#67e8f9', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Blink Detection Active
              </span>
            </div>
          </div>
        )}

        {/* ── PROCESSING ── */}
        {state === S.PROCESSING && (
          <div className="k-slide-up" style={{ textAlign: 'center' }}>
            <div style={{ position: 'relative', width: 100, height: 100, margin: '0 auto' }}>
              <div style={{
                width: '100%', height: '100%', borderRadius: '50%',
                border: '3px solid rgba(139,92,246,0.15)',
                borderTopColor: '#a78bfa',
                animation: 'k-spin 0.8s linear infinite',
              }} />
              <div style={{
                position: 'absolute', inset: 12, borderRadius: '50%',
                border: '3px solid rgba(139,92,246,0.1)',
                borderBottomColor: '#c4b5fd',
                animation: 'k-spin 1.2s linear infinite reverse',
              }} />
            </div>
            <h1 style={{ marginTop: 32, fontSize: 28, fontWeight: 900, color: '#c4b5fd', letterSpacing: '-0.03em' }}>
              Verifying Identity
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, color: 'rgba(196,181,253,0.4)', fontWeight: 500 }}>
              Matching against database...
            </p>
          </div>
        )}

        {/* ── RESULT ── */}
        {state === S.RESULT && result && (
          <div className="k-slide-up" style={{ pointerEvents: 'auto' }}>
            {result.type === 'success' ? (
              <div style={{
                maxWidth: 480, margin: '0 auto', padding: '40px 44px', borderRadius: 28, textAlign: 'center',
                background: result.action === 'CHECK_IN'
                  ? 'linear-gradient(160deg, rgba(5,46,22,0.85) 0%, rgba(2,26,13,0.9) 100%)'
                  : 'linear-gradient(160deg, rgba(67,20,7,0.85) 0%, rgba(36,10,4,0.9) 100%)',
                backdropFilter: 'blur(32px) saturate(1.5)',
                border: `1px solid ${result.action === 'CHECK_IN' ? 'rgba(16,185,129,0.25)' : 'rgba(251,146,60,0.25)'}`,
                boxShadow: result.action === 'CHECK_IN'
                  ? '0 0 80px rgba(16,185,129,0.15), 0 20px 60px rgba(0,0,0,0.5)'
                  : '0 0 80px rgba(251,146,60,0.15), 0 20px 60px rgba(0,0,0,0.5)',
              }}>
                {/* Icon */}
                <div style={{
                  width: 80, height: 80, borderRadius: '50%', margin: '0 auto 24px',
                  background: result.action === 'CHECK_IN'
                    ? 'linear-gradient(135deg, #059669, #10b981)' : 'linear-gradient(135deg, #ea580c, #f97316)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: result.action === 'CHECK_IN'
                    ? '0 8px 32px rgba(16,185,129,0.4)' : '0 8px 32px rgba(249,115,22,0.4)',
                  animation: 'k-breathe 2s ease-in-out infinite',
                }}>
                  {result.action === 'CHECK_IN' ? (
                    <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="#fff" strokeWidth="3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="#fff" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7" />
                    </svg>
                  )}
                </div>

                {/* Label */}
                <div style={{
                  display: 'inline-block', padding: '6px 20px', borderRadius: 100, marginBottom: 16,
                  background: result.action === 'CHECK_IN' ? 'rgba(16,185,129,0.15)' : 'rgba(251,146,60,0.15)',
                  border: `1px solid ${result.action === 'CHECK_IN' ? 'rgba(16,185,129,0.3)' : 'rgba(251,146,60,0.3)'}`,
                }}>
                  <span style={{
                    fontSize: 12, fontWeight: 800, letterSpacing: '0.2em', textTransform: 'uppercase',
                    color: result.action === 'CHECK_IN' ? '#6ee7b7' : '#fdba74',
                  }}>
                    ✦ {result.action === 'CHECK_IN' ? 'Checked In' : 'Checked Out'}
                  </span>
                </div>

                {/* Name */}
                <h1 style={{
                  fontSize: 40, fontWeight: 900, letterSpacing: '-0.04em', color: '#fff', lineHeight: 1.1,
                  marginBottom: 4,
                }}>
                  {result.name}
                </h1>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', fontFamily: "'JetBrains Mono', monospace", fontWeight: 500 }}>
                  {result.code}
                </p>

                {/* Stats */}
                <div style={{
                  display: 'flex', justifyContent: 'center', gap: 12, marginTop: 24,
                }}>
                  {result.confidence != null && (
                    <div style={{
                      padding: '8px 16px', borderRadius: 14,
                      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
                      fontSize: 13, fontWeight: 700,
                    }}>
                      🎯 {(result.confidence * 100).toFixed(0)}% match
                    </div>
                  )}
                  <div style={{
                    padding: '8px 16px', borderRadius: 14,
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
                    fontSize: 13, fontWeight: 700,
                  }}>
                    🕐 {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
                  </div>
                </div>
              </div>
            ) : (
              /* Error */
              <div style={{
                maxWidth: 440, margin: '0 auto', padding: '40px 44px', borderRadius: 28, textAlign: 'center',
                background: 'linear-gradient(160deg, rgba(69,10,10,0.85) 0%, rgba(30,4,4,0.9) 100%)',
                backdropFilter: 'blur(32px)', border: '1px solid rgba(248,113,113,0.2)',
                boxShadow: '0 0 60px rgba(239,68,68,0.1), 0 20px 60px rgba(0,0,0,0.5)',
              }}>
                <div style={{
                  width: 72, height: 72, borderRadius: '50%', margin: '0 auto 20px',
                  background: 'linear-gradient(135deg, #dc2626, #ef4444)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 8px 32px rgba(239,68,68,0.3)',
                }}>
                  <svg width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="#fff" strokeWidth="3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <h2 style={{ fontSize: 24, fontWeight: 900, color: '#fca5a5', marginBottom: 10 }}>
                  Verification Failed
                </h2>
                <p style={{ fontSize: 14, color: 'rgba(252,165,165,0.6)', lineHeight: 1.5 }}>
                  {result.message}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── COOLDOWN ── */}
        {state === S.COOLDOWN && (
          <div className="k-animate-in" style={{ textAlign: 'center' }}>
            <div style={{
              width: 40, height: 40, margin: '0 auto 16px', borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.15)', borderTopColor: 'rgba(255,255,255,0.5)',
              animation: 'k-spin 1s linear infinite',
            }} />
            <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}>
              Resetting...
            </p>
          </div>
        )}
      </div>


      {/* ═══ Bottom Status ═══ */}
      <div style={{
        position: 'absolute', bottom: 16, left: 16, right: 16, zIndex: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        {/* State pill */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px',
          borderRadius: 16, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: state === S.IDLE ? '#818cf8' : state === S.DETECTING ? '#facc15'
              : state === S.SCANNING ? '#22d3ee' : state === S.PROCESSING ? '#a78bfa'
                : state === S.RESULT ? (result?.type === 'success' ? '#34d399' : '#f87171') : '#6b7280',
            animation: state === S.IDLE ? 'k-pulse 2s infinite' : state === S.DETECTING ? 'k-ping 1s infinite' : 'none',
            boxShadow: `0 0 8px ${state === S.IDLE ? 'rgba(129,140,248,0.5)' : state === S.DETECTING ? 'rgba(250,204,21,0.5)' : 'transparent'}`,
          }} />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>
            {state === S.IDLE ? 'Awaiting person' : state === S.DETECTING ? 'Stabilizing...'
              : state === S.SCANNING ? 'Scanning blinks' : state === S.PROCESSING ? 'Verifying...'
                : state === S.RESULT ? (result?.type === 'success' ? 'Success' : 'Failed') : 'Resetting'}
          </span>
        </div>

        {/* Security badge */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px',
          borderRadius: 16, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(16,185,129,0.1)',
        }}>
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#34d399" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(52,211,153,0.7)', letterSpacing: '0.02em' }}>
            ArcFace · Liveness · Anti-Spoof
          </span>
        </div>
      </div>

      {/* ═══ Activity Panel ═══ */}
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, width: 340, zIndex: 40,
        background: 'rgba(3,7,18,0.92)', backdropFilter: 'blur(32px) saturate(1.4)',
        borderLeft: '1px solid rgba(255,255,255,0.06)',
        transform: showPanel ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
        display: 'flex', flexDirection: 'column',
        boxShadow: showPanel ? '-20px 0 60px rgba(0,0,0,0.5)' : 'none',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-0.02em' }}>Today's Activity</span>
          <button onClick={() => setShowPanel(false)} style={{
            width: 32, height: 32, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.04)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#6b7280" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {todayLogs.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>
              No attendance yet
            </div>
          ) : todayLogs.map((log, i) => (
            <div key={i} style={{
              padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              transition: 'background 0.15s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,0.4)',
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15))',
                  border: '1px solid rgba(99,102,241,0.15)',
                }}>
                  {log.employee_name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{log.employee_name}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>{log.employee_code}</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {log.checked_in && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#34d399' }} />
                    <span style={{ color: '#6ee7b7', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: 11 }}>
                      {fmt(log.check_in_time)}
                    </span>
                  </div>
                )}
                {log.checked_out && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, marginTop: 2 }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#fb923c' }} />
                    <span style={{ color: '#fdba74', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: 11 }}>
                      {fmt(log.check_out_time)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ No Camera ═══ */}
      {!isStreaming && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 50, background: '#030712',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="64" height="64" fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p style={{ marginTop: 16, color: 'rgba(255,255,255,0.3)', fontSize: 16, fontWeight: 500 }}>Camera unavailable</p>
          <button onClick={startCamera} style={{
            marginTop: 20, padding: '12px 28px', borderRadius: 14, border: 'none',
            background: 'linear-gradient(135deg, #4f46e5, #6366f1)', color: '#fff',
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(99,102,241,0.4)',
          }}>
            Retry Camera
          </button>
        </div>
      )}
    </div>
  );
}
