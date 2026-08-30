'use strict';

const http = require('http');
const { DateTime } = require('luxon');
const {
  recordFromLive,
  applyLearnedDurations,
  getProgramLearning,
  parseDurationMinutes,
  ensureInsightsCapabilities,
  startInsightsRecorder
} = require('../../lib/smart-wash-duration');

const SLIMLADEN_PRICES_URL = 'http://10.10.1.102:8778/api/prices';
const TURBO59_DRY_OPTIONS = ['NOT_SELECTED', 'DRYLEVEL_NORMAL'];
const FULL_DRY_OPTIONS = [
  'NOT_SELECTED',
  'NO_DRYLEVEL',
  'DRYLEVEL_NORMAL',
  'DRYLEVEL_30',
  'DRYLEVEL_60',
  'DRYLEVEL_90',
  'DRYLEVEL_120',
  'DRYLEVEL_150',
  'DRYLEVEL_ECO',
  'DRYLEVEL_VERY',
  'DRYLEVEL_IRON',
  'DRYLEVEL_LOW',
  'DRYLEVEL_ENERGY',
  'DRYLEVEL_SPEED'
];

function device(homey, id) {
  if (!id) throw new Error('Geen wasmachine geselecteerd in de widget.');
  return homey.app.getWasherDevice(id);
}

function ensureCourseOption(course, key, options, fallbackDefault = null) {
  if (!course || !Array.isArray(course.function)) return;
  let fn = course.function.find(x => x?.value === key);
  if (!fn) {
    fn = {
      value: key,
      default: fallbackDefault,
      selectable: [...options]
    };
    course.function.push(fn);
    return;
  }

  const existing = Array.isArray(fn.selectable) ? fn.selectable : [];
  fn.selectable = [...new Set([...existing, ...options])];
  if (fn.default === undefined || fn.default === null || fn.default === '') {
    fn.default = fallbackDefault;
  }
}

function patchWasherDryOptions(d) {
  const courses = d?._courses;
  if (!courses || typeof courses !== 'object') return;

  // Physical GD3V509S1 behaviour verified on the appliance:
  // Turbo Wash 59 allows drying OFF/ON, while Wash+Dry cycles through the
  // washer-dryer's complete drying choices. The LG course JSON exposes these
  // too narrowly, so widen only the Homey in-memory course model.
  if (courses.TURBO59) {
    ensureCourseOption(courses.TURBO59, 'dryLevel', TURBO59_DRY_OPTIONS, 'NOT_SELECTED');
  }
  if (courses.WASHDRY) {
    ensureCourseOption(courses.WASHDRY, 'dryLevel', FULL_DRY_OPTIONS, 'DRYLEVEL_NORMAL');
  }
  if (courses.DRYONLY) {
    ensureCourseOption(courses.DRYONLY, 'dryLevel', FULL_DRY_OPTIONS, 'DRYLEVEL_NORMAL');
  }
}

async function prepareDevice(d) {
  patchWasherDryOptions(d);
  await ensureInsightsCapabilities(d);
  startInsightsRecorder(d);
  return d;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function enrichLive(d, live) {
  const totalMinutes = parseDurationMinutes(live?.total || d.getCapabilityValue('lg_total'));
  const remainingMinutes = parseDurationMinutes(live?.remaining || d.getCapabilityValue('lg_remaining'));
  const progressPercent = Number.isFinite(totalMinutes) && totalMinutes > 0 && Number.isFinite(remainingMinutes)
    ? Math.max(0, Math.min(100, Math.round(((totalMinutes - remainingMinutes) / totalMinutes) * 100)))
    : null;
  const programId = live?.currentProgramId || d._lastProgram || d.getStoreValue('selected_program_id') || null;
  const learnedDuration = getProgramLearning(d, programId);
  const plan = d.getStoreValue('smart_wash_plan') || null;
  const actualCycleDuration = Number(d.getCapabilityValue('lg_actual_cycle_duration'));

  return {
    ...live,
    totalMinutes: Number.isFinite(totalMinutes) ? totalMinutes : null,
    remainingMinutes: Number.isFinite(remainingMinutes) ? remainingMinutes : null,
    progressPercent,
    learnedDuration,
    recentDurations: learnedDuration?.samples?.slice(-5).reverse().map(sample => ({
      minutes: Number(sample.minutes),
      actualMinutes: Number.isFinite(Number(sample.actualMinutes)) ? Number(sample.actualMinutes) : null,
      at: sample.at || null
    })) || [],
    actualCycleDuration: Number.isFinite(actualCycleDuration) ? actualCycleDuration : null,
    planDurationMinutes: Number.isFinite(Number(plan?.durationMinutes)) ? Number(plan.durationMinutes) : null,
    plannedAveragePrice: Number.isFinite(Number(plan?.averagePrice)) ? Number(plan.averagePrice) : null
  };
}

function averagePriceForWindow(slots, startMs, endMs) {
  const start = Number(startMs);
  const end = Number(endMs);
  if (!Array.isArray(slots) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  let cursor = start;
  let weighted = 0;
  let covered = 0;

  for (const slot of slots) {
    const slotStart = Number(slot.start);
    const slotEnd = Number(slot.end);
    if (!Number.isFinite(slotStart) || !Number.isFinite(slotEnd)) continue;
    if (slotEnd <= cursor) continue;
    if (slotStart >= end) break;
    if (slotStart > cursor + 1000) break;

    const segStart = Math.max(cursor, slotStart);
    const segEnd = Math.min(end, slotEnd);
    if (segEnd > segStart) {
      const ms = segEnd - segStart;
      weighted += Number(slot.price) * ms;
      covered += ms;
      cursor = segEnd;
    }
    if (cursor >= end) break;
  }

  return covered >= (end - start) - 1000 ? weighted / covered : null;
}

function httpGetJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`ongeldige JSON: ${err.message}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout na ${timeoutMs} ms`)));
    req.on('error', reject);
  });
}

