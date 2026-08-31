'use strict';

const tibber = require('./tibber');
const nordpool = require('./nordpool');

const PROVIDERS = Object.freeze({
  AUTO: 'auto',
  HOMEY_ENERGY: 'homey-energy',
  TIBBER: 'tibber',
  SLIMLADEN: 'slimladen',
  ENTSOE: 'entsoe',
  NORDPOOL: 'nordpool',
});

function describeProviders() {
  return [
    { id: PROVIDERS.AUTO, title: 'Automatisch', status: 'implemented' },
    { id: PROVIDERS.HOMEY_ENERGY, title: 'Homey Energy', status: 'existing' },
    { id: PROVIDERS.TIBBER, title: 'Tibber API', status: 'implemented', resolutionMinutes: 15, requiresToken: true },
    { id: PROVIDERS.SLIMLADEN, title: 'SlimLaden', status: 'existing', resolutionMinutes: 15 },
    { id: PROVIDERS.ENTSOE, title: 'ENTSO-E', status: 'planned', resolutionMinutes: 15 },
    { id: PROVIDERS.NORDPOOL, title: 'Nord Pool', status: 'implemented-auth-shell', resolutionMinutes: 15, requiresToken: true },
  ];
}

function getSettings(homey) {
  const settings = homey?.settings;
  return {
    provider: settings?.get('energy_price_provider') || PROVIDERS.AUTO,
    tibberToken: settings?.get('tibber_api_token') || '',
    tibberHomeId: settings?.get('tibber_home_id') || '',
    slimladenUrl: settings?.get('slimladen_prices_url') || '',
    nordpoolToken: settings?.get('nordpool_api_token') || '',
    nordpoolApiUrl: settings?.get('nordpool_api_url') || '',
    nordpoolArea: settings?.get('nordpool_area') || 'NL',
  };
}

function configuredFallbackOrder(homey) {
  const cfg = getSettings(homey);
  if (cfg.provider && cfg.provider !== PROVIDERS.AUTO) return [cfg.provider];

  const order = [PROVIDERS.HOMEY_ENERGY];
  if (cfg.tibberToken) order.push(PROVIDERS.TIBBER);
  if (cfg.slimladenUrl) order.push(PROVIDERS.SLIMLADEN);
  if (cfg.nordpoolToken && cfg.nordpoolApiUrl) order.push(PROVIDERS.NORDPOOL);
  return order;
}

async function getPrices(provider, options = {}) {
  const { homey } = options;
  const cfg = homey ? getSettings(homey) : {};

  switch (provider) {
    case PROVIDERS.TIBBER:
      return tibber.getQuarterHourlyPrices({
        token: options.token || cfg.tibberToken,
        homeId: options.homeId || cfg.tibberHomeId || null,
      });
    case PROVIDERS.NORDPOOL:
      return nordpool.getQuarterHourlyPrices({
        token: options.token || cfg.nordpoolToken,
        apiUrl: options.apiUrl || cfg.nordpoolApiUrl,
        area: options.area || cfg.nordpoolArea || 'NL',
      });
    default:
      throw new Error(`Prijsprovider '${provider}' is nog niet via de providerlaag aangesloten.`);
  }
}

module.exports = {
  PROVIDERS,
  describeProviders,
  getSettings,
  configuredFallbackOrder,
  getPrices,
  tibber,
  nordpool,
};
