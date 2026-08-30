'use strict';

const Homey = require('homey');
const ThinQConnect = require('../../lib/thinq-connect');
const ThinQ2Legacy = require('../../lib/thinq2-legacy');

function unwrapRoot(data) {
  if (Array.isArray(data)) return data[0] || {};
  return data || {};
}

function deepFind(obj, wanted) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFind(item, wanted);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (wanted.includes(k)) return v;
    if (v && typeof v === 'object') {
      const found = deepFind(v, wanted);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

const STATE_NL = {
  POWEROFF:'Uit', POWER_OFF:'Uit', INITIAL:'Gereed', PAUSE:'Gepauzeerd',
  RESERVED:'Uitgestelde start', DETECTING:'Belading detecteren', RUNNING:'Wassen',
  RINSING:'Spoelen', SPINNING:'Centrifugeren', DRYING:'Drogen', END:'Klaar',
  COOLDOWN:'Afkoelen', COOL_DOWN:'Afkoelen', RINSEHOLD:'Spoelstop',
  RINSE_HOLD:'Spoelstop', WASH_REFRESHING:'Opfrissen', REFRESHING:'Opfrissen',
  STEAMSOFTENING:'Stoom verzachten', STEAM_SOFTENING:'Stoom verzachten',
  ERROR:'Storing', SLEEP:'Slaapstand'
};

function stateLabel(v) {
  if (v === undefined || v === null || v === '') return 'Onbekend';
  const key = String(v).toUpperCase();
  return STATE_NL[key] || String(v);
}

function safeErrorMessage(err) {
  if (!err) return 'Onbekende fout';
  const status = err?.response?.status || err?.status || err?.statusCode;
  const code = err?.code;
  const message =
    err?.response?.data?.error?.message ||
    err?.response?.data?.message ||
    err?.message ||
    String(err);
  return [status ? `HTTP ${status}` : null, code ? String(code) : null, String(message)]
    .filter(Boolean)
    .join(' - ');
}

function tempLabel(v) {
  if (!v) return '-';
  const s = String(v);
  if (s === 'TEMP_COLD') return 'Koud';
  if (s === 'NO_TEMP') return '-';
  const m = s.match(/^TEMP_(\d+)$/);
  return m ? `${m[1]} °C` : s;
}

function spinLabel(v) {
  if (!v) return '-';
  const s = String(v);
  if (s === 'NO_SPIN') return 'Geen';
  if (s === 'SPIN_Max') return 'Max';
  if (s === 'NOT_SELECTED') return '-';
  const m = s.match(/^SPIN_(\d+)$/);
  return m ? `${m[1]} rpm` : s;
}

function rinseLabel(v) {
  const map = {
    NO_RINSE:'Geen', RINSE_NORMAL:'Normaal', RINSE_PLUS:'Extra',
    RINSE_PLUSPLUS:'Extra +', RINSE_NORMAL_HOLD:'Normaal + stop',
    RINSE_PLUS_HOLD:'Extra + stop'
  };
  return map[v] || v || '-';
}

function dryLabel(v) {
  if (!v || v === 'NOT_SELECTED' || v === 'NO_DRYLEVEL') return '-';
  return String(v)
    .replace('DRYLEVEL_', '')
    .replace('NORMAL','Normaal')
    .replace('ECO','Eco')
    .replace('VERY','Extra droog')
    .replace('IRON','Strijkdroog')
    .replace('LOW','Lage temp.');
}

function courseDefault(course, key) {
  const fn = (course?.function || []).find(x => x?.value === key);
  return fn?.default;
}

class LGWasherDevice extends Homey.Device {
  async onInit() {
    this._widgetStartPromise = null;
    this._widgetStartRequestedAt = 0;
    this.log('LG Washer init', this.getName(), this.getData().id);
    this._interval = null;
    this._profileCache = this.getStoreValue('last_profile') || null;
    this._thinQConnect416Logged = false;
    this._lastState = null;
    this._lastProgram = null;
    this._lastRemoteStart = null;
    this._lastDoorLock = null;
    this._lastChildLock = null;
    this._lastError = null;
    this._lastThinQ2Online = null;
    this._lastWd = {};
    this._courses = {};
    this._smartCourses = {};
    this._modelJson = null;

    await this._ensureCapabilities();
    await this._initFlowCards();
    this.registerCapabilityListener('lg_program_select', async value => {
      await this.selectProgram(value);
      return true;
    });
    this.registerCapabilityListener('lg_temp_select', async value => {
      await this.updateSelectedOption('temp', value);
      return true;
    });
    this.registerCapabilityListener('lg_spin_select', async value => {
      await this.updateSelectedOption('spin', value);
      return true;
    });
    this.registerCapabilityListener('lg_rinse_select', async value => {
      await this.updateSelectedOption('rinse', value);
      return true;
    });
    this.registerCapabilityListener('lg_dry_select', async value => {
      await this.updateSelectedOption('dryLevel', value);
      return true;
    });
    this.registerCapabilityListener('lg_soil_select', async value => {
      await this.updateSelectedOption('soilWash', value);
      return true;
    });
    this.registerCapabilityListener('lg_load_item_select', async value => {
      await this.updateSelectedOption('loadItemWasher', value);
      return true;
    });
    this.registerCapabilityListener('lg_delay_end_select', async value => {
      await this.setDelayEnd(value);
      return true;
    });
    this.registerCapabilityListener('lg_prewash_toggle', async value => {
      await this.setBooleanFlowOption('preWash', Boolean(value), 'PREWASH_ON', 'PREWASH_OFF');
      return true;
    });
    this.registerCapabilityListener('lg_turbowash_toggle', async value => {
      await this.setBooleanFlowOption('turboWash', Boolean(value), 'TURBOWASH_ON', 'TURBOWASH_OFF');
      return true;
    });
    this.registerCapabilityListener('lg_steam_toggle', async value => {
      await this.setBooleanFlowOption('steam', Boolean(value), 'STEAM_ON', 'STEAM_OFF');
      return true;
    });
    this.registerCapabilityListener('lg_medic_rinse_toggle', async value => {
      await this.setBooleanFlowOption('medicRinse', Boolean(value), 'MEDICRINSE_ON', 'MEDICRINSE_OFF');
      return true;
    });
    this.registerCapabilityListener('lg_eco_hybrid_toggle', async value => {
      await this.setBooleanFlowOption('ecoHybrid', Boolean(value), 'ECOHYBRID_ON', 'ECOHYBRID_OFF');
      return true;
    });
    this.registerCapabilityListener('lg_start_button', async () => {
      this.log('Directe Homey-knop: Start wasmachine');
      await this.startWasher();
      return true;
    });
    this.registerCapabilityListener('lg_wakeup_button', async () => {
      this.log('Directe Homey-knop: Uit slaapstand halen');
      await this.wakeupWasher();
      return true;
    });
    this.registerCapabilityListener('lg_pause_button', async () => {
      this.log('Directe Homey-knop: Wasmachine pauzeren');
      await this.pauseWasher();
      return true;
    });
    this.registerCapabilityListener('lg_poweroff_button', async () => {
      this.log('Directe Homey-knop: Wasmachine uitschakelen');
      await this.powerOffWasher();
      return true;
    });
    this.registerCapabilityListener('lg_refresh_button', async () => {
      this.log('Directe Homey-knop: Nu verversen');
      await this.refreshNow();
      await this.refreshThinQ2();
      return true;
    });
    await this.refreshNow().catch(this.error);
    await this.refreshThinQ2().catch(err => this.error('ThinQ2 refresh init:', err));
    this._interval = this.homey.setInterval(async () => {
      await this.refreshNow().catch(err => this.error('ThinQ Connect poll:', err));
      await this.refreshThinQ2().catch(err => this.error('ThinQ2 poll:', err));
      await this._checkSmartWashPlan().catch(err => this.error('Slim Wassen planner:', err));
      await this._pushWidgetLiveStatus().catch(() => {});
    }, 30000);

    // Check immediately as well, so a planned wash is not lost after an app restart.
    await this._checkSmartWashPlan().catch(err => this.error('Slim Wassen init:', err));
    await this._pushWidgetLiveStatus().catch(() => {});
  }

  async _ensureCapabilities() {
    const wanted = [
      'lg_state','lg_current_program','lg_remaining','lg_total',
      'lg_temperature','lg_spin','lg_rinse','lg_dry_level',
      'lg_remote_control','lg_operation_mode','lg_cycle_count',
      'lg_thinq2_status','lg_course_count',
      'lg_program_select','lg_temp_select','lg_spin_select','lg_rinse_select',
      'lg_dry_select','lg_soil_select','lg_load_item_select','lg_delay_end_select',
      'lg_prewash_toggle','lg_turbowash_toggle','lg_steam_toggle',
      'lg_medic_rinse_toggle','lg_eco_hybrid_toggle',
      'lg_start_button','lg_pause_button','lg_wakeup_button',
      'lg_poweroff_button','lg_refresh_button'
    ];
    for (const cap of wanted) {
      if (!this.hasCapability(cap)) await this.addCapability(cap);
    }
    if (this.hasCapability('lg_course_summary')) {
      await this.removeCapability('lg_course_summary').catch(this.error);
    }
  }

  async _initFlowCards() {
    this._startedTrigger = this.homey.flow.getDeviceTriggerCard('washing_started');
    this._finishedTrigger = this.homey.flow.getDeviceTriggerCard('washing_finished');
    this._errorTrigger = this.homey.flow.getDeviceTriggerCard('washer_error');
    this._stateChangedTrigger = this.homey.flow.getDeviceTriggerCard('state_changed');
    this._programChangedTrigger = this.homey.flow.getDeviceTriggerCard('program_changed');
    this._rinsingStartedTrigger = this.homey.flow.getDeviceTriggerCard('rinsing_started');
    this._spinningStartedTrigger = this.homey.flow.getDeviceTriggerCard('spinning_started');
    this._dryingStartedTrigger = this.homey.flow.getDeviceTriggerCard('drying_started');
    this._remoteStartEnabledTrigger = this.homey.flow.getDeviceTriggerCard('remote_start_enabled');
    this._remoteStartDisabledTrigger = this.homey.flow.getDeviceTriggerCard('remote_start_disabled');
    this._doorLockedTrigger = this.homey.flow.getDeviceTriggerCard('door_locked');
    this._doorUnlockedTrigger = this.homey.flow.getDeviceTriggerCard('door_unlocked');
    this._childLockEnabledTrigger = this.homey.flow.getDeviceTriggerCard('child_lock_enabled');
    this._childLockDisabledTrigger = this.homey.flow.getDeviceTriggerCard('child_lock_disabled');
    this._smartWashPlannedTrigger = this.homey.flow.getDeviceTriggerCard('smart_wash_planned');
    this._smartWashReplannedTrigger = this.homey.flow.getDeviceTriggerCard('smart_wash_replanned');
    this._smartWashStartedTrigger = this.homey.flow.getDeviceTriggerCard('smart_wash_started');
    this._smartWashStartFailedTrigger = this.homey.flow.getDeviceTriggerCard('smart_wash_start_failed');
    this._smartWashRemoteMissingTrigger = this.homey.flow.getDeviceTriggerCard('smart_wash_remote_missing');
  }

  _api() {
    const token = this.getStoreValue('token');
    const country = this.getStoreValue('country') || 'NL';
    const clientId = this.getStoreValue('client_id') || this.homey.app.id;
    if (!token) throw new Error('ThinQ token ontbreekt. Verwijder het apparaat en koppel opnieuw.');
    return new ThinQConnect({ token, country, clientId });
  }

  async _set(cap, value) {
    if (!this.hasCapability(cap)) return;
    if (value === undefined) return;
    try {
      await this.setCapabilityValue(cap, value);
    } catch (e) {
      this.error(`Capability ${cap}:`, e);
    }
  }


  async _setProgramSelectSafe(value) {
    if (!value || value === 'NOT_SELECTED') {
      this.log(`Programmakeuze niet bijgewerkt: LG rapporteert ${value || 'leeg'}; laatst geldige Homey-keuze blijft staan.`);
      return;
    }

    const cap = this.homey?.manifest?.capabilities?.lg_program_select;
    const allowed = Array.isArray(cap?.values) ? cap.values.map(x => x.id) : [
      'COTTON','EASYCARE','COTTONPLUS','MIXEDFABRIC','BABYSTEAMCARE','SPEED14',
      'TUB_CLEAN','WOOL','DELICATE','ALLERGYSPASTEAM','TURBO59','DRYONLY','WASHDRY','SPINONLY'
    ];

    if (!allowed.includes(value)) {
      this.log(`Programmakeuze niet bijgewerkt: LG rapporteert ${value}, maar dit staat niet in de Homey-keuzelijst.`);
      return;
    }

    await this._set('lg_program_select', value);
    await this.setStoreValue('last_valid_program_id', value);
  }

  async refreshNow() {
    const id = this.getData().id;
    const api = this._api();

    let stateRaw;
    try {
      stateRaw = await api.getState(id);
      this._thinQConnect416Logged = false;
    } catch (err) {
      // LG ThinQ Connect intermittently returns 416 "Not connected device"
      // while ThinQ2 still reports the washer online. Treat this as a temporary
      // Connect-side condition and keep the last values; ThinQ2 will continue
      // to refresh the live tiles.
      if (err?.status === 416 || /ThinQ API 416/i.test(err?.message || '')) {
        if (!this._thinQConnect416Logged) {
          this.log('ThinQ Connect tijdelijk niet beschikbaar (416 Not connected device); ThinQ2 fallback actief.');
          this._thinQConnect416Logged = true;
        }
        return { state: this.getStoreValue('last_state') || null, profile: this._profileCache };
      }
      throw err;
    }

    // Device profile is effectively static. Do not request it every 30 seconds.
    let profile = this._profileCache;
    if (!profile) {
      try {
        profile = await api.getProfile(id);
        this._profileCache = profile;
        await this.setStoreValue('last_profile', profile);
      } catch (err) {
        this.error('ThinQ Connect profile:', err);
      }
    }

    const state = unwrapRoot(stateRaw);
    await this.setStoreValue('last_state', stateRaw);

    // ThinQ Connect returns one washer state object with nested groups.
    // Read the explicit paths first; only use deepFind as fallback.
    const runState =
      state?.runState?.currentState ??
      state?.processState?.currentState ??
      deepFind(state, ['currentState']);

    const remainH = Number(state?.timer?.remainHour ?? deepFind(state, ['remainHour']) ?? 0);
    const remainM = Number(state?.timer?.remainMinute ?? deepFind(state, ['remainMinute']) ?? 0);
    const totalH = Number(state?.timer?.totalHour ?? deepFind(state, ['totalHour']) ?? 0);
    const totalM = Number(state?.timer?.totalMinute ?? deepFind(state, ['totalMinute']) ?? 0);

    const remote =
      state?.remoteControlEnable?.remoteControlEnabled ??
      deepFind(state, ['remoteControlEnabled']);

    const op =
      state?.operation?.washerOperationMode ??
      deepFind(state, ['washerOperationMode','operationMode']);

    const cycles = state?.cycle?.cycleCount ?? deepFind(state, ['cycleCount']);

    // ThinQ2 is authoritative for the visible washer state. ThinQ Connect can
    // briefly report SLEEP while ThinQ2 still reports INITIAL/Gereed, which
    // caused a one-second Gereed -> Slaapstand -> Gereed flicker in Homey.
    // Only use Connect as state fallback until ThinQ2 has supplied a state.
    const hasThinQ2State = Boolean(this._lastWd?.state);
    if (!hasThinQ2State) {
      await this._set('lg_state', stateLabel(runState));
    }

    await this._set('lg_remaining', `${remainH}u ${String(remainM).padStart(2,'0')}m`);
    await this._set('lg_total', `${totalH}u ${String(totalM).padStart(2,'0')}m`);
    const remoteBool =
      remote === true ||
      String(remote).toUpperCase() === 'ON' ||
      String(remote).toUpperCase() === 'TRUE';

    await this._set('lg_remote_control', remoteBool);
    await this._set('lg_operation_mode', op ? String(op) : (remoteBool ? 'Afstandsbediening actief' : stateLabel(runState)));
    await this._set('lg_cycle_count', Number.isFinite(Number(cycles)) ? Number(cycles) : 0);

    this.log(
      `STATUS parsed: state=${stateLabel(runState)}, remote=${remoteBool}, ` +
      `remaining=${remainH}:${String(remainM).padStart(2,'0')}, total=${totalH}:${String(totalM).padStart(2,'0')}, cycles=${cycles}`
    );

    const current = String(runState || '').toUpperCase();
    // When ThinQ2 is available it owns state changes as well. Do not let a
    // transient Connect SLEEP value create a false state transition.
    if (!hasThinQ2State && current && current !== this._lastState) {
      await this._handleWasherStateTransition(current);
    }

    this.log('STATE_JSON', JSON.stringify(stateRaw));
    return { state: stateRaw, profile };
  }

  _legacyClient() {
    const refreshToken = this.getStoreValue('legacy_refresh_token');
    if (!refreshToken) throw new Error('Geen ThinQ2 refresh-token aanwezig.');
    return {
      client: new ThinQ2Legacy({
        country: this.getStoreValue('country') || 'NL',
        language: this.getStoreValue('legacy_language') || 'nl-NL',
        logger: this
      }),
      refreshToken
    };
  }

  async _handleWasherStateTransition(currentRaw) {
    const current = String(currentRaw || '').toUpperCase();
    if (!current || current === this._lastState) return;

    await this._stateChangedTrigger.trigger(this, { state: stateLabel(current) }).catch(this.error);
    if (current === 'RUNNING' && this._lastState !== 'RUNNING') {
      await this._startedTrigger.trigger(this).catch(this.error);
    }
    if (current === 'RINSING') {
      await this._rinsingStartedTrigger.trigger(this).catch(this.error);
    }
    if (current === 'SPINNING') {
      await this._spinningStartedTrigger.trigger(this).catch(this.error);
    }
    if (current === 'DRYING') {
      await this._dryingStartedTrigger.trigger(this).catch(this.error);
    }
    if (current === 'END' && this._lastState !== 'END') {
      await this._finishedTrigger.trigger(this, {
        program: this.getCapabilityValue('lg_current_program') || 'Onbekend',
        message: `LG wasprogramma klaar: ${this.getCapabilityValue('lg_current_program') || 'Onbekend'}.`
      }).catch(this.error);
    }
    if (current === 'ERROR' && this._lastState !== 'ERROR') {
      await this._errorTrigger.trigger(this, {
        error: this._lastError || 'Onbekende fout',
        message: `LG wasmachine storing: ${this._lastError || 'Onbekende fout'}.`
      }).catch(this.error);
    }
    this._lastState = current;
  }

  async refreshThinQ2() {
    const { client, refreshToken } = this._legacyClient();
    await this._set('lg_thinq2_status', 'Verbinden...');
    await client.refresh(refreshToken);

    const devices = await client.getDevices();
    let legacyId = this.getStoreValue('legacy_device_id');
    let candidate = devices.find(d => d.deviceId === legacyId);

    if (!candidate) {
      const model = String(this.getStoreValue('model_name') || '').toUpperCase();
      candidate = devices.find(d => String(d.modelName || '').toUpperCase() === model)
        || devices.find(d => [201,221].includes(Number(d.deviceType)));
    }
    if (!candidate) throw new Error('Wasmachine niet gevonden in ThinQ2.');

    legacyId = candidate.deviceId;
    await this.setStoreValue('legacy_device_id', legacyId);

    const detail = await client.getSingleDevice(legacyId);
    const mc = await client.getModelAndCourses({ ...candidate, ...detail });
    const model = mc.model || {};
    this._modelJson = model;
    this._courses = model.Course || {};
    this._smartCourses = model.SmartCourse || {};

    const wd = candidate?.snapshot?.washerDryer || detail?.snapshot?.washerDryer || {};
    this._lastWd = wd;
    this._lastThinQ2Online = candidate?.online === true || detail?.online === true;

    // ThinQ2 event-style Flow triggers.
    const liveState = String(wd.state || '').toUpperCase();
    if (liveState) {
      await this._handleWasherStateTransition(liveState);
    }

    const remoteOnNow = String(wd.remoteStart || '').toUpperCase() === 'REMOTE_START_ON';
    const doorLockedNow = String(wd.doorLock || '').toUpperCase() === 'DOOR_LOCK_ON';
    const childLockNow = String(wd.childLock || '').toUpperCase() === 'CHILDLOCK_ON';
    const errorNow = String(wd.error || 'ERROR_NO');

    if (this._lastRemoteStart !== null && remoteOnNow !== this._lastRemoteStart) {
      const card = remoteOnNow ? this._remoteStartEnabledTrigger : this._remoteStartDisabledTrigger;
      await card.trigger(this).catch(this.error);
    }
    if (this._lastDoorLock !== null && doorLockedNow !== this._lastDoorLock) {
      const card = doorLockedNow ? this._doorLockedTrigger : this._doorUnlockedTrigger;
      await card.trigger(this).catch(this.error);
    }
    if (this._lastChildLock !== null && childLockNow !== this._lastChildLock) {
      const card = childLockNow ? this._childLockEnabledTrigger : this._childLockDisabledTrigger;
      await card.trigger(this).catch(this.error);
    }
    if (errorNow !== 'ERROR_NO' && errorNow !== this._lastError) {
      await this._errorTrigger.trigger(this, {
        error: errorNow || 'Onbekende fout',
        message: `LG wasmachine storing: ${errorNow || 'Onbekende fout'}.`
      }).catch(err => this.error('LG storing Flow-trigger:', safeErrorMessage(err)));
    }

    this._lastRemoteStart = remoteOnNow;
    this._lastDoorLock = doorLockedNow;
    this._lastChildLock = childLockNow;
    this._lastError = errorNow;

    // ThinQ2 contains richer live washer values. Use them to fill/verify tiles.
    if (wd.state) {
      await this._set('lg_state', stateLabel(wd.state));
      this.log(`STATUS bron ThinQ2: ${stateLabel(wd.state)}`);
    }
    if (wd.remoteStart) {
      const remoteOn = String(wd.remoteStart).toUpperCase() === 'REMOTE_START_ON';
      await this._set('lg_remote_control', remoteOn);
      await this._set('lg_operation_mode', remoteOn ? 'Afstandsbediening actief' : stateLabel(wd.state));
    }
    if (wd.TCLCount !== undefined) {
      await this._set('lg_cycle_count', Number(wd.TCLCount) || 0);
    }
    if (wd.initialTimeHour !== undefined || wd.initialTimeMinute !== undefined) {
      await this._set(
        'lg_total',
        `${Number(wd.initialTimeHour || 0)}u ${String(Number(wd.initialTimeMinute || 0)).padStart(2,'0')}m`
      );
    }
    if (wd.remainTimeHour !== undefined || wd.remainTimeMinute !== undefined) {
      await this._set(
        'lg_remaining',
        `${Number(wd.remainTimeHour || 0)}u ${String(Number(wd.remainTimeMinute || 0)).padStart(2,'0')}m`
      );
    }

    const courseKey = wd[model?.Config?.courseType || 'courseFL24inchBaseTitan']
      || wd.courseFL24inchBaseTitan
      || wd.course;

    const course = this._courses?.[courseKey];
    const courseName = course?._comment || courseKey || '-';
    await this._set('lg_current_program', courseName);
    if (courseKey && this._lastProgram !== null && courseKey !== this._lastProgram) {
      await this._programChangedTrigger.trigger(this, { program: courseName }).catch(this.error);
    }
    if (courseKey) this._lastProgram = courseKey;

    if (courseKey && this.hasCapability('lg_program_select')) {
      await this._setProgramSelectSafe(courseKey);
    }

    // During RINSING/SPINNING LG often reports temp=NO_TEMP even though a
    // temperature was selected for the program. Keep the last meaningful
    // selected value instead of clearing the picker.
    let selectedTemp = wd.temp;
    if (selectedTemp && selectedTemp !== 'NO_TEMP') {
      await this.setStoreValue('last_selected_temp', selectedTemp);
    } else {
      selectedTemp =
        this.getStoreValue('last_selected_temp') ||
        this.getCapabilityValue('lg_temp_select') ||
        courseDefault(course, 'temp') ||
        null;
    }

    if (selectedTemp && selectedTemp !== 'NO_TEMP') {
      await this._set('lg_temp_select', selectedTemp);
      await this._set('lg_temperature', tempLabel(selectedTemp));
    } else {
      await this._set('lg_temperature', '-');
    }

    let selectedSpin = wd.spin;
    if (selectedSpin === 'SPIN_1400') {
      this.log('LG rapporteert SPIN_1400; Homey vertaalt dit naar SPIN_Max.');
      selectedSpin = 'SPIN_Max';
    }
    if (selectedSpin && selectedSpin !== 'NOT_SELECTED') {
      await this.setStoreValue('last_selected_spin', selectedSpin);
    } else {
      selectedSpin =
        this.getStoreValue('last_selected_spin') ||
        this.getCapabilityValue('lg_spin_select') ||
        courseDefault(course, 'spin') ||
        null;
    }
    if (selectedSpin && selectedSpin !== 'NOT_SELECTED') {
      await this._set('lg_spin_select', selectedSpin);
      await this._set('lg_spin', spinLabel(selectedSpin));
    }

    let selectedRinse = wd.rinse;
    if (selectedRinse && selectedRinse !== 'NO_RINSE') {
      await this.setStoreValue('last_selected_rinse', selectedRinse);
    } else {
      selectedRinse =
        this.getStoreValue('last_selected_rinse') ||
        this.getCapabilityValue('lg_rinse_select') ||
        courseDefault(course, 'rinse') ||
        null;
    }
    if (selectedRinse && selectedRinse !== 'NO_RINSE') {
      await this._set('lg_rinse_select', selectedRinse);
      await this._set('lg_rinse', rinseLabel(selectedRinse));
    }

    if (wd.dryLevel) {
      await this._set('lg_dry_select', wd.dryLevel);
      await this._set('lg_dry_level', dryLabel(wd.dryLevel));
    }
    if (wd.soilWash) await this._set('lg_soil_select', wd.soilWash);
    if (wd.loadItemWasher) await this._set('lg_load_item_select', wd.loadItemWasher);
    if (wd.reserveTimeHour !== undefined) {
      const delayValue = Number(wd.reserveTimeHour || 0);
      await this._set('lg_delay_end_select', String(delayValue));
    }
    if (wd.preWash) await this._set('lg_prewash_toggle', wd.preWash === 'PREWASH_ON');
    if (wd.turboWash) await this._set('lg_turbowash_toggle', wd.turboWash === 'TURBOWASH_ON');
    if (wd.steam) await this._set('lg_steam_toggle', wd.steam === 'STEAM_ON');
    if (wd.medicRinse) await this._set('lg_medic_rinse_toggle', wd.medicRinse === 'MEDICRINSE_ON');
    if (wd.ecoHybrid) await this._set('lg_eco_hybrid_toggle', wd.ecoHybrid === 'ECOHYBRID_ON');
    await this._set('lg_course_count', Object.keys(this._courses).length);
    await this._set('lg_thinq2_status', 'OK');

    this.log(`ThinQ2: ${Object.keys(this._courses).length} programma's geladen; huidig=${courseName}`);
    return { client, candidate, detail, model };
  }

  async getProgramAutocomplete(query) {
    if (!this._modelJson || !Object.keys(this._courses).length) {
      await this.refreshThinQ2();
    }
    const q = String(query || '').toLowerCase();
    return Object.entries(this._courses)
      .filter(([,v]) => v?.controlEnable !== false)
      .map(([id,v]) => ({
        name: v?._comment || id,
        description: id,
        id
      }))
      .filter(x => !q || x.name.toLowerCase().includes(q) || x.id.toLowerCase().includes(q))
      .slice(0, 50);
  }

  async getProgramOptionAutocomplete(programId, key, query) {
    if (!this._modelJson || !Object.keys(this._courses).length) {
      await this.refreshThinQ2();
    }

    const course = this._courses?.[programId];
    if (!course) return [];

    const fn = (course.function || []).find(x => x?.value === key);
    let options = fn?.selectable ? [...fn.selectable] : (fn?.default ? [fn.default] : []);

    const q = String(query || '').toLowerCase();

    const labels = {
      TEMP_COLD:'Koud', TEMP_20:'20 °C', TEMP_30:'30 °C', TEMP_40:'40 °C',
      TEMP_50:'50 °C', TEMP_60:'60 °C', TEMP_95:'95 °C',
      NO_SPIN:'Niet centrifugeren', SPIN_400:'400 rpm', SPIN_600:'600 rpm',
      SPIN_700:'700 rpm', SPIN_800:'800 rpm', SPIN_900:'900 rpm',
      SPIN_1000:'1000 rpm', SPIN_1100:'1100 rpm', SPIN_1200:'1200 rpm',
      SPIN_1600:'1600 rpm', SPIN_Max:'Maximum',
      RINSE_NORMAL:'Normaal', RINSE_PLUS:'Extra', RINSE_PLUSPLUS:'Extra +',
      RINSE_NORMAL_HOLD:'Normaal + stop', RINSE_PLUS_HOLD:'Extra + stop',
      NOT_SELECTED:'Niet geselecteerd', NO_DRYLEVEL:'Geen',
      DRYLEVEL_NORMAL:'Normaal', DRYLEVEL_30:'30 min', DRYLEVEL_60:'60 min',
      DRYLEVEL_90:'90 min', DRYLEVEL_120:'120 min', DRYLEVEL_150:'150 min',
      DRYLEVEL_ECO:'Eco', DRYLEVEL_VERY:'Extra droog', DRYLEVEL_IRON:'Strijkdroog',
      DRYLEVEL_LOW:'Lage temperatuur', DRYLEVEL_ENERGY:'Energie', DRYLEVEL_SPEED:'Snel'
    };

    return options
      .map(id => ({ id, name: labels[id] || id }))
      .filter(x => !q || x.name.toLowerCase().includes(q) || x.id.toLowerCase().includes(q));
  }

  async _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async _ensureWasherAwake(client, legacyId) {
    const state = String(this._lastState || '').toUpperCase();
    if (state !== 'SLEEP') return true;

    this.log('[ThinQ2] Wasmachine staat in SLEEP; WMWakeup wordt eerst verstuurd.');
    await this._thinQ2Write(client, legacyId, 'WMWakeup', {
      controlDataType:'WAKEUP',
      controlDataValueLength:0
    });

    // ThinQ Connect can lag a few seconds behind the ThinQ2 wake command.
    // Poll the official state, but do not block forever if LG is slow to update.
    for (let i = 0; i < 8; i++) {
      await this._sleep(1500);
      try {
        await this.refreshNow();
      } catch (err) {
        this.log(`[ThinQ2] Wake statuscontrole ${i + 1}/8 kon niet worden gelezen: ${err.message || err}`);
      }

      const now = String(this._lastState || '').toUpperCase();
      this.log(`[ThinQ2] Wake statuscontrole ${i + 1}/8: ${now || 'ONBEKEND'}`);
      if (now && now !== 'SLEEP') {
        this.log(`[ThinQ2] Wasmachine is wakker: ${now}`);
        return true;
      }
    }

    this.log('[ThinQ2] ThinQ Connect meldt na wake nog SLEEP; control-write wordt toch geprobeerd.');
    return false;
  }

  async _thinQ2Write(client, legacyId, command, payload) {
    const clean = this._sanitizeWasherPayload(payload, command);
    this.log(`[ThinQ2] ${command} WASHER PAYLOAD: ${JSON.stringify(clean)}`);
    try {
      const response = await client.setWasher(legacyId, command, clean);
      this.log(`[ThinQ2] ${command} RESPONSE: ${JSON.stringify(response)}`);
      return response;
    } catch (err) {
      const status = err?.status || err?.response?.status || err?.statusCode || 'ERR';
      const body = err?.payload || err?.response?.data || err?.body || err?.message;
      this.error(`[ThinQ2] ${command} HTTP ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
      throw err;
    }
  }

  _sanitizeWasherPayload(payload, context = 'unknown') {
    const out = { ...(payload || {}) };

    // LG's model uses SmartCourse='temp' as a template placeholder.
    // For a normal Course the working ThinQ2 implementations explicitly send
    // SmartCourse='NOT_SELECTED' (do not remove the field).
    const internalSmartCourse = new Set(['temp', 'spin', 'rinse', 'dry', 'soil', 'program']);
    if (typeof out.SmartCourse === 'string' && internalSmartCourse.has(out.SmartCourse.toLowerCase())) {
      this.log(`ThinQ2 ${context}: SmartCourse=${out.SmartCourse} -> NOT_SELECTED.`);
      out.SmartCourse = 'NOT_SELECTED';
    }

    for (const [key, value] of Object.entries(out)) {
      if (typeof value === 'undefined') delete out[key];
    }

    return out;
  }

  async configureProgram(options) {
    const programId = options.programId;
    if (!this._courses?.[programId]) await this.refreshThinQ2();

    const course = this._courses?.[programId];
    if (!course) throw new Error(`Onbekend programma: ${programId}`);

    const wd = this._programPayload(programId);

    const setIfValid = (key, value) => {
      if (!value) return;
      const fn = (course.function || []).find(x => x?.value === key);
      if (fn?.selectable && !fn.selectable.includes(value)) {
        throw new Error(`${value} is niet toegestaan bij ${course._comment || programId}.`);
      }
      wd[key] = value;
    };

    setIfValid('temp', options.temperature);
    setIfValid('spin', options.spin);
    setIfValid('rinse', options.rinse);
    setIfValid('dryLevel', options.dry);

    const boolOption = (key, enabled, onValue, offValue) => {
      const fn = (course.function || []).find(x => x?.value === key);
      if (!fn) return;
      wd[key] = enabled ? onValue : offValue;
    };

    boolOption('preWash', options.prewash, 'PREWASH_ON', 'PREWASH_OFF');
    boolOption('turboWash', options.turbo, 'TURBOWASH_ON', 'TURBOWASH_OFF');
    boolOption('steam', options.steam, 'STEAM_ON', 'STEAM_OFF');

    wd.courseDownloadType = 'COURSEDATA';
    wd.courseDownloadDataLength = 21;

    const { client } = await this.refreshThinQ2();
    const legacyId = this.getStoreValue('legacy_device_id');

    this.log('WMDownload combined payload:', JSON.stringify(wd));
    await this._ensureWasherAwake(client, legacyId);
    const wmDownloadResponse = await this._thinQ2Write(client, legacyId, 'WMDownload', wd);
    this.log('WMDownload response:', JSON.stringify(wmDownloadResponse));

    await this.setStoreValue('selected_program_id', programId);
    await this.setStoreValue('selected_program_payload', wd);

    await this._set('lg_current_program', course._comment || programId);
    await this._setProgramSelectSafe(programId);

    if (wd.temp && wd.temp !== 'NO_TEMP') {
      await this.setStoreValue('last_selected_temp', wd.temp);
      await this._set('lg_temp_select', wd.temp);
      await this._set('lg_temperature', tempLabel(wd.temp));
    }
    if (wd.spin && wd.spin !== 'NOT_SELECTED') {
      await this.setStoreValue('last_selected_spin', wd.spin);
      await this._set('lg_spin_select', wd.spin);
      await this._set('lg_spin', spinLabel(wd.spin));
    }
    if (wd.rinse && wd.rinse !== 'NO_RINSE') {
      await this.setStoreValue('last_selected_rinse', wd.rinse);
      await this._set('lg_rinse_select', wd.rinse);
      await this._set('lg_rinse', rinseLabel(wd.rinse));
    }
    if (wd.dryLevel) {
      await this._set('lg_dry_level', dryLabel(wd.dryLevel));
    }

    return true;
  }

  async getCurrentProgramId() {
    let id = this.getStoreValue('selected_program_id') || this.getCapabilityValue('lg_program_select');
    if (id && this._courses?.[id]) return id;
    await this.refreshThinQ2();
    id = this.getCapabilityValue('lg_program_select');
    return id || this._lastProgram;
  }

  async getCurrentOptionAutocomplete(key, query) {
    const programId = await this.getCurrentProgramId();
    if (!programId) return [];
    return this.getProgramOptionAutocomplete(programId, key, query || '');
  }

  async setFlowOption(key, value) {
    if (!value) throw new Error('Geen waarde geselecteerd.');
    return this.updateSelectedOption(key, value);
  }

  async setBooleanFlowOption(key, enabled, onValue, offValue) {
    return this.updateSelectedOption(key, enabled ? onValue : offValue);
  }

  async setDelayEnd(hours) {
    const h = Number(hours);
    if (![0, ...Array.from({length:17}, (_,i)=>i+3)].includes(h)) {
      throw new Error('Uitgestelde eindtijd moet uit, of 3 t/m 19 uur zijn.');
    }
    return this.updateSelectedOption('reserveTimeHour', h);
  }

  async getSmartCourseAutocomplete(query) {
    if (!this._modelJson || !Object.keys(this._smartCourses).length) {
      await this.refreshThinQ2();
    }
    const q = String(query || '').toLowerCase();
    return Object.entries(this._smartCourses)
      .filter(([,v]) => v?.downloadEnable !== false && v?.controlEnable !== false)
      .map(([id,v]) => ({ id, name:v?._comment || id, description:v?.Course || '' }))
      .filter(x => !q || x.name.toLowerCase().includes(q) || x.id.toLowerCase().includes(q))
      .slice(0, 50);
  }

  async downloadSmartCourse(programId) {
    if (!this._modelJson || !this._smartCourses?.[programId]) await this.refreshThinQ2();
    const smart = this._smartCourses?.[programId];
    if (!smart) throw new Error(`Onbekend extra programma: ${programId}`);

    const wd = this._programPayload(smart.Course && this._courses?.[smart.Course] ? smart.Course : (this._modelJson?.Config?.defaultCourse || 'COTTON'));
    const { courseType, smartCourseType } = this._courseFieldNames();
    if (smart.Course) wd[courseType] = smart.Course;
    wd[smartCourseType] = programId;
    wd.courseDownloadType = 'COURSEDATA';
    wd.courseDownloadDataLength = 21;

    for (const fn of (smart.function || [])) {
      if (fn?.value && fn.default !== undefined) wd[fn.value] = fn.default;
    }

    const { client } = await this.refreshThinQ2();
    const legacyId = this.getStoreValue('legacy_device_id');
    this.log('WMDownload SmartCourse payload:', JSON.stringify(wd));
    await this._ensureWasherAwake(client, legacyId);
    await this._thinQ2Write(client, legacyId, 'WMDownload', wd);
    await this.setStoreValue('selected_program_payload', wd);
    return true;
  }

  async powerOffWasher() {
    const { client } = await this.refreshThinQ2();
    const legacyId = this.getStoreValue('legacy_device_id');
    return this._thinQ2Write(client, legacyId, 'WMOff', {
      controlDataType:'POWEROFF',
      controlDataValueLength:1,
      controlDataValue:0
    });
  }

  async wakeupWasher() {
    const { client } = await this.refreshThinQ2();
    const legacyId = this.getStoreValue('legacy_device_id');
    const liveState = String(this._lastWd?.state || this._lastState || '').toUpperCase();

    // IMPORTANT: LG accepts WMWakeup while a cycle is active, but on at least
    // some washer/washer-dryer models that command immediately powers the
    // appliance down. Never send WMWakeup during an active cycle.
    if (this.isRunning() || ['RUNNING','RINSING','SPINNING','DRYING','DETECTING','RESERVED','COOLDOWN','RINSEHOLD'].includes(liveState)) {
      this.log(`[ThinQ2] WMWakeup geblokkeerd: wasmachine is actief (${liveState || 'ONBEKEND'}).`);
      throw new Error('Wakker maken is niet toegestaan terwijl de wasmachine actief is.');
    }

    // If the machine is already awake/ready, there is nothing to do.
    if (liveState && !['SLEEP','POWER_OFF','POWEROFF'].includes(liveState)) {
      this.log(`[ThinQ2] WMWakeup overgeslagen: wasmachine is al wakker (${liveState}).`);
      return { resultCode:'0000', skipped:true, state:liveState };
    }

    const response = await this._thinQ2Write(client, legacyId, 'WMWakeup', {
      controlDataType:'WAKEUP',
      controlDataValueLength:0
    });
    await this._sleep(1500);
    await this.refreshNow().catch(err => this.log(`Wake refresh: ${safeErrorMessage(err)}`));
    return response;
  }

  isRunning() {
    return ['RUNNING','RINSING','SPINNING','DRYING','DETECTING','RESERVED','COOLDOWN','RINSEHOLD']
      .includes(String(this._lastWd?.state || this._lastState || '').toUpperCase());
  }

  isRemoteStartEnabled() { return this._lastRemoteStart === true; }
  isDoorLocked() { return this._lastDoorLock === true; }
  isChildLockEnabled() { return this._lastChildLock === true; }
  hasError() { return !!this._lastError && this._lastError !== 'ERROR_NO'; }
  isThinQ2Online() { return this._lastThinQ2Online === true; }

  stateIs(state) {
    return String(this._lastWd?.state || this._lastState || '').toUpperCase() === String(state || '').toUpperCase();
  }

  programIs(programId) {
    return String(this._lastProgram || this.getCapabilityValue('lg_program_select') || '') === String(programId || '');
  }

  _courseFieldNames() {
    const cfg = this._modelJson?.Config || {};
    return {
      courseType: cfg.courseType || 'course',
      smartCourseType: cfg.smartCourseType || 'SmartCourse',
      downloadedCourseType: cfg.downloadedCourseType || null
    };
  }

  _programPayload(programId) {
    const course = this._courses?.[programId];
    if (!course) throw new Error(`Onbekend programma: ${programId}`);

    const { courseType, smartCourseType } = this._courseFieldNames();

    const wd = {
      soilWash:'NO_SOILWASH',
      spin:'NOT_SELECTED',
      temp:'NO_TEMP',
      rinse:'NO_RINSE',
      dryLevel:'NOT_SELECTED',
      reserveTimeHour:0,
      reserveTimeMinute:0,
      loadItemWasher:'LOADITEM_OFF',
      turboWash:'TURBOWASH_OFF',
      creaseCare:'CREASECARE_OFF',
      steamSoftener:'STEAMSOFTENER_OFF',
      ecoHybrid:'ECOHYBRID_OFF',
      medicRinse:'MEDICRINSE_OFF',
      rinseSpin:'RINSE_SPIN_OFF',
      preWash:'PREWASH_OFF',
      steam:'STEAM_OFF',
      initialBit:'INITIAL_BIT_OFF',
      remoteStart:'REMOTE_START_OFF',
      wrinkleCare:'WRINKLECARE_OFF',
      doorLock:'DOOR_LOCK_OFF',
      childLock:'CHILDLOCK_OFF'
    };

    // ioBroker/LG model JSON uses Config.courseType and Config.smartCourseType.
    // On this washer the active course field may NOT literally be "course".
    wd[courseType] = programId;
    wd[smartCourseType] = 'NOT_SELECTED';

    for (const fn of (course.function || [])) {
      if (fn?.value && fn.default !== undefined) wd[fn.value] = fn.default;
    }
    return wd;
  }

  async selectProgram(programId) {
    if (!this._courses?.[programId]) await this.refreshThinQ2();
    const course = this._courses?.[programId];
    if (!course) throw new Error(`Onbekend programma: ${programId}`);

    const pending = this.getStoreValue('pending_flow_config') || {};
    pending.programId = programId;
    pending.updatedAt = Date.now();
    await this.setStoreValue('pending_flow_config', pending);
    await this.setStoreValue('selected_program_id', programId);

    await this._set('lg_current_program', course._comment || programId);
    await this._setProgramSelectSafe(programId);

    this.log('Flow staging - programma:', programId, JSON.stringify(pending));
    return true;
  }

  async updateSelectedOption(key, value) {
    if (!value) throw new Error('Geen waarde geselecteerd.');

    const pending = this.getStoreValue('pending_flow_config') || {};
    pending.options = { ...(pending.options || {}), [key]: value };
    pending.updatedAt = Date.now();
    await this.setStoreValue('pending_flow_config', pending);

    if (key === 'temp') {
      await this.setStoreValue('last_selected_temp', value);
      await this._set('lg_temp_select', value);
      await this._set('lg_temperature', tempLabel(value));
    } else if (key === 'spin') {
      await this.setStoreValue('last_selected_spin', value);
      await this._set('lg_spin_select', value);
      await this._set('lg_spin', spinLabel(value));
    } else if (key === 'rinse') {
      await this.setStoreValue('last_selected_rinse', value);
      await this._set('lg_rinse_select', value);
      await this._set('lg_rinse', rinseLabel(value));
    } else if (key === 'dryLevel') {
      await this._set('lg_dry_select', value);
      await this._set('lg_dry_level', dryLabel(value));
    } else if (key === 'soilWash') {
      await this._set('lg_soil_select', value);
    } else if (key === 'loadItemWasher') {
      await this._set('lg_load_item_select', value);
    } else if (key === 'reserveTimeHour') {
      await this._set('lg_delay_end_select', String(value));
    } else if (key === 'preWash') {
      await this._set('lg_prewash_toggle', value === 'PREWASH_ON');
    } else if (key === 'turboWash') {
      await this._set('lg_turbowash_toggle', value === 'TURBOWASH_ON');
    } else if (key === 'steam') {
      await this._set('lg_steam_toggle', value === 'STEAM_ON');
    } else if (key === 'medicRinse') {
      await this._set('lg_medic_rinse_toggle', value === 'MEDICRINSE_ON');
    } else if (key === 'ecoHybrid') {
      await this._set('lg_eco_hybrid_toggle', value === 'ECOHYBRID_ON');
    }

    this.log(`Flow/device staging - ${key}=${value}:`, JSON.stringify(pending));
    return true;
  }


  _widgetCourseOptions(course) {
    const out = {};
    for (const fn of (course?.function || [])) {
      if (!fn?.value) continue;
      out[fn.value] = {
        default: fn.default ?? fn.initial ?? null,
        selectable: Array.isArray(fn.selectable) ? fn.selectable : []
      };
    }
    return out;
  }

  _expectedDurationMinutes(programId, options = {}) {
    // Model-specific starting estimates for GD3V509S1/F_V7_F___W.
    // LG can still adjust the real duration after load sensing.
    const base = {
      COTTON: 180,
      EASYCARE: 140,
      COTTONPLUS: 210,
      MIXEDFABRIC: 81,
      BABYSTEAMCARE: 140,
      SPEED14: 16,
      TUB_CLEAN: 73,
      WOOL: 38,
      DELICATE: 47,
      ALLERGYSPASTEAM: 125,
      TURBO59: 59,
      DRYONLY: 150,
      WASHDRY: 240,
      SPINONLY: 15
    };

    let minutes = Number(base[programId] || 120);

    // Timed drying choices are explicit and therefore better than a generic estimate.
    const dry = options?.dryLevel;
    const timedDry = {
      DRYLEVEL_30: 30,
      DRYLEVEL_60: 60,
      DRYLEVEL_90: 90,
      DRYLEVEL_120: 120,
      DRYLEVEL_150: 150
    };
    if (programId === 'DRYONLY' && timedDry[dry]) {
      minutes = timedDry[dry];
    } else if (programId === 'WASHDRY' && timedDry[dry]) {
      // Approximate wash part + explicit drying time.
      minutes = 90 + timedDry[dry];
    }

    return Math.max(14, Math.min(600, Math.round(minutes)));
  }

  getWidgetState() {
    const programs = Object.entries(this._courses || {}).map(([id, course]) => ({
      id,
      name: course?._comment || id,
      options: this._widgetCourseOptions(course),
      expectedDurationMinutes: this._expectedDurationMinutes(id)
    })).sort((a,b) => a.name.localeCompare(b.name));

    const pending = this.getStoreValue('pending_flow_config') || {};
    return {
      deviceId: typeof this.getId === 'function' ? this.getId() : this.getData().id,
      name: this.getName(),
      status: this.getCapabilityValue('lg_state'),
      currentProgram: this.getCapabilityValue('lg_current_program'),
      remaining: this.getCapabilityValue('lg_remaining'),
      total: this.getCapabilityValue('lg_total'),
      remoteControl: this.getCapabilityValue('lg_remote_control'),
      error: this._lastError && this._lastError !== 'ERROR_NO' ? this._lastError : null,
      thinQ2Online: this._lastThinQ2Online,
      selected: {
        programId: pending.programId || this.getStoreValue('selected_program_id') || this.getStoreValue('last_valid_program_id') || null,
        options: pending.options || {}
      },
      programs,
      plan: this.getStoreValue('smart_wash_plan') || null
    };
  }

  _formatSmartWashTime(ms) {
    if (!Number.isFinite(Number(ms))) return '';
    try {
      return new Intl.DateTimeFormat('nl-NL', {
        day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false
      }).format(new Date(Number(ms)));
    } catch (e) {
      return new Date(Number(ms)).toISOString();
    }
  }

  _smartWashProgramName(plan) {
    const id = plan?.config?.programId || this.getStoreValue('selected_program_id') || '';
    return this._courses?.[id]?._comment || id || this.getCapabilityValue('lg_current_program') || 'Onbekend';
  }

  async _triggerSmartWash(card, tokens = {}) {
    if (!card) return;
    await card.trigger(this, tokens).catch(err => this.error('Slim Wassen Flow-trigger:', err));
  }

  getWidgetLiveStatus() {
    const wd = this._lastWd || {};
    const courseField = this._modelJson?.Config?.courseType || 'courseFL24inchBaseTitan';
    const currentProgramId = wd[courseField] || wd.courseFL24inchBaseTitan || wd.course || null;

    let liveSpin = wd.spin || null;
    if (liveSpin === 'SPIN_1400') liveSpin = 'SPIN_Max';

    const liveOptions = {
      temp: wd.temp || null,
      spin: liveSpin,
      rinse: wd.rinse || null,
      dryLevel: wd.dryLevel || null,
      soilWash: wd.soilWash || null,
      preWash: wd.preWash || null,
      turboWash: wd.turboWash || null,
      steam: wd.steam || null,
      medicRinse: wd.medicRinse || null,
      ecoHybrid: wd.ecoHybrid || null
    };

    return {
      deviceId: typeof this.getId === 'function' ? this.getId() : this.getData().id,
      status: this.getCapabilityValue('lg_state'),
      currentProgram: this.getCapabilityValue('lg_current_program'),
      currentProgramId,
      liveOptions,
      remaining: this.getCapabilityValue('lg_remaining'),
      total: this.getCapabilityValue('lg_total'),
      remoteControl: this.getCapabilityValue('lg_remote_control'),
      error: this._lastError && this._lastError !== 'ERROR_NO' ? this._lastError : null,
      thinQ2Online: this._lastThinQ2Online
    };
  }

  async _pushWidgetLiveStatus() {
    const live = this.getWidgetLiveStatus();
    this.homey.api.realtime('smart_wash_live_status', live).catch(() => {});
    return live;
  }

  async _applySmartWashConfig(config = {}) {
    const programId = config.programId;
    if (!programId || !this._courses?.[programId]) {
      throw new Error('Het geplande wasprogramma is niet beschikbaar.');
    }
    const pending = {
      programId,
      options: { ...(config.options || {}) },
      updatedAt: Date.now(),
      source: 'smart-wash-widget'
    };
    await this.setStoreValue('pending_flow_config', pending);
    await this.setStoreValue('selected_program_id', programId);
    await this._setProgramSelectSafe(programId);
    this.log('Slim Wassen configuratie geladen:', JSON.stringify(pending));
    return pending;
  }

  async startWasherSingleFlight(config = null, source = 'widget') {
    if (this._widgetStartPromise) {
      this.log(`Dubbele startopdracht genegeerd: startsequence loopt al (${source}).`);
      return { accepted:false, duplicate:true, message:'Starten is al bezig' };
    }

    const now = Date.now();
    if (now - Number(this._widgetStartRequestedAt || 0) < 10000) {
      this.log(`Dubbele startopdracht binnen 10 seconden genegeerd (${source}).`);
      return { accepted:false, duplicate:true, message:'Startopdracht was al ontvangen' };
    }
    this._widgetStartRequestedAt = now;

    this._widgetStartPromise = (async () => {
      if (config) await this._applySmartWashConfig(config);
      await this.startWasher();
      return { accepted:true, duplicate:false, message:'Wasmachine gestart' };
    })();

    try {
      return await this._widgetStartPromise;
    } finally {
      this._widgetStartPromise = null;
    }
  }

  async startWasherWithConfig(config) {
    await this._applySmartWashConfig(config);
    return this.startWasher();
  }

  async setSmartWashPlan(plan) {
    if (!plan?.config?.programId) throw new Error('Geen programma gekozen.');
    const stored = {
      id: `smartwash-${Date.now()}`,
      status: 'scheduled',
      createdAt: Date.now(),
      startAt: Number(plan.startAt),
      endAt: Number(plan.endAt),
      deadlineAt: Number(plan.deadlineAt),
      durationMinutes: Number(plan.durationMinutes),
      averagePrice: Number(plan.averagePrice),
      config: plan.config,
      autoReplan: plan.autoReplan !== false,
      lastReplanCheckAt: 0,
      lastReplannedAt: null,
      lastReplanSaving: null,
      replanCount: 0,
      lastError: null
    };
    if (!Number.isFinite(stored.startAt) || stored.startAt <= Date.now() - 60000) {
      throw new Error('Ongeldige geplande starttijd.');
    }
    await this.setStoreValue('smart_wash_plan', stored);
    this.log('Slim Wassen gepland:', JSON.stringify(stored));
    await this._triggerSmartWash(this._smartWashPlannedTrigger, {
      program: this._smartWashProgramName(stored),
      start_time: this._formatSmartWashTime(stored.startAt),
      end_time: this._formatSmartWashTime(stored.endAt),
      deadline: this._formatSmartWashTime(stored.deadlineAt),
      duration_minutes: stored.durationMinutes,
      average_price: Number(stored.averagePrice),
      message: `LG wasmachine gepland om ${this._formatSmartWashTime(stored.startAt)}, verwacht klaar ${this._formatSmartWashTime(stored.endAt)}.`
    });
    this.homey.api.realtime('smart_wash_plan_changed', {
      deviceId: typeof this.getId === 'function' ? this.getId() : this.getData().id,
      plan: stored
    }).catch(() => {});
    return stored;
  }

  async cancelSmartWashPlan() {
    const plan = this.getStoreValue('smart_wash_plan');
    if (!plan) return null;
    const cancelled = { ...plan, status:'cancelled', cancelledAt:Date.now() };
    await this.setStoreValue('smart_wash_plan', cancelled);
    this.log('Slim Wassen planning geannuleerd.');
    this.homey.api.realtime('smart_wash_plan_changed', {
      deviceId: typeof this.getId === 'function' ? this.getId() : this.getData().id,
      plan: cancelled
    }).catch(() => {});
    return cancelled;
  }

  async _checkSmartWashPlan() {
    let plan = this.getStoreValue('smart_wash_plan');
    if (!plan || plan.status !== 'scheduled') return false;

    const now = Date.now();
    const startAt = Number(plan.startAt);
    const deadlineAt = Number(plan.deadlineAt);

    if (!Number.isFinite(startAt)) return false;

    // Keep optimizing Homey Energy quarter-hour prices until 15 minutes before start.
    // Recheck at most once per 15 minutes, including plans made the evening before.
    const lockMs = 15 * 60 * 1000;
    const checkEveryMs = 15 * 60 * 1000;
    const lastCheck = Number(plan.lastReplanCheckAt || 0);

    if (
      plan.autoReplan !== false &&
      Number.isFinite(deadlineAt) &&
      startAt > now + lockMs &&
      now - lastCheck >= checkEveryMs
    ) {
      plan = { ...plan, lastReplanCheckAt: now };
      await this.setStoreValue('smart_wash_plan', plan);

      try {
        const recalculated = await this.homey.app.calculateCheapestWashWindow({
          earliestMs: now,
          deadlineMs: deadlineAt,
          durationMinutes: Number(plan.durationMinutes) || 120
        });

        const best = recalculated?.best;
        const newAvg = Number(best?.averagePrice);

        // Recalculate the currently planned slot with the latest all-in Homey
        // prices as well. Comparing with the old stored average can otherwise
        // cause a false replan after prices/user costs are updated.
        const currentWindowEnd = Number(plan.startAt) +
          (Number(plan.durationMinutes) || 120) * 60 * 1000;
        const currentAvgLatest = this.homey.app._averagePriceForWindow(
          recalculated?.slots || [],
          Number(plan.startAt),
          currentWindowEnd
        );
        const currentAvg = Number.isFinite(Number(currentAvgLatest))
          ? Number(currentAvgLatest)
          : Number(plan.averagePrice);
        const saving = currentAvg - newAvg;

        // Always keep the displayed average aligned with the latest Homey
        // all-in price, even when the start time does not move.
        if (Number.isFinite(currentAvg)) {
          plan = { ...plan, averagePrice: currentAvg };
          await this.setStoreValue('smart_wash_plan', plan);
        }

        // Prevent "jitter": only move when at least 1 eurocent/kWh cheaper.
        if (
          best &&
          Number.isFinite(newAvg) &&
          Number.isFinite(currentAvg) &&
          saving >= 0.01 &&
          Number(best.start) > now &&
          Number(best.end) <= deadlineAt &&
          Number(best.start) !== Number(plan.startAt)
        ) {
          const oldStartAt = Number(plan.startAt);
          plan = {
            ...plan,
            startAt: Number(best.start),
            endAt: Number(best.end),
            averagePrice: newAvg,
            lastReplannedAt: now,
            lastReplanSaving: saving,
            replanCount: Number(plan.replanCount || 0) + 1
          };
          await this.setStoreValue('smart_wash_plan', plan);
          this.log(
            `Slim Wassen planning aangepast: ${new Date(oldStartAt).toISOString()} -> ` +
            `${new Date(plan.startAt).toISOString()} (${saving.toFixed(4)} EUR/kWh goedkoper)`
          );
          await this._triggerSmartWash(this._smartWashReplannedTrigger, {
            program: this._smartWashProgramName(plan),
            old_start_time: this._formatSmartWashTime(oldStartAt),
            new_start_time: this._formatSmartWashTime(plan.startAt),
            end_time: this._formatSmartWashTime(plan.endAt),
            average_price: Number(plan.averagePrice),
            saving: Number(saving),
            revision: Number(plan.replanCount || 0),
            message: `LG planning aangepast: ${this._formatSmartWashTime(oldStartAt)} → ${this._formatSmartWashTime(plan.startAt)} wegens lagere energieprijs.`
          });
        }

        this.homey.api.realtime('smart_wash_plan_changed', {
          deviceId: typeof this.getId === 'function' ? this.getId() : this.getData().id,
          plan
        }).catch(() => {});
      } catch (err) {
        this.log(`Slim Wassen herberekenen overgeslagen: ${err?.message || err}`);
      }
    }

    plan = this.getStoreValue('smart_wash_plan');
    if (!plan || plan.status !== 'scheduled') return false;
    if (Date.now() < Number(plan.startAt)) return false;

    // Before an automatic start, Remote Start must still be active.
    // Keep the plan scheduled and retry on the next planner tick while there is
    // still enough time to finish before the user's deadline.
    const durationMs = Math.max(1, Number(plan.durationMinutes) || 60) * 60 * 1000;
    const remoteActive = this.getCapabilityValue('lg_remote_control') === true;
    if (!remoteActive) {
      const canStillFinish = !Number.isFinite(Number(plan.deadlineAt)) || (Date.now() + durationMs <= Number(plan.deadlineAt));
      const firstWarning = !plan.remoteBlockedAt;
      const blocked = {
        ...plan,
        remoteBlockedAt: plan.remoteBlockedAt || Date.now(),
        lastError: 'Remote Start is niet actief.'
      };
      await this.setStoreValue('smart_wash_plan', blocked);

      if (firstWarning) {
        await this._triggerSmartWash(this._smartWashRemoteMissingTrigger, {
          program: this._smartWashProgramName(blocked),
          start_time: this._formatSmartWashTime(blocked.startAt),
          deadline: this._formatSmartWashTime(blocked.deadlineAt),
          message: 'LG kan de geplande was niet automatisch starten: Remote Start is niet actief.'
        });
      }

      this.homey.api.realtime('smart_wash_plan_changed', {
        deviceId: typeof this.getId === 'function' ? this.getId() : this.getData().id,
        plan: blocked
      }).catch(() => {});

      if (canStillFinish) return false;

      const failed = {
        ...blocked,
        status:'failed',
        failedAt:Date.now(),
        lastError:'Remote Start is niet actief en de deadline kan niet meer gehaald worden.'
      };
      await this.setStoreValue('smart_wash_plan', failed);
      await this._triggerSmartWash(this._smartWashStartFailedTrigger, {
        program: this._smartWashProgramName(failed),
        error: failed.lastError,
        message: `LG Slim Wassen mislukt: ${failed.lastError}`
      });
      this.homey.api.realtime('smart_wash_plan_changed', {
        deviceId: typeof this.getId === 'function' ? this.getId() : this.getData().id,
        plan: failed
      }).catch(() => {});
      return false;
    }

    const starting = { ...plan, status:'starting', startingAt:Date.now(), lastError:null, remoteBlockedAt:null };
    await this.setStoreValue('smart_wash_plan', starting);
    try {
      // Same guarded start path as the widget's Nu starten button.
      const result = await this.startWasherSingleFlight(plan.config, 'smart-wash-planner');
      if (result?.duplicate) {
        // Another start is already executing. Do not send a second LG command train.
        const waiting = { ...plan, status:'scheduled', lastError:'Een andere startopdracht loopt al.' };
        await this.setStoreValue('smart_wash_plan', waiting);
        return false;
      }

      const started = { ...starting, status:'started', startedAt:Date.now(), lastError:null };
      await this.setStoreValue('smart_wash_plan', started);
      this.log('Slim Wassen automatisch gestart.');
      await this._triggerSmartWash(this._smartWashStartedTrigger, {
        program: this._smartWashProgramName(started),
        start_time: this._formatSmartWashTime(started.startedAt),
        message: `LG wasmachine automatisch gestart: ${this._smartWashProgramName(started)}.`
      });
      this.homey.api.realtime('smart_wash_plan_changed', {
        deviceId: typeof this.getId === 'function' ? this.getId() : this.getData().id,
        plan: started
      }).catch(() => {});
      return true;
    } catch (err) {
      const failed = {
        ...starting,
        status:'failed',
        failedAt:Date.now(),
        lastError:String(err?.message || err)
      };
      await this.setStoreValue('smart_wash_plan', failed);
      this.error('Slim Wassen automatisch starten mislukt:', err);
      await this._triggerSmartWash(this._smartWashStartFailedTrigger, {
        program: this._smartWashProgramName(failed),
        error: failed.lastError,
        message: `LG Slim Wassen start mislukt: ${failed.lastError}`
      });
      this.homey.api.realtime('smart_wash_plan_changed', {
        deviceId: typeof this.getId === 'function' ? this.getId() : this.getData().id,
        plan: failed
      }).catch(() => {});
      return false;
    }

  }


  async startWasher() {
    // Advanced Flow cards can start nearly simultaneously. Give staging cards a brief
    // moment to write their selections before assembling the one definitive payload.
    await this._sleep(300);

    const { client } = await this.refreshThinQ2();
    const legacyId = this.getStoreValue('legacy_device_id');

    // A second Start/Flow must never disturb an already running cycle.
    // In particular, this prevents a stale Flow or planner action from
    // reaching WMWakeup/WMDownload while the washer is active.
    if (this.isRunning()) {
      const liveState = String(this._lastWd?.state || this._lastState || '').toUpperCase();
      this.log(`Startopdracht geblokkeerd: wasmachine is al actief (${liveState || 'ONBEKEND'}).`);
      return { accepted:false, alreadyRunning:true, message:'Wasmachine is al actief' };
    }

    const pending = this.getStoreValue('pending_flow_config') || {};
    const current = pending.programId
      || this.getStoreValue('selected_program_id')
      || this.getStoreValue('last_valid_program_id');

    if (!current || !this._courses?.[current]) {
      throw new Error('Kies eerst een geldig wasprogramma voordat de wasmachine wordt gestart.');
    }

    const course = this._courses[current];
    let selected = this._programPayload(current);

    // Apply only the options staged by the current Flow. This prevents a program card
    // from resetting temperature/spin when Homey executes cards in parallel.
    for (const [key, value] of Object.entries(pending.options || {})) {
      const fn = (course.function || []).find(x => x.value === key);
      if (fn?.selectable && !fn.selectable.includes(value)) {
        throw new Error(`${value} is niet toegestaan bij ${course._comment || current}.`);
      }
      selected[key] = (key === 'spin' && value === 'SPIN_1400') ? 'SPIN_Max' : value;
    }

    selected.initialBit = 'INITIAL_BIT_OFF';
    selected.remoteStart = 'REMOTE_START_OFF';
    const { courseType, smartCourseType } = this._courseFieldNames();
    selected[courseType] = current;
    selected[smartCourseType] = 'NOT_SELECTED';
    selected.courseDownloadType = 'COURSEDATA';
    selected.courseDownloadDataLength = 21;

    await this._ensureWasherAwake(client, legacyId);

    let coursePayload = this._sanitizeWasherPayload(selected, 'WMDownload before start');
    this.log('FINAL FLOW CONFIG:', JSON.stringify({
      programId: current,
      programName: course._comment || current,
      options: pending.options || {}
    }));
    this.log('LG COURSE FIELD MAP:', JSON.stringify({
      courseType,
      smartCourseType,
      courseValue: coursePayload[courseType],
      smartCourseValue: coursePayload[smartCourseType]
    }));
    this.log('WMDownload before start payload:', JSON.stringify(coursePayload));

    await this._thinQ2Write(client, legacyId, 'WMDownload', coursePayload);
    await this._sleep(750);

    const startPayload = this._sanitizeWasherPayload({ ...coursePayload }, 'WMStart');
    this.log('WMStart selected payload:', JSON.stringify(startPayload));

    const wmStartResponse = await this._thinQ2Write(client, legacyId, 'WMStart', startPayload);
    this.log('WMStart response:', JSON.stringify(wmStartResponse));

    await this.setStoreValue('selected_program_id', current);
    await this.setStoreValue('selected_program_payload', coursePayload);
    await this.setStoreValue('pending_flow_config', {});
    await this._set('lg_current_program', course._comment || current);
    await this._setProgramSelectSafe(current);

    return true;
  }

  async pauseWasher() {
    const { client } = await this.refreshThinQ2();
    const legacyId = this.getStoreValue('legacy_device_id');
    return this._thinQ2Write(client, legacyId, 'WMStop', {
      controlDataType:'PAUSE',
      controlDataValueLength:1,
      controlDataValue:0
    });
  }

  async dumpDiagnostics() {
    const data = await this.refreshNow();
    this.log('=== LG THINQ DIAGNOSTICS START ===');
    this.log(JSON.stringify({ device:this.getData(), settings:this.getSettings(), state:data.state, profile:data.profile }, null, 2));
    this.log('=== LG THINQ DIAGNOSTICS END ===');
  }

  async dumpThinQ2Courses() {
    const data = await this.refreshThinQ2();
    this.log('=== THINQ2 COURSE DIAGNOSTICS START ===');
    this.log('THINQ2_DEVICE', JSON.stringify(data.candidate));
    this.log('THINQ2_DETAIL', JSON.stringify(data.detail));
    this.log('THINQ2_MODEL_JSON', JSON.stringify(data.model));
    this.log('=== THINQ2 COURSE DIAGNOSTICS END ===');
    return true;
  }

  onDeleted() {
    if (this._interval) this.homey.clearInterval(this._interval);
  }
}

module.exports = LGWasherDevice;
