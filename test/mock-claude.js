// Entry for the claude mock on Windows, where test/mock-claude.cmd (an npm-style shim) points.
process.env.MOCK_KIND = 'claude';
await import('./mock-agent.js');
