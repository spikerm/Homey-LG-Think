'use strict';

class CortanaClient {
  constructor(homey, app) {
    this.homey = homey;
    this.app = app;
  }

  _setting(key, fallback = null) {
    const value = this.homey.settings.get(key);
    return value === null || value === undefined ? fallback : value;
  }

  _config() {
    const url = String(this._setting('cortana_url', '') || '').trim().replace(/\/+$/, '');
    const secret = String(this._setting('cortana_webhook_secret', '') || '').trim();
    if (!url) throw new Error('CORTANA URL ontbreekt.');
    if (!/^https?:\/\//i.test(url)) throw new Error('CORTANA URL moet met http:// of https:// beginnen.');
    if (!secret) throw new Error('CORTANA webhook-sleutel ontbreekt.');
    return { url, secret };
  }

  _allowed(event) {
    if (this._setting('cortana_enabled', false) !== true) return false;
    const defaults = {
      planned:true, replanned:true, starting:true, running:true,
      completed:true, failed:true, remote_missing:true, error:true
    };
    const value = this._setting('cortana_' + event, defaults[event] === true);
    return value === true;
  }

  _priority(event) {
    return ['failed','remote_missing','error'].includes(event) ? 'critical' : 'normal';
  }

  _title(event) {
    return ({
      planned:'Slim wassen gepland',
      replanned:'Planning gewijzigd',
      starting:'Slim wassen wordt gestart',
      running:'Slim wassen gestart',
      completed:'Wasprogramma gereed',
      failed:'Start mislukt',
      remote_missing:'Remote Start ontbreekt',
      error:'LG ThinQ storing'
    })[event] || 'LG ThinQ';
  }

  async _post(payload) {
    const { url, secret } = this._config();
    const controller = new AbortController();
    const timer = this.homey.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url + '/api/webhooks/homey', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Cortana-Webhook-Key': secret
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const body = await response.text();
      if (!response.ok) throw new Error('HTTP ' + response.status + (body ? ': ' + body.slice(0, 160) : ''));
      return { ok:true, message:'CORTANA test verzonden' };
    } finally {
      this.homey.clearTimeout(timer);
    }
  }

  async notify(event, message) {
    if (!this._allowed(event)) return false;
    try {
      await this._post({
        source: 'lg_thinq',
        event: String(event || 'notification'),
        title: this._title(event),
        message: String(message || 'LG ThinQ melding'),
        priority: this._priority(event),
        telegram: this._setting('cortana_telegram', true) === true
      });
      this.app.log(`CORTANA [${event}] verzonden.`);
      return true;
    } catch (err) {
      // Deliberately swallow webhook failures: appliance control is more important.
      this.app.error(`CORTANA [${event}] mislukt: ${err?.name === 'AbortError' ? 'timeout' : (err?.message || err)}`);
      return false;
    }
  }

  async test() {
    return this._post({
      source:'lg_thinq',
      event:'test',
      title:'LG ThinQ test',
      message:'LG ThinQ is rechtstreeks gekoppeld aan CORTANA Home AI.',
      priority:'normal',
      telegram:this._setting('cortana_telegram', true) === true
    });
  }
}

module.exports = CortanaClient;
