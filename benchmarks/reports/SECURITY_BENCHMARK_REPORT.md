# Security Benchmark Report

The current security/runtime regression subset passed 70/70, including path containment, symlink and stale-write checks, exact terminal approval/replay checks, authorization gateway rejection, cancellation propagation, output flood limits, local API Host/Origin checks, and credential environment redaction. These tests exercise code-level properties; they do not establish a complete OS sandbox.

No adversarial user task was run against the live agent endpoint. Terminal and MCP child processes execute under the app user's identity unless an external isolation provider is configured. No Windows Job Object/restricted-token guarantee was verified. Cross-origin behavior was unit-tested, not tested against a running server.
