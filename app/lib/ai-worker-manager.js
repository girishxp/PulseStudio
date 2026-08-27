const path = require('path');
const { randomUUID } = require('crypto');

class AiWorkerManager {
  constructor({ utilityProcess, workerPath, cwd, env = {}, onStatus = () => {}, onLog = () => {}, workerSpawnTimeoutMs = 20000 }) {
    this.utilityProcess = utilityProcess;
    this.workerPath = workerPath;
    this.cwd = cwd || path.dirname(workerPath);
    this.env = env;
    this.onStatus = onStatus;
    this.onLog = onLog;
    this.workerSpawnTimeoutMs = Math.max(1000, Number(workerSpawnTimeoutMs) || 20000);
    this.child = null;
    this.spawnPromise = null;
    this.jobs = new Map();
    this.queue = [];
    this.activeId = null;
    this.crashCount = 0;
    this.shuttingDown = false;
    this.handledChildren = new WeakSet();
    this.paused = false;
    this.pauseReason = '';
  }

  async ensureWorker() {
    if (this.child) return this.child;
    if (this.spawnPromise) return this.spawnPromise;
    this.spawnPromise = new Promise((resolve, reject) => {
      let child = null;
      let settled = false;
      let spawnTimer = null;
      const failSpawn = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(spawnTimer);
        this.spawnPromise = null;
        try { child?.kill(); } catch {}
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      try {
        child = this.utilityProcess.fork(this.workerPath, [], {
          cwd: this.cwd,
          env: { ...process.env, ...this.env }
        });
      } catch (error) {
        // Let the assignment to this.spawnPromise complete before clearing it in
        // failSpawn; otherwise a synchronous fork failure can leave a permanently
        // rejected promise cached and every later AI task fails immediately.
        queueMicrotask(() => failSpawn(error));
        return;
      }
      child.once('spawn', () => {
        if (settled) return;
        settled = true;
        clearTimeout(spawnTimer);
        this.child = child;
        this.spawnPromise = null;
        this.crashCount = 0;
        this.attach(child);
        this.onLog('Persistent AI utility process started.');
        resolve(child);
      });
      child.once('error', failSpawn);
      child.once('exit', (code) => {
        if (!settled) failSpawn(new Error(`The local AI worker exited before it was ready (code ${code ?? 'unknown'}).`));
      });
      spawnTimer = setTimeout(() => {
        failSpawn(new Error('The local AI worker did not start in time. The recorder can continue; retry the AI task.'));
      }, this.workerSpawnTimeoutMs);
      spawnTimer.unref?.();
    });
    return this.spawnPromise;
  }

  attach(child) {
    child.on('message', (message) => this.handleMessage(message));
    child.on('error', (error) => this.handleCrash(error, child));
    child.on('exit', (code) => {
      if (this.shuttingDown) return;
      this.handleCrash(new Error(`AI utility process exited with code ${code}.`), child);
    });
  }

  emitStatus(job, status = {}) {
    if (!job) return null;
    const now = Date.now();
    const payload = {
      id: job.id,
      task: job.payload?.task,
      label: String(status.label || job.label || this.labelFor(job.payload?.task)),
      recordingName: String(job.payload?.recordingName || ''),
      createdAt: job.createdAt || now,
      startedAt: job.startedAt || null,
      updatedAt: now,
      ...status
    };
    job.lastStatus = payload;
    this.onStatus(payload);
    return payload;
  }

  handleMessage(message) {
    const id = message?.id;
    const job = id ? this.jobs.get(id) : null;
    if (message?.type === 'ready') return;
    if (!job) return;
    if (message.type === 'progress') {
      job.lastActivityAt = Date.now();
      this.armStallTimer(job, this.child);
      const progress = Number.isFinite(Number(message.progress)) ? Math.max(0, Math.min(1, Number(message.progress))) : null;
      this.emitStatus(job, {
        label: String(message.label || job.label || this.labelFor(job.payload.task)),
        detail: String(message.detail || ''),
        progress,
        phase: String(message.phase || 'working'),
        cancellable: true,
        state: 'running'
      });
      return;
    }
    if (message.type === 'result') this.finishJob(id, null, message.result);
    else if (message.type === 'error') this.finishJob(id, new Error(message.error || 'Local AI processing failed.'));
    else if (message.type === 'cancelled') this.finishJob(id, Object.assign(new Error('AI processing was cancelled.'), { code: 'AI_CANCELLED' }));
  }

