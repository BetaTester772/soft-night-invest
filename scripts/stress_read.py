"""HTTPS read stress test; fixed concurrency, no think time, same-host generator."""

import collections
import concurrent.futures
import datetime
import http.client
import json
import socket
import ssl
import subprocess
import threading
import time
from pathlib import Path

DOMAIN = "softnight.intelligentsw.com"
PATHS = ["/api/event", "/api/instruments", "/api/ranking", "/api/news", "/"]
OUT = Path(
    "artifacts/stress-"
    + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
)
OUT.mkdir(parents=True)
stop_monitor = threading.Event()


def monitor():
    with (OUT / "resources.jsonl").open("w") as f:
        while not stop_monitor.is_set():
            p = subprocess.run(
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
            f.write(
                json.dumps({"at": time.time(), "stats": p.stdout.splitlines()}) + "\n"
            )
            f.flush()
            stop_monitor.wait(3)


def worker(idx, deadline):
    results = []
    conn = None
    n = idx
    while time.monotonic() < deadline:
        path = PATHS[n % len(PATHS)]
        n += 1
        started = time.monotonic()
        try:
            if conn is None:
                conn = http.client.HTTPSConnection(
                    DOMAIN, timeout=5, context=ssl.create_default_context()
                )
                conn._create_connection = lambda address, timeout, source_address=None: (
                    socket.create_connection(("127.0.0.1", 443), timeout)
                )
            conn.request("GET", path, headers={"User-Agent": "softnight-stress/1.0"})
            response = conn.getresponse()
            body = response.read()
            status = str(response.status)
            if response.status == 200 and path.startswith("/api/"):
                json.loads(body)
        except Exception as exc:
            status = type(exc).__name__
            if conn:
                conn.close()
            conn = None
        results.append((path, status, (time.monotonic() - started) * 1000))
    if conn:
        conn.close()
    return results


def summarize(rows):
    lat = sorted(r[2] for r in rows)

    def pct(p):
        return (
            round(lat[min(len(lat) - 1, int((len(lat) - 1) * p))], 2) if lat else None
        )

    return {
        "requests": len(rows),
        "statuses": dict(collections.Counter(r[1] for r in rows)),
        "error_pct": round(
            100 * sum(r[1] != "200" for r in rows) / max(1, len(rows)), 3
        ),
        "p50_ms": pct(0.5),
        "p95_ms": pct(0.95),
        "p99_ms": pct(0.99),
        "max_ms": pct(1),
    }


thread = threading.Thread(target=monitor)
thread.start()
report = {
    "domain": DOMAIN,
    "target": "127.0.0.1:443 with real hostname and TLS verification",
    "duration_per_stage_s": 15,
    "paths": PATHS,
    "same_host_generator": True,
    "stages": [],
}
try:
    for concurrency in [10, 50, 100, 200]:
        started = time.monotonic()
        deadline = started + 15
        with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
            batches = list(pool.map(lambda i: worker(i, deadline), range(concurrency)))
        elapsed = time.monotonic() - started
        rows = [r for batch in batches for r in batch]
        stage = {
            "concurrency": concurrency,
            "elapsed_s": round(elapsed, 2),
            "rps": round(len(rows) / elapsed, 2),
            **summarize(rows),
            "endpoints": {p: summarize([r for r in rows if r[0] == p]) for p in PATHS},
        }
        report["stages"].append(stage)
        (OUT / "report.json").write_text(json.dumps(report, indent=2))
        print(json.dumps(stage), flush=True)
        if stage["error_pct"] > 5:
            print("Stopped: error rate exceeded 5%", flush=True)
            break
finally:
    stop_monitor.set()
    thread.join()
print("Artifacts: " + str(OUT), flush=True)
