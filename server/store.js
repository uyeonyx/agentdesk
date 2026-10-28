import path from 'node:path';
import { dataDir, readJson, writeJsonAtomic } from './util.js';

/** Tiny JSON-file store with debounced, atomic, owner-only writes. */
export class Store {
  constructor() {
    this.file = path.join(dataDir(), 'state.json');
    const d = readJson(this.file, {});
    this.projects = Array.isArray(d.projects) ? d.projects : [];
    this.tasks = Array.isArray(d.tasks) ? d.tasks : [];
    this.prefs = d.prefs && typeof d.prefs === 'object' ? d.prefs : {};
    this.timer = undefined;
  }
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 200);
  }
  flush() {
    clearTimeout(this.timer);
    writeJsonAtomic(this.file, { projects: this.projects, tasks: this.tasks, prefs: this.prefs });
  }
  project(id) {
    return this.projects.find((p) => p.id === id);
  }
  task(id) {
    return this.tasks.find((t) => t.id === id);
  }
}