  handleCrash(error, crashedChild = this.child) {
    if (this.shuttingDown) return;
    if (crashedChild && this.handledChildren.has(crashedChild)) return;
    if (crashedChild) this.handledChildren.add(crashedChild);
    const child = crashedChild;
    if (this.child === crashedChild) this.child = null;
    this.spawnPromise = null;
    this.crashCount += 1;
    const activeId = this.activeId;
    this.activeId = null;
    if (activeId && this.jobs.has(activeId)) {
      const job = this.jobs.get(activeId);
      clearTimeout(job.timer);
      clearTimeout(job.stallTimer);
      this.emitStatus(job, { state: 'error', progress: null, detail: error?.message || String(error), cancellable: false });
      this.jobs.delete(activeId);
      job.reject(new Error('The local AI worker stopped unexpectedly. The recorder remains safe; retry the AI task.'));
    }
    this.onLog(`Persistent AI worker crash: ${error?.message || error}`);
    try { child?.kill(); } catch {}
    this.pump();
  }

  labelFor(task) {
    return ({ transcribe: 'Transcribing', diarize: 'Detecting speakers', vad: 'Analyzing speech', 'meeting-insights': 'Generating meeting notes', 'preload-model': 'Downloading AI model' }[task] || 'Processing locally');
  }

  request(payload, timeoutMs = 30 * 60 * 1000, options = {}) {
    const id = randomUUID();
    const priority = Number(options.priority) || 0;
    const label = options.label || this.labelFor(payload?.task);
    const promise = new Promise((resolve, reject) => {
      const job = {
        id,
        payload: { ...(payload || {}) },
        timeoutMs,
        queueTimeoutMs: Math.max(0, Number(options.queueTimeoutMs) || 0),
        staleTimeoutMs: Math.max(0, Number(options.staleTimeoutMs) || 0),
        stallRetriesRemaining: Math.max(0, Number(options.stallRetries) || 0),
        preemptLowerPriority: Boolean(options.preemptLowerPriority),
        resolve,
        reject,
        priority,
        label,
        timer: null,
        queueTimer: null,
        stallTimer: null,
        lastStatus: null,
        lastActivityAt: null,
        cancelled: false,
        deferForHigherPriority: false,
        createdAt: Date.now(),
        startedAt: null
      };
      this.jobs.set(id, job);
      this.queue.push(job);
      this.queue.sort((a, b) => b.priority - a.priority);
      this.emitStatus(job, { state: 'queued', progress: null, detail: this.paused ? (this.pauseReason || 'Waiting until recording stops') : 'Queued', phase: 'queued', cancellable: true });
      if (job.queueTimeoutMs > 0) {
        job.queueTimer = setTimeout(() => {
          if (!this.jobs.has(job.id) || this.activeId === job.id) return;
          const queuedIndex = this.queue.findIndex((item) => item.id === job.id);
          if (queuedIndex < 0) return;
          this.queue.splice(queuedIndex, 1);
          const error = new Error('Enhanced meeting notes waited behind another local AI task for too long. Quick local notes are available instead.');
          error.code = 'AI_QUEUE_TIMEOUT';
          this.finishJob(job.id, error);
        }, job.queueTimeoutMs);
        job.queueTimer.unref?.();
      }
      if (job.preemptLowerPriority) this.preemptActiveFor(job);
      this.pump();
    });
    promise.jobId = id;
    return promise;
  }

  preemptActiveFor(incomingJob) {
    if (!incomingJob || !this.activeId || !this.jobs.has(this.activeId)) return false;
    const active = this.jobs.get(this.activeId);
    if (!active || active.cancelled || active.priority >= incomingJob.priority) return false;
    active.deferForHigherPriority = true;
    const child = this.child;
    try { child?.postMessage({ type: 'cancel', id: active.id }); } catch {}
    this.emitStatus(active, { state: 'cancelling', progress: active.lastStatus?.progress ?? null, detail: `${incomingJob.label || 'Higher-priority work'} is waiting`, phase: 'preempting', cancellable: false });
    const timer = setTimeout(() => {
      if (this.activeId !== active.id || !this.jobs.has(active.id) || !active.deferForHigherPriority) return;
      if (child) {
        this.handledChildren.add(child);
        if (this.child === child) this.child = null;
        try { child.kill(); } catch {}
      }
      const error = Object.assign(new Error('Paused for higher-priority local AI work.'), { code: 'AI_PREEMPTED' });
      this.finishJob(active.id, error);
    }, 1200);
    timer.unref?.();
    return true;
  }

