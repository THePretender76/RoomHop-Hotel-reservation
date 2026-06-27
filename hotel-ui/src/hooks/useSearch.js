import { useState } from 'react';
import { apiGet } from '../api/client';

const SKELETON_COUNT = 5;

export function useSearch() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);

  async function search(params) {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet('/v1/search', params);
      setResults(data.results || []);
    } catch (err) {
      setError(err.message || 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return {
    loading,
    results,
    error,
    skeletonCount: loading ? SKELETON_COUNT : 0,
    search,
  };
}
