"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Job = void 0;
const job_queue_1 = require("./job-queue");
const callback_helpers_1 = require("../utils/callback-helpers");
const validators_1 = require("../utils/validators");
async function methodCall(root, method, params, cb, after = (ret) => ret) {
    const rootStr = typeof root === 'object' && root.root ? root.root : root;
    const apply = Job._ddp_apply?.[rootStr] ?? Job._ddp_apply;
    if (typeof apply !== 'function') {
        throw new Error('Job remote method call error, no valid invocation method found.');
    }
    const name = `${rootStr}_${method}`;
    if (cb && typeof cb === 'function') {
        apply(name, params, (err, res) => {
            if (err)
                return cb(err);
            cb(null, after(res));
        });
        return;
    }
    else {
        return new Promise((resolve, reject) => {
            apply(name, params, (err, res) => {
                if (err)
                    reject(err);
                else
                    resolve(after(res));
            });
        });
    }
}
class Job {
    static forever = 9007199254740992;
    static foreverDate = new Date(8640000000000000);
    static jobPriorities = {
        low: 10,
        normal: 0,
        medium: -5,
        high: -10,
        critical: -15
    };
    static jobRetryBackoffMethods = ['constant', 'exponential'];
    static jobStatuses = [
        'waiting', 'paused', 'ready', 'running',
        'failed', 'cancelled', 'completed'
    ];
    static jobLogLevels = ['info', 'success', 'warning', 'danger'];
    static jobStatusCancellable = ['running', 'ready', 'waiting', 'paused'];
    static jobStatusPausable = ['ready', 'waiting'];
    static jobStatusRemovable = ['cancelled', 'completed', 'failed'];
    static jobStatusRestartable = ['cancelled', 'failed'];
    static ddpMethods = [
        'startJobs', 'stopJobs',
        'startJobServer', 'shutdownJobServer',
        'jobRemove', 'jobPause', 'jobResume', 'jobReady',
        'jobCancel', 'jobRestart', 'jobSave', 'jobRerun', 'getWork',
        'getJob', 'jobLog', 'jobProgress', 'jobDone', 'jobFail'
    ];
    static ddpPermissionLevels = ['admin', 'manager', 'creator', 'worker'];
    static ddpMethodPermissions = {
        'startJobs': ['startJobs', 'admin'],
        'stopJobs': ['stopJobs', 'admin'],
        'startJobServer': ['startJobServer', 'admin'],
        'shutdownJobServer': ['shutdownJobServer', 'admin'],
        'jobRemove': ['jobRemove', 'admin', 'manager'],
        'jobPause': ['jobPause', 'admin', 'manager'],
        'jobResume': ['jobResume', 'admin', 'manager'],
        'jobCancel': ['jobCancel', 'admin', 'manager'],
        'jobReady': ['jobReady', 'admin', 'manager'],
        'jobRestart': ['jobRestart', 'admin', 'manager'],
        'jobSave': ['jobSave', 'admin', 'creator'],
        'jobRerun': ['jobRerun', 'admin', 'creator'],
        'getWork': ['getWork', 'admin', 'worker'],
        'getJob': ['getJob', 'admin', 'worker'],
        'jobLog': ['jobLog', 'admin', 'worker'],
        'jobProgress': ['jobProgress', 'admin', 'worker'],
        'jobDone': ['jobDone', 'admin', 'worker'],
        'jobFail': ['jobFail', 'admin', 'worker']
    };
    static _ddp_apply = undefined;
    root;
    _root;
    _doc;
    constructor(rootVal, type, data) {
        if (!(this instanceof Job)) {
            return new Job(rootVal, type, data);
        }
        this.root = typeof rootVal === 'object' && rootVal.root ? rootVal.root : rootVal;
        this._root = rootVal;
        let doc;
        if (!data && typeof type === 'object' && 'data' in type && 'type' in type) {
            if (type instanceof Job) {
                return type;
            }
            doc = type;
            data = doc.data;
            type = doc.type;
        }
        else {
            doc = {};
        }
        if (typeof doc !== 'object' ||
            typeof data !== 'object' ||
            typeof type !== 'string' ||
            typeof this.root !== 'string') {
            throw new Error(`new Job: bad parameter(s), ${this.root} (${typeof this.root}), ${type} (${typeof type}), ${data} (${typeof data}), ${doc} (${typeof doc})`);
        }
        if (doc.type && doc.data) {
            this._doc = doc;
        }
        else {
            const time = new Date();
            this._doc = {
                runId: null,
                type: type,
                data: data,
                status: 'waiting',
                updated: time,
                created: time,
                priority: 0,
                depends: [],
                resolved: [],
                after: new Date(0),
                retries: 1,
                retried: 0,
                retryUntil: Job.foreverDate,
                retryWait: 300000,
                retryBackoff: 'constant',
                repeats: 0,
                repeated: 0,
                repeatUntil: Job.foreverDate,
                repeatWait: 300000,
                progress: {
                    completed: 0,
                    total: 1,
                    percent: 0
                },
                log: []
            };
            this.priority();
            this.retry();
            this.repeat();
            this.after();
            this.progress();
            this.depends();
            this.log('Constructed');
        }
    }
    get doc() {
        return this._doc;
    }
    get type() {
        return this._doc.type;
    }
    get data() {
        return this._doc.data;
    }
    static _setDDPApply(apply, collectionName) {
        if (typeof apply !== 'function') {
            throw new Error('Bad function in Job.setDDPApply()');
        }
        if (typeof collectionName === 'string') {
            this._ddp_apply = this._ddp_apply ?? {};
            if (typeof this._ddp_apply === 'function') {
                throw new Error('Job.setDDP must specify a collection name each time if called more than once.');
            }
            this._ddp_apply[collectionName] = apply;
        }
        else if (!this._ddp_apply) {
            this._ddp_apply = apply;
        }
        else {
            throw new Error('Job.setDDP must specify a collection name each time if called more than once.');
        }
    }
    static setDDP(ddp = null, collectionNames = null) {
        let names;
        if (typeof collectionNames === 'string') {
            names = [collectionNames];
        }
        else if (Array.isArray(collectionNames)) {
            names = collectionNames;
        }
        else {
            names = [undefined];
        }
        for (const collName of names) {
            if (!ddp || !ddp.close || !ddp.subscribe) {
                if (ddp === null && typeof Meteor !== 'undefined' && Meteor.apply) {
                    const meteorApply = (name, params, callback) => {
                        return Meteor.apply(name, params, callback);
                    };
                    this._setDDPApply(meteorApply, collName);
                }
                else {
                    throw new Error('Bad ddp object in Job.setDDP()');
                }
            }
            else if (!ddp.observe) {
                const ddpApply = (name, params, callback) => {
                    return ddp.apply(name, params, callback);
                };
                this._setDDPApply(ddpApply, collName);
            }
            else {
                const ddpCall = (name, params, callback) => {
                    return ddp.call(name, params, callback);
                };
                this._setDDPApply(ddpCall, collName);
            }
        }
    }
    static async getWork(root, type, options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        const typeArray = typeof type === 'string' ? [type] : type;
        if (opts.workTimeout !== undefined) {
            if (!(0, validators_1.isInteger)(opts.workTimeout) || opts.workTimeout <= 0) {
                throw new Error('getWork: workTimeout must be a positive integer');
            }
        }
        return methodCall(root, 'getWork', [typeArray, opts], cb, (res) => {
            const jobs = res.map(doc => new Job(root, doc));
            if (opts.maxJobs !== undefined) {
                return jobs;
            }
            else {
                return jobs[0];
            }
        });
    }
    static processJobs = job_queue_1.JobQueue;
    static async getJob(root, id, options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        opts.getLog = opts.getLog ?? false;
        return methodCall(root, 'getJob', [id, opts], cb, (doc) => {
            if (doc) {
                return new Job(root, doc);
            }
            return undefined;
        });
    }
    static async getJobs(root, ids, options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        opts.getLog = opts.getLog ?? false;
        const chunksOfIds = (0, callback_helpers_1.splitLongArray)(ids, 32);
        const myCb = (0, callback_helpers_1.reduceCallbacks)(cb, chunksOfIds.length, callback_helpers_1.concatReduce, []);
        if (!cb) {
            const results = [];
            for (const chunkOfIds of chunksOfIds) {
                const docs = await methodCall(root, 'getJob', [chunkOfIds, opts], undefined, (docs) => {
                    if (docs) {
                        return docs.map(d => new Job(root, d));
                    }
                    return [];
                });
                results.push(docs);
            }
            return results.flat();
        }
        else {
            for (const chunkOfIds of chunksOfIds) {
                methodCall(root, 'getJob', [chunkOfIds, opts], myCb, (docs) => {
                    if (docs) {
                        return docs.map(d => new Job(root, d));
                    }
                    return [];
                });
            }
            return [];
        }
    }
    static async pauseJobs(root, ids, options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        const chunksOfIds = (0, callback_helpers_1.splitLongArray)(ids, 256);
        let retVal = false;
        const myCb = (0, callback_helpers_1.reduceCallbacks)(cb, chunksOfIds.length);
        for (const chunkOfIds of chunksOfIds) {
            const result = await methodCall(root, 'jobPause', [chunkOfIds, opts], myCb);
            retVal = retVal || result;
        }
        return retVal;
    }
    static async resumeJobs(root, ids, options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        const chunksOfIds = (0, callback_helpers_1.splitLongArray)(ids, 256);
        let retVal = false;
        const myCb = (0, callback_helpers_1.reduceCallbacks)(cb, chunksOfIds.length);
        for (const chunkOfIds of chunksOfIds) {
            const result = await methodCall(root, 'jobResume', [chunkOfIds, opts], myCb);
            retVal = retVal || result;
        }
        return retVal;
    }
    static async readyJobs(root, ids = [], options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        opts.force = opts.force ?? false;
        let chunksOfIds = (0, callback_helpers_1.splitLongArray)(ids, 256);
        if (chunksOfIds.length === 0) {
            chunksOfIds = [[]];
        }
        let retVal = false;
        const myCb = (0, callback_helpers_1.reduceCallbacks)(cb, chunksOfIds.length);
        for (const chunkOfIds of chunksOfIds) {
            const result = await methodCall(root, 'jobReady', [chunkOfIds, opts], myCb);
            retVal = retVal || result;
        }
        return retVal;
    }
    static async cancelJobs(root, ids, options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        opts.antecedents = opts.antecedents ?? true;
        const chunksOfIds = (0, callback_helpers_1.splitLongArray)(ids, 256);
        let retVal = false;
        const myCb = (0, callback_helpers_1.reduceCallbacks)(cb, chunksOfIds.length);
        for (const chunkOfIds of chunksOfIds) {
            const result = await methodCall(root, 'jobCancel', [chunkOfIds, opts], myCb);
            retVal = retVal || result;
        }
        return retVal;
    }
    static async restartJobs(root, ids, options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        opts.retries = opts.retries ?? 1;
        opts.dependents = opts.dependents ?? true;
        const chunksOfIds = (0, callback_helpers_1.splitLongArray)(ids, 256);
        let retVal = false;
        const myCb = (0, callback_helpers_1.reduceCallbacks)(cb, chunksOfIds.length);
        for (const chunkOfIds of chunksOfIds) {
            const result = await methodCall(root, 'jobRestart', [chunkOfIds, opts], myCb);
            retVal = retVal || result;
        }
        return retVal;
    }
    static async removeJobs(root, ids, options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        const chunksOfIds = (0, callback_helpers_1.splitLongArray)(ids, 256);
        let retVal = false;
        const myCb = (0, callback_helpers_1.reduceCallbacks)(cb, chunksOfIds.length);
        for (const chunkOfIds of chunksOfIds) {
            const result = await methodCall(root, 'jobRemove', [chunkOfIds, opts], myCb);
            retVal = retVal || result;
        }
        return retVal;
    }
    static startJobs(root, options, cb) {
        console.warn('Deprecation Warning: Job.startJobs() has been renamed to Job.startJobServer()');
        return Job.startJobServer(root, options, cb);
    }
    static stopJobs(root, options, cb) {
        console.warn('Deprecation Warning: Job.stopJobs() has been renamed to Job.shutdownJobServer()');
        return Job.shutdownJobServer(root, options, cb);
    }
    static async startJobServer(root, options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        return methodCall(root, 'startJobServer', [opts], cb);
    }
    static async shutdownJobServer(root, options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        opts.timeout = opts.timeout ?? 60 * 1000;
        return methodCall(root, 'shutdownJobServer', [opts], cb);
    }
    static makeJob(root, doc) {
        console.warn('Job.makeJob(root, jobDoc) has been deprecated and will be removed in a future release, use "new Job(root, jobDoc)" instead.');
        return new Job(root, doc);
    }
    _echo(message, level = null) {
        switch (level) {
            case 'danger':
                console.error(message);
                break;
            case 'warning':
                console.warn(message);
                break;
            case 'success':
                console.log(message);
                break;
            default:
                console.info(message);
        }
    }
    depends(jobs) {
        if (jobs) {
            const jobArray = Array.isArray(jobs) ? jobs : [jobs];
            const depends = this._doc.depends;
            for (const j of jobArray) {
                if (!(j instanceof Job) || !j._doc._id) {
                    throw new Error('Each provided object must be a saved Job instance (with an _id)');
                }
                depends.push(j._doc._id);
            }
            this._doc.depends = depends;
        }
        else {
            this._doc.depends = [];
        }
        this._doc.resolved = [];
        return this;
    }
    priority(level = 0) {
        let priority;
        if (typeof level === 'string') {
            priority = Job.jobPriorities[level];
            if (priority === undefined) {
                throw new Error('Invalid string priority level provided');
            }
        }
        else if ((0, validators_1.isInteger)(level)) {
            priority = level;
        }
        else {
            throw new Error('priority must be an integer or valid priority level');
        }
        this._doc.priority = priority;
        return this;
    }
    retry(options = 0) {
        let opts;
        if ((0, validators_1.isInteger)(options) && options >= 0) {
            opts = { retries: options };
        }
        else if (typeof options === 'object') {
            opts = options;
        }
        else {
            throw new Error('bad parameter: accepts either an integer >= 0 or an options object');
        }
        if (opts.retries !== undefined) {
            if (!(0, validators_1.isInteger)(opts.retries) || opts.retries < 0) {
                throw new Error('bad option: retries must be an integer >= 0');
            }
            opts.retries++;
        }
        else {
            opts.retries = Job.forever;
        }
        if (opts.until !== undefined) {
            if (!(opts.until instanceof Date)) {
                throw new Error('bad option: until must be a Date object');
            }
        }
        else {
            opts.until = Job.foreverDate;
        }
        if (opts.wait !== undefined) {
            if (!(0, validators_1.isInteger)(opts.wait) || opts.wait < 0) {
                throw new Error('bad option: wait must be an integer >= 0');
            }
        }
        else {
            opts.wait = 5 * 60 * 1000;
        }
        if (opts.backoff !== undefined) {
            if (!Job.jobRetryBackoffMethods.includes(opts.backoff)) {
                throw new Error('bad option: invalid retry backoff method');
            }
        }
        else {
            opts.backoff = 'constant';
        }
        this._doc.retries = opts.retries;
        this._doc.repeatRetries = opts.retries;
        this._doc.retryWait = opts.wait;
        this._doc.retried = this._doc.retried ?? 0;
        this._doc.retryBackoff = opts.backoff;
        this._doc.retryUntil = opts.until;
        return this;
    }
    repeat(options = 0) {
        let opts;
        if ((0, validators_1.isInteger)(options) && options >= 0) {
            opts = { repeats: options };
        }
        else if (typeof options === 'object') {
            opts = options;
        }
        else {
            throw new Error('bad parameter: accepts either an integer >= 0 or an options object');
        }
        if (opts.wait && opts.schedule) {
            throw new Error('bad options: wait and schedule options are mutually exclusive');
        }
        if (opts.repeats !== undefined) {
            if (!(0, validators_1.isInteger)(opts.repeats) || opts.repeats < 0) {
                throw new Error('bad option: repeats must be an integer >= 0');
            }
        }
        else {
            opts.repeats = Job.forever;
        }
        if (opts.until !== undefined) {
            if (!(opts.until instanceof Date)) {
                throw new Error('bad option: until must be a Date object');
            }
        }
        else {
            opts.until = Job.foreverDate;
        }
        let waitValue;
        if (opts.wait !== undefined) {
            if (!(0, validators_1.isInteger)(opts.wait) || opts.wait < 0) {
                throw new Error('bad option: wait must be an integer >= 0');
            }
            waitValue = opts.wait;
        }
        else if (opts.schedule) {
            if (typeof opts.schedule !== 'object') {
                throw new Error('bad option, schedule option must be an object');
            }
            if (!opts.schedule.schedules || !Array.isArray(opts.schedule.schedules)) {
                throw new Error('bad option, schedule object requires a schedules attribute of type Array.');
            }
            if (opts.schedule.exceptions && !Array.isArray(opts.schedule.exceptions)) {
                throw new Error('bad option, schedule object exceptions attribute must be an Array');
            }
            waitValue = {
                schedules: opts.schedule.schedules,
                exceptions: opts.schedule.exceptions
            };
        }
        else {
            waitValue = 5 * 60 * 1000;
        }
        this._doc.repeats = opts.repeats;
        this._doc.repeatWait = waitValue;
        this._doc.repeated = this._doc.repeated ?? 0;
        this._doc.repeatUntil = opts.until;
        return this;
    }
    delay(wait = 0) {
        if (!(0, validators_1.isInteger)(wait) || wait < 0) {
            throw new Error('Bad parameter, delay requires a non-negative integer.');
        }
        return this.after(new Date(new Date().valueOf() + wait));
    }
    after(time = new Date(0)) {
        if (!(time instanceof Date)) {
            throw new Error('Bad parameter, after requires a valid Date object');
        }
        this._doc.after = time;
        return this;
    }
    log(message, options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        opts.level = opts.level ?? 'info';
        if (typeof message !== 'string') {
            throw new Error('Log message must be a string');
        }
        if (!Job.jobLogLevels.includes(opts.level)) {
            throw new Error('Log level options must be one of Job.jobLogLevels');
        }
        if (opts.echo) {
            const echoLevel = typeof opts.echo === 'string' ? opts.echo : opts.level;
            if (Job.jobLogLevels.indexOf(opts.level) >= Job.jobLogLevels.indexOf(echoLevel)) {
                this._echo(`LOG: ${opts.level}, ${this._doc._id} ${this._doc.runId}: ${message}`, opts.level);
            }
            delete opts.echo;
        }
        if (this._doc._id) {
            return (0, callback_helpers_1.callbackOrPromise)((callback) => methodCall(this._root, 'jobLog', [this._doc._id, this._doc.runId, message, opts], callback), cb);
        }
        else {
            this._doc.log = this._doc.log ?? [];
            this._doc.log.push({
                time: new Date(),
                runId: null,
                level: opts.level,
                message: message,
                ...(opts.data && { data: opts.data })
            });
            if (cb) {
                (0, callback_helpers_1.setImmediate)(() => cb(null, true));
            }
            return this;
        }
    }
    progress(completed = 0, total = 1, options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        if (typeof completed !== 'number' ||
            typeof total !== 'number' ||
            completed < 0 ||
            total <= 0 ||
            total < completed) {
            throw new Error(`job.progress: something is wrong with progress params: ${this._doc._id}, ${completed} out of ${total}`);
        }
        const progress = {
            completed: completed,
            total: total,
            percent: (100 * completed) / total
        };
        if (opts.echo) {
            delete opts.echo;
            this._echo(`PROGRESS: ${this._doc._id} ${this._doc.runId}: ${progress.completed} out of ${progress.total} (${progress.percent}%)`);
        }
        if (this._doc._id && this._doc.runId) {
            return (0, callback_helpers_1.callbackOrPromise)((callback) => methodCall(this._root, 'jobProgress', [this._doc._id, this._doc.runId, completed, total, opts], (err, res) => {
                if (!err && res) {
                    this._doc.progress = progress;
                }
                callback(err, res);
            }), cb);
        }
        else if (!this._doc._id) {
            this._doc.progress = progress;
            if (cb) {
                (0, callback_helpers_1.setImmediate)(() => cb(null, true));
            }
            return this;
        }
        return null;
    }
    save(options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        return (0, callback_helpers_1.callbackOrPromise)((callback) => methodCall(this._root, 'jobSave', [this._doc, opts], (err, id) => {
            if (!err && id) {
                this._doc._id = id;
            }
            callback(err, id);
        }), cb);
    }
    refresh(options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        opts.getLog = opts.getLog ?? false;
        if (!this._doc._id) {
            throw new Error("Can't call .refresh() on an unsaved job");
        }
        return (0, callback_helpers_1.callbackOrPromise)((callback) => methodCall(this._root, 'getJob', [this._doc._id, opts], (err, doc) => {
            if (!err && doc) {
                this._doc = doc;
                callback(null, this);
            }
            else if (!err) {
                callback(null, false);
            }
            else {
                callback(err);
            }
        }), cb);
    }
    done(result = {}, options, cb) {
        if (typeof result === 'function') {
            cb = result;
            result = {};
        }
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        if (result === null || typeof result !== 'object') {
            result = { value: result };
        }
        if (!this._doc._id || !this._doc.runId) {
            throw new Error("Can't call .done() on an unsaved or non-running job");
        }
        return (0, callback_helpers_1.callbackOrPromise)((callback) => methodCall(this._root, 'jobDone', [this._doc._id, this._doc.runId, result, opts], callback), cb);
    }
    fail(result = 'No error information provided', options, cb) {
        if (typeof result === 'function') {
            cb = result;
            result = 'No error information provided';
        }
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        if (result === null || typeof result !== 'object') {
            result = { value: result };
        }
        opts.fatal = opts.fatal ?? false;
        if (!this._doc._id || !this._doc.runId) {
            throw new Error("Can't call .fail() on an unsaved or non-running job");
        }
        return (0, callback_helpers_1.callbackOrPromise)((callback) => methodCall(this._root, 'jobFail', [this._doc._id, this._doc.runId, result, opts], callback), cb);
    }
    pause(options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        if (this._doc._id) {
            return (0, callback_helpers_1.callbackOrPromise)((callback) => methodCall(this._root, 'jobPause', [this._doc._id, opts], callback), cb);
        }
        else {
            this._doc.status = 'paused';
            if (cb) {
                (0, callback_helpers_1.setImmediate)(() => cb(null, true));
            }
            return this;
        }
    }
    resume(options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        if (this._doc._id) {
            return (0, callback_helpers_1.callbackOrPromise)((callback) => methodCall(this._root, 'jobResume', [this._doc._id, opts], callback), cb);
        }
        else {
            this._doc.status = 'waiting';
            if (cb) {
                (0, callback_helpers_1.setImmediate)(() => cb(null, true));
            }
            return this;
        }
    }
    ready(options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        opts.force = opts.force ?? false;
        if (!this._doc._id) {
            throw new Error("Can't call .ready() on an unsaved job");
        }
        return (0, callback_helpers_1.callbackOrPromise)((callback) => methodCall(this._root, 'jobReady', [this._doc._id, opts], callback), cb);
    }
    cancel(options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        opts.antecedents = opts.antecedents ?? true;
        if (!this._doc._id) {
            throw new Error("Can't call .cancel() on an unsaved job");
        }
        return (0, callback_helpers_1.callbackOrPromise)((callback) => methodCall(this._root, 'jobCancel', [this._doc._id, opts], callback), cb);
    }
    restart(options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        opts.retries = opts.retries ?? 1;
        opts.dependents = opts.dependents ?? true;
        if (!this._doc._id) {
            throw new Error("Can't call .restart() on an unsaved job");
        }
        return (0, callback_helpers_1.callbackOrPromise)((callback) => methodCall(this._root, 'jobRestart', [this._doc._id, opts], callback), cb);
    }
    rerun(options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        opts.repeats = opts.repeats ?? 0;
        opts.wait = opts.wait ?? this._doc.repeatWait;
        if (!this._doc._id) {
            throw new Error("Can't call .rerun() on an unsaved job");
        }
        return (0, callback_helpers_1.callbackOrPromise)((callback) => methodCall(this._root, 'jobRerun', [this._doc._id, opts], callback), cb);
    }
    remove(options, cb) {
        let opts;
        [opts, cb] = (0, callback_helpers_1.optionsHelp)(options ?? {}, cb);
        if (!this._doc._id) {
            throw new Error("Can't call .remove() on an unsaved job");
        }
        return (0, callback_helpers_1.callbackOrPromise)((callback) => methodCall(this._root, 'jobRemove', [this._doc._id, opts], callback), cb);
    }
}
exports.Job = Job;
exports.default = Job;
//# sourceMappingURL=job-class.js.map