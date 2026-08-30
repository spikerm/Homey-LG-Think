'use strict';

const STORE_KEY = 'smart_wash_duration_history';
const SESSION_KEY = 'smart_wash_duration_session';
const MAX_SAMPLES = 5;
const INSIGHT_CAPABILITIES = [
  'lg_progress_percent',
  'lg_remaining_minutes',
  'lg_total_minutes',
  'lg_learned_duration',
  'lg_actual_cycle_duration',
  'lg_planned_price'
];

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

function isFinishedStatus(status) {
  const s = String(status || '').toLowerCase();
  return ['klaar','end','finished','complete','completed'].some(x => s.includes(x));
}

async function ensureInsightsCapabilities(device) {
  for (const capability of INSIGHT_CAPABILITIES) {
    if (!device?.hasCapability?.(capability)) {
      try {
        await device.addCapability(capability);
      } catch (err) {
        device.error?.(`Insights capability ${capability} toevoegen:`, err);
      }
    }
  }
}

function startInsightsRecorder(device) {
  if (!device || device._smartWashInsightsInterval) return;
  device._smartWashInsightsInterval = device.homey.setInterval(async () => {
    try {
      await recordFromLive(device, device.getWidgetLiveStatus());
    } catch (err) {
      device.error?.('Slim Wassen Insights recorder:', err);
    }
  }, 30000);
}

async function safeSet(device, capability, value) {
  if (!device?.hasCapability?.(capability)) return;
  if (!Number.isFinite(Number(value))) return;
  try {
    await device.setCapabilityValue(capability, Number(value));
  } catch (err) {
    device.error?.(`Insights capability ${capability}:`, err);
  }
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

async function updateInsights(device, data, learned = null) {
  const totalMinutes = parseDurationMinutes(data?.total || device.getCapabilityValue('lg_total'));
  const remainingMinutes = parseDurationMinutes(data?.remaining || device.getCapabilityValue('lg_remaining'));

  if (Number.isFinite(totalMinutes) && totalMinutes >= 0) {
    await safeSet(device, 'lg_total_minutes', totalMinutes);
  }
  if (Number.isFinite(remainingMinutes) && remainingMinutes >= 0) {
    await safeSet(device, 'lg_remaining_minutes', remainingMinutes);
  }
  if (Number.isFinite(totalMinutes) && totalMinutes > 0 && Number.isFinite(remainingMinutes)) {
    const progress = Math.max(0, Math.min(100, Math.round(((totalMinutes - remainingMinutes) / totalMinutes) * 100)));
    await safeSet(device, 'lg_progress_percent', progress);
  }
  if (learned && Number.isFinite(Number(learned.averageMinutes))) {
    await safeSet(device, 'lg_learned_duration', Math.round(Number(learned.averageMinutes)));
  }

  const plan = device.getStoreValue('smart_wash_plan');
  if (plan && Number.isFinite(Number(plan.averagePrice))) {
    await safeSet(device, 'lg_planned_price', Number(plan.averagePrice));
  }
}

async function recordFromLive(device, live = null) {
  const data = live || device.getWidgetLiveStatus();
  let session = device.getStoreValue(SESSION_KEY) || null;

  if (!isActiveStatus(data?.status)) {
    if (session) {
      const elapsedMinutes = Math.round((Date.now() - Number(session.startedAt || Date.now())) / 60000);
      if (elapsedMinutes >= 1 && elapsedMinutes <= 600) {
        await safeSet(device, 'lg_actual_cycle_duration', elapsedMinutes);
      }
      await device.setStoreValue(SESSION_KEY, null);
    }
    if (isFinishedStatus(data?.status)) {
      await safeSet(device, 'lg_remaining_minutes', 0);
      await safeSet(device, 'lg_progress_percent', 100);
    }
    await updateInsights(device, data, null);
    return null;
  }

  const programId = data?.currentProgramId || device._lastProgram ||
    device.getStoreValue('selected_program_id') || device.getStoreValue('last_valid_program_id');
  if (!programId || programId === 'NOT_SELECTED') {
    await updateInsights(device, data, null);
    return null;
  }

  const wd = device._lastWd || {};
  let minutes = parseDurationMinutes(data?.total || device.getCapabilityValue('lg_total'));
  if (!Number.isFinite(minutes) || minutes <= 0) {
    minutes = Number(wd.initialTimeHour || 0) * 60 + Number(wd.initialTimeMinute || 0);
  }
  if (!Number.isFinite(minutes) || minutes < 14 || minutes > 600) {
    await updateInsights(device, data, getProgramLearning(device, programId));
    return null;
  }

  const cycleCount = Number(device.getCapabilityValue('lg_cycle_count'));
  const sameProgram = session?.programId === programId;
  const sameCycle = Number.isFinite(cycleCount) && cycleCount > 0 && Number(session?.cycleCount) === cycleCount;

  if (!session || !sameProgram || (Number.isFinite(cycleCount) && cycleCount > 0 && !sameCycle)) {
    const startedAt = Date.now();
    session = {
      id: `${programId}-${Number.isFinite(cycleCount) && cycleCount > 0 ? cycleCount : 'cycle'}-${startedAt}`,
      programId,
      cycleCount: Number.isFinite(cycleCount) && cycleCount > 0 ? cycleCount : null,
      startedAt
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
  await updateInsights(device, data, history[programId]);

  if (!Number.isFinite(previousAverage) || previousAverage !== averageMinutes) {
    device.log(`Slim Wassen leert programmaduur: ${programId} = ${averageMinutes} min (${valid.length} meting${valid.length === 1 ? '' : 'en'}).`);
  }
  return history[programId];
}

module.exports = {
  STORE_KEY,
  INSIGHT_CAPABILITIES,
  recordFromLive,
  applyLearnedDurations,
  getProgramLearning,
  parseDurationMinutes,
  updateInsights,
  ensureInsightsCapabilities,
  startInsightsRecorder
};
