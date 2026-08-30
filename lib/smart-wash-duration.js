'use strict';

const STORE_KEY = 'smart_wash_duration_history';
const SESSION_KEY = 'smart_wash_duration_session';
const MAX_SAMPLES = 5;

function parseDurationMinutes(value) {
  if (Number.isFinite(Number(value))) return Math.round(Number(value));
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/(?:(\d+)\s*u)?\s*(\d+)\s*m/i);
  if (match) return Number(match[1] || 0) * 60 + Number(match[2] || 0);
  const colon = text.match(/^(\d+):(\d{1,2})$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  return null;
}

function isActiveStatus(status) {
  const s = String(status || '').toLowerCase();
  return [
    'wassen','spoelen','centrifugeren','drogen','running','washing','rinsing',
    'spinning','drying','belading detecteren','detecting','gepauzeerd','pause',
    'uitgestelde start','reserved','afkoelen','cooldown','spoelstop','rinsehold'
  ].some(x => s.includes(x));
}

function getHistory(device) {
  const value = device.getStoreValue(STORE_KEY);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getProgramLearning(device, programId) {
  if (!programId) return null;
  const entry = getHistory(device)[programId];
  if (!entry || !Number.isFinite(Number(entry.averageMinutes))) return null;
  return {
    averageMinutes: Math.round(Number(entry.averageMinutes)),
    count: Number(entry.count || entry.samples?.length || 0),
    lastMinutes: Number(entry.lastMinutes || entry.averageMinutes),
    lastAt: entry.lastAt || null,
    samples: Array.isArray(entry.samples) ? entry.samples : []
  };
}

function applyLearnedDurations(device, state) {
  if (!state || !Array.isArray(state.programs)) return state;
  const programs = state.programs.map(program => {
    const learned = getProgramLearning(device, program.id);
    if (!learned || learned.count < 1) return program;
    return {
      ...program,
      expectedDurationMinutes: learned.averageMinutes,
      durationLearning: learned
    };
  });
  return { ...state, programs };
}

async function recordFromLive(device, live = null) {
  const data = live || device.getWidgetLiveStatus();
  if (!isActiveStatus(data?.status)) return null;

  const programId = data?.currentProgramId || device._lastProgram ||
    device.getStoreValue('selected_program_id') || device.getStoreValue('last_valid_program_id');
  if (!programId || programId === 'NOT_SELECTED') return null;

  const wd = device._lastWd || {};
  let minutes = parseDurationMinutes(data?.total || device.getCapabilityValue('lg_total'));
  if (!Number.isFinite(minutes) || minutes <= 0) {
    minutes = Number(wd.initialTimeHour || 0) * 60 + Number(wd.initialTimeMinute || 0);
  }
  if (!Number.isFinite(minutes) || minutes < 14 || minutes > 600) return null;

  const cycleCount = Number(device.getCapabilityValue('lg_cycle_count'));
  let session = device.getStoreValue(SESSION_KEY) || null;
  const sameProgram = session?.programId === programId;
  const sameCycle = Number.isFinite(cycleCount) && cycleCount > 0 && Number(session?.cycleCount) === cycleCount;

  if (!session || !sameProgram || (Number.isFinite(cycleCount) && cycleCount > 0 && !sameCycle)) {
    session = {
      id: `${programId}-${Number.isFinite(cycleCount) && cycleCount > 0 ? cycleCount : Date.now()}`,
      programId,
      cycleCount: Number.isFinite(cycleCount) && cycleCount > 0 ? cycleCount : null,
      startedAt: Date.now()
    };
    await device.setStoreValue(SESSION_KEY, session);
  }

  const history = getHistory(device);
  const current = history[programId] || { samples: [] };
  let samples = Array.isArray(current.samples) ? [...current.samples] : [];
  const sample = {
    cycleId: session.id,
    minutes: Math.round(minutes),
    at: Date.now(),
    options: data?.liveOptions || null
  };

  const existingIndex = samples.findIndex(item => item?.cycleId === session.id);
  if (existingIndex >= 0) samples[existingIndex] = sample;
  else samples.push(sample);
  samples = samples.slice(-MAX_SAMPLES);

  const valid = samples.map(item => Number(item.minutes)).filter(Number.isFinite);
  const averageMinutes = Math.round(valid.reduce((sum, n) => sum + n, 0) / valid.length);
  const previousAverage = Number(current.averageMinutes);

  history[programId] = {
    samples,
    count: valid.length,
    averageMinutes,
    lastMinutes: Math.round(minutes),
    lastAt: Date.now()
  };
  await device.setStoreValue(STORE_KEY, history);

  if (!Number.isFinite(previousAverage) || previousAverage !== averageMinutes) {
    device.log(`Slim Wassen leert programmaduur: ${programId} = ${averageMinutes} min (${valid.length} meting${valid.length === 1 ? '' : 'en'}).`);
  }
  return history[programId];
}

module.exports = {
  STORE_KEY,
  recordFromLive,
  applyLearnedDurations,
  getProgramLearning,
  parseDurationMinutes
};
