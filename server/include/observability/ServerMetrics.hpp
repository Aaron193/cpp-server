#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <vector>

enum class ClientMessageMetric {
    Rejected,
    Malformed,
    RateLimited,
    Unknown,
    Backpressure,
};

struct MetricDistribution {
    std::uint64_t count = 0;
    double p50 = 0.0;
    double p95 = 0.0;
    double p99 = 0.0;
    double max = 0.0;
};

class RollingMetric {
   public:
    explicit RollingMetric(std::size_t capacity = 4096U)
        : samples_(std::max<std::size_t>(1U, capacity), 0.0) {}

    void observe(double value) {
        samples_[next_] = value;
        next_ = (next_ + 1U) % samples_.size();
        size_ = std::min(size_ + 1U, samples_.size());
        ++count_;
    }

    MetricDistribution distribution() const {
        MetricDistribution result{};
        result.count = count_;
        if (size_ == 0U) return result;
        std::vector<double> ordered(samples_.begin(), samples_.begin() + size_);
        std::sort(ordered.begin(), ordered.end());
        const auto percentile = [&](double fraction) {
            const auto index = static_cast<std::size_t>(
                fraction * static_cast<double>(ordered.size() - 1U));
            return ordered[index];
        };
        result.p50 = percentile(0.50);
        result.p95 = percentile(0.95);
        result.p99 = percentile(0.99);
        result.max = ordered.back();
        return result;
    }

    void reset() {
        next_ = 0U;
        size_ = 0U;
        count_ = 0U;
    }

   private:
    std::vector<double> samples_;
    std::size_t next_ = 0U;
    std::size_t size_ = 0U;
    std::uint64_t count_ = 0U;
};

struct ServerMetricsSnapshot {
    MetricDistribution tickMilliseconds;
    MetricDistribution joltMilliseconds;
    MetricDistribution snapshotMilliseconds;
    MetricDistribution snapshotBytes;
    std::uint64_t accumulatorCalls = 0U;
    std::uint64_t catchUpSteps = 0U;
    std::size_t maxStepsPerAdvance = 0U;
    double droppedTimeSeconds = 0.0;
    std::size_t playerCount = 0U;
    std::size_t queuedInputHighWater = 0U;
    std::size_t pendingClientInputHighWater = 0U;
    std::size_t outboundQueueBytesHighWater = 0U;
    std::size_t outboundQueueMessagesHighWater = 0U;
    std::size_t transportBufferedBytesHighWater = 0U;
    std::uint64_t coalescedSnapshots = 0U;
    std::uint64_t snapshots = 0U;
    std::uint64_t reliableEvents = 0U;
    std::uint64_t inboundMessages = 0U;
    std::uint64_t inboundBytes = 0U;
    std::uint64_t outboundMessages = 0U;
    std::uint64_t outboundBytes = 0U;
    std::uint64_t rejectedMessages = 0U;
    std::uint64_t malformedMessages = 0U;
    std::uint64_t rateLimitedMessages = 0U;
    std::uint64_t unknownMessages = 0U;
    std::uint64_t backpressureCloses = 0U;
    std::uint64_t shotsFired = 0U;
    std::uint64_t pelletHits = 0U;
    std::uint64_t rejectedFireAttempts = 0U;
    std::uint64_t historyClamps = 0U;
};

class ServerMetrics {
   public:
    void observeTick(double milliseconds) { tick_.observe(milliseconds); }
    void observeJolt(double milliseconds) { jolt_.observe(milliseconds); }
    void observeSnapshot(double milliseconds, std::size_t bytes) {
        snapshotDuration_.observe(milliseconds);
        snapshotBytes_.observe(static_cast<double>(bytes));
        ++snapshots;
    }
    void observeAdvance(std::size_t steps, double droppedSeconds) {
        ++accumulatorCalls;
        if (steps > 1U) catchUpSteps += steps - 1U;
        maxStepsPerAdvance = std::max(maxStepsPerAdvance, steps);
        droppedTimeSeconds += droppedSeconds;
    }
    void observeQueuedInputs(std::size_t count) {
        queuedInputHighWater = std::max(queuedInputHighWater, count);
    }
    void observePendingClientInputs(std::size_t count) {
        pendingClientInputHighWater =
            std::max(pendingClientInputHighWater, count);
    }
    void observeOutboundQueue(std::size_t messages, std::size_t bytes) {
        outboundQueueMessagesHighWater =
            std::max(outboundQueueMessagesHighWater, messages);
        outboundQueueBytesHighWater =
            std::max(outboundQueueBytesHighWater, bytes);
    }
    void observeTransportBuffered(std::size_t bytes) {
        transportBufferedBytesHighWater =
            std::max(transportBufferedBytesHighWater, bytes);
    }

