'use strict';

const http = require('http');
const { DateTime } = require('luxon');
const { tibber } = require('./index');

const ZONE = 'Europe/Amsterdam';
const SLOT_MS = 15 * 60 * 1000;
const MIN_START_AHEAD_MS = 5 * 60 * 1000;
const DEFAULT_SLIMLADEN_URL = 'http://10.10.1.102:8778/api/prices';

function setting(app, key, fallback = '') {
  try {
    const value = app?.homey?.settings?.get(key);
    return value === undefined || value === null || value === '' ? fallback : value;
  } catch (err) {
    return fallback;
  }
}

function ceilQuarter(ms) {
  return Math.ceil(Number(ms) / SLOT_MS) * SLOT_MS;
}

function minimumPlanningStart(earliestMs = null) {
  const now = Date.now();
  const requested = Number.isFinite(Number(earliestMs)) ? Number(earliestMs) : now;
  return ceilQuarter(Math.max(requested, now + MIN_START_AHEAD_MS));
}

function httpGetJson(url, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 250)}`));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch (err) { reject(new Error(`ongeldige JSON: ${err.message}`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout na ${timeoutMs} ms`)));
    req.on('error', reject);
  });
}

function normalizeSlots(slots, source) {
  return (slots || []).map(p => {
    const start = p?.start instanceof Date ? p.start.getTime() : Number(p?.start);
    const end = p?.end instanceof Date ? p.end.getTime() : Number(p?.end);
    const price = Number(p?.price);
    if (!Number.isFinite(start) || !Number.isFinite(price)) return null;
    return {
      ...p,
      start,
      end: Number.isFinite(end) ? end : start + SLOT_MS,
      price,
      source: p?.source || source,
    };
  }).filter(Boolean).sort((a, b) => a.start - b.start);
}

function daysForWindow(from, until) {
  const first = DateTime.fromMillis(from, { zone: ZONE }).startOf('day');
  const last = DateTime.fromMillis(until, { zone: ZONE }).startOf('day');
  const days = [];
  for (let day = first; day.toMillis() <= last.toMillis() && days.length < 4; day = day.plus({ days: 1 })) {
    days.push(day.toISODate());
  }
  return days;
}

async function homeySlots(app, from, until) {
  const merged = [];
  for (const date of daysForWindow(from, until)) {
    app.log(`Prijsprovider Homey Energy: ${date} ophalen.`);
    const prices = await app.getHomeyEnergyPrices(date);
    if (!Array.isArray(prices) || !prices.length) throw new Error(`Homey Energy gaf geen prijzen voor ${date}.`);
    merged.push(...prices);
  }
  return normalizeSlots(merged, 'homey-energy');
}

async function tibberSlots(app) {
  const token = String(setting(app, 'tibber_api_token', '')).trim();
  if (!token) throw new Error('Tibber API-token is niet ingesteld.');
  const homeId = String(setting(app, 'tibber_home_id', '')).trim() || null;
  app.log('Prijsprovider Tibber: kwartierprijzen ophalen.');
  const result = await tibber.getQuarterHourlyPrices({ token, homeId });
  const slots = normalizeSlots(result?.prices, 'tibber');
  app.log(`Prijsprovider Tibber: ${slots.length} kwartierprijzen ontvangen.`);
  return slots;
}

async function slimLadenSlots(app, from, until) {
  const url = String(setting(app, 'slimladen_prices_url', DEFAULT_SLIMLADEN_URL)).trim();
  if (!url) throw new Error('SlimLaden prijs-URL ontbreekt.');
  app.log(`Prijsprovider SlimLaden: ${url} ophalen.`);
  const raw = await httpGetJson(url);
  if (!Array.isArray(raw)) throw new Error('SlimLaden /api/prices gaf geen array terug.');

  const now = DateTime.now().setZone(ZONE);
  const mapping = new Map([
    ['today', now.toISODate()],
    ['tomorrow', now.plus({ days: 1 }).toISODate()],
  ]);

  const slots = raw.map(row => {
    const date = mapping.get(String(row?.day || '').toLowerCase());
    const time = String(row?.time || '');
    const price = Number(row?.price);
    if (!date || !/^\d{2}:\d{2}$/.test(time) || !Number.isFinite(price)) return null;
    const start = DateTime.fromISO(`${date}T${time}:00`, { zone: ZONE });
    if (!start.isValid) return null;
    return {
      start: start.toMillis(),
      end: start.plus({ minutes: 15 }).toMillis(),
      price,
      priceField: 'slimladen_all_in',
      source: 'slimladen',
    };
  }).filter(Boolean);

  const normalized = normalizeSlots(slots, 'slimladen');
  if (!normalized.length) throw new Error('SlimLaden gaf geen bruikbare kwartierprijzen terug.');
  return normalized;
}

