#!/usr/bin/env python3
"""
Motor control - AI Vision Rover
Uses wiringOP (`gpio` command) to drive the L298N via Orange Pi GPIO.

Pinout (physical pins confirmed via `gpio readall`):
    IN1 -> Pin 11  (LEFT motors)
    IN2 -> Pin 13  (LEFT motors)
    IN3 -> Pin 15  (RIGHT motors)
    IN4 -> Pin 22  (RIGHT motors)

Per-side H-bridge logic:
    LEFT side:   IN1=1,IN2=0 -> forward | IN1=0,IN2=1 -> reverse | IN1=0,IN2=0 -> stop
    RIGHT side:  IN3=1,IN4=0 -> forward | IN3=0,IN4=1 -> reverse | IN3=0,IN4=0 -> stop

If a side spins opposite to expected, swap that side's wire pair on the L298N
(physical swap) OR invert the 0/1 logic in the functions below.

MOCK_GPIO=1 → logs pin writes instead of executing (dev on laptop without wiringOP).
"""

import os
import subprocess
import sys
import time

IN1 = 11  # left
IN2 = 13  # left
IN3 = 15  # right
IN4 = 22  # right

ALL_PINS = [IN1, IN2, IN3, IN4]

# ENA/ENB jumpered HIGH on the HW-095 → digital-only bang-bang control.
# Anything above THRESHOLD magnitude drives full speed, below stops.
# TODO: remove ENA/ENB jumpers, wire to PWM-capable GPIO, replace _apply_side() body.
THRESHOLD = 0.3

_pin_state: dict[int, int] = {}


def _gpio(*args):
    if os.environ.get("MOCK_GPIO") == "1":
        print(f"[MOCK_GPIO] gpio -1 {' '.join(str(a) for a in args)}")
        return
    subprocess.run(["gpio", "-1", *[str(a) for a in args]], check=True)


def _write(pin: int, value: int):
    """Write only if pin state changed. Avoids ~5-15ms subprocess cost per no-op."""
    if _pin_state.get(pin) == value:
        return
    _gpio("write", pin, value)
    _pin_state[pin] = value


def setup():
    """Configure all pins as output and ensure they start LOW."""
    for pin in ALL_PINS:
        _gpio("mode", pin, "out")
        _gpio("write", pin, 0)
        _pin_state[pin] = 0


def stop():
    _write(IN1, 0)
    _write(IN2, 0)
    _write(IN3, 0)
    _write(IN4, 0)


def forward():
    _write(IN1, 1)
    _write(IN2, 0)
    _write(IN3, 1)
    _write(IN4, 0)


def reverse():
    _write(IN1, 0)
    _write(IN2, 1)
    _write(IN3, 0)
    _write(IN4, 1)


def turn_left():
    _write(IN1, 0)
    _write(IN2, 1)
    _write(IN3, 1)
    _write(IN4, 0)


def turn_right():
    _write(IN1, 1)
    _write(IN2, 0)
    _write(IN3, 0)
    _write(IN4, 1)


def soft_left():
    _write(IN1, 0)
    _write(IN2, 0)
    _write(IN3, 1)
    _write(IN4, 0)


def soft_right():
    _write(IN1, 1)
    _write(IN2, 0)
    _write(IN3, 0)
    _write(IN4, 0)


def _apply_side(speed: float, in_fwd: int, in_rev: int):
    """Translate float speed in [-1,1] to bang-bang H-bridge pins for one side.
    ponytail: only place to swap for PWM once ENA/ENB jumpers are removed."""
    if abs(speed) < THRESHOLD:
        _write(in_fwd, 0)
        _write(in_rev, 0)
    elif speed > 0:
        _write(in_fwd, 1)
        _write(in_rev, 0)
    else:
        _write(in_fwd, 0)
        _write(in_rev, 1)


def set_speeds(left: float, right: float):
    """Proportional API. Clamps to [-1,1]. Currently thresholded (see _apply_side)."""
    left = max(-1.0, min(1.0, left))
    right = max(-1.0, min(1.0, right))
    _apply_side(left, IN1, IN2)
    _apply_side(right, IN3, IN4)


def test_sequence():
    steps = [
        ("FORWARD", forward),
        ("STOP", stop),
        ("REVERSE", reverse),
        ("STOP", stop),
        ("TURN LEFT", turn_left),
        ("STOP", stop),
        ("TURN RIGHT", turn_right),
        ("STOP", stop),
    ]

    for name, action in steps:
        print(f"→ {name}")
        action()
        time.sleep(1.5)

    stop()
    print("Test complete. Motors stopped.")


def _self_check():
    """Assert-based check of set_speeds → pin-state mapping. Requires MOCK_GPIO=1."""
    os.environ["MOCK_GPIO"] = "1"
    _pin_state.clear()
    setup()
    assert _pin_state == {IN1: 0, IN2: 0, IN3: 0, IN4: 0}, _pin_state

    set_speeds(0.5, -0.5)
    assert _pin_state == {IN1: 1, IN2: 0, IN3: 0, IN4: 1}, _pin_state

    set_speeds(0.1, 0.9)  # left below THRESHOLD
    assert _pin_state == {IN1: 0, IN2: 0, IN3: 1, IN4: 0}, _pin_state

    set_speeds(-2.0, 2.0)  # out of range → clamp
    assert _pin_state == {IN1: 0, IN2: 1, IN3: 1, IN4: 0}, _pin_state

    set_speeds(0, 0)
    assert _pin_state == {IN1: 0, IN2: 0, IN3: 0, IN4: 0}, _pin_state

    print("motor_control: OK")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "check":
        _self_check()
        sys.exit(0)

    setup()
    try:
        if len(sys.argv) > 1 and sys.argv[1] == "test":
            test_sequence()
        else:
            print("Usage:")
            print("  python3 motor_control.py test    # test sequence (hardware)")
            print("  MOCK_GPIO=1 python3 motor_control.py test    # no hardware")
            print("  python3 motor_control.py check   # asserts (no hardware)")
            print()
            print("Or import the functions in another script:")
            print("  from motor_control import forward, reverse, stop, set_speeds")
    except KeyboardInterrupt:
        print("\nInterrupted by user.")
    finally:
        stop()
