'use strict';

const https = require('https');

function requestJson(url, headers = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      headers,
      timeout: timeoutMs,
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Nord Pool API HTTP ${res.statusCode}.`));
          return;
        }
        try { resolve(raw ? JSON.parse(raw) : {}); }
        catch (err) { reject(new Error('Nord Pool gaf ongeldige JSON terug.')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Nord Pool API timeout.')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * Official Nord Pool Market Data API client shell.
 * Nord Pool publishes official day-ahead prices in 15-minute intervals, but
 * API access is customer/authentication based. We therefore require an API URL
 * and token from the user's Nord Pool account and never scrape the website.
 *
 * Response-field mapping stays disabled until we have captured one real API
 * response. That avoids silently choosing a wrong price/currency field.
 */
async function getQuarterHourlyPrices({ token, apiUrl, area = 'NL' } = {}) {
  if (!token || !String(token).trim()) throw new Error('Nord Pool API-token ontbreekt.');
  if (!apiUrl || !String(apiUrl).trim()) {
    throw new Error('Nord Pool API-URL ontbreekt. Gebruik de Market Data API-URL uit je Nord Pool account.');
  }

  const url = new URL(String(apiUrl).trim());
  if (!url.searchParams.has('area')) url.searchParams.set('area', area || 'NL');

  const data = await requestJson(url.toString(), {
    Authorization: `Bearer ${String(token).trim()}`,
    Accept: 'application/json',
    'User-Agent': 'Homey-LG-ThinQ',
  });

  return {
    provider: 'nordpool',
    area: area || 'NL',
    raw: data,
    prices: [],
    intervalMinutes: 15,
    mappingPending: true,
  };
}

async function testConnection(options) {
  const result = await getQuarterHourlyPrices(options);
  return { ok: true, provider: result.provider, area: result.area, mappingPending: true };
}

module.exports = { getQuarterHourlyPrices, testConnection };
