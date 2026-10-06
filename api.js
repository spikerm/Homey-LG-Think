'use strict';

module.exports = {
  async testPush({ homey }) {
    try {
      await homey.notifications.createNotification({
        excerpt: 'LG ThinQ • Testmelding — Pushmeldingen werken correct op deze Homey.'
      });
      homey.app.log('LG ThinQ test-pushmelding verzonden.');
      return { ok: true, message: 'Testmelding verzonden' };
    } catch (err) {
      const message = String(err?.message || err || 'Onbekende fout');
      homey.app.error('LG ThinQ test-pushmelding mislukt:', message);
      throw new Error('Testmelding mislukt: ' + message);
    }
  }
};
