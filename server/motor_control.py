#!/usr/bin/env python3
"""
Controle de motores - AI Vision Rover
Usa o wiringOP (comando 'gpio') para controlar o L298N via GPIO da Orange Pi.

Pinagem (pinos físicos confirmados no gpio readall):
    IN1 -> Pino 11  (motores ESQUERDA)
    IN2 -> Pino 13  (motores ESQUERDA)
    IN3 -> Pino 15  (motores DIREITA)
    IN4 -> Pino 22  (motores DIREITA)

Lógica H-bridge por lado:
    Lado ESQUERDO:  IN1=1,IN2=0 -> frente | IN1=0,IN2=1 -> ré | IN1=0,IN2=0 -> parado
    Lado DIREITO:   IN3=1,IN4=0 -> frente | IN3=0,IN4=1 -> ré | IN3=0,IN4=0 -> parado

Se um lado girar ao contrário do esperado, inverta o par de fios daquele lado
no L298N (troca física) OU inverta a lógica 0/1 nas funções abaixo.

MOCK_GPIO=1 → logs pin writes instead of executing (dev on laptop without wiringOP).
"""

import os
import subprocess
import sys
import time

IN1 = 11  # esquerda
IN2 = 13  # esquerda
IN3 = 15  # direita
IN4 = 22  # direita

TODOS_PINOS = [IN1, IN2, IN3, IN4]

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
    """Configura todos os pinos como saída e garante que começam desligados."""
    for pino in TODOS_PINOS:
        _gpio("mode", pino, "out")
        _gpio("write", pino, 0)
        _pin_state[pino] = 0


def parar():
    _write(IN1, 0)
    _write(IN2, 0)
    _write(IN3, 0)
    _write(IN4, 0)


def frente():
    _write(IN1, 1)
    _write(IN2, 0)
    _write(IN3, 1)
    _write(IN4, 0)


def re():
    _write(IN1, 0)
    _write(IN2, 1)
    _write(IN3, 0)
    _write(IN4, 1)


def girar_esquerda():
    _write(IN1, 0)
    _write(IN2, 1)
    _write(IN3, 1)
    _write(IN4, 0)


def girar_direita():
    _write(IN1, 1)
    _write(IN2, 0)
    _write(IN3, 0)
    _write(IN4, 1)


def curva_suave_esquerda():
    _write(IN1, 0)
    _write(IN2, 0)
    _write(IN3, 1)
    _write(IN4, 0)


def curva_suave_direita():
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


def testar_sequencia():
    testes = [
        ("FRENTE", frente),
        ("PARAR", parar),
        ("RÉ", re),
        ("PARAR", parar),
        ("GIRAR ESQUERDA", girar_esquerda),
        ("PARAR", parar),
        ("GIRAR DIREITA", girar_direita),
        ("PARAR", parar),
    ]

    for nome, funcao in testes:
        print(f"→ {nome}")
        funcao()
        time.sleep(1.5)

    parar()
    print("Teste concluído. Motores parados.")


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
        if len(sys.argv) > 1 and sys.argv[1] == "teste":
            testar_sequencia()
        else:
            print("Uso:")
            print("  python3 motor_control.py teste   # sequência de teste (hardware)")
            print("  MOCK_GPIO=1 python3 motor_control.py teste   # sem hardware")
            print("  python3 motor_control.py check   # asserts (sem hardware)")
            print()
            print("Ou importe as funções em outro script:")
            print("  from motor_control import frente, re, parar, set_speeds")
    except KeyboardInterrupt:
        print("\nInterrompido pelo usuário.")
    finally:
        parar()
