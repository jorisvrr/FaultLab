import { useEffect, useState } from 'react';

/** The three application modes (approved: Configure, Simulate, Investigate). Hash-routed, no router dependency. */
export type Mode = 'configure' | 'simulate' | 'investigate';
export const MODES: readonly { id: Mode; label: string }[] = [
  { id: 'configure', label: 'Configure' },
  { id: 'simulate', label: 'Simulate' },
  { id: 'investigate', label: 'Investigate' },
];

const read = (): Mode => {
  const id = location.hash.replace(/^#\/?/, '');
  return MODES.some((m) => m.id === id) ? (id as Mode) : 'configure';
};

export function useMode(): [Mode, (mode: Mode) => void] {
  const [mode, setMode] = useState<Mode>(read);
  useEffect(() => {
    const onChange = () => setMode(read());
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return [mode, (next) => (location.hash = `/${next}`)];
}
