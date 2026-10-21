import http from 'k6/http';
import { check } from 'k6';

// Where to send traffic. Set with: -e BASE_URL=http://127.0.0.1:PORT
const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';

// Requests per second. Change with: -e PEAK_RPS=40
const WARMUP_RPS = Number(__ENV.WARMUP_RPS || 5);
const PEAK_RPS = Number(__ENV.PEAK_RPS || 80);

const TYPES = ['medical', 'fire', 'rescue', 'other'];
const LOCATIONS = [
  'Central Market', 'North Station', 'East Bridge', 'River Road',
  'Old Town', 'Airport Road', 'Lakeside', 'Hill View Colony',
  'Industrial Area', 'University Gate',
];

export const options = {
  scenarios: {
    disaster_spike: {
      executor: 'ramping-arrival-rate',
      startRate: WARMUP_RPS,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 150,
      stages: [
        { target: WARMUP_RPS, duration: '30s' }, // 1. quiet warm-up
        { target: PEAK_RPS, duration: '20s' },   // 2. sudden disaster ramp
        { target: PEAK_RPS, duration: '3m' },    // 3. sustained peak
        { target: WARMUP_RPS, duration: '10s' }, // 4. traffic drops
        { target: WARMUP_RPS, duration: '4m' },  // 5. calm, watch pods shrink
      ],
    },
  },
  // Open a fresh connection for every request. Without this, each virtual user
  // keeps one connection alive and would stay glued to the same pod, so new
  // pods created during the spike would never receive any traffic.
  noVUConnectionReuse: true,
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1000'],
    checks: ['rate>0.95'],
  },
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export default function () {
  const payload = JSON.stringify({
    type: pick(TYPES),
    location: pick(LOCATIONS),
    severity: Math.floor(Math.random() * 5) + 1, // 1 to 5
  });

  const res = http.post(`${BASE_URL}/requests`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(res, {
    'status is 201': (r) => r.status === 201,
    'response under 1000 ms': (r) => r.timings.duration < 1000,
  });
}