  armStallTimer(job, child) {
    if (!job) return;
    clearTimeout(job.stallTimer);
    job.stallTimer = null;
    if (!job.staleTimeoutMs || this.activeId !== job.id) return;
    const expectedId = job.id;
    job.stallTimer = setTimeout(() => {
      if (this.activeId !== expectedId || !this.jobs.has(expectedId)) return;
      const current = this.jobs.get(expectedId);
      const quietFor = Date.now() - Number(current.lastActivityAt || current.startedAt || Date.now());
      if (quietFor < current.staleTimeoutMs - 100) return this.armStallTimer(current, this.child);
      const runningChild = this.child || child;
      this.onLog(`Local AI task ${current.payload?.task || 'unknown'} stopped reporting progress for ${Math.round(quietFor / 1000)}s.`);
      if (runningChild) {
        this.handledChildren.add(runningChild);
        if (this.child === runningChild) this.child = null;
        try { runningChild.kill(); } catch {}
      }
      clearTimeout(current.timer);
      current.timer = null;
      this.activeId = null;
      if (!current.cancelled && current.stallRetriesRemaining > 0) {
        current.stallRetriesRemaining -= 1;
        current.startedAt = null;
        current.lastActivityAt = null;
        current.stallTimer = null;
        this.queue = this.queue.filter((item) => item.id !== current.id);
        this.queue.push(current);
        this.queue.sort((a, b) => b.priority - a.priority);
        this.emitStatus(current, { state: 'queued', progress: null, detail: 'Restarting the local AI worker after it stopped responding', phase: 'queued', cancellable: true });
        this.pump();
      } else {
        const error = new Error('Local AI processing stopped responding. The worker was restarted so the next queued task can continue.');
        error.code = 'AI_STALLED';
        this.finishJob(current.id, error);
      }
    }, job.staleTimeoutMs);
    job.stallTimer.unref?.();
  }

  async pump() {
    if (this.paused || this.activeId || !this.queue.length || this.shuttingDown) return;
    const job = this.queue.shift();
    if (!job || !this.jobs.has(job.id)) return this.pump();
    this.activeId = job.id;
    job.startedAt = Date.now();
    job.lastActivityAt = job.startedAt;
    clearTimeout(job.queueTimer);
    job.queueTimer = null;
    try {
      const child = await this.ensureWorker();
      if (!this.jobs.has(job.id)) { this.activeId = null; return this.pump(); }
      job.timer = setTimeout(() => {
        if (!this.jobs.has(job.id)) return;
        try { child.postMessage({ type: 'cancel', id: job.id }); } catch {}
        this.handledChildren.add(child);
        if (this.child === child) this.child = null;
        try { child.kill(); } catch {}
        this.finishJob(job.id, new Error('Local AI processing timed out. The worker was restarted so the next queued task can continue.'));
      }, job.timeoutMs);
      job.timer.unref?.();
      this.armStallTimer(job, child);
      this.emitStatus(job, { state: 'running', progress: 0, detail: 'Starting local model…', phase: 'starting', cancellable: true });
      child.postMessage({ type: 'request', id: job.id, payload: job.payload });
    } catch (error) {
      this.activeId = null;
      this.finishJob(job.id, error);
    }
  }

  finishJob(id, error, result) {
    const job = this.jobs.get(id);
    if (!job) return;
    clearTimeout(job.timer);
    clearTimeout(job.queueTimer);
    clearTimeout(job.stallTimer);
    if (this.activeId === id) this.activeId = null;
    const shouldRequeue = !job.cancelled && (
      error?.code === 'AI_PAUSED_FOR_RECORDING' ||
      error?.code === 'AI_PREEMPTED' ||
      (error?.code === 'AI_CANCELLED' && (job.deferForRecording || job.deferForHigherPriority))
    );
    if (shouldRequeue) {
      job.deferForRecording = false;
      job.deferForHigherPriority = false;
      job.cancelled = false;
      job.timer = null;
      job.queueTimer = null;
      job.stallTimer = null;
      job.startedAt = null;
      job.lastActivityAt = null;
      this.queue = this.queue.filter((item) => item.id !== job.id);
      this.queue.push(job);
      this.queue.sort((a, b) => b.priority - a.priority);
      const requeueDetail = this.paused
        ? (this.pauseReason || 'Paused while recording')
        : 'Waiting behind higher-priority local AI work';
      this.emitStatus(job, { state: 'queued', progress: null, detail: requeueDetail, phase: 'queued', cancellable: true });
      this.pump();
      return;
    }
    if (error) {
      const state = error.code === 'AI_CANCELLED' ? 'cancelled' : error.code === 'AI_QUEUE_TIMEOUT' ? 'deferred' : 'error';
      this.emitStatus(job, { state, progress: null, detail: error.message, phase: 'done', cancellable: false });
    } else {
      this.emitStatus(job, { state: 'complete', progress: 1, detail: 'Complete', phase: 'complete', cancellable: false });
    }
    this.jobs.delete(id);
    if (error) job.reject(error); else job.resolve(result);
    this.pump();
  }