    ServerMetricsSnapshot snapshot(std::size_t players,
                                   std::uint64_t shotsFired,
                                   std::uint64_t pelletHits,
                                   std::uint64_t rejectedFireAttempts,
                                   std::uint64_t historyClamps) const {
        ServerMetricsSnapshot value{};
        value.tickMilliseconds = tick_.distribution();
        value.joltMilliseconds = jolt_.distribution();
        value.snapshotMilliseconds = snapshotDuration_.distribution();
        value.snapshotBytes = snapshotBytes_.distribution();
        value.accumulatorCalls = accumulatorCalls;
        value.catchUpSteps = catchUpSteps;
        value.maxStepsPerAdvance = maxStepsPerAdvance;
        value.droppedTimeSeconds = droppedTimeSeconds;
        value.playerCount = players;
        value.queuedInputHighWater = queuedInputHighWater;
        value.pendingClientInputHighWater = pendingClientInputHighWater;
        value.outboundQueueBytesHighWater = outboundQueueBytesHighWater;
        value.outboundQueueMessagesHighWater = outboundQueueMessagesHighWater;
        value.transportBufferedBytesHighWater = transportBufferedBytesHighWater;
        value.coalescedSnapshots = coalescedSnapshots;
        value.snapshots = snapshots;
        value.reliableEvents = reliableEvents;
        value.inboundMessages = inboundMessages;
        value.inboundBytes = inboundBytes;
        value.outboundMessages = outboundMessages;
        value.outboundBytes = outboundBytes;
        value.rejectedMessages = rejectedMessages;
        value.malformedMessages = malformedMessages;
        value.rateLimitedMessages = rateLimitedMessages;
        value.unknownMessages = unknownMessages;
        value.backpressureCloses = backpressureCloses;
        value.shotsFired = shotsFired;
        value.pelletHits = pelletHits;
        value.rejectedFireAttempts = rejectedFireAttempts;
        value.historyClamps = historyClamps;
        return value;
    }

    void reset() {
        *this = ServerMetrics{};
    }

    std::uint64_t accumulatorCalls = 0U;
    std::uint64_t catchUpSteps = 0U;
    std::size_t maxStepsPerAdvance = 0U;
    double droppedTimeSeconds = 0.0;
    std::size_t queuedInputHighWater = 0U;
    std::size_t pendingClientInputHighWater = 0U;
    std::size_t outboundQueueBytesHighWater = 0U;
    std::size_t outboundQueueMessagesHighWater = 0U;
    std::size_t transportBufferedBytesHighWater = 0U;
    std::uint64_t coalescedSnapshots = 0U;
    std::uint64_t snapshots = 0U;
    std::uint64_t reliableEvents = 0U;
    std::uint64_t inboundMessages = 0U;
    std::uint64_t inboundBytes = 0U;
    std::uint64_t outboundMessages = 0U;
    std::uint64_t outboundBytes = 0U;
    std::uint64_t rejectedMessages = 0U;
    std::uint64_t malformedMessages = 0U;
    std::uint64_t rateLimitedMessages = 0U;
    std::uint64_t unknownMessages = 0U;
    std::uint64_t backpressureCloses = 0U;

   private:
    RollingMetric tick_;
    RollingMetric jolt_;
    RollingMetric snapshotDuration_;
    RollingMetric snapshotBytes_;
};
