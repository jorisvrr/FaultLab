# ADR-0002: Virtual time is integer ticks

**Status:** Accepted (CP0)

**Problem.** The simulation needs a notion of time that orders events and models latency, and it must be exact. Floating-point addition is not associative, and accumulated latencies drift: `0.1 + 0.2 !== 0.3`. Two events that "should" be simultaneous can compare unequal.

**Decision.** `VirtualTime` is a non-negative safe integer number of ticks (convention: 1 tick = 1 ms). Delays are integers ≤ 2³¹. The clock advances only when an event is dispatched, to that event's time.

**Alternatives.**
- *Float milliseconds:* natural to write, but inexact (see above).
- *BigInt:* unbounded and exact, but slow, awkward in arithmetic, and not JSON-serialisable without custom encoding.
- *Integer microseconds:* finer resolution, but traces become harder to read; nothing in CP0–CP4 needs sub-millisecond resolution. Changing the tick convention later only changes how the UI labels time.

**Trade-off.** Protocols cannot express sub-tick delays. With ≤ 2³¹ per delay and the default 100 000-event limit, time stays below ≈ 2⁴⁷·⁶, far from 2⁵³.

**Invariant.** Clock time is monotonic non-decreasing and always a safe integer; no event is scheduled before `now`.

**Tested by.** Scheduler tests (rejecting past/fractional/NaN/∞/2⁵³ times), config tests (latency bounds), protocol tests (fractional and negative delays rejected).
