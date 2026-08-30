'use strict';

const {
  recordFromLive,
  getProgramLearning,
  parseDurationMinutes,
  ensureInsightsCapabilities,
  startInsightsRecorder
} = require('../../lib/smart-wash-duration');

function device(homey, id) {
  if (!id) throw new Error('Geen LG ThinQ-apparaat geselecteerd in de widget.');
  return homey.app.getWasherDevice(id);
}

async function prepareDevice(d) {
  await ensureInsightsCapabilities(d);
  startInsightsRecorder(d);
  return d;
}

function isActive(status) {
  const s = String(status || '').toLowerCase();
  return [
    'wassen','spoelen','centrifugeren','drogen','running','washing','rinsing',
    'spinning','drying','belading detecteren','detecting','gepauzeerd','pause'
  ].some(x => s.includes(x));
}

function triState(raw, onValue, offValue) {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = String(raw).toUpperCase();
  if (value === onValue) return true;
  if (value === offValue) return false;
  return null;
}

async function overview(d) {
  const state = d.getWidgetState();
  const live = d.getWidgetLiveStatus();
  await recordFromLive(d, live).catch(() => {});
  const merged = { ...state, ...live };
  const wd = d._lastWd || {};

  const currentProgramId = merged.currentProgramId || merged.selected?.programId || null;
  const programFromList = Array.isArray(state?.programs)
    ? state.programs.find(program => program?.id === currentProgramId)
    : null;
  const learnedDuration = getProgramLearning(d, currentProgramId);
  const plan = merged.plan || null;
  const planDurationMinutes = Number(plan?.durationMinutes || learnedDuration?.averageMinutes || programFromList?.expectedDurationMinutes);
  const expectedEndAt = plan?.startAt && Number.isFinite(planDurationMinutes)
    ? Number(plan.startAt) + planDurationMinutes * 60 * 1000
    : null;

  const liveTotalMinutes = parseDurationMinutes(merged.total);
  const liveRemainingMinutes = parseDurationMinutes(merged.remaining);
  let progressPercent = null;
  if (
    isActive(merged.status) &&
    Number.isFinite(liveTotalMinutes) && liveTotalMinutes > 0 &&
    Number.isFinite(liveRemainingMinutes) && liveRemainingMinutes >= 0
  ) {
    progressPercent = Math.max(0, Math.min(100,
      Math.round(((liveTotalMinutes - liveRemainingMinutes) / liveTotalMinutes) * 100)
    ));
  }

  const doorLocked = Object.prototype.hasOwnProperty.call(wd, 'doorLock')
    ? triState(wd.doorLock, 'DOOR_LOCK_ON', 'DOOR_LOCK_OFF')
    : null;
  const childLock = Object.prototype.hasOwnProperty.call(wd, 'childLock')
    ? triState(wd.childLock, 'CHILDLOCK_ON', 'CHILDLOCK_OFF')
    : null;
  const actualCycleDuration = Number(d.getCapabilityValue('lg_actual_cycle_duration'));

  return {
    deviceType: 'washer',
    name: merged.name || d.getName?.() || 'LG ThinQ',
    status: merged.status || 'Onbekend',
    active: isActive(merged.status),
    remaining: merged.remaining || null,
    total: merged.total || null,
    progressPercent,
    actualCycleDuration: Number.isFinite(actualCycleDuration) ? actualCycleDuration : null,
    currentProgramId,
    currentProgramName: merged.currentProgramName || merged.programName || programFromList?.name || null,
    remoteControl: merged.remoteControl === true,
    doorLocked,
    doorLockRaw: Object.prototype.hasOwnProperty.call(wd, 'doorLock') ? wd.doorLock : null,
    childLock,
    error: merged.error || null,
    liveOptions: merged.liveOptions || {},
    learnedDuration,
    expectedDurationMinutes: Number.isFinite(planDurationMinutes) ? Math.round(planDurationMinutes) : null,
    expectedEndAt,
    plan,
    updatedAt: Date.now()
  };
}

module.exports = {
  async getOverview({ homey, query }) {
    const d = await prepareDevice(device(homey, query.deviceId));
    return overview(d);
  },

  async refresh({ homey, body }) {
    const d = await prepareDevice(device(homey, body.deviceId));
    await d.refreshNow().catch(() => {});
    await d.refreshThinQ2().catch(() => {});
    return overview(d);
  },

  async pause({ homey, body }) {
    const d = await prepareDevice(device(homey, body.deviceId));
    const current = await overview(d);
    if (!current.active) throw new Error('De wasmachine is niet actief.');
    await d.pauseWasher();
    return overview(d);
  },

  async powerOff({ homey, body }) {
    const d = await prepareDevice(device(homey, body.deviceId));
    await d.powerOffWasher();
    return overview(d);
  },

  async wake({ homey, body }) {
    const d = await prepareDevice(device(homey, body.deviceId));
    const current = await overview(d);
    if (current.active) throw new Error('Wakker maken is geblokkeerd terwijl de wasmachine actief is.');
    await d.wakeupWasher();
    return overview(d);
  }
};
