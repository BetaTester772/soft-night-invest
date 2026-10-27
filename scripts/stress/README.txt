Booth stress test (adapted from /home/ubuntu/stress-test)

The test uses the current production images but a separate Compose project,
network, PostgreSQL database and volumes. It does not use production credentials.
Set STRESS_BACKEND_IMAGE in test.env to compare a separately built backend image.
Prerequisite: scripts/stress/test.env with test-only database credentials,
COMPOSE_PROJECT_NAME=soft-night-stress, booth mode, scheduler enabled and
an app clock inside an open booth round. Keep time_scale=1 so the market
remains open throughout the run. Reinitialize test data before changing the date.

docker compose --env-file scripts/stress/test.env -p soft-night-stress -f docker-compose.yml -f scripts/stress/compose.yml up -d --no-build --wait
python3 scripts/stress/run.py smoke
python3 scripts/stress/run.py ramp

smoke: 5 virtual users for 30 seconds.
ramp: 25, 50, 100, 150, 200, 300, 400 virtual users at one-minute intervals,
then 30 seconds ramp-down. Users join once, poll state, alternate buy/sell
of one FEED share, and wait 1–3 seconds between iterations.
Failures >5%, p95 >3 seconds or correctness checks below 99% abort the run
(after the first 30 seconds). Five consecutive production health failures
or probes over one second stop the load generator.

Test backend: one CPU; generator: 0.6 CPU. Both run on the same host as
production, so this measures that constrained setup, not an isolated machine.
The k6 requests use internal HTTP to the test frontend; they exclude public
DNS, internet latency and the domain Caddy TLS hop. Separate HTTPS read tests
are recorded by scripts/stress_read.py. Concurrency is not requests/second.

Results: artifacts/k6-<profile>-<timestamp>/{summary.json,k6.log,production.jsonl,stats.jsonl}
Stop test containers after testing (preserves test volumes):
docker compose --env-file scripts/stress/test.env -p soft-night-stress -f docker-compose.yml -f scripts/stress/compose.yml down
