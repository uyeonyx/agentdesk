// Entry for the codex mock on Windows, where test/mock-codex.cmd (an npm-style shim) points.
process.env.MOCK_KIND = 'codex';
await import('./mock-agent.js');
