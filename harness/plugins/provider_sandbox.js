const { SEAMS } = require('../seams');

const SandboxPlugin = {
  name: 'dsh-provider-sandbox',
  version: '2.0.0',
  category: 'Execution',
  description: 'Untrusted code execution is unavailable because no operating-system isolation provider is configured.',
  apply(ctx) {
    const executionService = {
      async runCode() {
        return {
          ok: false,
          success: false,
          isolated: false,
          error: 'Code execution is disabled: Abyx has no configured OS-level isolation boundary. Node vm and host subprocess execution are not treated as sandboxing.'
        };
      }
    };
    SEAMS.SANDBOX.validateProvider(executionService);
    ctx.provide('sandbox', executionService);
  }
};

module.exports = SandboxPlugin;
