import { useEffect, useRef, useState } from 'react'

const STICK_RADIUS = 22   // travel radius of the knob inside its base
const TRIGGER_MAX = 20    // px height fill for full trigger pull
const STICK_ACTIVE = 0.15 // matches app deadzone — highlight when the user is actually pushing

type State = {
  connected: boolean
  lx: number; ly: number; l3: boolean
  rx: number; ry: number; r3: boolean
  up: boolean; down: boolean; left: boolean; right: boolean
  a: boolean; b: boolean; x: boolean; y: boolean
  l1: boolean; r1: boolean; l2: number; r2: number
}

const EMPTY: State = {
  connected: false,
  lx: 0, ly: 0, l3: false,
  rx: 0, ry: 0, r3: false,
  up: false, down: false, left: false, right: false,
  a: false, b: false, x: false, y: false,
  l1: false, r1: false, l2: 0, r2: 0,
}

function readPad(): State {
  const pads = navigator.getGamepads ? navigator.getGamepads() : []
  const pad = Array.from(pads).find((p) => p !== null) as Gamepad | null
  if (!pad) return EMPTY
  const btn = (i: number) => !!pad.buttons[i]?.pressed
  const val = (i: number) => pad.buttons[i]?.value ?? 0
  return {
    connected: true,
    lx: pad.axes[0] ?? 0, ly: pad.axes[1] ?? 0, l3: btn(10),
    rx: pad.axes[2] ?? 0, ry: pad.axes[3] ?? 0, r3: btn(11),
    a: btn(0), b: btn(1), x: btn(2), y: btn(3),
    l1: btn(4), r1: btn(5), l2: val(6), r2: val(7),
    up: btn(12), down: btn(13), left: btn(14), right: btn(15),
  }
}

const ON = '#00ff88'
const OFF = '#2a3448'
const STROKE = '#4a5878'

export default function GamepadVisualizer() {
  const [s, setS] = useState<State>(EMPTY)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const tick = () => {
      setS(readPad())
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const face = (fill: boolean) => (fill ? ON : OFF)
  const dpad = (fill: boolean) => (fill ? ON : OFF)

  return (
    <svg viewBox="0 0 300 220" width="100%" style={{ display: 'block' }}>
      <rect x="20" y="60" width="260" height="120" rx="60" ry="60"
        fill="none" stroke={STROKE} strokeWidth="1.5" opacity="0.7" />

      <rect x="60" y="4" width="50" height={TRIGGER_MAX} rx="4" fill="none" stroke={STROKE} strokeWidth="1" />
      <rect x="60" y={4 + TRIGGER_MAX - TRIGGER_MAX * s.l2} width="50" height={TRIGGER_MAX * s.l2}
        rx="4" fill={ON} opacity="0.6" />
      <text x="85" y="18" textAnchor="middle" fontSize="9" fill={s.l2 > 0 ? ON : '#8a94a8'}>L2</text>
      <rect x="190" y="4" width="50" height={TRIGGER_MAX} rx="4" fill="none" stroke={STROKE} strokeWidth="1" />
      <rect x="190" y={4 + TRIGGER_MAX - TRIGGER_MAX * s.r2} width="50" height={TRIGGER_MAX * s.r2}
        rx="4" fill={ON} opacity="0.6" />
      <text x="215" y="18" textAnchor="middle" fontSize="9" fill={s.r2 > 0 ? ON : '#8a94a8'}>R2</text>

      <rect x="60" y="30" width="50" height="20" rx="6" fill={s.l1 ? ON : 'none'} stroke={s.l1 ? ON : STROKE} strokeWidth="2" opacity={s.l1 ? 0.6 : 1} />
      <text x="85" y="44" textAnchor="middle" fontSize="10" fill={s.l1 ? '#000' : '#8a94a8'}>L1</text>
      <rect x="190" y="30" width="50" height="20" rx="6" fill={s.r1 ? ON : 'none'} stroke={s.r1 ? ON : STROKE} strokeWidth="2" opacity={s.r1 ? 0.6 : 1} />
      <text x="215" y="44" textAnchor="middle" fontSize="10" fill={s.r1 ? '#000' : '#8a94a8'}>R1</text>

      <circle cx="85" cy="130" r="28" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <circle cx={85 + s.lx * STICK_RADIUS} cy={130 + s.ly * STICK_RADIUS} r="14"
        fill={s.l3 || Math.abs(s.lx) > STICK_ACTIVE || Math.abs(s.ly) > STICK_ACTIVE ? ON : OFF}
        stroke={STROKE} strokeWidth="1.5" />

      <circle cx="215" cy="130" r="28" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <circle cx={215 + s.rx * STICK_RADIUS} cy={130 + s.ry * STICK_RADIUS} r="14"
        fill={s.r3 || Math.abs(s.rx) > STICK_ACTIVE || Math.abs(s.ry) > STICK_ACTIVE ? ON : OFF}
        stroke={STROKE} strokeWidth="1.5" />

      <g transform="translate(150 130)">
        <rect x="-8" y="-24" width="16" height="16" fill={dpad(s.up)} stroke={STROKE} />
        <rect x="-8" y="8" width="16" height="16" fill={dpad(s.down)} stroke={STROKE} />
        <rect x="-24" y="-8" width="16" height="16" fill={dpad(s.left)} stroke={STROKE} />
        <rect x="8" y="-8" width="16" height="16" fill={dpad(s.right)} stroke={STROKE} />
      </g>

      <g transform="translate(150 180)">
        <circle cx="0" cy="-14" r="7" fill={face(s.y)} stroke={STROKE} />
        <text x="0" y="-11" textAnchor="middle" fontSize="8" fill="#000">△</text>
        <circle cx="14" cy="0" r="7" fill={face(s.b)} stroke={STROKE} />
        <text x="14" y="3" textAnchor="middle" fontSize="8" fill="#000">○</text>
        <circle cx="0" cy="14" r="7" fill={face(s.a)} stroke={STROKE} />
        <text x="0" y="17" textAnchor="middle" fontSize="8" fill="#000">✕</text>
        <circle cx="-14" cy="0" r="7" fill={face(s.x)} stroke={STROKE} />
        <text x="-14" y="3" textAnchor="middle" fontSize="8" fill="#000">□</text>
      </g>

      {!s.connected && (
        <text x="150" y="115" textAnchor="middle" fontSize="11" fill="#8a94a8">no gamepad</text>
      )}
    </svg>
  )
}
