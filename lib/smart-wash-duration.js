'use strict';

const { patchWasherStartSafety } = require('./washer-start-safety');

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

function normalizeDryLevel(value) {
  const dry = String(value || '').trim().toUpperCase();
  return dry || 'NOT_SELECTED';
}

function learningKey(programId, dryLevel = 'NOT_SELECTED') {
  return `${programId}::dry=${normalizeDryLevel(dryLevel)}`;
}

function resolveDryLevel(device, data = null) {
  const liveDry = data?.liveOptions?.dryLevel;
  if (liveDry) return normalizeDryLevel(liveDry);
  const wdDry = device?._lastWd?.dryLevel;
  if (wdDry) return normalizeDryLevel(wdDry);
  const planDry = device?.getStoreValue?.('smart_wash_plan')?.config?.options?.dryLevel;
  if (planDry) return normalizeDryLevel(planDry);
  const selectedDry = device?.getStoreValue?.('smart_wash_selected_config')?.options?.dryLevel;
  if (selectedDry) return normalizeDryLevel(selectedDry);
  return 'NOT_SELECTED';
}

async function ensureInsightsCapabilities(device) {
  patchWasherStartSafety(device);
  for (const capability of INSIGHT_CAPABILITIES) {
    if (!device?.hasCapability?.(capability)) {
      try { await device.addCapability(capability); }
      catch (err) { device.error?.(`Insights capability ${capability} toevoegen:`, err); }
    }
  }
}

function startInsightsRecorder(device) {
  if (!device || device._smartWashInsightsInterval) return;
  device._smartWashInsightsInterval = device.homey.setInterval(async () => {
    try { await recordFromLive(device, device.getWidgetLiveStatus()); }
    catch (err) { device.error?.('Slim Wassen Insights recorder:', err); }
  }, 30000);
}

async function safeSet(device, capability, value) {
  if (!device?.hasCapability?.(capability) || !Number.isFinite(Number(value))) return;
  try { await device.setCapabilityValue(capability, Number(value)); }
  catch (err) { device.error?.(`Insights capability ${capability}:`, err); }
}

