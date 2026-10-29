// Adapted from ~/stress-test/load.js for the current booth APIs.
// Only run on the isolated soft-night-stress stack.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
const BASE = __ENV.BASE || 'http://frontend';
if (BASE !== 'http://frontend') throw new Error('Isolated stack only');
const PROFILE = __ENV.PROFILE || 'smoke';
const unexpected = new Counter('unexpected_status');
const filled = new Counter('filled_orders');
const profiles = {
  smoke: { executor: 'constant-vus', vus: 5, duration: '30s' },
  ramp: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '1m', target: 25 },
      { duration: '1m', target: 50 },
      { duration: '1m', target: 100 },
      { duration: '1m', target: 150 },
      { duration: '1m', target: 200 },
      { duration: '1m', target: 300 },
      { duration: '1m', target: 400 },
      { duration: '30s', target: 0 },
    ],
    gracefulRampDown: '10s',
  },
};

export const options = {
  scenarios: { users: profiles[PROFILE] },
  thresholds: {
    checks: [{ threshold: 'rate>0.99', abortOnFail: true, delayAbortEval: '30s' }],
    // 한계: 실패율 5% 또는 p95 3초를 넘으면 (30초 유예 뒤) 중단
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' }],
    http_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: true, delayAbortEval: '30s' }],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};


let token = null;
let sequence = 0;
let holding = false;
function expect(r, status) {
  const good = check(r, { [`${r.request.method} ${r.url.replace(BASE, '').split('?')[0]} ${status}`]: x => x.status === status });
  if (!good) unexpected.add(1, { status: String(r.status) });
  return good;
}
export default function () {
  const headers = {'Content-Type': 'application/json'};
  if (!token) {
    const member = http.post(BASE + '/api/auth/register', JSON.stringify({
      email: `stress${__ENV.RUN_ID}_${__VU}@g.skku.edu`,
      name: '부하검사 참가자', student_id: String(__VU).padStart(10, '0'),
      department: '소프트웨어학과', nickname: `stress${__ENV.RUN_ID}_${__VU}`,
      password: 'tiger-moon-river-42', privacy_consent: true,
    }), {headers});
    if (!expect(member, 201)) { sleep(1); return; }
    const r = http.post(BASE + '/api/booth/session', null, {
      headers: {...headers, Authorization: `Bearer ${member.json('token')}`},
    });
    if (!expect(r, 200)) { sleep(1); return; }
    token = r.json('token');
  }
  headers.Authorization = `Bearer ${token}`;
  expect(http.get(BASE + '/api/booth/state?round_id=1', {headers}), 200);
  const r = http.post(BASE + '/api/booth/orders', JSON.stringify({round_id:1, request_id:`stress_${__ENV.RUN_ID}_${__VU}_${++sequence}`, kind:'stock', code:'FEED', side:holding?'sell':'buy', quantity:1}), {headers});
  if (expect(r, 201)) {
    const good = check(r, {'order filled': x => x.json('order.kind') === 'stock' && x.json('order.code') === 'FEED' && x.json('order.quantity') === 1 && x.json('order.side') === (holding ? 'sell' : 'buy')});
    if (good) { holding = !holding; filled.add(1); }
    else unexpected.add(1, {status:'order_rejected'});
  }
  if (Math.random() < 0.3) expect(http.get(BASE + '/api/booth/state?round_id=1'), 200);
  sleep(1 + Math.random() * 2);
}
