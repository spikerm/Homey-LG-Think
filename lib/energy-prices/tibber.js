'use strict';

const https = require('https');

const ENDPOINT = 'https://api.tibber.com/v1-beta/gql';

function postJson(url, headers, body, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = JSON.stringify(body);
    const req = https.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
      timeout: timeoutMs,
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = raw ? JSON.parse(raw) : {}; }
        catch (err) { return reject(new Error(`Tibber gaf ongeldige JSON terug (HTTP ${res.statusCode}).`)); }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Tibber API HTTP ${res.statusCode}.`));
        }
        resolve(parsed);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tibber API timeout.')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function normalizePrice(p) {
  if (!p || !p.startsAt || !Number.isFinite(Number(p.total))) return null;
  const startMs = Date.parse(p.startsAt);
  if (!Number.isFinite(startMs)) return null;
  return {
    start: new Date(startMs),
    end: new Date(startMs + 15 * 60 * 1000),
    price: Number(p.total),
    energy: p.energy == null ? null : Number(p.energy),
    tax: p.tax == null ? null : Number(p.tax),
    currency: p.currency || 'EUR',
    intervalMinutes: 15,
    priceField: 'total',
    priceType: 'tibber_total',
    source: 'tibber',
  };
}

async function getQuarterHourlyPrices({ token, homeId = null }) {
  if (!token || !String(token).trim()) throw new Error('Tibber API-token ontbreekt.');

  const query = `query HomeyLgThinQPrices {
    viewer {
      homes {
        id
        address { address1 city postalCode }
        currentSubscription {
          priceInfo(resolution: QUARTER_HOURLY) {
            current { total energy tax startsAt currency level }
            today { total energy tax startsAt currency level }
            tomorrow { total energy tax startsAt currency level }
          }
        }
      }
    }
  }`;

  const result = await postJson(ENDPOINT, {
    Authorization: `Bearer ${String(token).trim()}`,
    'User-Agent': 'Homey-LG-ThinQ',
  }, { query });

  if (Array.isArray(result.errors) && result.errors.length) {
    throw new Error(`Tibber API: ${result.errors.map(e => e.message).join('; ')}`);
  }

  const homes = result?.data?.viewer?.homes || [];
  if (!homes.length) throw new Error('Geen Tibber Home gevonden voor deze API-token.');
  const home = homeId ? homes.find(h => h.id === homeId) : homes[0];
  if (!home) throw new Error('De ingestelde Tibber Home is niet gevonden.');

  const info = home?.currentSubscription?.priceInfo;
  if (!info) throw new Error('Geen Tibber prijsinformatie beschikbaar voor deze Home.');

  const prices = [...(info.today || []), ...(info.tomorrow || [])]
    .map(normalizePrice)
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  if (!prices.length) throw new Error('Tibber gaf geen kwartierprijzen terug.');

  return {
    provider: 'tibber',
    home: { id: home.id, address: home.address || null },
    intervalMinutes: 15,
    prices,
  };
}

async function testConnection(options) {
  const result = await getQuarterHourlyPrices(options);
  return {
    ok: true,
    provider: result.provider,
    home: result.home,
    points: result.prices.length,
    first: result.prices[0]?.start?.toISOString() || null,
    last: result.prices[result.prices.length - 1]?.start?.toISOString() || null,
  };
}

module.exports = { getQuarterHourlyPrices, testConnection };
