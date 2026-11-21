// feature-base.js — classe de base des composants features du catalogue.
// Quand un conteneur LDP n'est pas encore publié (CR-0/1/4…) ou qu'un endpoint
// fonctionnel manque (POST /app/llm = CR-5, négociation DSP…), le composant rend
// un panneau explicite « données indisponibles côté serveur » (LDP-only :
// plus de proxy POST /app/query, chantier O-1 supprimé).
import { html } from 'lit';
import { OrbitComponent } from '@facis/app-store/components/boilerplate/index.js';
import { isMissingBackend } from './feature-data.js';

export class FeatureComponent extends OrbitComponent {
  static styles = OrbitComponent.styles;

  render() {
    const err = this._task?.error;
    if (err && isMissingBackend(err)) {
      return html`<div class="error" role="alert">
        <b>Données indisponibles côté serveur.</b><br>
        <code>${err.message}</code><br>
        <span class="fresh">${err.hint ?? 'Chantier serveur à livrer — la feature s’activera dès que le back est déployé.'}</span>
      </div>`;
    }
    return super.render();
  }
}
