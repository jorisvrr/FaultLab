# ADR-0010: Network faults and messages in flight

**Status:** Accepted (CP1)

**Problem.** Delay, loss and partitions must have precise semantics, especially for messages *already in flight* when a fault starts or ends. Ambiguity here is exactly where simulators silently diverge from reality.

**Decision.**

*Link conditions* are directed (`from → to`): `{ loss ∈ [0,1], delay: {min,max} }`, set by a `link` fault (replacing any previous condition on that link) and cleared by `link-restore`. **A message's fate is decided once, at send time**, in this order:
1. Partition separates sender and receiver → `message.drop { reason: 'partitioned' }`.
2. Link loss > 0 and `chance(loss)` → `message.drop { reason: 'lost' }`.
3. Otherwise `deliverAt = now + base latency + extra link delay`.

Changing or restoring a link therefore never affects messages already in flight (they "left the wire" under the old conditions).

*Partitions* assign every node to a group: the listed groups plus one implicit group of all unlisted nodes. A new partition replaces the old one; `heal` removes it. Partitions are checked **at send and again at delivery**. A message in flight across a partition that starts before it arrives is dropped (`'partitioned-in-flight'`), like packets on a cut cable. A partition that heals before the message arrives does not drop it.

*Crashes:* messages sent before the sender crashed are still delivered (they already left). Messages arriving at a crashed receiver are dropped (`'node-down'`). Messages addressed to an earlier incarnation are delivered to the current one; the network knows nothing about incarnations, and protocols must tolerate old messages.

At delivery, network checks come before node checks: a message that is both partitioned and addressed to a crashed node is reported as partitioned (it never reached the machine).

Every drop records `conditionIndex`: the trace index of the fault entry that caused it (the partition, link fault, or crash). `cause` stays the message's own `message.send`. Together they answer both "where did this message come from?" and "why was it lost?".

All randomness comes from the network stream. Extra draws happen only when a condition is active, so a run with no faults draws exactly as before.

**Alternatives.**
- *Partition checked only at send:* simpler, but in-flight messages would tunnel through a fresh partition.
- *Loss decided at delivery:* would let a link fault affect in-flight messages retroactively and complicate the model.
- *Undirected links:* convenient, but real network failures are often asymmetric (one-way loss is a classic source of split-brain bugs). Symmetric degradation is two faults.

**Trade-off.** Link conditions don't touch in-flight messages; partitions do. That asymmetry is intentional and documented.

**Invariant.** No message is delivered between nodes that are in different partition groups at delivery time. Every sent message is eventually delivered or dropped exactly once, or is still pending when the run stops.

**Tested by.** `test/network-faults.test.ts` (partition, heal, in-flight cases, directed loss, delay, restore, statistical loss rate on a fixed seed) and message-conservation properties over random fault plans.
