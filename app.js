'use strict';

const Homey = require('homey');

class LGThinQApp extends Homey.App {
  async onInit() {
    this.log(`LG ThinQ v${this.homey?.manifest?.version || 'onbekend'} gestart`);

    const action = id => this.homey.flow.getActionCard(id);
    const condition = id => this.homey.flow.getConditionCard(id);

    action('dump_profile').registerRunListener(async args => { await args.device.dumpDiagnostics(); return true; });
    action('refresh_washer').registerRunListener(async args => { await args.device.refreshNow(); await args.device.refreshThinQ2(); return true; });
    action('dump_thinq2_courses').registerRunListener(async args => { await args.device.dumpThinQ2Courses(); return true; });

    // Program selection card: program only. Temperature, spin, rinse, dry etc.
    // each have their own Flow card below.
    const selectProgram = action('select_program');
    selectProgram.registerRunListener(async args => {
      if (!args.device) throw new Error('Geen wasmachine geselecteerd.');
      if (!args.program?.id) throw new Error('Geen wasprogramma geselecteerd.');
      await args.device.selectProgram(args.program.id);
      return true;
    });
    selectProgram.getArgument('program').registerAutocompleteListener(async (query,args) =>
      args?.device ? args.device.getProgramAutocomplete(query || '') : []);

    // Basic controls
    action('start_washer').registerRunListener(async args => { await args.device.startWasher(); return true; });
    action('pause_washer').registerRunListener(async args => { await args.device.pauseWasher(); return true; });
    action('power_off_washer').registerRunListener(async args => { await args.device.powerOffWasher(); return true; });
    action('wakeup_washer').registerRunListener(async args => { await args.device.wakeupWasher(); return true; });

    // Dynamic individual option cards
    for (const [cardId,key] of [
      ['set_temperature','temp'],
      ['set_spin','spin'],
      ['set_rinse','rinse'],
      ['set_dry_level','dryLevel']
    ]) {
      const card = action(cardId);
      card.registerRunListener(async args => { await args.device.setFlowOption(key,args.value?.id); return true; });
      card.getArgument('value').registerAutocompleteListener(async (query,args) =>
        args?.device ? args.device.getCurrentOptionAutocomplete(key,query||'') : []);
    }

    action('set_soil_wash').registerRunListener(async args => { await args.device.setFlowOption('soilWash',args.value); return true; });
    action('set_prewash').registerRunListener(async args => { await args.device.setBooleanFlowOption('preWash',Boolean(args.enabled),'PREWASH_ON','PREWASH_OFF'); return true; });
    action('set_turbowash').registerRunListener(async args => { await args.device.setBooleanFlowOption('turboWash',Boolean(args.enabled),'TURBOWASH_ON','TURBOWASH_OFF'); return true; });
    action('set_steam').registerRunListener(async args => { await args.device.setBooleanFlowOption('steam',Boolean(args.enabled),'STEAM_ON','STEAM_OFF'); return true; });
    action('set_medic_rinse').registerRunListener(async args => { await args.device.setBooleanFlowOption('medicRinse',Boolean(args.enabled),'MEDICRINSE_ON','MEDICRINSE_OFF'); return true; });
    action('set_eco_hybrid').registerRunListener(async args => { await args.device.setBooleanFlowOption('ecoHybrid',Boolean(args.enabled),'ECOHYBRID_ON','ECOHYBRID_OFF'); return true; });
    action('set_load_item').registerRunListener(async args => { await args.device.setFlowOption('loadItemWasher',args.value); return true; });
    action('set_delay_end').registerRunListener(async args => { await args.device.setDelayEnd(args.hours); return true; });

    const smart = action('download_smart_course');
    smart.registerRunListener(async args => { await args.device.downloadSmartCourse(args.program?.id); return true; });
    smart.getArgument('program').registerAutocompleteListener(async (query,args) =>
      args?.device ? args.device.getSmartCourseAutocomplete(query||'') : []);

    // Conditions
    condition('is_running').registerRunListener(async args => args.device.isRunning());
    condition('is_remote_start_enabled').registerRunListener(async args => args.device.isRemoteStartEnabled());
    condition('is_door_locked').registerRunListener(async args => args.device.isDoorLocked());
    condition('is_child_lock_enabled').registerRunListener(async args => args.device.isChildLockEnabled());
    condition('has_error').registerRunListener(async args => args.device.hasError());
    condition('state_is').registerRunListener(async args => args.device.stateIs(args.state));
    condition('thinq2_is_online').registerRunListener(async args => args.device.isThinQ2Online());

    const programIs = condition('program_is');
    programIs.registerRunListener(async args => args.device.programIs(args.program?.id));
    programIs.getArgument('program').registerAutocompleteListener(async (query,args) =>
      args?.device ? args.device.getProgramAutocomplete(query||'') : []);

    this.log('Alle beschikbare LG washer Flow-kaarten geregistreerd');
  }

