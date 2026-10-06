'use strict';

module.exports = {
  async testPush({ homey }) {
    try {
      if (!homey.notifications || typeof homey.notifications.createNotification !== 'function') {
        throw new Error('Homey ManagerNotifications is niet beschikbaar.');
      }
      const result = await homey.notifications.createNotification({
        excerpt: 'LG ThinQ • Testmelding — Pushmeldingen werken correct op deze Homey.'
      });
      homey.app.log('LG ThinQ test-notificatie aangemaakt:', JSON.stringify(result || {}));
      return { ok: true, message: 'Homey-notificatie aangemaakt' };
    } catch (err) {
      const message = String(err?.message || err || 'Onbekende fout');
      homey.app.error('LG ThinQ test-pushmelding mislukt:', message);
      throw new Error('Testmelding mislukt: ' + message);
    }
  },
  async testCortana({ homey }) {
    try {
      const result = await homey.app.cortana.test();
      return { ok: true, message: result?.message || 'CORTANA test verzonden' };
    } catch (err) {
      throw new Error('CORTANA test mislukt: ' + String(err?.message || err || 'Onbekende fout'));
    }
  }
};
