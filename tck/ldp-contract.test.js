// TCK e2e — real LDP contract against a FAP-LDP pod (CA-A2, CA-A7).
// Runs only if the env is provided:
//   APPSTORE_TEST_POD_URL=https://<pod> APPSTORE_TEST_TOKEN=<bearer> \
//   APPSTORE_TEST_PREFS_IRI=https://<pod>/prefs/<pk> \
//   APPSTORE_TEST_OTHER_PREFS_IRI=https://<pod>/prefs/<other_pk> \
//   npm run test:e2e
import { test } from 'node:test';
import assert from 'node:assert/strict';

const POD = process.env.APPSTORE_TEST_POD_URL;
const TOKEN = process.env.APPSTORE_TEST_TOKEN;
const PREFS_IRI = process.env.APPSTORE_TEST_PREFS_IRI;
const OTHER_IRI = process.env.APPSTORE_TEST_OTHER_PREFS_IRI;
const SKIP = !POD || !TOKEN || !PREFS_IRI || !OTHER_IRI;

const headers = { accept: 'application/ld+json', authorization: `Bearer ${TOKEN}` };

async function req(method, url, body, extra = {}) {
  return fetch(url, {
    method,
    headers: { ...headers, ...(body ? { 'content-type': 'application/merge-patch+json' } : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test('app store LDP contract (e2e)', { skip: SKIP && 'APPSTORE_TEST_* not provided' }, async () => {
  // CA-A7: GET /features/<slug> resolved by slug (slug→id lookup on the PEP side)
  const cat = await req('GET', `${POD}/features/`);
  assert.equal(cat.status, 200);
  const container = await cat.json();
  const slugs = (container['ldp:contains'] ?? []).map((m) => (m['@id'] ?? '').split('/').pop());
  assert.ok(slugs.length > 0, 'catalogue not empty');
  const slug = slugs[0];
  const fiche = await req('GET', `${POD}/features/${slug}`);
  assert.equal(fiche.status, 200, `GET /features/${slug} → 200 (CA-A7)`);
  const f = await fiche.json();
  assert.equal(f.slug ?? f['features:slug'] ?? f['@id']?.split('/').pop(), slug);

  // CA-A2: R1-form PATCH on my prefs → 200 + read-after-write
  const etag = (await req('GET', PREFS_IRI)).headers.get('etag');
  const patch = await req('PATCH', PREFS_IRI, { prefs: { [slug]: { enabled: false } } }, etag ? { 'if-match': etag } : {});
  assert.ok([200, 201, 204].includes(patch.status), `PATCH /prefs → ${patch.status}`);
  const after = await req('GET', PREFS_IRI);
  assert.equal(after.status, 200);
  const prefs = await after.json();
  const entry = prefs.prefs?.[slug] ?? prefs['prefs:prefs']?.[slug];
  assert.equal(entry?.enabled, false, 'read-after-write: enabled=false persisted');

  // CA-A2: another user does not see my prefs → 404 (not 403, §1.9.10)
  const other = await req('GET', OTHER_IRI);
  assert.equal(other.status, 404, `GET another user's prefs → 404 (got ${other.status})`);
});
