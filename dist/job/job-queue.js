"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobQueue = void 0;
const job_class_1 = require("./job-class");
const validators_1 = require("../utils/validators");
const callback_helpers_1 = require("../utils/callback-helpers");
class JobQueue {
    root;
    type;
    worker;
    errorCallback;
    pollInterval;
    concurrency;
    payload;
    prefetch;
    workTimeout;
    callbackStrict;
    _workers = {};
    _tasks = [];
    _taskNumber = 0;
    _stoppingGetWork;
    _stoppingTasks;
    _interval = null;
    _getWorkOutstanding = false;
    paused = true;
    constructor(root, type, options, worker) {
        if (!(this instanceof JobQueue)) {
            return new JobQueue(root, type, options, worker);
        }
        let opts;
        let workerFn;
        if (typeof options === 'function') {
            workerFn = options;
            opts = {};
        }
        else {
            const result = (0, callback_helpers_1.optionsHelp)(options, worker);
            opts = result[0];
            workerFn = result[1];
        }
        this.worker = workerFn;
        if (!(0, validators_1.isNonEmptyString)(root)) {
            throw new Error('JobQueue: Invalid root, must be nonempty string');
        }
        if (!(0, validators_1.isNonEmptyStringOrArrayOfNonEmptyStrings)(type)) {
            throw new Error('JobQueue: Invalid type, must be nonempty string or array of nonempty strings');
        }
        if (!(0, validators_1.isFunction)(this.worker)) {
            throw new Error('JobQueue: Invalid worker, must be a function');
        }
        this.root = root;
        this.type = type;
        this.errorCallback = opts.errorCallback ?? ((e) => {
            console.error('JobQueue: ', e);
        });
        if (!(0, validators_1.isFunction)(this.errorCallback)) {
            throw new Error('JobQueue: Invalid errorCallback, must be a function');
        }
        if (opts.pollInterval !== undefined && !opts.pollInterval) {
            this.pollInterval = job_class_1.Job.forever;
        }
        else if (opts.pollInterval === undefined || !(0, validators_1.isInteger)(opts.pollInterval)) {
            this.pollInterval = 5000;
        }
        else {
            this.pollInterval = opts.pollInterval;
        }
        if (!(0, validators_1.isInteger)(this.pollInterval) || this.pollInterval < 0) {
            throw new Error('JobQueue: Invalid pollInterval, must be a positive integer');
        }
        this.concurrency = opts.concurrency ?? 1;
        if (!(0, validators_1.isInteger)(this.concurrency) || this.concurrency < 0) {
            throw new Error('JobQueue: Invalid concurrency, must be a positive integer');
        }
        this.payload = opts.payload ?? 1;
        if (!(0, validators_1.isInteger)(this.payload) || this.payload < 0) {
            throw new Error('JobQueue: Invalid payload, must be a positive integer');
        }
        this.prefetch = opts.prefetch ?? 0;
        if (!(0, validators_1.isInteger)(this.prefetch) || this.prefetch < 0) {
            throw new Error('JobQueue: Invalid prefetch, must be a positive integer');
        }
        this.workTimeout = opts.workTimeout;
        if (this.workTimeout !== undefined && (!(0, validators_1.isInteger)(this.workTimeout) || this.workTimeout < 0)) {
            throw new Error('JobQueue: Invalid workTimeout, must be a positive integer');
        }
        this.callbackStrict = opts.callbackStrict;
        if (this.callbackStrict !== undefined && !(0, validators_1.isBoolean)(this.callbackStrict)) {
            throw new Error('JobQueue: Invalid callbackStrict, must be a boolean');
        }
        this.resume();
    }
    async _getWork() {
        if (this._getWorkOutstanding || this.paused) {
            return;
        }
        const numJobsToGet = this.prefetch + this.payload * (this.concurrency - this.running()) - this.length();
        if (numJobsToGet > 0) {
            this._getWorkOutstanding = true;
            const options = { maxJobs: numJobsToGet };
            if (this.workTimeout !== undefined) {
                options.workTimeout = this.workTimeout;
            }
            try {
                const jobs = await job_class_1.Job.getWork(this.root, this.type, options);
                this._getWorkOutstanding = false;
                if (jobs && Array.isArray(jobs)) {
                    if (jobs.length > numJobsToGet) {
                        this.errorCallback(new Error(`getWork() returned jobs (${jobs.length}) in excess of maxJobs (${numJobsToGet})`));
                    }
                    for (const j of jobs) {
                        this._tasks.push(j);
                        if (!this._stoppingGetWork) {
                            (0, callback_helpers_1.setImmediate)(this._process.bind(this));
                        }
                    }
                    if (this._stoppingGetWork) {
                        this._stoppingGetWork();
                    }
                }
                else {
                    this.errorCallback(new Error('Nonarray response from server from getWork()'));
                }
            }
            catch (err) {
                this._getWorkOutstanding = false;
                this.errorCallback(new Error(`Received error from getWork(): ${err}`));
            }
        }
    }
    _only_once(fn) {
        let called = false;
        return (...args) => {
            if (called) {
                this.errorCallback(new Error('Worker callback called multiple times'));
                if (this.callbackStrict) {
                    throw new Error('JobQueue: worker callback was invoked multiple times');
                }
            }
            called = true;
            fn.apply(this, args);
        };
    }
    _process() {
        if (!this.paused && this.running() < this.concurrency && this.length()) {
            let job;
            if (this.payload > 1) {
                job = this._tasks.splice(0, this.payload);
            }
            else {
                job = this._tasks.shift();
            }
            const taskId = `Task_${this._taskNumber++}`;
            if (Array.isArray(job)) {
                for (const j of job) {
                    j._taskId = taskId;
                }
            }
            else {
                job._taskId = taskId;
            }
            this._workers[taskId] = job;
            const next = () => {
                delete this._workers[taskId];
                if (this._stoppingTasks && this.running() === 0 && this.length() === 0) {
                    this._stoppingTasks();
                }
                else {
                    (0, callback_helpers_1.setImmediate)(this._process.bind(this));
                    (0, callback_helpers_1.setImmediate)(this._getWork.bind(this));
                }
            };
            const cb = this._only_once(next);
            this.worker(job, cb);
        }
    }
    _stopGetWork(callback) {
        (0, callback_helpers_1.clearInterval)(this._interval);
        this._interval = null;
        if (this._getWorkOutstanding) {
            this._stoppingGetWork = callback;
        }
        else {
            (0, callback_helpers_1.setImmediate)(callback);
        }
    }
    _waitForTasks(callback) {
        if (this.running() !== 0) {
            this._stoppingTasks = callback;
        }
        else {
            (0, callback_helpers_1.setImmediate)(callback);
        }
    }
    async _failJobs(tasks, callback) {
        if (tasks.length === 0) {
            (0, callback_helpers_1.setImmediate)(callback);
            return;
        }
        let count = 0;
        for (const job of tasks) {
            try {
                if (Array.isArray(job)) {
                    for (const j of job) {
                        await j.fail('Worker shutdown');
                    }
                }
                else {
                    await job.fail('Worker shutdown');
                }
            }
            catch (err) {
                console.error('Error failing job during shutdown:', err);
            }
            finally {
                count++;
                if (count === tasks.length) {
                    callback();
                }
            }
        }
    }
    _hard(callback) {
        this.paused = true;
        this._stopGetWork(async () => {
            const tasks = [...this._tasks];
            this._tasks = [];
            for (const [, r] of Object.entries(this._workers)) {
                if (Array.isArray(r)) {
                    tasks.push(...r);
                }
                else {
                    tasks.push(r);
                }
            }
            await this._failJobs(tasks, callback);
        });
    }
    _stop(callback) {
        this.paused = true;
        this._stopGetWork(() => {
            const tasks = this._tasks;
            this._tasks = [];
            this._waitForTasks(async () => {
                await this._failJobs(tasks, callback);
            });
        });
    }
    _soft(callback) {
        this._stopGetWork(() => {
            this._waitForTasks(callback);
        });
    }
    length() {
        return this._tasks.length;
    }
    running() {
        return Object.keys(this._workers).length;
    }
    idle() {
        return this.length() + this.running() === 0;
    }
    full() {
        return this.running() === this.concurrency;
    }
    pause() {
        if (this.paused) {
            return this;
        }
        if (this.pollInterval < job_class_1.Job.forever) {
            (0, callback_helpers_1.clearInterval)(this._interval);
            this._interval = null;
        }
        this.paused = true;
        return this;
    }
    resume() {
        if (!this.paused) {
            return this;
        }
        this.paused = false;
        (0, callback_helpers_1.setImmediate)(this._getWork.bind(this));
        if (this.pollInterval < job_class_1.Job.forever) {
            this._interval = (0, callback_helpers_1.setInterval)(this._getWork.bind(this), this.pollInterval);
        }
        for (let w = 1; w <= this.concurrency; w++) {
            (0, callback_helpers_1.setImmediate)(this._process.bind(this));
        }
        return this;
    }
    trigger() {
        if (this.paused) {
            return this;
        }
        (0, callback_helpers_1.setImmediate)(this._getWork.bind(this));
        return this;
    }
    shutdown(options, cb) {
        let opts;
        let callback;
        if (typeof options === 'function') {
            callback = options;
            opts = {};
        }
        else {
            [opts, callback] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        }
        opts.level = opts.level ?? 'normal';
        opts.quiet = opts.quiet ?? false;
        if (!callback) {
            if (!opts.quiet) {
                console.warn('using default shutdown callback!');
            }
            callback = () => {
                console.warn('Shutdown complete');
            };
        }
        switch (opts.level) {
            case 'hard':
                if (!opts.quiet)
                    console.warn('Shutting down hard');
                this._hard(callback);
                break;
            case 'soft':
                if (!opts.quiet)
                    console.warn('Shutting down soft');
                this._soft(callback);
                break;
            default:
                if (!opts.quiet)
                    console.warn('Shutting down normally');
                this._stop(callback);
        }
    }
}
exports.JobQueue = JobQueue;
//# sourceMappingURL=job-queue.js.map