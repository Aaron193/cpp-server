# Network clock and remote presentation

Protocol version 4 adds fixed-size `Ping` and `Pong` messages. The client sends
`Ping.pingId` about every 500 ms, including while no movement input is being
produced. `Pong.pingId` is an exact echo. `Pong.serverTick` is the authoritative
60 Hz simulation tick at pong creation. `Pong.serverMonotonicMs` is the low
32 bits of `std::chrono::steady_clock` milliseconds at pong creation. It is not
Unix time or wall-clock time. All three fields wrap modulo 2^32.

The client measures RTT from its own `performance.now()` send/receive times,
uses the midpoint estimate for server-to-client monotonic offset, and anchors
the server tick to the unwrapped server millisecond value. RTT, absolute RTT
deviation, and offset use EWMAs. Confidence ramps over four accepted samples
and decays with sample age. A clock/tick discontinuity resets the clock,
prediction reconciliation state, and remote timelines on the normal hard-sync
path; reconnects reset the entire clock generation.

`InputCommand.sequence` continues to order and acknowledge commands.
`InputCommand.clientTick` continues to mean the estimated server-tick-domain
time at which input was sampled for lag compensation. Ping IDs, clock anchors,
or future scheduling are not encoded in `clientTick`.

Remote presentation targets `estimatedServerTickNow - interpolationDelayTicks`.
The delay starts at approximately two snapshot intervals (with a floor), widens
after arrival gaps, narrows gradually on calm links, and is capped at 250 ms.
Timelines interpolate only adjacent records with shortest-arc yaw, extrapolate
trusted velocity for at most 250 ms, and then freeze. Development telemetry
reports the current mode and delay plus interpolation, extrapolation, freeze,
underflow, and overflow sample counts. Match and countdown presentation use the
same estimated server tick rather than the age of the latest snapshot.

Prediction lead and time dilation are intentionally not enabled in this phase.
They require separate trace evidence and a default-off feature flag; they must
not change the meaning of `clientTick`.
