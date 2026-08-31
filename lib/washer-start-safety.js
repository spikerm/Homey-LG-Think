'use strict';

const ACTIVE_STATES = new Set([
  'RUNNING','RINSING','SPINNING','DRYING','DETECTING','RESERVED','COOLDOWN','COOL_DOWN','RINSEHOLD','RINSE_HOLD'
]);
const SLEEP_STATES = new Set(['SLEEP','POWER_OFF','POWEROFF']);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function connectState(device) {
  const raw = device.getStoreValue('last_state');
  const state = Array.isArray(raw) ? (raw[0] || {}) : (raw || {});
  return String(
    state?.runState?.currentState ||
    state?.processState?.currentState ||
    ''
  ).toUpperCase();
}

function thinq2State(device) {
  return String(device?._lastWd?.state || '').toUpperCase();
}

function isPhysicallyActive(device) {
  return ACTIVE_STATES.has(connectState(device)) || ACTIVE_STATES.has(thinq2State(device));
}

function patchWasherStartSafety(device) {
  if (!device || device._washerStartSafetyPatchApplied) return;
  if (typeof device.startWasher !== 'function' || typeof device._thinQ2Write !== 'function') return;

  device._washerStartSafetyPatchApplied = true;
  const originalStartWasher = device.startWasher.bind(device);

  device._ensureWasherAwake = async (client, legacyId) => {
    // Always refresh the official Connect state for the wake decision. ThinQ2 can
    // report INITIAL/Gereed while the physical appliance is still asleep.
    await device.refreshNow().catch(err => device.log(`[ThinQ2] Wake precheck Connect mislukt: ${err?.message || err}`));

    let cState = connectState(device);
    let tState = thinq2State(device);
    device.log(`[ThinQ2] Start precheck: Connect=${cState || 'ONBEKEND'}, ThinQ2=${tState || 'ONBEKEND'}, remote=${device.getCapabilityValue('lg_remote_control') === true}`);

    if (isPhysicallyActive(device) || (typeof device.isRunning === 'function' && device.isRunning())) {
      throw new Error(`Wasmachine is al actief (${cState || tState || 'ONBEKEND'}); wake/start geblokkeerd.`);
    }

    const mustWake = SLEEP_STATES.has(cState) || (!cState && SLEEP_STATES.has(tState));
    if (mustWake) {
      device.log(`[ThinQ2] Fysieke status ${cState || tState}; WMWakeup wordt verstuurd vóór WMDownload.`);
      await device._thinQ2Write(client, legacyId, 'WMWakeup', {
        controlDataType:'WAKEUP',
        controlDataValueLength:0
      });

      let awake = false;
      for (let i = 0; i < 10; i++) {
        await sleep(1500);
        await device.refreshNow().catch(err => device.log(`[ThinQ2] Wake Connect controle ${i + 1}/10 mislukt: ${err?.message || err}`));
        cState = connectState(device);
        device.log(`[ThinQ2] Wake Connect controle ${i + 1}/10: ${cState || 'ONBEKEND'}`);
        if (cState && !SLEEP_STATES.has(cState)) {
          awake = true;
          break;
        }
      }

      if (!awake) {
        throw new Error(`Wasmachine reageert niet op WMWakeup; ThinQ Connect blijft ${cState || 'ONBEKEND'}.`);
      }
    } else {
      device.log(`[ThinQ2] WMWakeup niet nodig: Connect=${cState || 'ONBEKEND'}, ThinQ2=${tState || 'ONBEKEND'}.`);
    }

    // Refresh ThinQ2 after waking and verify Remote Start again. Do not send a
    // program/start command when the remote permission disappeared during wake.
    await device.refreshThinQ2();
    cState = connectState(device);
    tState = thinq2State(device);
    const remote = device.getCapabilityValue('lg_remote_control') === true || device._lastRemoteStart === true;
    device.log(`[ThinQ2] Na wake: Connect=${cState || 'ONBEKEND'}, ThinQ2=${tState || 'ONBEKEND'}, remote=${remote}`);

    if (isPhysicallyActive(device)) {
      throw new Error(`Wasmachine werd tijdens wake actief (${cState || tState}); WMDownload geblokkeerd.`);
    }
    if (!remote) {
      throw new Error('Remote Start is na het wakker maken niet meer actief.');
    }
    if (SLEEP_STATES.has(cState)) {
      throw new Error(`Wasmachine is na WMWakeup nog in ${cState}; WMDownload geblokkeerd.`);
    }
    return true;
  };

  device.startWasher = async (...args) => {
    const result = await originalStartWasher(...args);

    // LG resultCode 0000 means that the cloud accepted WMStart; it does not
    // prove that the appliance actually started. Confirm a physical active state.
    for (let i = 0; i < 10; i++) {
      await sleep(1500);
      await device.refreshNow().catch(err => device.log(`[ThinQ2] Startbevestiging Connect ${i + 1}/10 mislukt: ${err?.message || err}`));
      await device.refreshThinQ2().catch(err => device.log(`[ThinQ2] Startbevestiging ThinQ2 ${i + 1}/10 mislukt: ${err?.message || err}`));
      const cState = connectState(device);
      const tState = thinq2State(device);
      device.log(`[ThinQ2] Startbevestiging ${i + 1}/10: Connect=${cState || 'ONBEKEND'}, ThinQ2=${tState || 'ONBEKEND'}`);
      if (isPhysicallyActive(device)) {
        device.log(`[ThinQ2] Fysieke start bevestigd: ${cState || tState}.`);
        return result;
      }
    }

    const cState = connectState(device);
    const tState = thinq2State(device);
    throw new Error(`LG accepteerde WMStart, maar de wasmachine startte niet (Connect=${cState || 'ONBEKEND'}, ThinQ2=${tState || 'ONBEKEND'}).`);
  };

  device.log('Slim Wassen startbeveiliging actief: fysieke wake/start wordt geverifieerd.');
}

module.exports = { patchWasherStartSafety };