function getHistory(device) {
  const value = device.getStoreValue(STORE_KEY);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function learningResult(entry, programId, dryLevel) {
  if (!entry || !Number.isFinite(Number(entry.averageMinutes))) return null;
  return {
    programId,
    dryLevel: normalizeDryLevel(dryLevel),
    averageMinutes: Math.round(Number(entry.averageMinutes)),
    count: Number(entry.count || entry.samples?.length || 0),
    lastMinutes: Number(entry.lastMinutes || entry.averageMinutes),
    lastAt: entry.lastAt || null,
    samples: Array.isArray(entry.samples) ? entry.samples : []
  };
}

function getProgramLearning(device, programId, options = null) {
  if (!programId) return null;
  const dryLevel = normalizeDryLevel(options?.dryLevel || 'NOT_SELECTED');
  const entry = getHistory(device)[learningKey(programId, dryLevel)];
  return learningResult(entry, programId, dryLevel);
}

function getProgramLearningByDry(device, programId) {
  if (!programId) return {};
  const history = getHistory(device);
  const prefix = `${programId}::dry=`;
  const result = {};
  for (const [key, entry] of Object.entries(history)) {
    if (!key.startsWith(prefix)) continue;
    const dryLevel = key.slice(prefix.length) || 'NOT_SELECTED';
    const learned = learningResult(entry, programId, dryLevel);
    if (learned) result[dryLevel] = learned;
  }
  return result;
}

function applyLearnedDurations(device, state) {
  if (!state || !Array.isArray(state.programs)) return state;
  const programs = state.programs.map(program => {
    const durationLearningByDry = getProgramLearningByDry(device, program.id);
    return Object.keys(durationLearningByDry).length
      ? { ...program, durationLearningByDry }
      : program;
  });
  return { ...state, programs };
}

async function updateInsights(device, data, learned = null) {
  const totalMinutes = parseDurationMinutes(data?.total || device.getCapabilityValue('lg_total'));
  const remainingMinutes = parseDurationMinutes(data?.remaining || device.getCapabilityValue('lg_remaining'));
  if (Number.isFinite(totalMinutes) && totalMinutes >= 0) await safeSet(device, 'lg_total_minutes', totalMinutes);
  if (Number.isFinite(remainingMinutes) && remainingMinutes >= 0) await safeSet(device, 'lg_remaining_minutes', remainingMinutes);
  if (Number.isFinite(totalMinutes) && totalMinutes > 0 && Number.isFinite(remainingMinutes)) {
    const progress = Math.max(0, Math.min(100, Math.round(((totalMinutes - remainingMinutes) / totalMinutes) * 100)));
    await safeSet(device, 'lg_progress_percent', progress);
  }
  if (learned && Number.isFinite(Number(learned.averageMinutes))) {
    await safeSet(device, 'lg_learned_duration', Math.round(Number(learned.averageMinutes)));
  }
  const plan = device.getStoreValue('smart_wash_plan');
  if (plan && Number.isFinite(Number(plan.averagePrice))) await safeSet(device, 'lg_planned_price', Number(plan.averagePrice));
}

async function finaliseSession(device, session, elapsedMinutes) {
  if (!session?.programId || !session?.learningKey || !Number.isFinite(elapsedMinutes) || elapsedMinutes < 1 || elapsedMinutes > 600) return;
  const history = getHistory(device);
  const current = history[session.learningKey];
  if (!current || !Array.isArray(current.samples)) return;
  const samples = current.samples.map(sample => sample?.cycleId === session.id
    ? { ...sample, actualMinutes: elapsedMinutes, finishedAt: Date.now() }
    : sample);
  const matched = samples.some(sample => sample?.cycleId === session.id && Number(sample.actualMinutes) === elapsedMinutes);
  if (!matched) return;
  history[session.learningKey] = { ...current, samples, lastActualMinutes: elapsedMinutes };
  await device.setStoreValue(STORE_KEY, history);
}

async function recordFromLive(device, live = null) {
  const data = live || device.getWidgetLiveStatus();
  let session = device.getStoreValue(SESSION_KEY) || null;

  if (!isActiveStatus(data?.status)) {
    if (session) {
      const elapsedMinutes = Math.round((Date.now() - Number(session.startedAt || Date.now())) / 60000);
      if (elapsedMinutes >= 1 && elapsedMinutes <= 600) {
        await safeSet(device, 'lg_actual_cycle_duration', elapsedMinutes);
        await finaliseSession(device, session, elapsedMinutes);
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

  const dryLevel = resolveDryLevel(device, data);
  const key = learningKey(programId, dryLevel);
  const wd = device._lastWd || {};
  let minutes = parseDurationMinutes(data?.total || device.getCapabilityValue('lg_total'));
  if (!Number.isFinite(minutes) || minutes <= 0) minutes = Number(wd.initialTimeHour || 0) * 60 + Number(wd.initialTimeMinute || 0);
  if (!Number.isFinite(minutes) || minutes < 14 || minutes > 600) {
    await updateInsights(device, data, getProgramLearning(device, programId, { dryLevel }));
    return null;
  }

  const cycleCount = Number(device.getCapabilityValue('lg_cycle_count'));
  const sameProgram = session?.programId === programId;
  const sameLearningKey = session?.learningKey === key;
  const sameCycle = Number.isFinite(cycleCount) && cycleCount > 0 && Number(session?.cycleCount) === cycleCount;
  if (!session || !sameProgram || !sameLearningKey || (Number.isFinite(cycleCount) && cycleCount > 0 && !sameCycle)) {
    const startedAt = Date.now();
    session = {
      id: `${programId}-${dryLevel}-${Number.isFinite(cycleCount) && cycleCount > 0 ? cycleCount : 'cycle'}-${startedAt}`,
      programId,
      dryLevel,
      learningKey:key,
      cycleCount: Number.isFinite(cycleCount) && cycleCount > 0 ? cycleCount : null,
      startedAt
    };
    await device.setStoreValue(SESSION_KEY, session);
  }

  const history = getHistory(device);
  const current = history[key] || { programId, dryLevel, samples: [] };
  let samples = Array.isArray(current.samples) ? [...current.samples] : [];
  const existing = samples.find(item => item?.cycleId === session.id);
  const sample = {
    ...existing,
    cycleId: session.id,
    minutes: Math.round(minutes),
    at: Date.now(),
    dryLevel,
    options: data?.liveOptions || null
  };
  const existingIndex = samples.findIndex(item => item?.cycleId === session.id);
  if (existingIndex >= 0) samples[existingIndex] = sample;
  else samples.push(sample);
  samples = samples.slice(-MAX_SAMPLES);

  const valid = samples.map(item => Number(item.minutes)).filter(Number.isFinite);
  const averageMinutes = Math.round(valid.reduce((sum, n) => sum + n, 0) / valid.length);
  const previousAverage = Number(current.averageMinutes);
  history[key] = { programId, dryLevel, samples, count: valid.length, averageMinutes, lastMinutes: Math.round(minutes), lastAt: Date.now() };
  await device.setStoreValue(STORE_KEY, history);
  await updateInsights(device, data, history[key]);

  if (!Number.isFinite(previousAverage) || previousAverage !== averageMinutes) {
    device.log(`Slim Wassen leert programmaduur: ${programId} / ${dryLevel} = ${averageMinutes} min (${valid.length} meting${valid.length === 1 ? '' : 'en'}).`);
  }
  return history[key];
}

module.exports = {
  STORE_KEY,
  INSIGHT_CAPABILITIES,
  recordFromLive,
  applyLearnedDurations,
  getProgramLearning,
  getProgramLearningByDry,
  learningKey,
  parseDurationMinutes,
  updateInsights,
  ensureInsightsCapabilities,
  startInsightsRecorder
};
