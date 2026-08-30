'use strict';

function device(homey, id) {
  if (!id) throw new Error('Geen LG ThinQ-apparaat geselecteerd in de widget.');
  return homey.app.getWasherDevice(id);
}

function isActive(status) {
  const s = String(status || '').toLowerCase();
  return [
    'wassen','spoelen','centrifugeren','drogen','running','washing','rinsing',
    'spinning','drying','belading detecteren','detecting','gepauzeerd','pause'
  ].some(x => s.includes(x));
}

async function overview(d) {
  const state = d.getWidgetState();
  const live = d.getWidgetLiveStatus();
  const merged = { ...state, ...live };

  return {
    deviceType: 'washer',
    name: merged.name || d.getName?.() || 'LG ThinQ',
    status: merged.status || 'Onbekend',
    active: isActive(merged.status),
    remaining: merged.remaining || null,
    currentProgramId: merged.currentProgramId || merged.selected?.programId || null,
    currentProgramName: merged.currentProgramName || merged.programName || null,
    remoteControl: merged.remoteControl === true,
    doorLocked: merged.doorLocked === true,
    childLock: merged.childLock === true,
    error: merged.error || null,
    liveOptions: merged.liveOptions || {},
    plan: merged.plan || null,
    updatedAt: Date.now()
  };
}

module.exports = {
  async getOverview({ homey, query }) {
    const d = device(homey, query.deviceId);
    return overview(d);
  },

  async refresh({ homey, body }) {
    const d = device(homey, body.deviceId);
    await d.refreshNow().catch(() => {});
    await d.refreshThinQ2().catch(() => {});
    return overview(d);
  },

  async pause({ homey, body }) {
    const d = device(homey, body.deviceId);
    const current = await overview(d);
    if (!current.active) throw new Error('De wasmachine is niet actief.');
    await d.pauseWasher();
    return overview(d);
  },

  async powerOff({ homey, body }) {
    const d = device(homey, body.deviceId);
    await d.powerOffWasher();
    return overview(d);
  },

  async wake({ homey, body }) {
    const d = device(homey, body.deviceId);
    const current = await overview(d);
    if (current.active) throw new Error('Wakker maken is geblokkeerd terwijl de wasmachine actief is.');
    await d.wakeupWasher();
    return overview(d);
  }
};
