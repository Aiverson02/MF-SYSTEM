import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Estado de carregamento + erro reutilizável para chamadas ao Supabase.
 */
export function useAsyncData<T>(
  fetcher: () => Promise<{ data: T | null; error: { message: string } | null }>,
  deps: unknown[] = [],
) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data: result, error: err } = await fetcherRef.current()
    if (err) setError(err.message)
    setData(result)
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading, error, reload, setData }
}
