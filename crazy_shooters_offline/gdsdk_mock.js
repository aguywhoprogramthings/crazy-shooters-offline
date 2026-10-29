/**
 * GameDistribution Offline Mock SDK
 * Replaces online ad network and tracking with instantaneous offline callbacks.
 */
(function() {
  'use strict';
  
  console.log('[Crazy Shooters Offline] GameDistribution Mock SDK initialized.');

  window.gdsdk = {
    showBanner: function() {
      console.log('[Offline GD] Banner requested - skipped silently.');
    },
    showAd: function(adType) {
      console.log('[Offline GD] showAd(' + adType + ') - granting instant completion.');
      setTimeout(function() {
        if (window.gameInstance && typeof window.gameInstance.SendMessage === 'function') {
          try {
            window.gameInstance.SendMessage('GameDistribution', 'ResumeGame');
          } catch(e) {
            console.warn('[Offline GD] ResumeGame call:', e);
          }
        }
      }, 50);
      return Promise.resolve();
    },
    preloadAd: function(adType) {
      console.log('[Offline GD] preloadAd(' + adType + ') - instantly resolved.');
      return Promise.resolve({ success: true });
    },
    openConsole: function() {
      console.log('[Offline GD] Mock console active.');
    }
  };

  // Dispatch initial SDK_GAME_START if GD_OPTIONS registered
  window.addEventListener('load', function() {
    if (window.GD_OPTIONS && typeof window.GD_OPTIONS.onEvent === 'function') {
      try {
        window.GD_OPTIONS.onEvent({ name: 'SDK_GAME_START' });
      } catch(e) {}
    }
  });
})();
