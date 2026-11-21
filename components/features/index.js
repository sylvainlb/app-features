// Barrel des composants features du catalogue (app-store-catalogue.md v0.4 §3).
// Import unique pour enregistrer tous les custom elements packagés (v1) :
//   import '@facis/app-features/components/features/index.js';
// FEATURE_COMPONENTS : slug du catalogue → tag du composant (cohérence seed ↔ orbit.json, §1.9.8).
import './alert-list/alert-list.js';
import './sla-view/sla-view.js';
import './report-form/report-form.js';
import './budget-gauge/budget-gauge.js';
import './shift-advisor/shift-advisor.js';
import './pv-gauge/pv-gauge.js';
import './benchmark-view/benchmark-view.js';
import './regulatory-export/regulatory-export.js';
import './weather-chart/weather-chart.js';
import './city-feed/city-feed.js';
import './ai-chat/ai-chat.js';
import './share-manager/share-manager.js';

export const FEATURE_COMPONENTS = {
  // Lot 1
  'alert-rules': 'alert-list',
  'sla-dashboard': 'sla-view',
  'report-builder': 'report-form',
  // Lot 2
  'budget-tracker': 'budget-gauge',
  'price-optimizer': 'shift-advisor',
  'pv-selfconsumption': 'pv-gauge',
  'benchmark': 'benchmark-view',
  'regulatory-export': 'regulatory-export',
  // Lot 3
  'weather-correlation': 'weather-chart',
  'city-events': 'city-feed',
  'ai-assistant': 'ai-chat',
  'data-sharing': 'share-manager',
};
