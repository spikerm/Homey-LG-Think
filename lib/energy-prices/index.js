'use strict';

const tibber = require('./tibber');

const PROVIDERS = Object.freeze({
  HOMEY_ENERGY: 'homey-energy',
  TIBBER: 'tibber',
  SLIMLADEN: 'slimladen',
  ENTSOE: 'entsoe',
  NORDPOOL: 'nordpool',
});

function describeProviders() {
  return [
    { id: PROVIDERS.HOMEY_ENERGY, title: 'Homey Energy', status: 'existing' },
    { id: PROVIDERS.TIBBER, title: 'Tibber API', status: 'implemented', resolutionMinutes: 15, requiresToken: true },
    { id: PROVIDERS.SLIMLADEN, title: 'SlimLaden', status: 'existing', resolutionMinutes: 15 },
    { id: PROVIDERS.ENTSOE, title: 'ENTSO-E', status: 'planned', resolutionMinutes: 15 },
    { id: PROVIDERS.NORDPOOL, title: 'Nord Pool', status: 'planned', resolutionMinutes: 15 },
  ];
}

async function getPrices(provider, options = {}) {
  switch (provider) {
    case PROVIDERS.TIBBER:
      return tibber.getQuarterHourlyPrices(options);
    default:
      throw new Error(`Prijsprovider '${provider}' is nog niet via de providerlaag aangesloten.`);
  }
}

module.exports = { PROVIDERS, describeProviders, getPrices, tibber };
