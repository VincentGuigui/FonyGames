import { useEffect, useState } from 'preact/hooks';
import { soloTesting, subscribeSoloTesting } from './solo';

/** Reactive solo-testing preference for game and lobby components. */
export function useSoloTesting(): boolean {
  const [on, setOn] = useState(soloTesting);
  useEffect(() => subscribeSoloTesting(() => setOn(soloTesting())), []);
  return on;
}