function assertComplete(slots, from, until, provider) {
  const useful = normalizeSlots(slots, provider)
    .filter(p => p.end > from && p.start < until)
    .sort((a, b) => a.start - b.start);
  if (!useful.length) throw new Error(`${provider}: geen prijzen in het gevraagde tijdvenster.`);

  let cursor = from;
  for (const slot of useful) {
    if (slot.end <= cursor) continue;
    if (slot.start > cursor + 1000) {
      const a = DateTime.fromMillis(cursor, { zone: ZONE }).toFormat('dd-LL HH:mm');
      const b = DateTime.fromMillis(slot.start, { zone: ZONE }).toFormat('dd-LL HH:mm');
      throw new Error(`${provider}: prijsdata ontbreekt tussen ${a} en ${b}.`);
    }
    cursor = Math.max(cursor, slot.end);
    if (cursor >= until - 1000) break;
  }
  if (cursor < until - 1000) {
    const a = DateTime.fromMillis(cursor, { zone: ZONE }).toFormat('dd-LL HH:mm');
    const b = DateTime.fromMillis(until, { zone: ZONE }).toFormat('dd-LL HH:mm');
    throw new Error(`${provider}: prijzen beschikbaar tot ${a}, nodig tot ${b}.`);
  }
  return useful;
}

async function getCompleteWindow(app, from, until) {
  const configured = String(setting(app, 'energy_price_provider', 'auto')).trim() || 'auto';
  let order;
  if (configured === 'auto') order = ['homey-energy', 'tibber', 'slimladen'];
  else order = [configured];

  const errors = [];
  for (const provider of order) {
    try {
      let slots;
      if (provider === 'homey-energy') slots = await homeySlots(app, from, until);
      else if (provider === 'tibber') slots = await tibberSlots(app);
      else if (provider === 'slimladen') slots = await slimLadenSlots(app, from, until);
      else if (provider === 'nordpool') throw new Error('Nord Pool is ingesteld maar de officiële Market Data API-koppeling is nog niet geconfigureerd.');
      else throw new Error(`Onbekende prijsprovider: ${provider}.`);

      const complete = assertComplete(slots, from, until, provider);
      app.log(`Slim Wassen prijsprovider gekozen: ${provider} (${complete.length} bruikbare punten).`);
      return { provider, slots: complete };
    } catch (err) {
      errors.push(`${provider}: ${err?.message || err}`);
      app.log(`Prijsprovider ${provider} niet bruikbaar: ${err?.message || err}`);
      if (configured !== 'auto') break;
    }
  }
  throw new Error(`Geen complete energieprijsbron beschikbaar. ${errors.join(' | ')}`);
}

function averagePriceForWindow(slots, startMs, endMs) {
  const start = Number(startMs);
  const end = Number(endMs);
  if (!Array.isArray(slots) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  let cursor = start;
  let weighted = 0;
  let covered = 0;
  for (const slot of slots) {
    if (slot.end <= cursor) continue;
    if (slot.start >= end) break;
    if (slot.start > cursor + 1000) break;
    const a = Math.max(cursor, slot.start);
    const b = Math.min(end, slot.end);
    if (b > a) {
      const ms = b - a;
      weighted += Number(slot.price) * ms;
      covered += ms;
      cursor = b;
    }
    if (cursor >= end) break;
  }
  return covered >= (end - start) - 1000 ? weighted / covered : null;
}

async function calculate(app, { earliestMs, deadlineMs, durationMinutes }) {
  const earliest = minimumPlanningStart(earliestMs);
  const deadline = Number(deadlineMs);
  const duration = Math.max(15, Number(durationMinutes) || 120);
  const durationMs = duration * 60000;
  if (!Number.isFinite(deadline) || deadline <= earliest + durationMs) {
    throw new Error('De eindtijd ligt te vroeg voor de gekozen programmaduur en minimale startmarge.');
  }

  app.log(`Slim Wassen minimale start: ${DateTime.fromMillis(earliest, { zone: ZONE }).toFormat('dd-LL HH:mm')} (minimaal 5 min vooruit, afgerond op kwartier).`);
  const { provider, slots } = await getCompleteWindow(app, earliest, deadline);
  const starts = slots.map(s => s.start).filter(t => t >= earliest);
  const candidates = [];
  for (const start of [...new Set(starts)]) {
    const end = start + durationMs;
    if (end > deadline) continue;
    const averagePrice = averagePriceForWindow(slots, start, end);
    if (!Number.isFinite(averagePrice)) continue;
    candidates.push({ start, end, averagePrice, durationMinutes: Math.round(duration) });
  }
  if (!candidates.length) throw new Error('Geen geldig toekomstig kwartier gevonden dat vóór de deadline klaar is.');
  candidates.sort((a, b) => a.averagePrice - b.averagePrice || a.start - b.start);
  app.log(`Slim Wassen planning: ${candidates.length} kandidaten via ${provider}; goedkoopste=${DateTime.fromMillis(candidates[0].start, { zone: ZONE }).toFormat('dd-LL HH:mm')} @ ${candidates[0].averagePrice.toFixed(4)} EUR/kWh.`);

  return {
    provider,
    earliestStart: earliest,
    best: candidates[0],
    alternatives: candidates.slice(1, 5),
    slots: slots.map(s => ({ start: s.start, end: s.end, price: s.price, source: s.source || provider, priceField: s.priceField || null })),
  };
}

module.exports = {
  MIN_START_AHEAD_MS,
  minimumPlanningStart,
  averagePriceForWindow,
  getCompleteWindow,
  calculate,
};