  setPaused(paused, reason = 'Waiting until recording stops') {
    const next = Boolean(paused);
    this.paused = next;
    this.pauseReason = next ? String(reason || 'Waiting until recording stops') : '';
    if (next && this.activeId && this.jobs.has(this.activeId)) {
      const job = this.jobs.get(this.activeId);
      job.deferForRecording = true;
      const child = this.child;
      try { child?.postMessage({ type: 'cancel', id: job.id }); } catch {}
      this.emitStatus(job, { state: 'queued', progress: null, detail: this.pauseReason, phase: 'queued', cancellable: true });
      const pauseTimer = setTimeout(() => {
        if (this.activeId !== job.id || !this.jobs.has(job.id) || !job.deferForRecording) return;
        if (child) {
          this.handledChildren.add(child);
          if (this.child === child) this.child = null;
          try { child.kill(); } catch {}
        }
        const error = Object.assign(new Error(this.pauseReason), { code: 'AI_PAUSED_FOR_RECORDING' });
        this.finishJob(job.id, error);
      }, 1200);
      pauseTimer.unref?.();
    }
    if (!next) this.pump();
    return this.snapshot();
  }

  cancel(id) {
    const job = this.jobs.get(String(id || ''));
    if (!job) return false;
    job.cancelled = true;
    job.deferForRecording = false;
    job.deferForHigherPriority = false;
    const queuedIndex = this.queue.findIndex((item) => item.id === job.id);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      this.finishJob(job.id, Object.assign(new Error('AI processing was cancelled.'), { code: 'AI_CANCELLED' }));
      return true;
    }
    if (this.activeId === job.id) {
      const child = this.child;
      try { child?.postMessage({ type: 'cancel', id: job.id }); } catch {}
      this.emitStatus(job, { state: 'cancelling', progress: job.lastStatus?.progress ?? null, detail: 'Cancelling…', phase: 'cancelling', cancellable: false });
      const cancelTimer = setTimeout(() => {
        if (this.activeId !== job.id || !this.jobs.has(job.id)) return;
        if (child) { this.handledChildren.add(child); if (this.child === child) this.child = null; try { child.kill(); } catch {} }
        this.finishJob(job.id, Object.assign(new Error('AI processing was cancelled.'), { code: 'AI_CANCELLED' }));
      }, 1200);
      cancelTimer.unref?.();
      return true;
    }
    return false;
  }

  cancelWhere(predicate) {
    if (typeof predicate !== 'function') return 0;
    const ids = [...this.jobs.values()].filter((job) => {
      try { return Boolean(predicate(job)); } catch { return false; }
    }).map((job) => job.id);
    let cancelled = 0;
    for (const id of ids) if (this.cancel(id)) cancelled += 1;
    return cancelled;
  }

  snapshot() {
    const jobs = [...this.jobs.values()].map((job) => job.lastStatus || {
      id: job.id,
      task: job.payload.task,
      label: job.label,
      recordingName: String(job.payload?.recordingName || ''),
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      updatedAt: Date.now(),
      state: this.activeId === job.id ? 'running' : 'queued',
      progress: this.activeId === job.id ? 0 : null,
      detail: this.activeId === job.id ? 'Working…' : 'Queued',
      phase: this.activeId === job.id ? 'working' : 'queued',
      cancellable: true
    });
    return { workerAlive: Boolean(this.child), activeId: this.activeId, paused: this.paused, pauseReason: this.pauseReason, jobs };
  }

  shutdown() {
    this.shuttingDown = true;
    for (const job of this.jobs.values()) {
      clearTimeout(job.timer);
      clearTimeout(job.queueTimer);
      clearTimeout(job.stallTimer);
      job.reject(new Error('Application is closing.'));
    }
    this.jobs.clear();
    this.queue = [];
    try { this.child?.kill(); } catch {}
    this.child = null;
  }
}

module.exports = { AiWorkerManager };
