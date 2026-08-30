'use strict';

const axios = require('axios');
const crypto = require('crypto');
const qs = require('qs');
const { DateTime } = require('luxon');

const GATEWAY_URL = 'https://route.lgthinq.com:46030/v1/service/application/gateway-uri';
const CLIENT_ID = 'LGAO221A02';
const OAUTH_SECRET_KEY = 'c053c2a6ddeb7ad97cb0eed0dcb31cf8';
const OAUTH_CLIENT_KEY = 'LGAO722A02';
const API_KEY = 'VGhpblEyLjAgU0VSVklDRQ==';
const API_CLIENT_ID = 'c713ea8e50f657534ff8b9d373dfebfc2ed70b88285c26b8ade49868c0b164d9';
const APPLICATION_KEY = '6V1V8H2BN5P9ZQGOI5DAQ92YZBDO3EK9';

function hmac(message, secret) {
  return crypto.createHmac('sha1', Buffer.from(secret)).update(message).digest('base64');
}

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i=0;i<length;i++) out += chars[Math.floor(Math.random()*chars.length)];
  return out;
}


function normalizeUrl(value) {
  if (!value) return value;
  let out = String(value).trim();

  // LG may return oauth2_backend_url percent-encoded, e.g.
  // https%3A%2F%2Fgb.lgeapi.com%2F
  for (let i = 0; i < 3; i++) {
    if (/^https?:\/\//i.test(out)) break;
    try {
      const decoded = decodeURIComponent(out);
      if (decoded === out) break;
      out = decoded;
    } catch (_) {
      break;
    }
  }

  if (out && !out.endsWith('/')) out += '/';
  return out;
}

function _safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (err) {
    return String(value);
  }
}

class ThinQ2Legacy {
  constructor({ country='NL', language='nl-NL', logger=console }) {
    this.country = country;
    this.language = language;
    this.logger = logger;
    this.http = axios.create({
      timeout: 20000,
      maxRedirects: 10,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 7.1.2; SM-G930L) AppleWebKit/537.36 Chrome/93.0.4577.63 Mobile Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    this.gateway = null;
    this.session = null;
    this.userNumber = null;
    this.clientId = API_CLIENT_ID;
  }

  _httpError(step, err) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    const body = data === undefined ? '' : ` body=${typeof data === 'string' ? data : JSON.stringify(data)}`;
    const e = new Error(`${step}${status ? ` HTTP ${status}` : ''}: ${err?.message || err}${body}`);
    e.cause = err;
    return e;
  }

  async _step(step, fn) {
    try {
      this.logger?.log?.(`[ThinQ2] ${step}...`);
      const result = await fn();
      this.logger?.log?.(`[ThinQ2] ${step}: OK`);
      return result;
    } catch (err) {
      const e = this._httpError(step, err);
      this.logger?.error?.(`[ThinQ2] ${e.message}`);
      throw e;
    }
  }

  baseHeaders() {
    return {
      'x-api-key': API_KEY,
      'x-client-id': this.clientId || API_CLIENT_ID,
      'x-thinq-app-ver': '3.6.1200',
      'x-thinq-app-type': 'NUTS',
      'x-thinq-app-level': 'PRD',
      'x-thinq-app-os': 'ANDROID',
      'x-thinq-app-logintype': 'LGE',
      'x-service-code': 'SVC202',
      'x-country-code': this.country,
      'x-language-code': this.language,
      'x-service-phase': 'OP',
      'x-origin': 'app-native',
      'x-model-name': 'samsung/SM-G930L',
      'x-os-version': 'AOS/7.1.2',
      'x-app-version': 'LG ThinQ/3.6.12110',
      'x-message-id': randomString(22),
      'user-agent': 'okhttp/3.14.9'
    };
  }

  async loadGateway() {
    if (this.gateway) return this.gateway;
    const res = await this.http.get(GATEWAY_URL, { headers: this.baseHeaders() });
    this.gateway = res.data.result;
    return this.gateway;
  }