async function getSlimLadenPricesForDate(app, date) {
  const zone = 'Europe/Amsterdam';
  const now = DateTime.now().setZone(zone);
  const today = now.toISODate();
  const tomorrow = now.plus({ days: 1 }).toISODate();
  let dayLabel;

  if (date === today) dayLabel = 'today';
  else if (date === tomorrow) dayLabel = 'tomorrow';
  else throw new Error(`SlimLaden fallback ondersteunt alleen vandaag en morgen; gevraagd=${date}.`);

  app.log(`SlimLaden fallback: ${SLIMLADEN_PRICES_URL} ophalen voor ${date} (${dayLabel}).`);
  const raw = await httpGetJson(SLIMLADEN_PRICES_URL);
  if (!Array.isArray(raw)) throw new Error('SlimLaden /api/prices gaf geen array terug.');

  const rows = raw.filter(row => row?.day === dayLabel);
  const slots = rows.map(row => {
    const price = Number(row?.price);
    const time = String(row?.time || '');
    const match = time.match(/^(\d{2}):(\d{2})$/);
    if (!match || !Number.isFinite(price)) return null;

    const start = DateTime.fromISO(`${date}T${time}:00`, { zone });
    if (!start.isValid) return null;
    const end = start.plus({ minutes: 15 });
    return {
      start: start.toMillis(),
      end: end.toMillis(),
      price,
      marketPrice: null,
      priceField: 'slimladenFallback'
    };
  }).filter(Boolean).sort((a, b) => a.start - b.start);

  if (!slots.length) throw new Error(`SlimLaden heeft geen prijsdata voor ${date}.`);
  app.log(`SlimLaden fallback ${date}: ${slots.length} prijspunten ontvangen (15 min, EUR/kWh, all-in).`);
  return slots;
}

async function getPriceDayWithFallback(app, date) {
  try {
    app.log(`Homey Energy planning: prijsdata ${date} ophalen.`);
    const prices = await app.getHomeyEnergyPrices(date);
    if (Array.isArray(prices) && prices.length) return prices;
    throw new Error('lege prijsrespons');
  } catch (homeyErr) {
    app.log(`Homey Energy ${date} niet beschikbaar (${homeyErr?.message || homeyErr}); SlimLaden fallback proberen.`);
    try {
      return await getSlimLadenPricesForDate(app, date);
    } catch (fallbackErr) {
      throw new Error(
        `prijsdata voor ${date} ontbreekt. Homey Energy: ${homeyErr?.message || homeyErr}; ` +
        `SlimLaden fallback: ${fallbackErr?.message || fallbackErr}`
      );
    }
  }
}

