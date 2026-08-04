import { useCallback, useEffect, useRef, useState } from 'react'

type LogType = 'info' | 'ok' | 'err'
type LogEntry = { time: string; msg: string; type: LogType }

const MAX_LOGS = 30

function wsUrl(): string {
  const host = window.location.hostname || 'localhost'
  return `ws://${host}:8000/ws/camera`
}

function nowTime(): string {
  return new Date().toTimeString().slice(0, 8)
}

export default function App() {
  const [connected, setConnected] = useState(false)
  const [frameSrc, setFrameSrc] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [frameTotal, setFrameTotal] = useState(0)
  const [resolution, setResolution] = useState('—')
  const [latency, setLatency] = useState('— ms')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [host, setHost] = useState('—')

  const wsRef = useRef<WebSocket | null>(null)
  const pingIntervalRef = useRef<number | null>(null)
  const pingStartRef = useRef(0)
  const frameWindowRef = useRef(0)
  const lastFpsTimeRef = useRef(performance.now())
  const imgRef = useRef<HTMLImageElement | null>(null)
  const logsRef = useRef<HTMLDivElement | null>(null)

  const addLog = useCallback((msg: string, type: LogType = 'info') => {
    setLogs((prev) => {
      const next = [...prev, { time: nowTime(), msg, type }]
      return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next
    })
  }, [])

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight
  }, [logs])

  const disconnect = useCallback(() => {
    if (pingIntervalRef.current !== null) {
      clearInterval(pingIntervalRef.current)
      pingIntervalRef.current = null
    }
    wsRef.current?.close()
    wsRef.current = null
    setFps(0)
    setFrameTotal(0)
    setLatency('— ms')
    setFrameSrc(null)
    addLog('Disconnected by user')
  }, [addLog])

  const connect = useCallback(() => {
    const url = wsUrl()
    setHost(window.location.hostname || 'localhost')
    addLog(`Connecting to ${url}...`)
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      addLog('WebSocket connected', 'ok')
      pingIntervalRef.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          pingStartRef.current = performance.now()
          ws.send('ping')
        }
      }, 2000)
    }

    ws.onmessage = (event) => {
      if (event.data === 'pong') {
        setLatency(`${Math.round(performance.now() - pingStartRef.current)} ms`)
        return
      }
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
      if (pingIntervalRef.current !== null) {
        clearInterval(pingIntervalRef.current)
        pingIntervalRef.current = null
      }
      setFrameSrc(null)
      addLog('Connection closed')
    }
  }, [addLog])

  useEffect(() => {
    addLog('System ready. Click Connect to start stream.')
    return () => {
      wsRef.current?.close()
      if (pingIntervalRef.current !== null) clearInterval(pingIntervalRef.current)
    }
  }, [addLog])

  const handleImgLoad = () => {
    const img = imgRef.current
    if (img && img.naturalWidth) {
      setResolution(`${img.naturalWidth}×${img.naturalHeight}`)
    }
  }

  const toggle = () => (connected ? disconnect() : connect())

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
            <img
              ref={imgRef}
              className="camera-feed"
              src={frameSrc}
              alt="camera feed"
              onLoad={handleImgLoad}
            />
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
              <span className="stat-value small">{host}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Latency</span>
              <span className="stat-value">{latency}</span>
            </div>
            <button
              className={`connect-btn ${connected ? 'disconnect' : ''}`}
              onClick={toggle}
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
            <div className="stat-row">
              <span className="stat-label">Resolution</span>
              <span className="stat-value">{resolution}</span>
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
          <span className="resolution-badge">
            {resolution === '—' ? '640 × 480' : resolution}
          </span>
        </div>
      </main>
    </>
  )
}
