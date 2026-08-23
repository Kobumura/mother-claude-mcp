// Programmatic API, for embedding the engine in another process.
export { loadConfig, findConfig, ConfigError } from './config.js';
export { buildCorpus, loadSources, filterDocs } from './corpus.js';
export { createServer, createCorpusHandle } from './server.js';
export { search } from './search.js';
