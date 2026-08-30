'use strict';

const crypto = require('crypto');

const COUNTRY_REGION = {
  // LG ThinQ Connect domain prefixes:
  // KIC = Asia/Pacific, AIC = Americas, EIC = Europe/Middle East/Africa.
  AU: 'kic', BD: 'kic', CN: 'kic', HK: 'kic', ID: 'kic', IN: 'kic',
  JP: 'kic', KH: 'kic', KR: 'kic', LA: 'kic', LK: 'kic', MM: 'kic',
  MY: 'kic', NP: 'kic', NZ: 'kic', PH: 'kic', SG: 'kic', TH: 'kic',
  TW: 'kic', VN: 'kic',

  AG: 'aic', AR: 'aic', AW: 'aic', BB: 'aic', BO: 'aic', BR: 'aic',
  BS: 'aic', BZ: 'aic', CA: 'aic', CL: 'aic', CO: 'aic', CR: 'aic',
  CU: 'aic', DM: 'aic', DO: 'aic', EC: 'aic', GD: 'aic', GT: 'aic',
  GY: 'aic', HN: 'aic', HT: 'aic', JM: 'aic', KN: 'aic', LC: 'aic',
  MX: 'aic', NI: 'aic', PA: 'aic', PE: 'aic', PR: 'aic', PY: 'aic',
  SR: 'aic', SV: 'aic', TT: 'aic', US: 'aic', UY: 'aic', VC: 'aic',
  VE: 'aic',

  AE: 'eic', AF: 'eic', AL: 'eic', AM: 'eic', AO: 'eic', AT: 'eic',
  AZ: 'eic', BA: 'eic', BE: 'eic', BF: 'eic', BG: 'eic', BH: 'eic',
  BJ: 'eic', BY: 'eic', CD: 'eic', CF: 'eic', CG: 'eic', CH: 'eic',
  CI: 'eic', CM: 'eic', CV: 'eic', CY: 'eic', CZ: 'eic', DE: 'eic',
  DJ: 'eic', DK: 'eic', DZ: 'eic', EE: 'eic', EG: 'eic', ES: 'eic',
  ET: 'eic', FI: 'eic', FR: 'eic', GA: 'eic', GB: 'eic', GE: 'eic',
  GH: 'eic', GM: 'eic', GN: 'eic', GQ: 'eic', GR: 'eic', HR: 'eic',
  HU: 'eic', IE: 'eic', IL: 'eic', IQ: 'eic', IR: 'eic', IS: 'eic',
  IT: 'eic', JO: 'eic', KE: 'eic', KG: 'eic', KW: 'eic', KZ: 'eic',
  LB: 'eic', LR: 'eic', LT: 'eic', LU: 'eic', LV: 'eic', LY: 'eic',
  MA: 'eic', MD: 'eic', ME: 'eic', MK: 'eic', ML: 'eic', MR: 'eic',
  MT: 'eic', MU: 'eic', MW: 'eic', NE: 'eic', NG: 'eic', NL: 'eic',
  NO: 'eic', OM: 'eic', PK: 'eic', PL: 'eic', PS: 'eic', PT: 'eic',
  QA: 'eic', RO: 'eic', RS: 'eic', RU: 'eic', RW: 'eic', SA: 'eic',
  SD: 'eic', SE: 'eic', SI: 'eic', SK: 'eic', SL: 'eic', SN: 'eic',
  SO: 'eic', ST: 'eic', SY: 'eic', TD: 'eic', TG: 'eic', TN: 'eic',
  TR: 'eic', TZ: 'eic', UA: 'eic', UG: 'eic', UZ: 'eic', XK: 'eic',
  YE: 'eic', ZA: 'eic', ZM: 'eic'
};

// Public ThinQ Connect API key from LG's Apache-2.0 SDK.
const API_KEY = 'ZkVkqP9jq44HuWkbNX9EKzZmmn7ToPY3A4vQ4tY8';

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

class ThinQConnect {
  constructor({ token, country = 'NL', clientId }) {
    if (!token) throw new Error('ThinQ Personal Access Token ontbreekt');
    this.token = token.trim();
    this.country = String(country || 'NL').toUpperCase();
    this.clientId = clientId || crypto.randomUUID();
    this.region = COUNTRY_REGION[this.country];
    if (!this.region) throw new Error(`Niet-ondersteunde ThinQ landcode: ${this.country}`);
  }

  get baseUrl() {
    return `https://api-${this.region}.lgthinq.com`;
  }

  headers(extra = {}) {
    return {
      'Authorization': `Bearer ${this.token}`,
      'x-country': this.country,
      'x-message-id': b64url(Buffer.from(crypto.randomUUID().replace(/-/g, ''), 'hex')),
      'x-client-id': this.clientId,
      'x-api-key': API_KEY,
      'x-service-phase': 'OP',
      'accept': 'application/json',
      ...extra,
    };
  }

  async request(method, endpoint, body) {
    const res = await fetch(`${this.baseUrl}/${endpoint}`, {
      method,
      headers: {
        ...this.headers(method !== 'GET' ? {'content-type': 'application/json'} : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    let payload;
    try {
      payload = await res.json();
    } catch {
      payload = { error: { message: await res.text() } };
    }

    if (!res.ok) {
      const msg = payload?.error?.message || payload?.message || `HTTP ${res.status}`;
      const err = new Error(`ThinQ API ${res.status}: ${msg}`);
      err.status = res.status;
      err.payload = payload;
      throw err;
    }
    return payload?.response ?? payload;
  }

  getDevices() {
    return this.request('GET', 'devices');
  }

  getProfile(deviceId) {
    return this.request('GET', `devices/${encodeURIComponent(deviceId)}/profile`);
  }

  getState(deviceId) {
    return this.request('GET', `devices/${encodeURIComponent(deviceId)}/state`);
  }

  control(deviceId, payload) {
    return this.request('POST', `devices/${encodeURIComponent(deviceId)}/control`, payload);
  }
}

module.exports = ThinQConnect;
