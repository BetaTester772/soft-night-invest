"""Run adapted k6 scenarios on the isolated stack while watching production."""

import http.client
import json
import socket
import ssl
import subprocess
import sys
import threading
import time
from pathlib import Path

profile = sys.argv[1] if len(sys.argv) > 1 else "smoke"
if profile not in ("smoke", "ramp"):
    raise SystemExit("Expected smoke or ramp")
root = Path(__file__).resolve().parents[2]
run_id = str(int(time.time()))
out = root / "artifacts" / ("k6-" + profile + "-" + run_id)
out.mkdir(parents=True)
name = "softnight-stress-k6"
done = threading.Event()


def monitor():
    slow = 0
    tick = 0
    with (
        (out / "production.jsonl").open("w") as health,
        (out / "stats.jsonl").open("w") as stats,
    ):
        while not done.is_set():
            start = time.monotonic()
            status = 0
            try:
                conn = http.client.HTTPSConnection(
                    "softnight.intelligentsw.com",
                    timeout=2,
                    context=ssl.create_default_context(),
                )
                conn._create_connection = lambda address, timeout, source_address=None: (
                    socket.create_connection(("127.0.0.1", 443), timeout)
                )
                conn.request("GET", "/api/health")
                r = conn.getresponse()
                r.read()
                status = r.status
                conn.close()
            except Exception:
                pass
            elapsed = time.monotonic() - start
            health.write(
                json.dumps({"at": time.time(), "status": status, "seconds": elapsed})
                + "\n"
            )
            health.flush()
            slow = slow + 1 if status != 200 or elapsed > 1 else 0
            if slow >= 5:
                print("Production health degraded: stopping k6", flush=True)
                subprocess.run(
                    ["sudo", "-n", "docker", "stop", "-t", "1", name],
                    capture_output=True,
                )
                break
            if tick % 5 == 0:
                r = subprocess.run(
                    [
                        "sudo",
                        "-n",
                        "docker",
                        "stats",
                        "--no-stream",
                        "--format",
                        "{{json .}}",
                    ],
                    capture_output=True,
                    text=True,
                )
                stats.write(
                    json.dumps({"at": time.time(), "stats": r.stdout.splitlines()})
                    + "\n"
                )
                stats.flush()
            tick += 1
            done.wait(1)


thread = threading.Thread(target=monitor)
thread.start()
try:
    with (out / "k6.log").open("w") as log:
        r = subprocess.run(
            [
                "sudo",
                "-n",
                "docker",
                "run",
                "--rm",
                "--name",
                name,
                "--user",
                str(__import__("os").getuid()) + ":" + str(__import__("os").getgid()),
                "--network",
                "soft-night-stress_default",
                "--cpu-shares",
                "256",
                "--cpus",
                "0.6",
                "-v",
                str(root / "scripts/stress") + ":/scripts:ro",
                "-v",
                str(out) + ":/results",
                "-e",
                "PROFILE=" + profile,
                "-e",
                "RUN_ID=" + run_id,
                "grafana/k6:latest",
                "run",
                "--quiet",
                "--summary-export",
                "/results/summary.json",
                "/scripts/load.js",
            ],
            stdout=log,
            stderr=subprocess.STDOUT,
        )
    print("k6 exit:", r.returncode, "Artifacts:", out, flush=True)
    print((out / "k6.log").read_text()[-6500:], flush=True)
finally:
    done.set()
    thread.join()

raise SystemExit(r.returncode)
