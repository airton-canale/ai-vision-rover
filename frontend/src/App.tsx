import { useCallback, useEffect, useRef, useState } from 'react'
import ObjectDetector from './ObjectDetector'
import GamepadVisualizer from './GamepadVisualizer'

type LogEntry = { time: string; msg: string; type: 'info' | 'ok' | 'err' }

const MAX_LOGS = 30
const DEADZONE = 0.15
const SEND_MIN_INTERVAL_MS = 66 // ~15 Hz
const HEARTBEAT_MS = 300 // resend even if unchanged so 500ms watchdog doesn't fire
const CHANGE_EPSILON = 0.05

function applyDeadzone(v: number): number {
  if (Math.abs(v) < DEADZONE) return 0
  const sign = v < 0 ? -1 : 1
  return (v - sign * DEADZONE) / (1 - DEADZONE)
}

function clamp(v: number, lo = -1, hi = 1) {
  return Math.max(lo, Math.min(hi, v))
}

export default function App() {
  const [connected, setConnected] = useState(false)
  const [frameSrc, setFrameSrc] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [frameTotal, setFrameTotal] = useState(0)
  const [logs, setLogs] = useState<LogEntry[]>([])

  const [gamepadName, setGamepadName] = useState<string | null>(null)
  const [controlConnected, setControlConnected] = useState(false)
  const [currentCmd, setCurrentCmd] = useState({ left: 0, right: 0 })

  const [mode, setMode] = useState<'manual' | 'auto'>('manual')
  const [apState, setApState] = useState<string>('IDLE')
  const [distanceCm, setDistanceCm] = useState<number | null>(null)
  const [distanceStale, setDistanceStale] = useState(true)
  const [statusConnected, setStatusConnected] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(false)

  const imgRef = useRef<HTMLImageElement | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const frameWindowRef = useRef(0)
  const lastFpsTimeRef = useRef(performance.now())
  const logsRef = useRef<HTMLDivElement | null>(null)

  const controlWsRef = useRef<WebSocket | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastSentRef = useRef({ left: 0, right: 0, stop: false })
  const lastSendTimeRef = useRef(0)
  const stopBtnPrevRef = useRef(false)
  const gamepadNameRef = useRef<string | null>(null)

  const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
    setLogs((prev) =>
      [...prev, { time: new Date().toTimeString().slice(0, 8), msg, type }].slice(-MAX_LOGS),
    )
  }, [])

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight
  }, [logs])

  const disconnect = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
    setFps(0)
    setFrameTotal(0)
    setFrameSrc(null)
    addLog('Disconnected by user')
  }, [addLog])

  const connect = useCallback(() => {
    const url = `ws://${window.location.hostname || 'localhost'}:8000/ws/camera`
    addLog(`Connecting to ${url}...`)
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      addLog('Camera connected', 'ok')
    }

    ws.onmessage = (event) => {
      setFrameSrc(event.data)
      frameWindowRef.current += 1
      setFrameTotal((n) => n + 1)

      const now = performance.now()
      if (now - lastFpsTimeRef.current >= 1000) {
        setFps(frameWindowRef.current)
        frameWindowRef.current = 0
        lastFpsTimeRef.current = now
      }
    }

    ws.onerror = () => addLog('Camera error — is the server running?', 'err')
    ws.onclose = () => {
      setConnected(false)
      setFrameSrc(null)
      addLog('Camera closed')
    }
  }, [addLog])

  const sendControl = useCallback((left: number, right: number, stop: boolean) => {
    const ws = controlWsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ left, right, stop }))
    lastSentRef.current = { left, right, stop }
    lastSendTimeRef.current = performance.now()
  }, [])

  const sendMode = useCallback((next: 'auto' | 'manual') => {
    const ws = controlWsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      addLog('Cannot switch mode — control channel down', 'err')
      return
    }
    ws.send(JSON.stringify({ mode: next }))
    addLog(`Requested ${next.toUpperCase()} mode`)
  }, [addLog])

  useEffect(() => {
    let cancelled = false
    let retry: number | undefined
    let ws: WebSocket | null = null

    const open = () => {
      if (cancelled) return
      const url = `ws://${window.location.hostname || 'localhost'}:8000/ws/status`
      ws = new WebSocket(url)
      ws.onopen = () => setStatusConnected(true)
      ws.onmessage = (event) => {
        try {
          const s = JSON.parse(event.data)
          setMode(s.mode)
          setApState(s.state)
          setDistanceCm(s.distance_cm)
          setDistanceStale(!!s.distance_stale)
        } catch {
          // ignore malformed
        }
      }
      ws.onclose = () => {
        setStatusConnected(false)
        retry = window.setTimeout(open, 2000)
      }
    }
    open()

    return () => {
      cancelled = true
      if (retry !== undefined) clearTimeout(retry)
      ws?.close()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let reconnectTimer: number | undefined

    const openControl = () => {
      if (cancelled) return
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
      const existing = controlWsRef.current
      if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
        return
      }
      const url = `ws://${window.location.hostname || 'localhost'}:8000/ws/control`
      const ws = new WebSocket(url)
      controlWsRef.current = ws
      ws.onopen = () => {
        if (controlWsRef.current !== ws) return
        setControlConnected(true)
        addLog('Control channel connected', 'ok')
      }
      ws.onclose = (ev) => {
        if (controlWsRef.current !== ws) return
        setControlConnected(false)
        controlWsRef.current = null
        addLog(`Control closed (code=${ev.code}${ev.reason ? ` reason="${ev.reason}"` : ''}) — retry 2s`, 'err')
        reconnectTimer = window.setTimeout(openControl, 2000)
      }
    }

    openControl()

    const tick = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : []
      const pad = Array.from(pads).find((p) => p !== null) as Gamepad | null

      if (!pad) {
        if (gamepadNameRef.current !== null) {
          gamepadNameRef.current = null
          setGamepadName(null)
        }
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      if (gamepadNameRef.current !== pad.id) {
        gamepadNameRef.current = pad.id
        setGamepadName(pad.id)
      }

      const throttle = applyDeadzone(-(pad.axes[1] ?? 0))
      const steering = applyDeadzone(pad.axes[2] ?? 0)
      const left = clamp(throttle + steering)
      const right = clamp(throttle - steering)

      // DS4 Circle = button index 1 in standard mapping
      const stopBtn = !!pad.buttons[1]?.pressed
      const stopEdge = stopBtn && !stopBtnPrevRef.current
      stopBtnPrevRef.current = stopBtn

      setCurrentCmd({ left, right })

      if (stopEdge) {
        sendControl(0, 0, true)
        addLog('EMERGENCY STOP', 'err')
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      const now = performance.now()
      const dt = now - lastSendTimeRef.current
      const last = lastSentRef.current
      const changed =
        Math.abs(left - last.left) > CHANGE_EPSILON ||
        Math.abs(right - last.right) > CHANGE_EPSILON ||
        last.stop
      if ((dt >= SEND_MIN_INTERVAL_MS && changed) || dt >= HEARTBEAT_MS) {
        sendControl(left, right, false)
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      controlWsRef.current?.close()
    }
  }, [addLog, sendControl])

  useEffect(() => {
    addLog('System ready. Click Connect for camera. Plug gamepad to drive.')
    return () => {
      wsRef.current?.close()
    }
  }, [addLog])

  return (
    <>
      <header>
        <div className="logo">
          <div className="logo-icon" />
          <div>
            <div className="logo-text">ROVER-01</div>
            <div className="logo-sub">Mission Control</div>
          </div>
        </div>
        <div className="header-status">
          <div className="status-pill">
            <div className={`dot ${connected ? 'green' : 'red'}`} />
            <span>{connected ? 'CAMERA' : 'NO CAMERA'}</span>
          </div>
          <div className="status-pill">
            <div className={`dot ${controlConnected ? 'green' : 'red'}`} />
            <span>{controlConnected ? 'CONTROL' : 'NO CONTROL'}</span>
          </div>
          <div className="status-pill">
            <div className={`dot ${gamepadName ? 'green' : 'red'}`} />
            <span>{gamepadName ? 'GAMEPAD' : 'NO GAMEPAD'}</span>
          </div>
          <div className="status-pill">
            <div className={`dot ${mode === 'auto' ? 'green' : ''}`} />
            <span>{mode === 'auto' ? 'AUTOPILOT' : 'MANUAL'}</span>
          </div>
        </div>
      </header>

      <main>
        <div className="camera-panel">
          <div className="camera-label">CAM / FEED-01 / LIVE</div>
          <div className="camera-corner tl" />
          <div className="camera-corner tr" />
          <div className="camera-corner bl" />
          <div className="camera-corner br" />
          <div className="scanlines" />
          {frameSrc ? (
            <>
              <img ref={imgRef} className="camera-feed" src={frameSrc} alt="camera feed" />
              <ObjectDetector imgRef={imgRef} enabled={aiEnabled && connected} />
            </>
          ) : (
            <div className="no-signal">
              <div className="no-signal-icon">📷</div>
              <div className="no-signal-text">Awaiting signal</div>
            </div>
          )}
        </div>

        <div className="side-panel">
          <div className="panel-section">
            <div className="section-label">Camera</div>
            <div className="stat-row">
              <span className="stat-label">Host</span>
              <span className="stat-value small">
                {window.location.hostname || 'localhost'}
              </span>
            </div>
            <button
              className={`connect-btn ${connected ? 'disconnect' : ''}`}
              onClick={() => (connected ? disconnect() : connect())}
            >
              {connected ? 'Disconnect' : 'Connect'}
            </button>
            <div className="stat-row" style={{ marginTop: 12 }}>
              <span className="stat-label">FPS</span>
              <span className="stat-value green">{fps}</span>
            </div>
            <div className="fps-bar-track">
              <div
                className="fps-bar-fill"
                style={{ width: `${Math.min((fps / 30) * 100, 100)}%` }}
              />
            </div>
            <div className="stat-row" style={{ marginTop: 8 }}>
              <span className="stat-label">Frames recv.</span>
              <span className="stat-value">{frameTotal}</span>
            </div>
            <button
              className={`connect-btn ${aiEnabled ? 'disconnect' : ''}`}
              onClick={() => setAiEnabled((v) => !v)}
              style={{ marginTop: 8 }}
            >
              {aiEnabled ? 'AI Detection: ON' : 'AI Detection: OFF'}
            </button>
          </div>

          <div className="panel-section">
            <div className="section-label">Control</div>
            {(!gamepadName || !controlConnected) && (
              <div className="log-err" style={{ marginBottom: 8 }}>
                {!controlConnected && '⚠ Control channel down. '}
                {!gamepadName && '⚠ No gamepad detected. '}
              </div>
            )}
            <div className="stat-row">
              <span className="stat-label">Gamepad</span>
              <span className="stat-value small">{gamepadName ?? '—'}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Left</span>
              <span className="stat-value">{currentCmd.left.toFixed(2)}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Right</span>
              <span className="stat-value">{currentCmd.right.toFixed(2)}</span>
            </div>
            <button
              className="connect-btn disconnect"
              onClick={() => sendControl(0, 0, true)}
              style={{ marginTop: 8 }}
            >
              Emergency Stop
            </button>
            <div style={{ marginTop: 12 }}>
              <GamepadVisualizer />
            </div>
          </div>

          <div className="panel-section">
            <div className="section-label">Autopilot</div>
            {!statusConnected && (
              <div className="log-err" style={{ marginBottom: 8 }}>
                ⚠ Status channel down.
              </div>
            )}
            <div className="stat-row">
              <span className="stat-label">Mode</span>
              <span className={`stat-value ${mode === 'auto' ? 'green' : ''}`}>
                {mode.toUpperCase()}
              </span>
            </div>
            <div className="stat-row">
              <span className="stat-label">State</span>
              <span className="stat-value">{apState}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Distance</span>
              <span className={`stat-value ${distanceStale ? '' : 'green'}`}>
                {distanceCm === null ? '— (no reading)' : `${distanceCm.toFixed(1)} cm`}
              </span>
            </div>
            <button
              className={`connect-btn ${mode === 'auto' ? 'disconnect' : ''}`}
              onClick={() => sendMode(mode === 'auto' ? 'manual' : 'auto')}
              style={{ marginTop: 8 }}
            >
              {mode === 'auto' ? 'Switch to Manual' : 'Switch to Autopilot'}
            </button>
          </div>

          <div className="panel-section log-flex">
            <div className="section-label">System Log</div>
            <div className="log-area" ref={logsRef}>
              {logs.map((l, i) => (
                <span key={i} className={`log-${l.type}`}>
                  [{l.time}] {l.msg}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="bottom-bar">
          <span className="bottom-info">
            ROVER VISION SYSTEM v0.3 — MANUAL + AUTOPILOT
          </span>
          <span className="resolution-badge">640 × 480</span>
        </div>
      </main>
    </>
  )
}
