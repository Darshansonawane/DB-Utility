package com.qa.utility.connection;

/** Result of a successful reachability + authentication check. */
public record Probe(long latencyMs, String serverVersion) {
}
