"""HC-SR04 ultrasonic distance sensor driver. See README "Autopilot" section
for wiring (⚠ Echo needs a voltage divider), pin choice, and MOCK_DISTANCES."""

import os
import statistics
import time

TRIG_PIN = 12
ECHO_PIN = 16

MIN_PING_INTERVAL_S = 0.06  # HC-SR04: ≥60ms between pings or echoes overlap
ECHO_TIMEOUT_S = 0.038      # 38ms ≈ 6.5m range; longer = clear path
SPEED_OF_SOUND_CM_PER_S = 34300
SAMPLES = 5
MIN_VALID_SAMPLES = 3
MIN_CM = 2
MAX_CM = 400

_last_ping_time = 0.0
_gpio = None
_gpio_ready = False

_mock_seq: list[float] | None = None
_mock_idx = 0


def _load_mock_seq() -> list[float]:
    global _mock_seq
    if _mock_seq is None:
        env = os.environ.get("MOCK_DISTANCES", "100")
        _mock_seq = [float(x) for x in env.split(",") if x.strip()]
    return _mock_seq


def _init_gpio():
    global _gpio, _gpio_ready
    if _gpio_ready:
        return
    if os.environ.get("MOCK_GPIO") == "1":
        _gpio_ready = True
        return
    import OPi.GPIO as GPIO
    GPIO.setmode(GPIO.BOARD)
    GPIO.setwarnings(False)
    GPIO.setup(TRIG_PIN, GPIO.OUT, initial=GPIO.LOW)
    GPIO.setup(ECHO_PIN, GPIO.IN)
    _gpio = GPIO
    _gpio_ready = True


def _measure_once() -> float | None:
    global _last_ping_time, _mock_idx
    _init_gpio()

    if os.environ.get("MOCK_GPIO") == "1":
        seq = _load_mock_seq()
        val = seq[_mock_idx % len(seq)]
        _mock_idx += 1
        return None if val < 0 else val

    since = time.monotonic() - _last_ping_time
    if since < MIN_PING_INTERVAL_S:
        time.sleep(MIN_PING_INTERVAL_S - since)

    _gpio.output(TRIG_PIN, _gpio.HIGH)
    time.sleep(1e-5)
    _gpio.output(TRIG_PIN, _gpio.LOW)

    wait_start = time.monotonic()
    while _gpio.input(ECHO_PIN) == 0:
        if time.monotonic() - wait_start > ECHO_TIMEOUT_S:
            _last_ping_time = time.monotonic()
            return None
    pulse_start = time.monotonic()

    while _gpio.input(ECHO_PIN) == 1:
        if time.monotonic() - pulse_start > ECHO_TIMEOUT_S:
            _last_ping_time = time.monotonic()
            return None
    pulse_end = time.monotonic()
    _last_ping_time = pulse_end

    distance_cm = (pulse_end - pulse_start) * SPEED_OF_SOUND_CM_PER_S / 2
    if distance_cm < MIN_CM or distance_cm > MAX_CM:
        return None
    return distance_cm


def measure_distance_cm() -> float | None:
    """Median of SAMPLES reads. Returns None if fewer than MIN_VALID_SAMPLES succeed.
    Never call from the asyncio event loop — use run_in_executor. It blocks up to
    ~200ms (5 samples × ~40ms worst case)."""
    reads: list[float] = []
    for _ in range(SAMPLES):
        r = _measure_once()
        if r is not None:
            reads.append(r)
    if len(reads) < MIN_VALID_SAMPLES:
        return None
    return statistics.median(reads)


def _self_check():
    os.environ["MOCK_GPIO"] = "1"
    os.environ["MOCK_DISTANCES"] = "100,100,100,100,100"
    global _mock_seq, _mock_idx
    _mock_seq = None
    _mock_idx = 0
    assert measure_distance_cm() == 100.0

    os.environ["MOCK_DISTANCES"] = "-1,-1,-1,-1,-1"
    _mock_seq = None
    _mock_idx = 0
    assert measure_distance_cm() is None, "all timeouts → None"

    os.environ["MOCK_DISTANCES"] = "50,50,50,-1,-1"
    _mock_seq = None
    _mock_idx = 0
    assert measure_distance_cm() == 50.0, "3 good + 2 bad → median of 3"

    os.environ["MOCK_DISTANCES"] = "10,50,50,50,999"
    _mock_seq = None
    _mock_idx = 0
    assert measure_distance_cm() == 50.0, "outliers ignored by median"

    print("sensors: OK")


if __name__ == "__main__":
    _self_check()
