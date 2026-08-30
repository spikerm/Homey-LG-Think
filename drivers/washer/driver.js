'use strict';

const Homey = require('homey');
const crypto = require('crypto');
const ThinQConnect = require('../../lib/thinq-connect');
const ThinQ2Legacy = require('../../lib/thinq2-legacy');
const {
  ensureInsightsCapabilities,
  startInsightsRecorder,
  recordFromLive
} = require('../../lib/smart-wash-duration');

function asArray(body) {
  if (Array.isArray(body)) return body;
  return body?.devices || body?.item || body?.items || [];
}

function infoOf(d) {
  return d?.deviceInfo && typeof d.deviceInfo === 'object' ? d.deviceInfo : d || {};
}

function isWasher(d) {
  const i = infoOf(d);
  const fields = [
    i.deviceType,
    i.deviceTypeCode,
    i.type,
    i.deviceTypeName,
    i.category,
    i.modelName,
    i.alias,
    i.deviceName,
    d?.deviceType,
    d?.type
  ].filter(Boolean).map(v => String(v).toUpperCase());

  return fields.some(v =>
    v === 'DEVICE_WASHER' ||
    v.includes('DEVICE_WASHER') ||
    v.includes('WASHTOWER_WASHER') ||
    v.includes('WASHCOMBO') ||
    v.includes('WASH') ||
    v.includes('WASM') ||
    v.includes('LAUNDRY') ||
    v === '201' ||
    v === '221'
  );
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

function enableTurbo59Drying(device) {
  const courses = device?._courses;
  const turbo = courses?.TURBO59;
  if (!turbo) return false;

  const turboFunctions = Array.isArray(turbo.function) ? turbo.function : [];
  let turboDry = turboFunctions.find(fn => fn?.value === 'dryLevel');

  // On this LG washer-dryer the front panel allows a dry level to be selected
  // after choosing Turbo Wash 59. The downloaded course definition reports
  // dryLevel as NOT_SELECTED, which is the default state rather than a real
  // restriction. Reuse the machine's own dry-level choices from Wash+Dry (or
  // Dry Only as fallback) so Homey offers the same combinations as the panel.
  const donor = courses?.WASHDRY || courses?.DRYONLY;
  const donorDry = (donor?.function || []).find(fn => fn?.value === 'dryLevel');
  const donorOptions = Array.isArray(donorDry?.selectable)
    ? donorDry.selectable.filter(Boolean)
    : [];

  if (!donorOptions.length) return false;

  const options = [...new Set([
    'NOT_SELECTED',
    ...(Array.isArray(turboDry?.selectable) ? turboDry.selectable : []),
    ...donorOptions
  ])];

  if (!turboDry) {
    turboDry = {
      value: 'dryLevel',
      default: 'NOT_SELECTED',
      selectable: options
    };
    turbo.function = [...turboFunctions, turboDry];
  } else {
    turboDry.default = turboDry.default || 'NOT_SELECTED';
    turboDry.selectable = options;
  }

  device.log(`Turbo Wash 59: drogen beschikbaar gemaakt (${options.join(', ')}).`);
  return true;
}

function patchTurbo59Drying(device) {
  if (!device || device._turbo59DryPatchApplied) {
    enableTurbo59Drying(device);
    return;
  }

  device._turbo59DryPatchApplied = true;
  enableTurbo59Drying(device);

  if (typeof device.refreshThinQ2 === 'function') {
    const originalRefreshThinQ2 = device.refreshThinQ2.bind(device);
    device.refreshThinQ2 = async (...args) => {
      const result = await originalRefreshThinQ2(...args);
      enableTurbo59Drying(device);
      return result;
    };
  }
}

class LGWasherDriver extends Homey.Driver {
  async onInit() {
    // Add the new Insights capabilities to already paired washers as well.
    // The short delay lets device onInit finish first after an app restart.
    this.homey.setTimeout(async () => {
      for (const device of this.getDevices()) {
        try {
          patchTurbo59Drying(device);
          await ensureInsightsCapabilities(device);
          await recordFromLive(device, device.getWidgetLiveStatus()).catch(() => {});
          startInsightsRecorder(device);
        } catch (err) {
          this.error('Slim Wassen Insights initialisatie:', safeErrorMessage(err));
        }
      }
    }, 5000);
  }

  async onPair(session) {
    this.log('Pair sessie gestart');

    const pairData = {
      token: null,
      country: 'NL',
      clientId: `homey-${crypto.randomUUID()}`,
      devices: [],
      legacyRefreshToken: null,
      legacyDevices: [],
      language: 'nl-NL'
    };

    session.setHandler('showView', async viewId => {
      this.log('Pair view:', viewId);
    });

    session.setHandler('combined_login', async data => {
      pairData.token = String(data?.token || '').trim();
      pairData.country = String(data?.country || 'NL').trim().toUpperCase();
      pairData.language = String(data?.language || 'nl-NL').trim();
      const email = String(data?.email || '').trim();
      const password = String(data?.password || '');

      const result = {
        connect: { ok: false, count: 0, message: '' },
        legacy: { ok: false, count: 0, message: '' }
      };

      try {
        const api = new ThinQConnect({
          token: pairData.token,
          country: pairData.country,
          clientId: pairData.clientId
        });

        pairData.devices = asArray(await api.getDevices());

        result.connect.ok = true;
        result.connect.count = pairData.devices.length;

        this.log(`ThinQ Connect OK: ${pairData.devices.length} apparaten gevonden`);
        this.log('ThinQ Connect device list:', JSON.stringify(pairData.devices));
      } catch (err) {
        result.connect.message = err?.message || String(err);
        this.error('ThinQ Connect fout:', safeErrorMessage(err));
        return result;
      }

      try {
        const legacy = new ThinQ2Legacy({
          country: pairData.country,
          language: pairData.language,
          logger: this
        });

        const auth = await legacy.login(email, password);
        pairData.legacyRefreshToken = auth.refreshToken;
        pairData.legacyDevices = await legacy.getDevices();

        result.legacy.ok = true;
        result.legacy.count = pairData.legacyDevices.length;

        this.log(`ThinQ2 legacy OK: ${pairData.legacyDevices.length} apparaten gevonden`);
        this.log('THINQ2_DEVICE_LIST', JSON.stringify(pairData.legacyDevices));

        for (const d of pairData.legacyDevices.filter(isWasher)) {
          try {
            const detail = await legacy.getSingleDevice(d.deviceId);
            const mc = await legacy.getModelAndCourses({ ...d, ...detail });

            this.log('THINQ2_WASHER_DETAIL', JSON.stringify(detail));
            this.log('THINQ2_MODEL_URL', mc.modelUrl || '-');
            this.log('THINQ2_COURSE_URL', mc.courseUrl || '-');
            if (mc.model) this.log('THINQ2_MODEL_JSON', JSON.stringify(mc.model));
            if (mc.course) this.log('THINQ2_COURSE_JSON', JSON.stringify(mc.course));
          } catch (err) {
            this.error('ThinQ2 model/course dump fout:', safeErrorMessage(err));
          }
        }
      } catch (err) {
        result.legacy.message = err?.message || String(err);
        this.error('ThinQ2 login fout:', safeErrorMessage(err));
      }

      return result;
    });

    session.setHandler('list_devices', async () => {
      if (!pairData.token) {
        throw new Error('ThinQ Connect is nog niet gekoppeld.');
      }

      const washers = pairData.devices.filter(isWasher);
      this.log(`Washer filter: ${washers.length} van ${pairData.devices.length} apparaten`);

      if (!washers.length) {
        throw new Error('Geen LG wasmachine gevonden via ThinQ Connect.');
      }

      return washers.map(d => {
        const i = infoOf(d);
        const model = String(i.modelName || '').toUpperCase();
        const alias = String(i.alias || '').toUpperCase();

        const legacyMatch = pairData.legacyDevices.find(ld =>
          String(ld.modelName || '').toUpperCase() === model &&
          (!alias || String(ld.alias || '').toUpperCase() === alias)
        ) || pairData.legacyDevices.find(ld =>
          String(ld.modelName || '').toUpperCase() === model
        ) || pairData.legacyDevices.find(ld =>
          [201, 221].includes(Number(ld.deviceType))
        );

        if (legacyMatch) {
          this.log('ThinQ2 match:', legacyMatch.deviceId, legacyMatch.modelName, legacyMatch.alias);
        }

        return {
          name: i.alias || i.deviceName || i.name || i.modelName || 'LG Wasmachine',
          data: {
            id: d.deviceId || i.deviceId || d.id
          },
          store: {
            token: pairData.token,
            country: pairData.country,
            client_id: pairData.clientId,
            raw_device: d,
            model_name: i.modelName || '',
            device_type: i.deviceType || '',
            legacy_refresh_token: pairData.legacyRefreshToken || '',
            legacy_language: pairData.language,
            legacy_device_id: legacyMatch?.deviceId || ''
          }
        };
      });
    });
  }
}

module.exports = LGWasherDriver;