  gw(name) {
    const g = this.gateway;
    if (name === 'login') return `${g.empSpxUri}/`;
    if (name === 'emp') return `${g.empTermsUri}/`;
    if (name === 'thinq2') return `${g.thinq2Uri}/`;
    if (name === 'thinq1') return `${g.thinq1Uri}/`;
    throw new Error('Unknown gateway field');
  }

  async login(username, password) {
    await this._step('gateway', () => this.loadGateway());
    this.logger?.log?.('[ThinQ2] gateway:', JSON.stringify(this.gateway));

    const hash = crypto.createHash('sha512').update(password).digest('hex');

    const headers = {
      'Accept': 'application/json',
      'X-Application-Key': APPLICATION_KEY,
      'X-Client-App-Key': CLIENT_ID,
      'X-Lge-Svccode': 'SVC709',
      'X-Device-Type': 'M01',
      'X-Device-Platform': 'ADR',
      'X-Device-Language-Type': 'IETF',
      'X-Device-Publish-Flag': 'Y',
      'X-Device-Country': this.gateway.countryCode,
      'X-Device-Language': this.gateway.languageCode,
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'Access-Control-Allow-Origin': '*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 7.1.2; SM-G930L) AppleWebKit/537.36 Chrome/93.0.4577.63 Mobile Safari/537.36'
    };

    const pre = await this._step('preLogin', () => this.http.post(
      this.gw('login') + 'preLogin',
      qs.stringify({
        user_auth2: hash,
        log_param: `login request / user_id : ${username} / third_party : null / svc_list : SVC202,SVC710 / 3rd_service : `
      }),
      { headers }
    ).then(r => r.data));

    headers['X-Signature'] = pre.signature;
    headers['X-Timestamp'] = pre.tStamp;

    const account = await this._step('account session', () => this.http.post(
      this.gw('emp') + 'emp/v2.0/account/session/' + encodeURIComponent(username),
      qs.stringify({
        user_auth2: pre.encrypted_pw,
        password_hash_prameter_flag: 'Y',
        svc_list: 'SVC202,SVC710'
      }),
      { headers }
    ).then(r => r.data.account));

    const secretKey = await this._step('OAuth secret key', () => this.http.get(
      this.gw('login') + 'searchKey?key_name=OAUTH_SECRETKEY&sever_type=OP',
      { headers: {
        'Accept': 'application/json',
        'User-Agent': headers['User-Agent'],
        'Accept-Language': headers['Accept-Language']
      }}
    ).then(r => r.data.returnData));

    const timestamp = DateTime.utc().toRFC2822();
    const params = {
      account_type: account.userIDType,
      client_id: CLIENT_ID,
      country_code: account.country,
      redirect_uri: 'lgaccount.lgsmartthinq:/',
      response_type: 'code',
      state: '12345',
      username: account.userID
    };
    const url = new URL('https://emp-oauth.lgecloud.com/emp/oauth2/authorize/empsession?' + qs.stringify(params));
    const signature = hmac(`${url.pathname}${url.search}\n${timestamp}`, secretKey);

    const auth = await this._step('OAuth authorize', () => this.http.get(url.href, { headers: {
      'lgemp-x-app-key': OAUTH_CLIENT_KEY,
      'lgemp-x-date': timestamp,
      'lgemp-x-session-key': account.loginSessionID,
      'lgemp-x-signature': signature,
      'Accept': 'application/json',
      'X-Device-Type': 'M01',
      'X-Device-Platform': 'ADR',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Access-Control-Allow-Origin': '*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/93.0.4577.63 Safari/537.36'
    }}).then(r => r.data));

    if (auth.status !== 1 || !auth.redirect_uri) {
      throw new Error(`OAuth authorize: ${auth.message || JSON.stringify(auth)}`);
    }

    const redirect = new URL(auth.redirect_uri);
    const oauthBackend = normalizeUrl(redirect.searchParams.get('oauth2_backend_url'));
    if (!oauthBackend) throw new Error('OAuth redirect bevat geen oauth2_backend_url');

    const tokenData = {
      code: redirect.searchParams.get('code'),
      grant_type: 'authorization_code',
      redirect_uri: params.redirect_uri
    };

    // Important: upstream signs the path WITH '?' before query.
    const requestPath = '/oauth/1.0/oauth2/token?' + qs.stringify(tokenData);
    const tokenTimestamp = DateTime.utc().toRFC2822();

    const token = await this._step('OAuth token exchange', () => this.http.post(
      oauthBackend + 'oauth/1.0/oauth2/token',
      qs.stringify(tokenData),
      { headers: {
        'x-lge-app-os': 'ADR',
        'x-lge-appkey': CLIENT_ID,
        'x-lge-oauth-signature': hmac(`${requestPath}\n${tokenTimestamp}`, OAUTH_SECRET_KEY),
        'x-lge-oauth-date': tokenTimestamp,
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': headers['User-Agent']
      }}
    ).then(r => r.data));

    this.session = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      oauthBase: normalizeUrl(token.oauth2_backend_url) || oauthBackend || `https://${this.gateway.countryCode.toLowerCase()}.lgeapi.com/`
    };

