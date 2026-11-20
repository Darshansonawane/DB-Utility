package com.qa.utility.automation;

import java.util.function.BooleanSupplier;

/** Cooperative cancellation + deadline for a running workflow. Waits are sliced so a stop takes effect within ~250 ms. */
public final class RunControl {
    private final BooleanSupplier cancelled;
    private final long deadlineMillis; // 0 = none
    private volatile boolean timedOut;

    public RunControl(BooleanSupplier cancelled, long deadlineMillis) {
        this.cancelled = cancelled;
        this.deadlineMillis = deadlineMillis;
    }

    public static RunControl of(BooleanSupplier cancelled) {
        return new RunControl(cancelled, 0);
    }

    public boolean shouldStop() {
        if (deadlineMillis > 0 && System.currentTimeMillis() >= deadlineMillis) timedOut = true;
        return timedOut || cancelled.getAsBoolean();
    }

    public boolean timedOut() {
        shouldStop();
        return timedOut;
    }

    /** Sleeps up to {@code ms}; returns false when the run was stopped or hit its time limit before the wait finished. */
    public boolean sleep(long ms) {
        long end = System.currentTimeMillis() + ms;
        while (true) {
            if (shouldStop()) return false;
            long left = end - System.currentTimeMillis();
            if (left <= 0) return true;
            try {
                Thread.sleep(Math.min(left, 250));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
    }
}