async function getCompleteEnergyPriceWindow(app, fromMs, untilMs) {
  const from = Number(fromMs);
  const until = Number(untilMs);
  if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) {
    throw new Error('Ongeldige periode voor Homey Energy-prijzen.');
  }

  const zone = 'Europe/Amsterdam';
  const firstDay = DateTime.fromMillis(from, { zone }).startOf('day');
  const lastDay = DateTime.fromMillis(until, { zone }).startOf('day');
  const days = [];

  for (
    let day = firstDay;
    day.toMillis() <= lastDay.toMillis() && days.length < 4;
    day = day.plus({ days: 1 })
  ) {
    days.push(day.toISODate());
  }

  app.log(
    `Homey Energy planning: van=${DateTime.fromMillis(from, { zone }).toFormat('dd-LL HH:mm')} ` +
    `tot=${DateTime.fromMillis(until, { zone }).toFormat('dd-LL HH:mm')}; dagen=${days.join(',')}`
  );

  const merged = [];
  for (const date of days) {
    let prices;
    try {
      prices = await getPriceDayWithFallback(app, date);
    } catch (err) {
      const message = `Energieprijzen voor ${date} ontbreken: ${err?.message || err}`;
      app.error(`Slim Wassen planning: ${message}`);
      throw new Error(message);
    }
    merged.push(...prices);
  }

  const byStart = new Map();
  for (const p of merged) {
    if (Number.isFinite(Number(p?.start)) && Number.isFinite(Number(p?.end)) && Number.isFinite(Number(p?.price))) {
      byStart.set(Number(p.start), p);
    }
  }

  const slots = [...byStart.values()]
    .filter(p => Number(p.end) > from && Number(p.start) < until)
    .sort((a, b) => Number(a.start) - Number(b.start));

  if (!slots.length) throw new Error('Geen energieprijzen beschikbaar in deze periode.');

  let cursor = from;
  for (const slot of slots) {
    const slotStart = Number(slot.start);
    const slotEnd = Number(slot.end);
    if (slotEnd <= cursor) continue;
    if (slotStart > cursor + 1000) {
      const missingFrom = DateTime.fromMillis(cursor, { zone }).toFormat('dd-LL HH:mm');
      const missingTo = DateTime.fromMillis(slotStart, { zone }).toFormat('dd-LL HH:mm');
      throw new Error(`Prijsdata is niet compleet tussen ${missingFrom} en ${missingTo}. Er wordt niet gepland met onvolledige prijzen.`);
    }
    cursor = Math.max(cursor, slotEnd);
    if (cursor >= until - 1000) break;
  }

  if (cursor < until - 1000) {
    const availableUntil = DateTime.fromMillis(cursor, { zone }).toFormat('dd-LL HH:mm');
    const wantedUntil = DateTime.fromMillis(until, { zone }).toFormat('dd-LL HH:mm');
    throw new Error(`Energieprijzen zijn beschikbaar tot ${availableUntil}, maar de deadline is ${wantedUntil}. Wacht tot alle prijzen beschikbaar zijn.`);
  }

  const homeyCount = slots.filter(s => s.priceField !== 'slimladenFallback').length;
  const fallbackCount = slots.filter(s => s.priceField === 'slimladenFallback').length;
  app.log(
    `Slim Wassen prijsvenster: ${slots.length} bruikbare prijspunten ` +
    `(Homey Energy=${homeyCount}, SlimLaden fallback=${fallbackCount}).`
  );
  return slots;
}

async function calculateCompleteCheapestWindow(app, { earliestMs, deadlineMs, durationMinutes }) {
  const now = Date.now();
  const earliest = Math.max(Number(earliestMs) || now, now);
  const deadline = Number(deadlineMs);
  const duration = Math.max(15, Number(durationMinutes) || 120);
  const durationMs = duration * 60000;

  if (!Number.isFinite(deadline) || deadline <= earliest + durationMs) {
    throw new Error('De eindtijd ligt te vroeg voor de gekozen programmaduur.');
  }

  const slots = await getCompleteEnergyPriceWindow(app, earliest, deadline);
  const starts = [earliest, ...slots.map(s => Number(s.start)).filter(t => t > earliest)];
  const candidates = [];
  const seen = new Set();

  for (const start of starts) {
    if (seen.has(start)) continue;
    seen.add(start);
    const finish = start + durationMs;
    if (finish > deadline) continue;
    const averagePrice = averagePriceForWindow(slots, start, finish);
    if (!Number.isFinite(averagePrice)) continue;
    candidates.push({
      start,
      end: finish,
      averagePrice,
      durationMinutes: Math.round(duration)
    });
  }

  if (!candidates.length) {
    throw new Error('Geen aaneengesloten prijsperiode gevonden die lang genoeg is.');
  }

  candidates.sort((a, b) => a.averagePrice - b.averagePrice || a.start - b.start);
  app.log(
    `Slim Wassen planning: ${candidates.length} kandidaten; goedkoopste=` +
    `${DateTime.fromMillis(candidates[0].start, { zone: 'Europe/Amsterdam' }).toFormat('dd-LL HH:mm')} ` +
    `@ ${Number(candidates[0].averagePrice).toFixed(4)} EUR/kWh.`
  );

  return {
    best: candidates[0],
    alternatives: candidates.slice(1, 5),
    slots: slots.map(s => ({
      start: Number(s.start),
      end: Number(s.end),
      price: Number(s.price),
      marketPrice: Number.isFinite(Number(s.marketPrice)) ? Number(s.marketPrice) : null,
      priceField: s.priceField
    }))
  };
}

