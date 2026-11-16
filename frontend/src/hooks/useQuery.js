import { useEffect, useRef, useState } from 'react';

const cache = new Map();
const MAX_ENTRIES = 120;

function remember(key, value) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

/**
 * Pedido con caché por clave y "stale-while-revalidate": mientras llega la
 * respuesta nueva se conserva la anterior (la UI la atenúa en vez de vaciarse).
 * `key = null` desactiva el pedido.
 */
export function useQuery(key, fetcher) {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [state, setState] = useState(() => ({
    data: (key && cache.get(key)) || null,
    loading: Boolean(key) && !cache.has(key),
    error: null,
  }));

  useEffect(() => {
    if (!key) return undefined;
    if (cache.has(key)) {
      setState({ data: cache.get(key), loading: false, error: null });
      return undefined;
    }
    const ctl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcherRef.current(ctl.signal)
      .then((d) => {
        remember(key, d);
        setState({ data: d, loading: false, error: null });
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setState((s) => ({ ...s, loading: false, error: e.message }));
      });
    return () => ctl.abort();
  }, [key]);

  return state;
}

export const clearQueryCache = () => cache.clear();
