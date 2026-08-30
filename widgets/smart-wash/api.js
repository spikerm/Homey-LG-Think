'use strict';

const {
  recordFromLive,
  applyLearnedDurations,
  getProgramLearning,
  parseDurationMinutes
} = require('../../lib/smart-wash-duration');

function device(homey, id) {
  if (!id) throw new Error('Geen wasmachine geselecteerd in de widget.');
  return homey.app.getWasherDevice(id);
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

  return {
    ...live,
    totalMinutes: Number.isFinite(totalMinutes) ? totalMinutes : null,
    remainingMinutes: Number.isFinite(remainingMinutes) ? remainingMinutes : null,
    progressPercent,
    learnedDuration,
    planDurationMinutes: Number.isFinite(Number(plan?.durationMinutes)) ? Number(plan.durationMinutes) : null,
    plannedAveragePrice: Number.isFinite(Number(plan?.averagePrice)) ? Number(plan.averagePrice) : null
  };
}

async function getReadyWidgetState(d) {
  // Prefer the device cache. During app startup the widget can open a fraction
  // earlier than the initial ThinQ2 refresh has finished, which previously left
  // the program and option lists empty. Give the device init a short moment to
  // finish before falling back to one explicit refresh.
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

  // Only refresh when the cache is still empty after ~1.5 seconds. This keeps
  // normal widget opens cache-only while still recovering from a startup race.
  await d.refreshThinQ2().catch(() => {});
  state = d.getWidgetState();
  const live = d.getWidgetLiveStatus();
  await recordFromLive(d, live).catch(() => {});
  return { ...applyLearnedDurations(d, state), ...enrichLive(d, live) };
}

module.exports = {
  async getState({ homey, query }) {
    const d = device(homey, query.deviceId);
    return getReadyWidgetState(d);
  },

  async getLiveStatus({ homey, query }) {
    const d = device(homey, query.deviceId);
    const live = d.getWidgetLiveStatus();
    await recordFromLive(d, live).catch(() => {});
    return enrichLive(d, live);
  },

  async previewPlan({ homey, body }) {
    const d = device(homey, body.deviceId);
    const result = await homey.app.calculateCheapestWashWindow({
      earliestMs: body.earliestMs,
      deadlineMs: body.deadlineMs,
      durationMinutes: body.durationMinutes
    });
    return { ...result, state:applyLearnedDurations(d, d.getWidgetState()) };
  },

  async savePlan({ homey, body }) {
    const d = device(homey, body.deviceId);
    return d.setSmartWashPlan(body.plan);
  },

  async cancelPlan({ homey, query }) {
    const d = device(homey, query.deviceId);
    return d.cancelSmartWashPlan();
  },

  async startNow({ homey, body }) {
    const d = device(homey, body.deviceId);
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
    const d = device(homey, body.deviceId);
    await d.wakeupWasher();
    return applyLearnedDurations(d, d.getWidgetState());
  }
};
