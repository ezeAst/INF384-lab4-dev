import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = (__ENV.BASE_URL || '').replace(/\/$/, '');
const SLO_P95 = Number(__ENV.SLO_P95 || 500);
const USUARIOS = ['ana', 'beto', 'carla', 'diego', 'elena'];

http.setResponseCallback(http.expectedStatuses(200));

export const options = {
  stages: [
    { duration: '1m', target: 30 },
    { duration: '10m', target: 30 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: [`p(95)<${SLO_P95}`],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

function par() {
  const i = Math.floor(Math.random() * USUARIOS.length);
  const j = (i + 1 + Math.floor(Math.random() * (USUARIOS.length - 1))) % USUARIOS.length;
  return [USUARIOS[i], USUARIOS[j]];
}

export default function () {
  const [origen, destino] = par();

  const t = http.post(
    `${BASE}/transferir`,
    JSON.stringify({ origen, destino, monto: 1 }),
    { headers: { 'content-type': 'application/json' }, tags: { endpoint: 'transferir' } },
  );
  check(t, { 'transferir 200': (r) => r.status === 200 });

  const s = http.get(`${BASE}/saldo/${origen}`, { tags: { endpoint: 'saldo' } });
  check(s, { 'saldo 200': (r) => r.status === 200 });

  sleep(1);
}