  _priceNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const n = Number(value.replace(',', '.'));
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  _normaliseEnergyPrices(raw) {
    const arrays = [];
    const visit = (value, depth = 0) => {
      if (depth > 5 || value == null) return;
      if (Array.isArray(value)) {
        if (value.length && value.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
          arrays.push(value);
        }
        for (const item of value) visit(item, depth + 1);
      } else if (typeof value === 'object') {
        for (const v of Object.values(value)) visit(v, depth + 1);
      }
    };
    visit(raw);

    const timeKeys = ['periodStart','start','startTime','from','time','timestamp','datetime','dateTime','date'];
    // Prefer final/user-cost fields when Homey exposes them, then generic market price fields.
    const priceKeys = [
      'priceWithCosts','priceWithUserCosts','userPrice','totalPrice','importPrice',
      'price','value','marketPrice','amount'
    ];
    const endKeys = ['periodEnd','end','endTime','to'];

    // Current Homey Pro Energy response (13.x) exposes the actual tariff points
    // as pricesPerInterval[{ periodStart, periodEnd, value }].
    if (Array.isArray(raw?.pricesPerInterval)) {
      arrays.unshift(raw.pricesPerInterval);
    }

    const parseArray = arr => arr.map(item => {
      let start = null;
      for (const key of timeKeys) {
        if (item[key] != null) {
          const d = new Date(item[key]);
          if (!Number.isNaN(d.getTime())) { start = d.getTime(); break; }
          if (typeof item[key] === 'number' && Number.isFinite(item[key])) {
            start = item[key] < 1e12 ? item[key] * 1000 : item[key];
            break;
          }
        }
      }
      let price = null;
      let priceField = null;
      for (const key of priceKeys) {
        const n = this._priceNumber(item[key]);
        if (n !== null) { price = n; priceField = key; break; }
      }
      let end = null;
      for (const key of endKeys) {
        if (item[key] != null) {
          const d = new Date(item[key]);
          if (!Number.isNaN(d.getTime())) { end = d.getTime(); break; }
        }
      }
      return start !== null && price !== null ? { start, end, price, priceField } : null;
    }).filter(Boolean);

    let best = [];
    if (Array.isArray(raw?.pricesPerInterval)) {
      best = parseArray(raw.pricesPerInterval);
    }
    if (!best.length) {
      for (const arr of arrays) {
        const parsed = parseArray(arr);
        if (parsed.length > best.length) best = parsed;
      }
    }

    best.sort((a,b) => a.start - b.start);
    // Remove duplicate timestamps if the response contains the same price list in multiple wrappers.
    const seen = new Set();
    best = best.filter(x => {
      const key = String(x.start);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Infer interval ends where the endpoint only returns a start timestamp.
    for (let i=0; i<best.length; i++) {
      if (!best[i].end) {
        const next = best[i+1]?.start;
        const prevDelta = i > 0 ? best[i].start - best[i-1].start : null;
        const inferred = next && next > best[i].start
          ? next
          : best[i].start + (prevDelta && prevDelta > 0 ? prevDelta : 60 * 60 * 1000);
        best[i].end = inferred;
      }
    }
    return best;
  }

  async _getHomeyEnergySession() {
    // ManagerApi is available as this.homey.api. With homey:manager:api it can
    // create an owner API token and expose Homey's local URL.
    if (this._homeyEnergySession?.token && this._homeyEnergySession?.baseUrl) {
      return this._homeyEnergySession;
    }

    const managerApi = this.homey?.api;
    if (!managerApi) throw new Error('Homey ManagerApi ontbreekt.');
    if (typeof managerApi.getOwnerApiToken !== 'function') {
      throw new Error('ManagerApi.getOwnerApiToken() is niet beschikbaar.');
    }
    if (typeof managerApi.getLocalUrl !== 'function') {
      throw new Error('ManagerApi.getLocalUrl() is niet beschikbaar.');
    }

    const [token, baseUrl] = await Promise.all([
      managerApi.getOwnerApiToken(),
      managerApi.getLocalUrl()
    ]);

    if (!token) throw new Error('Homey gaf geen owner API-token terug.');
    if (!baseUrl) throw new Error('Homey gaf geen lokale API-URL terug.');

    this._homeyEnergySession = {
      token,
      baseUrl: String(baseUrl).replace(/\/+$/, '')
    };

    this.log('Homey Energy: geauthenticeerde lokale Web API-sessie aangemaakt.');
    return this._homeyEnergySession;
  }

  async _homeyEnergyRawGet(path) {
    const axios = require('axios');
    const session = await this._getHomeyEnergySession();
    const url = `${session.baseUrl}${path}`;

    try {
      const response = await axios.get(url, {
        timeout: 12000,
        headers: {
          Authorization: `Bearer ${session.token}`,
          Accept: 'application/json'
        },
        validateStatus: () => true
      });

      if (response.status >= 200 && response.status < 300) {
        return response.data;
      }

      // A token can become invalid after a Homey reboot/update. Retry once
      // with a freshly created owner session.
      if (response.status === 401 || response.status === 403) {
        this.log(`Homey Energy: sessie ${response.status}, token één keer vernieuwen.`);
        this._homeyEnergySession = null;
        const refreshed = await this._getHomeyEnergySession();
        const retry = await axios.get(`${refreshed.baseUrl}${path}`, {
          timeout: 12000,
          headers: {
            Authorization: `Bearer ${refreshed.token}`,
            Accept: 'application/json'
          },
          validateStatus: () => true
        });
        if (retry.status >= 200 && retry.status < 300) return retry.data;
        throw new Error(`Homey Energy HTTP ${retry.status}: ${JSON.stringify(retry.data)}`);
      }

      throw new Error(`Homey Energy HTTP ${response.status}: ${JSON.stringify(response.data)}`);
    } catch (err) {
      if (err?.response?.status) {
        throw new Error(`Homey Energy HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`);
      }
      throw err;
    }
  }

  async getHomeyEnergyUserCosts() {
    const now = Date.now();
    if (
      this._homeyEnergyUserCostsCache &&
      now - Number(this._homeyEnergyUserCostsCacheAt || 0) < 5 * 60 * 1000
    ) {
      return this._homeyEnergyUserCostsCache;
    }

    try {
      const raw = await this._homeyEnergyRawGet(
        '/api/manager/energy/price/electricity/dynamic/user-costs'
      );
      this._homeyEnergyUserCostsCache = raw;
      this._homeyEnergyUserCostsCacheAt = now;

      const expression = this._findEnergyCostExpression(raw);
      this.log(
        `Homey Energy gebruikerskosten geladen` +
        (expression ? `; formule=${expression}` : '; geen formule gevonden')
      );
      return raw;
    } catch (err) {
      this.log(`Homey Energy gebruikerskosten niet beschikbaar: ${err.message || err}`);
      return null;
    }
  }

  _findEnergyCostExpression(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') return raw;

    const preferred = [
      'mathExpression','expression','formula','priceFormula','costFormula'
    ];
    const queue = [raw];
    const seen = new Set();

    while (queue.length) {
      const cur = queue.shift();
      if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
      seen.add(cur);

      for (const key of preferred) {
        if (typeof cur[key] === 'string' && cur[key].trim()) {
          return cur[key].trim();
        }
      }
      for (const value of Object.values(cur)) {
        if (value && typeof value === 'object') queue.push(value);
      }
    }
    return null;
  }

  _evaluateEnergyCostExpression(expression, marketPrice) {
    if (!expression || !Number.isFinite(Number(marketPrice))) return null;

    let expr = String(expression).trim();

    // Homey stores the Energy user-cost expression in template form, e.g.:
    // {{([[price]]*1.21)+0.0248+0.1108}}
    // Remove the outer template braces first and accept both [price] and
    // [[price]] placeholders.
    expr = expr
      .replace(/^\s*\{\{\s*/, '')
      .replace(/\s*\}\}\s*$/, '')
      .replace(/\[\[\s*(?:price|prijs)\s*\]\]/gi, 'p')
      .replace(/\[\s*(?:price|prijs)\s*\]/gi, 'p')
      .replace(/\bspotprice\b/gi, 'p')
      .replace(/\bprice\b/gi, 'p')
      .replace(/\bprijs\b/gi, 'p')
      .replace(/\bP\b/g, 'p');

    // Homey examples sometimes use a decimal comma. Only convert a comma
    // directly between digits; commas are otherwise rejected below.
    expr = expr.replace(/(\d),(\d)/g, '$1.$2');

    // Deliberately support arithmetic only. No identifiers, calls, property
    // access or JavaScript syntax are allowed except our numeric p variable.
    if (!/^[0-9p+\-*/%().\s]+$/.test(expr)) return null;

    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('p', `"use strict"; return (${expr});`);
      const value = Number(fn(Number(marketPrice)));
      return Number.isFinite(value) ? value : null;
    } catch (err) {
      return null;
    }
  }

  _applyHomeyEnergyUserCosts(prices, userCosts, rawDynamic = null) {
    if (!Array.isArray(prices) || !prices.length) return prices || [];

    const expression = this._findEnergyCostExpression(userCosts);
    if (expression) {
      let converted = 0;
      const adjusted = prices.map(slot => {
        const userPrice = this._evaluateEnergyCostExpression(expression, slot.price);
        if (!Number.isFinite(userPrice)) return slot;
        converted++;
        return {
          ...slot,
          marketPrice: slot.price,
          price: userPrice,
          priceField: 'homeyUserCostsFormula'
        };
      });
      if (converted === prices.length) {
        const sampleMarket = Number(prices[0]?.price);
        const sampleAllIn = Number(adjusted[0]?.price);
        this.log(
          `Homey Energy: gebruikerskosten toegepast op ${converted} prijspunten` +
          (Number.isFinite(sampleMarket) && Number.isFinite(sampleAllIn)
            ? ` (voorbeeld ${sampleMarket.toFixed(6)} -> ${sampleAllIn.toFixed(6)} EUR/kWh).`
            : '.')
        );
        return adjusted;
      }
      this.log(
        `Homey Energy: gebruikerskostenformule kon niet op alle prijspunten worden toegepast; fallback actief.`
      );
    }

    // Some Homey versions may expose a final-price array in the user-cost
    // response itself. Prefer it when timestamps match the dynamic price data.
    const userCostSlots = this._normaliseEnergyPrices(userCosts);
    if (userCostSlots.length) {
      const byStart = new Map(userCostSlots.map(x => [Number(x.start), x]));
      let matched = 0;
      const adjusted = prices.map(slot => {
        const u = byStart.get(Number(slot.start));
        if (!u || !Number.isFinite(Number(u.price))) return slot;
        matched++;
        return {
          ...slot,
          marketPrice: slot.price,
          price: Number(u.price),
          priceField: u.priceField || 'homeyUserCosts'
        };
      });
      if (matched >= Math.max(1, Math.floor(prices.length * 0.9))) {
        this.log(`Homey Energy: ${matched} gebruikersprijs-punten direct gekoppeld.`);
        return adjusted;
      }
    }

    // Last-resort compatibility: if Homey only gives summary values, derive a
    // constant correction from its average. This keeps the displayed all-in
    // average aligned, but the preferred route above remains the exact formula.
    const summaryUserAvg = this._priceNumber(
      rawDynamic?.averagePriceWithUserCosts ??
      rawDynamic?.averagePriceWithCosts ??
      rawDynamic?.averageUserPrice
    );
    const summaryMarketAvg = this._priceNumber(
      rawDynamic?.averagePrice ??
      rawDynamic?.averageMarketPrice
    );
    if (summaryUserAvg !== null && summaryMarketAvg !== null) {
      const delta = summaryUserAvg - summaryMarketAvg;
      this.log(
        `Homey Energy: gebruikerskosten fallback via gemiddelde correctie ${delta.toFixed(6)} EUR/kWh.`
      );
      return prices.map(slot => ({
        ...slot,
        marketPrice: slot.price,
        price: slot.price + delta,
        priceField: 'homeyUserCostsAverageCorrection'
      }));
    }

    this.log('Homey Energy: geen toepasbare gebruikerskosten gevonden; kale marktprijzen gebruikt.');
    return prices;
  }

  async getHomeyEnergyPrices(date) {
    const path = `/api/manager/energy/price/electricity/dynamic?date=${encodeURIComponent(date)}`;
    const raw = await this._homeyEnergyRawGet(path);
    const marketPrices = this._normaliseEnergyPrices(raw);

    if (!marketPrices.length) {
      this.log('Homey Energy response niet herkend:', JSON.stringify({
        keys: raw && typeof raw === 'object' ? Object.keys(raw) : [],
        priceInterval: raw?.priceInterval,
        priceUnit: raw?.priceUnit,
        measureUnit: raw?.measureUnit,
        pricesPerIntervalCount: Array.isArray(raw?.pricesPerInterval) ? raw.pricesPerInterval.length : null
      }));
      throw new Error('Homey Energy gaf geen herkenbare dynamische prijsdata terug.');
    }

    const userCosts = await this.getHomeyEnergyUserCosts();
    const prices = this._applyHomeyEnergyUserCosts(marketPrices, userCosts, raw);

    const adjusted = prices.some(p =>
      p.priceField === 'homeyUserCostsFormula' ||
      p.priceField === 'homeyUserCosts' ||
      p.priceField === 'homeyUserCostsAverageCorrection'
    );

    this.log(
      `Homey Energy ${date}: ${prices.length} prijspunten ontvangen ` +
      `(${raw?.priceInterval || raw?.defaultPriceInterval || '?'} min, ` +
      `${raw?.priceUnit || 'EUR'}/${raw?.measureUnit || 'kWh'}, ` +
      `${adjusted ? 'incl. gebruikerskosten' : 'kale marktprijs'}).`
    );
    return prices;
  }

  async getEnergyPriceWindow(fromMs, untilMs) {
    const { DateTime } = require('luxon');
    const start = DateTime.fromMillis(fromMs);
    const end = DateTime.fromMillis(untilMs);
    const days = [];
    let day = start.startOf('day');
    const last = end.startOf('day');
    while (day <= last && days.length < 4) {
      days.push(day.toISODate());
      day = day.plus({ days: 1 });
    }

    const merged = [];
    for (const date of days) {
      try {
        merged.push(...await this.getHomeyEnergyPrices(date));
      } catch (err) {
        this.log(`Homey Energy ${date}: ${err.message || err}`);
      }
    }
    const byStart = new Map();
    for (const p of merged) byStart.set(p.start, p);
    return [...byStart.values()]
      .filter(p => p.end > fromMs && p.start < untilMs)
      .sort((a,b) => a.start - b.start);
  }

  _averagePriceForWindow(slots, startMs, endMs) {
    const start = Number(startMs);
    const end = Number(endMs);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

    let cursor = start;
    let weighted = 0;
    let covered = 0;

    for (const s of slots || []) {
      if (s.end <= cursor) continue;
      if (s.start >= end) break;
      if (s.start > cursor + 1000) break;

      const segStart = Math.max(cursor, s.start);
      const segEnd = Math.min(end, s.end);
      if (segEnd > segStart) {
        const ms = segEnd - segStart;
        weighted += Number(s.price) * ms;
        covered += ms;
        cursor = segEnd;
      }
      if (cursor >= end) break;
    }

    return covered >= (end - start) - 1000 ? weighted / covered : null;
  }

  async calculateCheapestWashWindow({ earliestMs, deadlineMs, durationMinutes }) {
    const now = Date.now();
    const earliest = Math.max(Number(earliestMs) || now, now);
    const deadline = Number(deadlineMs);
    const durationMs = Math.max(15, Number(durationMinutes) || 120) * 60 * 1000;
    if (!Number.isFinite(deadline) || deadline <= earliest + durationMs) {
      throw new Error('De eindtijd ligt te vroeg voor de gekozen programmaduur.');
    }

    const slots = await this.getEnergyPriceWindow(earliest, deadline);
    if (!slots.length) throw new Error('Geen Homey Energy-prijzen beschikbaar in deze periode.');

    const candidates = [];
    for (let i=0; i<slots.length; i++) {
      const start = Math.max(earliest, slots[i].start);
      const finish = start + durationMs;
      if (finish > deadline) continue;

      let cursor = start;
      let weighted = 0;
      let covered = 0;
      let lastEnd = start;
      for (let j=i; j<slots.length && cursor < finish; j++) {
        const s = slots[j];
        if (s.end <= cursor) continue;
        if (s.start > cursor + 1000) break; // gap in price data
        const segStart = Math.max(cursor, s.start);
        const segEnd = Math.min(finish, s.end);
        if (segEnd > segStart) {
          const ms = segEnd - segStart;
          weighted += s.price * ms;
          covered += ms;
          cursor = segEnd;
          lastEnd = s.end;
        }
      }
      if (covered >= durationMs - 1000) {
        candidates.push({
          start,
          end: finish,
          averagePrice: weighted / covered,
          durationMinutes: Math.round(durationMs / 60000)
        });
      }
    }

    if (!candidates.length) {
      throw new Error('Geen aaneengesloten prijsperiode gevonden die lang genoeg is.');
    }
    candidates.sort((a,b) => a.averagePrice - b.averagePrice || a.start - b.start);
    return {
      best: candidates[0],
      alternatives: candidates.slice(1, 5),
      slots: slots.map(s => ({
        start:s.start,
        end:s.end,
        price:s.price,
        marketPrice:Number.isFinite(Number(s.marketPrice)) ? Number(s.marketPrice) : null,
        priceField:s.priceField
      }))
    };
  }

  getWasherDevice(deviceId) {
    const driver = this.homey.drivers.getDriver('washer');
    const devices = driver.getDevices();
    const found = devices.find(device => {
      const ids = [
        typeof device.getId === 'function' ? device.getId() : null,
        device.id,
        device.getData?.().id
      ].filter(Boolean).map(String);
      return ids.includes(String(deviceId));
    });
    if (!found) throw new Error('LG-wasmachine niet gevonden.');
    return found;
  }
}

module.exports = LGThinQApp;