async function getReadyWidgetState(d) {
  patchWasherDryOptions(d);
  let state = d.getWidgetState();
  if (Array.isArray(state?.programs) && state.programs.length) {
    const live = d.getWidgetLiveStatus();
    await recordFromLive(d, live).catch(() => {});
    return { ...applyLearnedDurations(d, state), ...enrichLive(d, live) };
  }

  for (let i = 0; i < 6; i++) {
    await sleep(250);
    patchWasherDryOptions(d);
    state = d.getWidgetState();
    if (Array.isArray(state?.programs) && state.programs.length) {
      const live = d.getWidgetLiveStatus();
      await recordFromLive(d, live).catch(() => {});
      return { ...applyLearnedDurations(d, state), ...enrichLive(d, live) };
    }
  }

  await d.refreshThinQ2().catch(() => {});
  patchWasherDryOptions(d);
  state = d.getWidgetState();
  const live = d.getWidgetLiveStatus();
  await recordFromLive(d, live).catch(() => {});
  return { ...applyLearnedDurations(d, state), ...enrichLive(d, live) };
}

module.exports = {
  async getState({ homey, query }) {
    const d = await prepareDevice(device(homey, query.deviceId));
    return getReadyWidgetState(d);
  },

  async getLiveStatus({ homey, query }) {
    const d = await prepareDevice(device(homey, query.deviceId));
    const live = d.getWidgetLiveStatus();
    await recordFromLive(d, live).catch(() => {});
    return enrichLive(d, live);
  },

  async previewPlan({ homey, body }) {
    const d = await prepareDevice(device(homey, body.deviceId));
    let result;
    try {
      result = await calculateCompleteCheapestWindow(homey.app, {
        earliestMs: body.earliestMs,
        deadlineMs: body.deadlineMs,
        durationMinutes: body.durationMinutes
      });
    } catch (err) {
      homey.app.error(`Slim Wassen preview mislukt: ${err?.message || err}`);
      throw err;
    }

    const durationMs = Number(result?.best?.durationMinutes || body.durationMinutes) * 60000;
    const directStart = Math.max(Date.now(), Number(body.earliestMs) || Date.now());
    const directAveragePrice = averagePriceForWindow(result.slots, directStart, directStart + durationMs);
    const smartAveragePrice = Number(result?.best?.averagePrice);
    const savingsPerKwh = Number.isFinite(directAveragePrice) && Number.isFinite(smartAveragePrice)
      ? Math.max(0, directAveragePrice - smartAveragePrice)
      : null;

    return {
      ...result,
      directAveragePrice,
      savingsPerKwh,
      savingsPercent: Number.isFinite(savingsPerKwh) && directAveragePrice > 0
        ? Math.round((savingsPerKwh / directAveragePrice) * 100)
        : null,
      state: applyLearnedDurations(d, d.getWidgetState())
    };
  },

  async savePlan({ homey, body }) {
    const d = await prepareDevice(device(homey, body.deviceId));
    // Keep the verified complete-horizon result fixed. The device-level legacy
    // replanner still uses the older app-level routine until that is migrated.
    return d.setSmartWashPlan({ ...body.plan, autoReplan: false });
  },

  async cancelPlan({ homey, query }) {
    const d = await prepareDevice(device(homey, query.deviceId));
    return d.cancelSmartWashPlan();
  },

  async startNow({ homey, body }) {
    const d = await prepareDevice(device(homey, body.deviceId));
    if (d.getCapabilityValue('lg_remote_control') !== true) {
      throw new Error('Remote Start is niet actief. Zet Remote Start eerst op de wasmachine aan.');
    }
    homey.setTimeout(async () => {
      try {
        const result = await d.startWasherSingleFlight(body.config || {}, 'smart-wash-widget');
        homey.api.realtime('smart_wash_start_result', {
          deviceId: body.deviceId,
          ok: result.accepted || result.duplicate,
          duplicate: !!result.duplicate,
          message: result.message
        }).catch(() => {});
      } catch (err) {
        d.error('Widget direct starten mislukt:', err);
        homey.api.realtime('smart_wash_start_result', {
          deviceId: body.deviceId,
          ok: false,
          message: String(err?.message || err)
        }).catch(() => {});
      }
    }, 10);
    return { accepted:true, message:'Startopdracht geaccepteerd' };
  },

  async wake({ homey, body }) {
    const d = await prepareDevice(device(homey, body.deviceId));
    await d.wakeupWasher();
    return applyLearnedDurations(d, d.getWidgetState());
  }
};