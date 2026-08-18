"""Autopilot state machine. Supervised operation — see README for hardware
limits (no drop-off detection, forward-facing only)."""

import asyncio
import time
from enum import Enum

import motor_control
import sensors

CLEAR_DISTANCE_CM = 50   # resume CRUISE above this
STOP_DISTANCE_CM = 25    # trigger OBSTACLE below this
BACKUP_DURATION_S = 0.5
TURN_DURATION_S = 0.4
OBSTACLE_PAUSE_S = 0.2
MAX_TURN_ATTEMPTS = 4
LOOP_INTERVAL_S = 0.1


class State(str, Enum):
    IDLE = "IDLE"
    CRUISE = "CRUISE"
    OBSTACLE = "OBSTACLE"
    BACKUP = "BACKUP"
    TURN = "TURN"
    STUCK = "STUCK"


class Autopilot:
    def __init__(self):
        self.state: State = State.IDLE
        self.distance_cm: float | None = None
        self.distance_stale: bool = True
        self._task: asyncio.Task | None = None
        self._state_started: float = 0.0
        self._turn_attempts: int = 0
        self._turn_left: bool = True

    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self):
        if self.running():
            return
        self.state = State.CRUISE
        self._state_started = time.monotonic()
        self._turn_attempts = 0
        self.distance_stale = True
        self._task = asyncio.create_task(self._run())

    async def stop(self):
        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        self.state = State.IDLE
        motor_control.parar()

    async def _run(self):
        loop = asyncio.get_running_loop()
        try:
            while True:
                dist = await loop.run_in_executor(None, sensors.measure_distance_cm)
                self.distance_cm = dist
                self.distance_stale = dist is None
                self._tick(dist, time.monotonic())
                await asyncio.sleep(LOOP_INTERVAL_S)
        finally:
            motor_control.parar()

    def _tick(self, dist: float | None, now: float):
        s = self.state
        elapsed = now - self._state_started

        if s == State.CRUISE:
            if dist is not None and dist < STOP_DISTANCE_CM:
                motor_control.parar()
                self._enter(State.OBSTACLE, now)
            else:
                motor_control.set_speeds(1.0, 1.0)

        elif s == State.OBSTACLE:
            if elapsed >= OBSTACLE_PAUSE_S:
                motor_control.set_speeds(-1.0, -1.0)
                self._enter(State.BACKUP, now)

        elif s == State.BACKUP:
            if elapsed >= BACKUP_DURATION_S:
                if self._turn_left:
                    motor_control.set_speeds(-1.0, 1.0)
                else:
                    motor_control.set_speeds(1.0, -1.0)
                self._enter(State.TURN, now)

        elif s == State.TURN:
            if elapsed >= TURN_DURATION_S:
                motor_control.parar()
                if dist is not None and dist > CLEAR_DISTANCE_CM:
                    self._turn_attempts = 0
                    self._enter(State.CRUISE, now)
                else:
                    self._turn_attempts += 1
                    self._turn_left = not self._turn_left
                    if self._turn_attempts >= MAX_TURN_ATTEMPTS:
                        self._enter(State.STUCK, now)
                    else:
                        self._enter(State.OBSTACLE, now)

        elif s == State.STUCK:
            motor_control.parar()

    def _enter(self, new_state: State, now: float):
        self.state = new_state
        self._state_started = now


autopilot = Autopilot()


def _self_check():
    import os
    os.environ["MOCK_GPIO"] = "1"

    ap = Autopilot()
    ap.state = State.CRUISE
    ap._state_started = 0.0

    ap._tick(dist=100.0, now=0.01)
    assert ap.state == State.CRUISE, ap.state

    ap._tick(dist=10.0, now=0.02)
    assert ap.state == State.OBSTACLE, ap.state

    ap._tick(dist=10.0, now=0.02 + OBSTACLE_PAUSE_S + 0.01)
    assert ap.state == State.BACKUP, ap.state

    t = 0.02 + OBSTACLE_PAUSE_S + 0.01
    ap._tick(dist=10.0, now=t + BACKUP_DURATION_S + 0.01)
    assert ap.state == State.TURN, ap.state

    t2 = t + BACKUP_DURATION_S + 0.01
    ap._tick(dist=100.0, now=t2 + TURN_DURATION_S + 0.01)
    assert ap.state == State.CRUISE, ap.state
    assert ap._turn_attempts == 0

    ap2 = Autopilot()
    ap2.state = State.TURN
    ap2._turn_attempts = MAX_TURN_ATTEMPTS - 1
    ap2._state_started = 0.0
    ap2._tick(dist=10.0, now=TURN_DURATION_S + 0.01)
    assert ap2.state == State.STUCK, ap2.state

    print("autopilot: OK")


if __name__ == "__main__":
    _self_check()
