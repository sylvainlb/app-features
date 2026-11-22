// feature-base.js — base class of the catalogue feature components.
// When an LDP container is not published yet (CR-0/1/4…) or a functional
// endpoint is missing (POST /app/llm = CR-5, DSP negotiation…), the component
// renders an explicit "data unavailable on the server side" panel (LDP-only:
// no more POST /app/query proxy, work item O-1 removed).
import { html } from 'lit';
import { OrbitComponent } from '@facis/app-store/components/boilerplate/index.js';
import { isMissingBackend } from './feature-data.js';

export class FeatureComponent extends OrbitComponent {
  static styles = OrbitComponent.styles;

  render() {
    const err = this._task?.error;
    if (err && isMissingBackend(err)) {
      return html`<div class="error" role="alert">
        <b>Data unavailable on the server side.</b><br>
        <code>${err.message}</code><br>
        <span class="fresh">${err.hint ?? 'Server work to be delivered — the feature will activate once the back end is deployed.'}</span>
      </div>`;
    }
    return super.render();
  }
}
