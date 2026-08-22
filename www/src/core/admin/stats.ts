export type StatsValue = string | number;

export function sortStatsRows<T extends Record<string, StatsValue>>(
  source: readonly T[],
  key: string,
  ascending: boolean,
): T[] {
  return [...source].sort((a, b) => {
    const left = a[key] ?? '';
    const right = b[key] ?? '';
    const compared = typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left).localeCompare(String(right));
    return ascending ? compared : -compared;
  });
}

export function citiesForCountry<T extends { country: string }>(cities: readonly T[], country: string): T[] {
  return cities.filter((row) => row.country === country);
}
