import { WebError } from '@deepseek-ai/dsh-web';

export const name = 'web-search-lfzxb';
export const inject = ['web', 'credentials'];

export function createSearchProvider(resolveApiKey, fetchImpl = fetch) {
  return {
    id: 'lfzxb-searxng',
    available: () => true,
    async search(request, signal) {
      signal?.throwIfAborted();
      const apiKey = await resolveApiKey();
      if (!apiKey) throw new WebError('SearXNG search credential is missing', 'WEB_PROVIDER_CREDENTIAL_MISSING');
      const url = new URL('https://search.lfzxb.top/search');
      url.searchParams.set('q', request.query);
      url.searchParams.set('format', 'json');
      const timeout = AbortSignal.timeout(25_000);
      let result;
      try {
        const response = await fetchImpl(url, {
          headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
          redirect: 'error',
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (!response.ok) throw new WebError(`SearXNG search HTTP ${response.status}`, 'WEB_PROVIDER_ERROR');
        result = await response.json();
      } catch (error) {
        if (error instanceof WebError) throw error;
        throw new WebError(signal?.aborted ? 'Search cancelled' : 'SearXNG search request failed or timed out',
          signal?.aborted ? 'WEB_ABORTED' : 'WEB_PROVIDER_ERROR');
      }
      if (!Array.isArray(result?.results)) throw new WebError('Invalid SearXNG response', 'WEB_PROVIDER_ERROR');
      const seen = new Set();
      const sources = result.results.flatMap(item => {
        if (!item || typeof item.url !== 'string' || !URL.canParse(item.url)
          || !['http:', 'https:'].includes(new URL(item.url).protocol) || seen.has(item.url)) return [];
        seen.add(item.url);
        return [{ url: item.url,
          ...(typeof item.title === 'string' ? { title: item.title } : {}),
          ...(typeof item.content === 'string' ? { snippet: item.content } : {}),
        }];
      });
      return { sources, truncated: false };
    },
  };
}

export function apply(ctx) {
  ctx.web.registerSearchProvider(createSearchProvider(async () =>
    (await ctx.credentials.resolve('LFZXB_SEARCH_API_KEY'))?.value));
}
