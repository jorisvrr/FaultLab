import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import type { Frame } from '@faultlab/trace';
import type { Session, SessionView } from '../state/session';

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error('useSession outside <SessionContext>');
  return session;
}

/** The session's current view; re-renders at most once per animation frame. */
export function useSessionView(): SessionView {
  const session = useSession();
  return useSyncExternalStore(session.subscribe, () => session.view);
}

/** The reconstructed world at the cursor (null before the first chunk). */
export function useFrame(): Frame | null {
  const session = useSession();
  const { cursor, traceVersion } = useSessionView();
  return useMemo(() => {
    const index = session.trace.index;
    return index === null ? null : index.frameAt(cursor);
    // traceVersion: records of in-flight messages can resolve as the trace grows.
  }, [session, cursor, traceVersion]);
}
