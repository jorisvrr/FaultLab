# ADR-0005: Protocol API — immutable JSON state, buffered effects, expiring context

**Status:** Accepted (CP0)

**Problem.** Protocols (ping, Raft, later user-written) must be easy to write, yet the engine must be able to trace every state change, snapshot every node, and guarantee that steps are atomic.

**Decision.** A protocol is `{ name, version, init(ctx), onMessage(state, msg, ctx), onTimer(state, timer, ctx) }`. Handlers receive deeply frozen state and **return** the next state. `ctx.send`/`setTimer`/`cancelTimer` record effects into a buffer, which is applied only after the handler returns successfully. The context expires when the handler returns.

**Alternatives.**
- *Mutable `this.state` / class-based nodes:* familiar, but the engine can't tell what changed, snapshots need deep copies, and partial mutation before a throw leaves corrupted state.
- *Pure reducer returning `{ state, effects[] }`:* maximally pure and easy to test, but verbose for authors, and message ids can't be returned to the caller synchronously.
- *Async handlers (`await ctx.receive()`):* reads naturally for sequential logic, but reintroduces scheduling questions (when does a continuation run?) that undermine determinism.

**Trade-off.** Authors write `return { ...state, x }` instead of `state.x = …` (Redux-style). In exchange: change detection is a reference comparison; snapshots share structure for free; a throwing handler has no effects; ids returned by `send()` are immediately usable.

**Invariant.** Each handler invocation is atomic: either all its effects and its new state are committed, or none are. Node state is only ever replaced, never mutated.

**Tested by.** "records a throwing handler and applies none of its effects"; frozen-state mutation rejected; stale context rejected; state-change detection (no `state.update` when unchanged).
