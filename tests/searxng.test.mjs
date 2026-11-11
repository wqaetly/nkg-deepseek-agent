import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchProvider } from '../plugins/searxng.mjs';

test('SearXNG authenticates by header, encodes query and returns deduplicated web citations', async () => {
  const provider = createSearchProvider(async () => 'test-secret', async (url, options) => {
    assert.equal(url.origin, 'https://search.lfzxb.top');
    assert.equal(url.searchParams.get('q'), '中文 & news');
    assert.equal(url.searchParams.get('format'), 'json');
    assert.equal(options.headers['X-API-Key'], 'test-secret');
    assert.equal(options.redirect, 'error');
    assert.ok(!url.href.includes('test-secret'));
    return { ok: true, json: async () => ({ results: [
      { url: 'https://example.org', title: 'Example', content: 'Snippet' },
      { url: 'https://example.org' }, { url: 'javascript:alert(1)' }, null,
    ] }) };
  });
  assert.deepEqual(await provider.search({ query: '中文 & news' }), {
    sources: [{ url: 'https://example.org', title: 'Example', snippet: 'Snippet' }], truncated: false,
  });
});

test('missing key, HTTP failures and invalid responses surface errors without leaking credentials', async () => {
  await assert.rejects(createSearchProvider(async () => '').search({ query: 'test' }), { code: 'WEB_PROVIDER_CREDENTIAL_MISSING' });
  const denied = createSearchProvider(async () => 'test-secret', async () => ({ ok: false, status: 401 }));
  await assert.rejects(denied.search({ query: 'test' }), { code: 'WEB_PROVIDER_ERROR', message: 'SearXNG search HTTP 401' });
  const invalid = createSearchProvider(async () => 'test-secret', async () => ({ ok: true, json: async () => ({}) }));
  await assert.rejects(invalid.search({ query: 'test' }), { code: 'WEB_PROVIDER_ERROR' });
});

test('cancelled searches do not start a network request', async () => {
  const controller = new AbortController();
  controller.abort();
  const provider = createSearchProvider(async () => { throw Error('must not resolve credential'); });
  await assert.rejects(provider.search({ query: 'test' }, controller.signal), { name: 'AbortError' });
});
