'use strict';

const { DateTime } = require('luxon');
const {
  recordFromLive,
  applyLearnedDurations,
  getProgramLearning,
  parseDurationMinutes,
  ensureInsightsCapabilities,
  startInsightsRecorder
} = require('../../lib/smart-wash-duration');

function device(homey, id) {
  if (!id) throw new Error('Geen wasmachine geselecteerd in de widget.');
  return homey.app.getWasherDevice(id);
}

async function prepareDevice(d) {
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

async function getCompleteEnergyPriceWindow(app, fromMs, untilMs) {
  const start = DateTime.fromMillis(Number(fromMs));
  const end = DateTime.fromMillis(Number(untilMs));
  const days = [];
  let day = start.startOf('day');
  const last = end.startOf('day');

  while (day <= last && days.length < 4) {
    days.push(day.toISODate());
    day = day.plus({ days: 1 });
  }

  const merged = [];
  for (const date of days) {
    let prices;
    try {
      prices = await app.getHomeyEnergyPrices(date);
    } catch (err) {
      throw new Error(`Homey Energy-prijzen voor ${date} ontbreken: ${err?.message || err}`);
    }
    if (!Array.isArray(prices) || !prices.length) {
      throw new Error(`Homey Energy heeft nog geen prijsdata voor ${date}. Probeer het later opnieuw.`);
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
    .filter(p => Number(p.end) > Number(fromMs) && Number(p.start) < Number(untilMs))
    .sort((a, b) => Number(a.start) - Number(b.start));

  if (!slots.length) throw new Error('Geen Homey Energy-prijzen beschikbaar in deze periode.');

  // Refuse to optimize over an incomplete horizon. Previously a missing next-day
  // response silently left only tonight's prices, which could select a much more
  // expensive start even though cheaper prices existed tomorrow.
  let cursor = Number(fromMs);
  for (const slot of slots) {
    const slotStart = Number(slot.start);
    const slotEnd = Number(slot.end);
    if (slotEnd <= cursor) continue;
    if (slotStart > cursor + 1000) {
      const missingFrom = DateTime.fromMillis(cursor).toFormat('dd-LL HH:mm');
      const missingTo = DateTime.fromMillis(slotStart).toFormat('dd-LL HH:mm');
      throw new Error(`Prijsdata is niet compleet tussen ${missingFrom} en ${missingTo}. Er wordt niet gepland met onvolledige prijzen.`);
    }
    cursor = Math.max(cursor, slotEnd);
    if (cursor >= Number(untilMs) - 1000) break;
  }

  if (cursor < Number(untilMs) - 1000) {
    const availableUntil = DateTime.fromMillis(cursor).toFormat('dd-LL HH:mm');
    const wantedUntil = DateTime.fromMillis(Number(untilMs)).toFormat('dd-LL HH:mm');
    throw new Error(`Homey Energy-prijzen zijn beschikbaar tot ${availableUntil}, maar de deadline is ${wantedUntil}. Wacht tot alle prijzen beschikbaar zijn.`);
  }

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
  let state = d.getWidgetState();
  if (Array.isArray(state?.programs) && state.programs.length) {
    const live = d.getWidgetLiveStatus();
    await recordFromLive(d, live).catch(() => {});
    return { ...applyLearnedDurations(d, state), ...enrichLive(d, live) };
  }

  for (let i = 0; i < 6; i++) {
    await sleep(250);
    state = d.getWidgetState();
    if (Array.isArray(state?.programs) && state.programs.length) {
      const live = d.getWidgetLiveStatus();
      await recordFromLive(d, live).catch(() => {});
      return { ...applyLearnedDurations(d, state), ...enrichLive(d, live) };
    }
  }

  await d.refreshThinQ2().catch(() => {});
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
    const result = await calculateCompleteCheapestWindow(homey.app, {
      earliestMs: body.earliestMs,
      deadlineMs: body.deadlineMs,
      durationMinutes: body.durationMinutes
    });
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
    // Temporary safety lock for 0.7.8 testing: the device-level legacy replanner
    // still uses the older partial-horizon routine. Keep the verified widget
    // result fixed so it cannot be replaced by an incomplete overnight window.
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
