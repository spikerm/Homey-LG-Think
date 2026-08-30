'use strict';

function device(homey, id) {
  if (!id) throw new Error('Geen wasmachine geselecteerd in de widget.');
  return homey.app.getWasherDevice(id);
}

module.exports = {
  async getState({ homey, query }) {
    const d = device(homey, query.deviceId);
    await d.refreshThinQ2().catch(() => {});
    return d.getWidgetState();
  },

  async getLiveStatus({ homey, query }) {
    const d = device(homey, query.deviceId);
    return d.getWidgetLiveStatus();
  },

  async previewPlan({ homey, body }) {
    const d = device(homey, body.deviceId);
    const result = await homey.app.calculateCheapestWashWindow({
      earliestMs: body.earliestMs,
      deadlineMs: body.deadlineMs,
      durationMinutes: body.durationMinutes
    });
    return { ...result, state:d.getWidgetState() };
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
    return d.getWidgetState();
  }
};