    this.userNumber = await this._step('user profile', () => this.getUserNumber());
    this.clientId = crypto.createHash('sha256')
      .update(this.userNumber + Date.now())
      .digest('hex');

    return {
      refreshToken: this.session.refreshToken,
      userNumber: this.userNumber
    };
  }

  async refresh(refreshToken) {
    await this.loadGateway();
    let oauthBase = `https://${this.gateway.countryCode.toLowerCase()}.lgeapi.com/`;
    try {
      const g = await this.http.post('https://kic.lgthinq.com:46030/api/common/gatewayUriList', {
        lgedmRoot: { countryCode: this.gateway.countryCode, langCode: this.gateway.languageCode }
      }, { headers: {
        'Accept':'application/json',
        'x-thinq-application-key':'wideq',
        'x-thinq-security-key':'nuts_securitykey'
      }}).then(r => r.data.lgedmRoot);
      if (g.oauthUri) oauthBase = normalizeUrl(g.oauthUri);
    } catch (_) {}

    const data = { grant_type:'refresh_token', refresh_token: refreshToken };
    const ts = DateTime.utc().toRFC2822();
    const path = '/oauth/1.0/oauth2/token' + qs.stringify(data, { addQueryPrefix:true });
    const token = await this.http.post(oauthBase + 'oauth/1.0/oauth2/token',
      qs.stringify(data),
      { headers: {
        'x-lge-app-os':'ADR',
        'x-lge-appkey':CLIENT_ID,
        'x-lge-oauth-signature':hmac(`${path}\n${ts}`, OAUTH_SECRET_KEY),
        'x-lge-oauth-date':ts,
        'Accept':'application/json',
        'Content-Type':'application/x-www-form-urlencoded'
      }}
    ).then(r => r.data);

    this.session = {
      accessToken: token.access_token,
      refreshToken: refreshToken,
      oauthBase
    };
    this.userNumber = await this.getUserNumber();
    this.clientId = crypto.createHash('sha256').update(this.userNumber + Date.now()).digest('hex');
    return true;
  }

  async getUserNumber() {
    const base = normalizeUrl(this.session.oauthBase);
    this.logger?.log?.('[ThinQ2] OAuth base:', base);
    const ts = DateTime.utc().toRFC2822();
    const sig = hmac(`/users/profile\n${ts}`, OAUTH_SECRET_KEY);
    const resp = await this.http.get(base + 'users/profile', { headers: {
      'Accept':'application/json',
      'Authorization':'Bearer ' + this.session.accessToken,
      'X-Lge-Svccode':'SVC202',
      'X-Application-Key':APPLICATION_KEY,
      'lgemp-x-app-key':CLIENT_ID,
      'X-Device-Type':'M01',
      'X-Device-Platform':'ADR',
      'x-lge-oauth-date':ts,
      'x-lge-oauth-signature':sig
    }}).then(r => r.data);
    return String(resp.account.userNo);
  }

  authHeaders() {
    return {
      ...this.baseHeaders(),
      'x-emp-token': this.session.accessToken,
      'x-user-no': this.userNumber,
      'x-client-id': this.clientId
    };
  }

  async request(method, endpoint, data) {
    const url = new URL(endpoint, this.gw('thinq2')).href;
    try {
      return await this.http.request({
        method, url, data, headers: this.authHeaders()
      }).then(r => r.data);
    } catch (err) {
      const status = err?.response?.status;
      const body = err?.response?.data;
      const detail = body === undefined ? '' : ` body=${typeof body === 'string' ? body : JSON.stringify(body)}`;
      const e = new Error(`ThinQ2 ${method.toUpperCase()} ${endpoint}${status ? ` HTTP ${status}` : ''}: ${err?.message || err}${detail}`);
      e.status = status;
      e.payload = body;
      throw e;
    }
  }

  async getHomes() {
    const x = await this.request('get','service/homes');
    return x?.result?.item || [];
  }

  async getDevices() {
    const homes = await this.getHomes();
    const out = [];
    for (const h of homes) {
      const x = await this.request('get', `service/homes/${h.homeId}`);
      out.push(...(x?.result?.devices || []));
    }
    return out;
  }

  async getSingleDevice(deviceId) {
    const x = await this.request('get', `service/devices/${deviceId}`);
    return x?.result || x;
  }

  async fetchJsonUrl(url) {
    if (!url) return null;
    return this.http.get(url, { timeout:20000 }).then(r => r.data);
  }

  async getModelAndCourses(device) {
    const modelUrl = device.modelJsonUrl || device.modelJsonUri || device.modelJsonURL;
    const courseUrl = device.courseJsonUrl || device.courseJsonUri || device.courseJsonURL;
    const model = modelUrl ? await this.fetchJsonUrl(modelUrl) : null;
    const course = courseUrl ? await this.fetchJsonUrl(courseUrl) : null;

    return { modelUrl, courseUrl, model, course };
  }
  async sendControl(deviceId, values, command = 'Set', ctrlKey = 'basicCtrl', ctrlPath = 'control-sync') {
    const body = {
      ctrlKey,
      command,
      ...values
    };
    const x = await this.request('post', `service/devices/${deviceId}/${ctrlPath}`, body);
    if (x && x.resultCode && x.resultCode !== '0000') {
      throw new Error(`ThinQ2 control geweigerd: ${x.resultCode}`);
    }
    return x;
  }

  async setWasher(deviceId, action, washerDryer) {
    if (!action || typeof action !== 'string') {
      throw new Error('ThinQ2 washer action ontbreekt');
    }

    // Exact ThinQ2 washer format used by working ioBroker implementation:
    // { ctrlKey:<action>, command:'Set', dataSetList:{ washerDryer:{...} } }
    // WMStop and WMOff are the exception and use ctrlKey 'WMControl'.
    const ctrlKey = (action === 'WMStop' || action === 'WMOff')
      ? 'WMControl'
      : action;

    const body = {
      ctrlKey,
      command: 'Set',
      dataSetList: {
        washerDryer
      }
    };

    this.logger?.log?.(`[ThinQ2] CONTROL-SYNC BODY ${action}: ${_safeJson(body)}`);

    const x = await this.request(
      'post',
      `service/devices/${deviceId}/control-sync`,
      body
    );

    if (x && x.resultCode && x.resultCode !== '0000') {
      const e = new Error(`ThinQ2 ${action} geweigerd: ${x.resultCode}`);
      e.status = 400;
      e.payload = x;
      throw e;
    }
    return x;
  }

}

module.exports = ThinQ2Legacy;
