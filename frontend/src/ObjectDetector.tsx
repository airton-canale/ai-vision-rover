import { RefObject, useEffect, useRef, useState } from 'react'
import * as cocoSsd from '@tensorflow-models/coco-ssd'
import '@tensorflow/tfjs'

type Detection = { class: string; score: number; bbox: [number, number, number, number] }

const MIN_INTERVAL_MS = 200  // ~5 detections/sec; COCO-SSD lite on laptop CPU
const MIN_SCORE = 0.5

type Props = {
  imgRef: RefObject<HTMLImageElement | null>
  enabled: boolean
}

export default function ObjectDetector({ imgRef, enabled }: Props) {
  const [detections, setDetections] = useState<Detection[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const modelRef = useRef<cocoSsd.ObjectDetection | null>(null)
  const busyRef = useRef(false)
  const lastRunRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    cocoSsd.load({ base: 'lite_mobilenet_v2' })
      .then((m) => {
        if (cancelled) return
        modelRef.current = m
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setDetections([])
      return
    }
    const tick = async () => {
      rafRef.current = requestAnimationFrame(tick)
      const now = performance.now()
      if (now - lastRunRef.current < MIN_INTERVAL_MS) return
      if (busyRef.current) return
      const model = modelRef.current
      const img = imgRef.current
      if (!model || !img || !img.complete || img.naturalWidth === 0) return
      busyRef.current = true
      lastRunRef.current = now
      try {
        const preds = await model.detect(img)
        setDetections(preds.filter((p) => p.score >= MIN_SCORE) as Detection[])
      } catch {
        // frame may be gone by the time detect resolves — skip
      } finally {
        busyRef.current = false
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [enabled, imgRef])

  const img = imgRef.current
  const vw = img?.naturalWidth ?? 640
  const vh = img?.naturalHeight ?? 480

  return (
    <>
      <svg
        viewBox={`0 0 ${vw} ${vh}`}
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        {detections.map((d, i) => {
          const [x, y, w, h] = d.bbox
          return (
            <g key={i}>
              <rect x={x} y={y} width={w} height={h}
                fill="none" stroke="#00ff88" strokeWidth={2} />
              <rect x={x} y={y - 18} width={d.class.length * 8 + 40} height={18} fill="#00ff88" />
              <text x={x + 4} y={y - 5} fontSize={12} fill="#000" fontFamily="monospace">
                {d.class} {(d.score * 100).toFixed(0)}%
              </text>
            </g>
          )
        })}
      </svg>
      <div style={{
        position: 'absolute', top: 8, right: 8, padding: '2px 8px',
        background: 'rgba(0,0,0,0.6)', color: status === 'ready' ? '#00ff88' : '#8a94a8',
        fontSize: 10, fontFamily: 'monospace', borderRadius: 4, pointerEvents: 'none',
      }}>
        AI: {status === 'loading' ? 'loading model…' : status === 'error' ? 'failed' : `${detections.length} obj`}
      </div>
    </>
  )
}
