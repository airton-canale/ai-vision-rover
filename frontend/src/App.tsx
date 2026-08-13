import { useCallback, useEffect, useRef, useState } from 'react'

type LogEntry = { time: string; msg: string; type: 'info' | 'ok' | 'err' }

const MAX_LOGS = 30

export default function App() {
  const [connected, setConnected] = useState(false)
  const [frameSrc, setFrameSrc] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [frameTotal, setFrameTotal] = useState(0)
  const [logs, setLogs] = useState<LogEntry[]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const frameWindowRef = useRef(0)
  const lastFpsTimeRef = useRef(performance.now())
  const logsRef = useRef<HTMLDivElement | null>(null)

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
      addLog('WebSocket connected', 'ok')
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

    ws.onerror = () => addLog('Connection error — is the server running?', 'err')
    ws.onclose = () => {
      setConnected(false)
      setFrameSrc(null)
      addLog('Connection closed')
    }
  }, [addLog])

  useEffect(() => {
    addLog('System ready. Click Connect to start stream.')
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
            <span>{connected ? 'CONNECTED' : 'DISCONNECTED'}</span>
          </div>
          <div className="status-pill">
            <div className={`dot ${frameSrc ? 'green' : ''}`} />
            <span>{frameSrc ? 'LIVE' : 'NO SIGNAL'}</span>
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
            <img className="camera-feed" src={frameSrc} alt="camera feed" />
          ) : (
            <div className="no-signal">
              <div className="no-signal-icon">📷</div>
              <div className="no-signal-text">Awaiting signal</div>
            </div>
          )}
        </div>

        <div className="side-panel">
          <div className="panel-section">
            <div className="section-label">Connection</div>
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
          </div>

          <div className="panel-section">
            <div className="section-label">Stream</div>
            <div className="stat-row">
              <span className="stat-label">FPS</span>
              <span className="stat-value green">{fps}</span>
            </div>
            <div className="fps-bar-track">
              <div
                className="fps-bar-fill"
                style={{ width: `${Math.min((fps / 30) * 100, 100)}%` }}
              />
            </div>
            <div className="stat-row" style={{ marginTop: 12 }}>
              <span className="stat-label">Frames recv.</span>
              <span className="stat-value">{frameTotal}</span>
            </div>
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
            ROVER VISION SYSTEM v0.1 — PHASE 1: CAMERA STREAM
          </span>
          <span className="resolution-badge">640 × 480</span>
        </div>
      </main>
    </>
  )
}
