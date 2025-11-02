"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobCollection = exports.JobCollectionBase = void 0;
const job_class_1 = require("./job/job-class");
const validators_1 = require("./utils/validators");
function validLog() {
    return [{
            time: Date,
            runId: Match.OneOf(Match.Where(validators_1.validId), null),
            level: Match.Where(validators_1.validLogLevel),
            message: String,
            data: Match.Optional(Object)
        }];
}
function validProgress() {
    return {
        completed: Match.Where(validators_1.validNumGTEZero),
        total: Match.Where(validators_1.validNumGTEZero),
        percent: Match.Where(validators_1.validNumGTEZero)
    };
}
function validLaterJSObj() {
    return {
        schedules: [Object],
        exceptions: Match.Optional([Object])
    };
}
function validJobDoc() {
    return {
        _id: Match.Optional(Match.OneOf(Match.Where(validators_1.validId), null)),
        runId: Match.OneOf(Match.Where(validators_1.validId), null),
        type: String,
        status: Match.Where(validators_1.validStatus),
        data: Object,
        result: Match.Optional(Object),
        failures: Match.Optional([Object]),
        priority: Match.Integer,
        depends: [Match.Where(validators_1.validId)],
        resolved: [Match.Where(validators_1.validId)],
        after: Date,
        updated: Date,
        workTimeout: Match.Optional(Match.Where(validators_1.validIntGTEOne)),
        expiresAfter: Match.Optional(Date),
        log: Match.Optional(validLog()),
        progress: validProgress(),
        retries: Match.Where(validators_1.validIntGTEZero),
        retried: Match.Where(validators_1.validIntGTEZero),
        repeatRetries: Match.Optional(Match.Where(validators_1.validIntGTEZero)),
        retryUntil: Date,
        retryWait: Match.Where(validators_1.validIntGTEZero),
        retryBackoff: Match.Where(validators_1.validRetryBackoff),
        repeats: Match.Where(validators_1.validIntGTEZero),
        repeated: Match.Where(validators_1.validIntGTEZero),
        repeatUntil: Date,
        repeatWait: Match.OneOf(Match.Where(validators_1.validIntGTEZero), Match.Where(validLaterJSObj)),
        created: Date
    };
}
class JobCollectionBase extends Mongo.Collection {
    root;
    later;
    _validNumGTEZero = validators_1.validNumGTEZero;
    _validNumGTZero = validators_1.validNumGTZero;
    _validNumGTEOne = validators_1.validNumGTEOne;
    _validIntGTEZero = validators_1.validIntGTEZero;
    _validIntGTEOne = validators_1.validIntGTEOne;
    _validStatus = validators_1.validStatus;
    _validLogLevel = validators_1.validLogLevel;
    _validRetryBackoff = validators_1.validRetryBackoff;
    _validId = validators_1.validId;
    _validLog = validLog;
    _validProgress = validProgress;
    _validJobDoc = validJobDoc;
    jobLogLevels = job_class_1.Job.jobLogLevels;
    jobPriorities = job_class_1.Job.jobPriorities;
    jobStatuses = job_class_1.Job.jobStatuses;
    jobStatusCancellable = job_class_1.Job.jobStatusCancellable;
    jobStatusPausable = job_class_1.Job.jobStatusPausable;
    jobStatusRemovable = job_class_1.Job.jobStatusRemovable;
    jobStatusRestartable = job_class_1.Job.jobStatusRestartable;
    forever = job_class_1.Job.forever;
    foreverDate = job_class_1.Job.foreverDate;
    ddpMethods = job_class_1.Job.ddpMethods;
    ddpPermissionLevels = job_class_1.Job.ddpPermissionLevels;
    ddpMethodPermissions = job_class_1.Job.ddpMethodPermissions;
    jobDocPattern = validJobDoc();
    _createLogEntry;
    _logMessage;
    _toLog;
    _unblockDDPMethods;
    scrubJobDoc;
    constructor(root = 'queue', options = {}) {
        if (!(Mongo.Collection.prototype instanceof Object.getPrototypeOf(Mongo.Collection.prototype).constructor)) {
            throw new Meteor.Error('The global definition of Mongo.Collection has changed since the job-collection package was loaded. Please ensure that any packages that redefine Mongo.Collection are loaded before job-collection.');
        }
        if (Mongo.Collection !== Mongo.Collection.prototype.constructor) {
            throw new Meteor.Error('The global definition of Mongo.Collection has been patched by another package, and the prototype constructor has been left in an inconsistent state. Please see this link for a workaround: https://github.com/vsivsi/meteor-file-sample-app/issues/2#issuecomment-120780592');
        }
        options.noCollectionSuffix = options.noCollectionSuffix ?? false;
        let collectionName = root;
        if (!options.noCollectionSuffix) {
            collectionName += '.jobs';
        }
        delete options.noCollectionSuffix;
        super(collectionName, options);
        this.root = root;
        this.later = typeof later !== 'undefined' ? later : undefined;
        job_class_1.Job.setDDP(options.connection, this.root);
        this._createLogEntry = (message = '', runId = null, level = 'info', time = new Date(), data = null) => {
            const entry = {
                time,
                runId,
                message,
                level
            };
            if (data) {
                entry.data = data;
            }
            return entry;
        };
        this._logMessage = {
            readied: () => this._createLogEntry('Promoted to ready'),
            forced: (_id) => this._createLogEntry('Dependencies force resolved', null, 'warning'),
            rerun: (id, runId) => this._createLogEntry('Rerunning job', null, 'info', new Date(), {
                previousJob: { id, runId }
            }),
            running: (runId) => this._createLogEntry('Job Running', runId),
            paused: () => this._createLogEntry('Job Paused'),
            resumed: () => this._createLogEntry('Job Resumed'),
            cancelled: () => this._createLogEntry('Job Cancelled', null, 'warning'),
            restarted: () => this._createLogEntry('Job Restarted'),
            resubmitted: () => this._createLogEntry('Job Resubmitted'),
            submitted: () => this._createLogEntry('Job Submitted'),
            completed: (runId) => this._createLogEntry('Job Completed', runId, 'success'),
            resolved: (id, runId) => this._createLogEntry('Dependency resolved', null, 'info', new Date(), {
                dependency: { id, runId }
            }),
            failed: (runId, fatal, err) => {
                const value = err.value;
                const msg = `Job Failed with${fatal ? ' Fatal' : ''} Error${value && typeof value === 'string' ? ': ' + value : ''}.`;
                const level = fatal ? 'danger' : 'warning';
                return this._createLogEntry(msg, runId, level);
            }
        };
    }
    processJobs(type, options, worker) {
        if (worker) {
            return new job_class_1.Job.processJobs(this.root, type, options, worker);
        }
        else {
            return new job_class_1.Job.processJobs(this.root, type, options);
        }
    }
    getJob(id, options, cb) {
        return job_class_1.Job.getJob(this.root, id, options, cb);
    }
    getWork(type, options, cb) {
        return job_class_1.Job.getWork(this.root, type, options, cb);
    }
    getJobs(ids, options, cb) {
        return job_class_1.Job.getJobs(this.root, ids, options, cb);
    }
    readyJobs(ids, options, cb) {
        return job_class_1.Job.readyJobs(this.root, ids, options, cb);
    }
    cancelJobs(ids, options, cb) {
        return job_class_1.Job.cancelJobs(this.root, ids, options, cb);
    }
    pauseJobs(ids, options, cb) {
        return job_class_1.Job.pauseJobs(this.root, ids, options, cb);
    }
    resumeJobs(ids, options, cb) {
        return job_class_1.Job.resumeJobs(this.root, ids, options, cb);
    }
    restartJobs(ids, options, cb) {
        return job_class_1.Job.restartJobs(this.root, ids, options, cb);
    }
    removeJobs(ids, options, cb) {
        return job_class_1.Job.removeJobs(this.root, ids, options, cb);
    }
    setDDP(ddp, names) {
        return job_class_1.Job.setDDP(ddp, names);
    }
    startJobServer(options, cb) {
        return job_class_1.Job.startJobServer(this.root, options, cb);
    }
    shutdownJobServer(options, cb) {
        return job_class_1.Job.shutdownJobServer(this.root, options, cb);
    }
    startJobs(options, cb) {
        return job_class_1.Job.startJobs(this.root, options, cb);
    }
    stopJobs(options, cb) {
        return job_class_1.Job.stopJobs(this.root, options, cb);
    }
    setJobPermissions(type, _options) {
        throw new Error(`Server-only function jc.${type}() invoked on client.`);
    }
    promote(_milliseconds) {
        throw new Error('Server-only function jc.promote() invoked on client.');
    }
    setLogStream(_writeStream) {
        throw new Error('Server-only function jc.setLogStream() invoked on client.');
    }
    logConsole;
    makeJob(type, data) {
        console.warn('WARNING: jc.makeJob() has been deprecated. Use new Job(jc, doc) instead.');
        return new job_class_1.Job(this.root, type, data);
    }
    createJob(type, data) {
        console.warn('WARNING: jc.createJob() has been deprecated. Use new Job(jc, type, data) instead.');
        return new job_class_1.Job(this.root, type, data);
    }
    _methodWrapper(method, func) {
        const toLog = this._toLog;
        const unblockDDPMethods = this._unblockDDPMethods ?? false;
        return function (...params) {
            const user = this.userId ?? '[UNAUTHENTICATED]';
            if (toLog) {
                toLog(user, method, 'params: ' + JSON.stringify(params));
            }
            if (unblockDDPMethods) {
                this.unblock();
            }
            const retval = func(...params);
            if (toLog) {
                toLog(user, method, 'returned: ' + JSON.stringify(retval));
            }
            return retval;
        };
    }
    _generateMethods() {
        const methodsOut = {};
        const methodPrefix = '_DDPMethod_';
        let obj = this;
        const propertyNames = new Set();
        while (obj && obj !== Object.prototype) {
            Object.getOwnPropertyNames(obj).forEach(name => propertyNames.add(name));
            obj = Object.getPrototypeOf(obj);
        }
        for (const methodName of propertyNames) {
            if (methodName.startsWith(methodPrefix)) {
                const methodFunc = this[methodName];
                if (typeof methodFunc === 'function') {
                    const baseMethodName = methodName.substring(methodPrefix.length);
                    methodsOut[`${this.root}_${baseMethodName}`] = this._methodWrapper(baseMethodName, methodFunc.bind(this));
                }
            }
        }
        return methodsOut;
    }
    async _idsOfDeps(ids, antecedents, dependents, jobStatuses) {
        const dependsIds = [];
        const dependsQuery = [];
        if (dependents) {
            dependsQuery.push({
                depends: {
                    $elemMatch: {
                        $in: ids
                    }
                }
            });
        }
        if (antecedents) {
            const antsArray = [];
            const docs = await this.find({ _id: { $in: ids } }, {
                fields: { depends: 1 },
                transform: null
            }).fetchAsync();
            for (const d of docs) {
                for (const i of d.depends) {
                    if (!antsArray.includes(i)) {
                        antsArray.push(i);
                    }
                }
            }
            if (antsArray.length > 0) {
                dependsQuery.push({
                    _id: { $in: antsArray }
                });
            }
        }
        if (dependsQuery.length > 0) {
            const docs = await this.find({
                status: { $in: jobStatuses },
                $or: dependsQuery
            }, {
                fields: { _id: 1 },
                transform: null
            }).fetchAsync();
            for (const d of docs) {
                if (d._id && !dependsIds.includes(d._id)) {
                    dependsIds.push(d._id);
                }
            }
        }
        return dependsIds;
    }
    async _rerun_job(doc, repeats = doc.repeats - 1, wait = doc.repeatWait, repeatUntil = doc.repeatUntil) {
        const id = doc._id;
        const runId = doc.runId;
        const time = new Date();
        delete doc._id;
        delete doc.result;
        delete doc.failures;
        delete doc.expiresAfter;
        delete doc.workTimeout;
        doc.runId = null;
        doc.status = 'waiting';
        doc.repeatRetries = doc.repeatRetries ?? doc.retries + doc.retried;
        doc.retries = doc.repeatRetries;
        doc.retries = Math.min(doc.retries, this.forever);
        doc.retryUntil = repeatUntil;
        doc.retried = 0;
        doc.repeats = repeats;
        doc.repeats = Math.min(doc.repeats, this.forever);
        doc.repeatUntil = repeatUntil;
        doc.repeated = doc.repeated + 1;
        doc.updated = time;
        doc.created = time;
        doc.progress = {
            completed: 0,
            total: 1,
            percent: 0
        };
        const logObj = this._logMessage.rerun(id, runId);
        doc.log = logObj ? [logObj] : [];
        if (typeof wait === 'number') {
            doc.after = new Date(time.valueOf() + wait);
        }
        else {
            doc.after = time;
        }
        const jobId = await this.insertAsync(doc);
        if (jobId) {
            await this._DDPMethod_jobReady(jobId);
            return jobId;
        }
        else {
            console.warn('Job rerun/repeat failed to reschedule!', id, runId);
        }
        return null;
    }
    async _checkDeps(job, dryRun = true) {
        let cancel = false;
        const resolved = [];
        const failed = [];
        const cancelled = [];
        const removed = [];
        const log = [];
        if (job.depends.length > 0) {
            const deps = await this.find({ _id: { $in: job.depends } }, { fields: { _id: 1, runId: 1, status: 1 } }).fetchAsync();
            if (deps.length !== job.depends.length) {
                const foundIds = deps.map((d) => d._id);
                for (const j of job.depends) {
                    if (!foundIds.includes(j)) {
                        if (!dryRun) {
                            await this._DDPMethod_jobLog(job._id, null, `Antecedent job ${j} missing at save`);
                        }
                        removed.push(j);
                    }
                }
                cancel = true;
            }
            for (const depJob of deps) {
                if (!this.jobStatusCancellable.includes(depJob.status)) {
                    switch (depJob.status) {
                        case 'completed':
                            if (depJob._id)
                                resolved.push(depJob._id);
                            if (depJob._id && depJob.runId) {
                                log.push(this._logMessage.resolved(depJob._id, depJob.runId));
                            }
                            break;
                        case 'failed':
                            cancel = true;
                            if (depJob._id)
                                failed.push(depJob._id);
                            if (!dryRun && job._id) {
                                await this._DDPMethod_jobLog(job._id, null, 'Antecedent job failed before save');
                            }
                            break;
                        case 'cancelled':
                            cancel = true;
                            if (depJob._id)
                                cancelled.push(depJob._id);
                            if (!dryRun && job._id) {
                                await this._DDPMethod_jobLog(job._id, null, 'Antecedent job cancelled before save');
                            }
                            break;
                        default:
                            throw new Meteor.Error('Unknown status in jobSave Dependency check');
                    }
                }
            }
            if (resolved.length > 0 && !dryRun) {
                const mods = {
                    $pull: {
                        depends: { $in: resolved }
                    },
                    $push: {
                        resolved: { $each: resolved },
                        log: { $each: log }
                    }
                };
                const n = await this.updateAsync({
                    _id: job._id,
                    status: 'waiting'
                }, mods);
                if (!n) {
                    console.warn(`Update for job ${job._id} during dependency check failed.`);
                }
            }
            if (cancel && !dryRun && job._id) {
                await this._DDPMethod_jobCancel(job._id);
                return false;
            }
        }
        if (dryRun) {
            if (cancel || resolved.length > 0) {
                return {
                    jobId: job._id,
                    resolved,
                    failed,
                    cancelled,
                    removed
                };
            }
            else {
                return false;
            }
        }
        else {
            return true;
        }
    }
    async _DDPMethod_startJobServer(options = {}) {
        check(options, Match.Optional({}));
        return true;
    }
    _DDPMethod_startJobs(options = {}) {
        console.warn('Deprecation Warning: jc.startJobs() has been renamed to jc.startJobServer()');
        return this._DDPMethod_startJobServer(options);
    }
    async _DDPMethod_shutdownJobServer(options = {}) {
        check(options, Match.Optional({
            timeout: Match.Optional(Match.Where(validators_1.validIntGTEOne))
        }));
        return true;
    }
    _DDPMethod_stopJobs(options = {}) {
        console.warn('Deprecation Warning: jc.stopJobs() has been renamed to jc.shutdownJobServer()');
        return this._DDPMethod_shutdownJobServer(options);
    }
    async _DDPMethod_getJob(ids, options = {}) {
        check(ids, Match.OneOf(Match.Where(validators_1.validId), [Match.Where(validators_1.validId)]));
        check(options, Match.Optional({
            getLog: Match.Optional(Boolean),
            getFailures: Match.Optional(Boolean)
        }));
        options.getLog = options.getLog ?? false;
        options.getFailures = options.getFailures ?? false;
        const single = !Array.isArray(ids);
        const idsArray = Array.isArray(ids) ? ids : [ids];
        if (idsArray.length === 0) {
            return null;
        }
        const fields = { _private: 0 };
        if (!options.getLog) {
            fields.log = 0;
        }
        if (!options.getFailures) {
            fields.failures = 0;
        }
        const docs = await this.find({ _id: { $in: idsArray } }, {
            fields,
            transform: null
        }).fetchAsync();
        if (docs && docs.length) {
            let scrubbedDocs = docs;
            if (this.scrubJobDoc) {
                scrubbedDocs = docs.map(d => this.scrubJobDoc(d));
            }
            check(scrubbedDocs, [validJobDoc()]);
            return single ? scrubbedDocs[0] : scrubbedDocs;
        }
        return null;
    }
    async _DDPMethod_getWork(type, options = {}) {
        check(type, Match.OneOf(String, [String]));
        check(options, Match.Optional({
            maxJobs: Match.Optional(Match.Where(validators_1.validIntGTEOne)),
            workTimeout: Match.Optional(Match.Where(validators_1.validIntGTEOne))
        }));
        options.maxJobs = options.maxJobs ?? 1;
        const typeArray = typeof type === 'string' ? [type] : type;
        const time = new Date();
        const docs = [];
        const runId = this._makeNewID ? this._makeNewID() : new Mongo.ObjectID().toHexString();
        while (docs.length < options.maxJobs) {
            const ids = (await this.find({
                type: { $in: typeArray },
                status: 'ready',
                runId: null
            }, {
                sort: {
                    priority: 1,
                    retryUntil: 1,
                    after: 1
                },
                limit: options.maxJobs - docs.length,
                fields: { _id: 1 },
                transform: null
            }).fetchAsync()).map((d) => d._id);
            if (!ids || ids.length === 0) {
                break;
            }
            const mods = {
                $set: {
                    status: 'running',
                    runId: runId,
                    updated: time
                },
                $inc: {
                    retries: -1,
                    retried: 1
                }
            };
            const logObj = this._logMessage.running(runId);
            if (logObj) {
                mods.$push = { log: logObj };
            }
            if (options.workTimeout) {
                mods.$set.workTimeout = options.workTimeout;
                mods.$set.expiresAfter = new Date(time.valueOf() + options.workTimeout);
            }
            else {
                mods.$unset = {
                    workTimeout: '',
                    expiresAfter: ''
                };
            }
            const num = await this.updateAsync({
                _id: { $in: ids },
                status: 'ready',
                runId: null
            }, mods, { multi: true });
            if (num > 0) {
                let foundDocs = await this.find({
                    _id: { $in: ids },
                    runId: runId
                }, {
                    fields: {
                        log: 0,
                        failures: 0,
                        _private: 0
                    },
                    transform: null
                }).fetchAsync();
                if (foundDocs && foundDocs.length > 0) {
                    if (this.scrubJobDoc) {
                        foundDocs = foundDocs.map(d => this.scrubJobDoc(d));
                    }
                    check(docs, [validJobDoc()]);
                    docs.push(...foundDocs);
                }
            }
        }
        return docs;
    }
    async _DDPMethod_jobRemove(ids, options = {}) {
        check(ids, Match.OneOf(Match.Where(validators_1.validId), [Match.Where(validators_1.validId)]));
        check(options, Match.Optional({}));
        const idsArray = Array.isArray(ids) ? ids : [ids];
        if (idsArray.length === 0) {
            return false;
        }
        const num = await this.removeAsync({
            _id: { $in: idsArray },
            status: { $in: this.jobStatusRemovable }
        });
        if (num > 0) {
            return true;
        }
        else {
            console.warn('jobRemove failed');
        }
        return false;
    }
    async _DDPMethod_jobPause(ids, options = {}) {
        check(ids, Match.OneOf(Match.Where(validators_1.validId), [Match.Where(validators_1.validId)]));
        check(options, Match.Optional({}));
        const idsArray = Array.isArray(ids) ? ids : [ids];
        if (idsArray.length === 0) {
            return false;
        }
        const time = new Date();
        const mods = {
            $set: {
                status: 'paused',
                updated: time
            }
        };
        const logObj = this._logMessage.paused();
        if (logObj) {
            mods.$push = { log: logObj };
        }
        const num = await this.updateAsync({
            _id: { $in: idsArray },
            status: { $in: this.jobStatusPausable }
        }, mods, { multi: true });
        if (num > 0) {
            return true;
        }
        else {
            console.warn('jobPause failed');
        }
        return false;
    }
    async _DDPMethod_jobResume(ids, options = {}) {
        check(ids, Match.OneOf(Match.Where(validators_1.validId), [Match.Where(validators_1.validId)]));
        check(options, Match.Optional({}));
        const idsArray = Array.isArray(ids) ? ids : [ids];
        if (idsArray.length === 0) {
            return false;
        }
        const time = new Date();
        const mods = {
            $set: {
                status: 'waiting',
                updated: time
            }
        };
        const logObj = this._logMessage.resumed();
        if (logObj) {
            mods.$push = { log: logObj };
        }
        const num = await this.updateAsync({
            _id: { $in: idsArray },
            status: 'paused',
            updated: { $ne: time }
        }, mods, { multi: true });
        if (num > 0) {
            await this._DDPMethod_jobReady(idsArray);
            return true;
        }
        else {
            console.warn('jobResume failed');
        }
        return false;
    }
    async _DDPMethod_jobReady(ids = [], options = {}) {
        check(ids, Match.OneOf(Match.Where(validators_1.validId), [Match.Where(validators_1.validId)]));
        check(options, Match.Optional({
            force: Match.Optional(Boolean),
            time: Match.Optional(Date)
        }));
        const now = new Date();
        const opts = options ?? {};
        opts.force = opts.force ?? false;
        opts.time = opts.time ?? now;
        const idsArray = Array.isArray(ids) ? ids : [ids];
        const query = {
            status: 'waiting',
            after: { $lte: opts.time }
        };
        const mods = {
            $set: {
                status: 'ready',
                updated: now
            }
        };
        if (idsArray.length > 0) {
            query._id = { $in: idsArray };
            mods.$set.after = now;
        }
        const logObj = [];
        if (opts.force) {
            mods.$set.depends = [];
            const l = this._logMessage.forced(idsArray[0]);
            if (l)
                logObj.push(l);
        }
        else {
            query.depends = { $size: 0 };
        }
        const l = this._logMessage.readied();
        if (l)
            logObj.push(l);
        if (logObj.length > 0) {
            mods.$push = {
                log: { $each: logObj }
            };
        }
        const num = await this.updateAsync(query, mods, { multi: true });
        return num > 0;
    }
    async _DDPMethod_jobCancel(ids, options = {}) {
        check(ids, Match.OneOf(Match.Where(validators_1.validId), [Match.Where(validators_1.validId)]));
        check(options, Match.Optional({
            antecedents: Match.Optional(Boolean),
            dependents: Match.Optional(Boolean)
        }));
        const opts = options ?? {};
        opts.antecedents = opts.antecedents ?? false;
        opts.dependents = opts.dependents ?? true;
        const idsArray = Array.isArray(ids) ? ids : [ids];
        if (idsArray.length === 0) {
            return false;
        }
        const time = new Date();
        const mods = {
            $set: {
                status: 'cancelled',
                runId: null,
                progress: {
                    completed: 0,
                    total: 1,
                    percent: 0
                },
                updated: time
            }
        };
        const logObj = this._logMessage.cancelled();
        if (logObj) {
            mods.$push = { log: logObj };
        }
        const num = await this.updateAsync({
            _id: { $in: idsArray },
            status: { $in: this.jobStatusCancellable }
        }, mods, { multi: true });
        const cancelIds = await this._idsOfDeps(idsArray, opts.antecedents, opts.dependents, this.jobStatusCancellable);
        let depsCancelled = false;
        if (cancelIds.length > 0) {
            depsCancelled = await this._DDPMethod_jobCancel(cancelIds, opts);
        }
        if (num > 0 || depsCancelled) {
            return true;
        }
        else {
            console.warn('jobCancel failed');
        }
        return false;
    }
    async _DDPMethod_jobRestart(ids, options = {}) {
        check(ids, Match.OneOf(Match.Where(validators_1.validId), [Match.Where(validators_1.validId)]));
        check(options, Match.Optional({
            retries: Match.Optional(Match.Where(validators_1.validIntGTEZero)),
            until: Match.Optional(Date),
            antecedents: Match.Optional(Boolean),
            dependents: Match.Optional(Boolean)
        }));
        const opts = options ?? {};
        opts.retries = opts.retries ?? 1;
        opts.retries = Math.min(opts.retries, this.forever);
        opts.dependents = opts.dependents ?? false;
        opts.antecedents = opts.antecedents ?? true;
        const idsArray = Array.isArray(ids) ? ids : [ids];
        if (idsArray.length === 0) {
            return false;
        }
        const time = new Date();
        const query = {
            _id: { $in: idsArray },
            status: { $in: this.jobStatusRestartable }
        };
        const mods = {
            $set: {
                status: 'waiting',
                progress: {
                    completed: 0,
                    total: 1,
                    percent: 0
                },
                updated: time
            },
            $inc: {
                retries: opts.retries
            }
        };
        const logObj = this._logMessage.restarted();
        if (logObj) {
            mods.$push = { log: logObj };
        }
        if (opts.until) {
            mods.$set.retryUntil = opts.until;
        }
        const num = await this.updateAsync(query, mods, { multi: true });
        const restartIds = await this._idsOfDeps(idsArray, opts.antecedents, opts.dependents, this.jobStatusRestartable);
        let depsRestarted = false;
        if (restartIds.length > 0) {
            depsRestarted = await this._DDPMethod_jobRestart(restartIds, opts);
        }
        if (num > 0 || depsRestarted) {
            await this._DDPMethod_jobReady(idsArray);
            return true;
        }
        else {
            console.warn('jobRestart failed');
        }
        return false;
    }
    async _DDPMethod_jobSave(doc, options = {}) {
        check(doc, validJobDoc());
        check(options, Match.Optional({
            cancelRepeats: Match.Optional(Boolean)
        }));
        check(doc.status, Match.Where((v) => Match.test(v, String) && ['waiting', 'paused'].includes(v)));
        const opts = options ?? {};
        opts.cancelRepeats = opts.cancelRepeats ?? false;
        doc.repeats = Math.min(doc.repeats, this.forever);
        doc.retries = Math.min(doc.retries, this.forever);
        const time = new Date();
        if (doc.after < time)
            doc.after = time;
        if (doc.retryUntil < time)
            doc.retryUntil = time;
        if (doc.repeatUntil < time)
            doc.repeatUntil = time;
        if (this.later && typeof doc.repeatWait !== 'number') {
            const schedule = this.later.schedule(doc.repeatWait);
            if (!schedule) {
                console.warn(`No valid available later.js times in schedule after ${doc.after}`);
                return null;
            }
            const next = schedule.next(2, schedule.prev(1, doc.after))[1];
            if (!next) {
                console.warn(`No valid available later.js times in schedule after ${doc.after}`);
                return null;
            }
            const nextDate = new Date(next);
            if (nextDate > doc.repeatUntil) {
                console.warn(`No valid available later.js times in schedule before ${doc.repeatUntil}`);
                return null;
            }
            doc.after = nextDate;
        }
        else if (!this.later && typeof doc.repeatWait !== 'number') {
            console.warn('Later.js not loaded...');
            return null;
        }
        if (doc._id) {
            const mods = {
                $set: {
                    status: 'waiting',
                    data: doc.data,
                    retries: doc.retries,
                    repeatRetries: doc.repeatRetries ?? doc.retries + doc.retried,
                    retryUntil: doc.retryUntil,
                    retryWait: doc.retryWait,
                    retryBackoff: doc.retryBackoff,
                    repeats: doc.repeats,
                    repeatUntil: doc.repeatUntil,
                    repeatWait: doc.repeatWait,
                    depends: doc.depends,
                    priority: doc.priority,
                    after: doc.after,
                    updated: time
                }
            };
            const logObj = this._logMessage.resubmitted();
            if (logObj) {
                mods.$push = { log: logObj };
            }
            const num = await this.updateAsync({
                _id: doc._id,
                status: 'paused',
                runId: null
            }, mods);
            if (num && (await this._checkDeps(doc, false))) {
                await this._DDPMethod_jobReady(doc._id);
                return doc._id;
            }
            else {
                return null;
            }
        }
        else {
            if (doc.repeats === this.forever && opts.cancelRepeats) {
                const existingJobs = await this.find({
                    type: doc.type,
                    status: { $in: this.jobStatusCancellable }
                }, { transform: null }).fetchAsync();
                for (const d of existingJobs) {
                    await this._DDPMethod_jobCancel(d._id, {});
                }
            }
            doc.created = time;
            doc.log.push(this._logMessage.submitted());
            doc._id = await this.insertAsync(doc);
            if (doc._id && (await this._checkDeps(doc, false))) {
                await this._DDPMethod_jobReady(doc._id);
                return doc._id;
            }
            else {
                return null;
            }
        }
    }
    async _DDPMethod_jobProgress(id, runId, completed, total, options = {}) {
        check(id, Match.Where(validators_1.validId));
        check(runId, Match.Where(validators_1.validId));
        check(completed, Match.Where(validators_1.validNumGTEZero));
        check(total, Match.Where(validators_1.validNumGTZero));
        check(options, Match.Optional({}));
        const progress = {
            completed,
            total,
            percent: (100 * completed) / total
        };
        check(progress, Match.Where((v) => v.total >= v.completed && v.percent >= 0 && v.percent <= 100));
        const time = new Date();
        const job = await this.findOneAsync({ _id: id }, { fields: { workTimeout: 1 } });
        const mods = {
            $set: {
                progress,
                updated: time
            }
        };
        if (job?.workTimeout) {
            mods.$set.expiresAfter = new Date(time.valueOf() + job.workTimeout);
        }
        const num = await this.updateAsync({
            _id: id,
            runId: runId,
            status: 'running'
        }, mods);
        if (num === 1) {
            return true;
        }
        else {
            console.warn('jobProgress failed');
        }
        return false;
    }
    async _DDPMethod_jobLog(id, runId, message, options = {}) {
        check(id, Match.Where(validators_1.validId));
        check(runId, Match.OneOf(Match.Where(validators_1.validId), null));
        check(message, String);
        check(options, Match.Optional({
            level: Match.Optional(Match.Where(validators_1.validLogLevel)),
            data: Match.Optional(Object)
        }));
        const opts = options ?? {};
        const time = new Date();
        const logObj = {
            time,
            runId,
            level: opts.level ?? 'info',
            message
        };
        if (opts.data) {
            logObj.data = opts.data;
        }
        const job = await this.findOneAsync({ _id: id }, { fields: { status: 1, workTimeout: 1 } });
        const mods = {
            $push: { log: logObj },
            $set: { updated: time }
        };
        if (job?.workTimeout && job.status === 'running') {
            mods.$set.expiresAfter = new Date(time.valueOf() + job.workTimeout);
        }
        const num = await this.updateAsync({ _id: id }, mods);
        if (num === 1) {
            return true;
        }
        else {
            console.warn('jobLog failed');
        }
        return false;
    }
    async _DDPMethod_jobRerun(id, options = {}) {
        check(id, Match.Where(validators_1.validId));
        check(options, Match.Optional({
            repeats: Match.Optional(Match.Where(validators_1.validIntGTEZero)),
            until: Match.Optional(Date),
            wait: Match.OneOf(Match.Where(validators_1.validIntGTEZero), Match.Where(validLaterJSObj))
        }));
        const opts = options ?? {};
        const doc = await this.findOneAsync({ _id: id, status: 'completed' }, {
            fields: {
                result: 0,
                failures: 0,
                log: 0,
                progress: 0,
                updated: 0,
                after: 0,
                status: 0
            },
            transform: null
        });
        if (doc) {
            opts.repeats = opts.repeats ?? 0;
            opts.repeats = Math.min(opts.repeats, this.forever);
            opts.until = opts.until ?? doc.repeatUntil;
            opts.wait = opts.wait ?? 0;
            const result = await this._rerun_job(doc, opts.repeats, opts.wait, opts.until);
            return result ?? false;
        }
        return false;
    }
    async _DDPMethod_jobDone(id, runId, result, options = {}) {
        check(id, Match.Where(validators_1.validId));
        check(runId, Match.Where(validators_1.validId));
        check(result, Object);
        check(options, Match.Optional({
            repeatId: Match.Optional(Boolean),
            delayDeps: Match.Optional(Match.Where(validators_1.validIntGTEZero))
        }));
        const opts = options ?? {};
        opts.repeatId = opts.repeatId ?? false;
        const time = new Date();
        const doc = await this.findOneAsync({
            _id: id,
            runId: runId,
            status: 'running'
        }, {
            fields: {
                log: 0,
                failures: 0,
                updated: 0,
                after: 0,
                status: 0
            },
            transform: null
        });
        if (!doc) {
            console.warn('Running job not found', id, runId);
            return false;
        }
        const mods = {
            $set: {
                status: 'completed',
                result,
                progress: {
                    completed: doc.progress.total || 1,
                    total: doc.progress.total || 1,
                    percent: 100
                },
                updated: time
            }
        };
        const logObj = this._logMessage.completed(runId);
        if (logObj) {
            mods.$push = { log: logObj };
        }
        const num = await this.updateAsync({
            _id: id,
            runId: runId,
            status: 'running'
        }, mods);
        if (num === 1) {
            let jobId = null;
            if (doc.repeats > 0) {
                if (typeof doc.repeatWait === 'number') {
                    if (doc.repeatUntil.valueOf() - doc.repeatWait >= time.valueOf()) {
                        jobId = await this._rerun_job(doc);
                    }
                }
                else {
                    const next = this.later?.schedule(doc.repeatWait).next(2);
                    if (next && next.length > 0) {
                        let d = new Date(next[0]);
                        if (d.valueOf() - time.valueOf() <= 500 && next.length > 1) {
                            d = new Date(next[1]);
                        }
                        const wait = d.valueOf() - time.valueOf();
                        if (doc.repeatUntil.valueOf() - wait >= time.valueOf()) {
                            jobId = await this._rerun_job(doc, doc.repeats - 1, wait);
                        }
                    }
                }
            }
            const ids = (await this.find({ depends: { $all: [id] } }, {
                transform: null,
                fields: { _id: 1 }
            }).fetchAsync()).map((d) => d._id);
            if (ids.length > 0) {
                const depMods = {
                    $pull: { depends: id },
                    $push: { resolved: id }
                };
                if (opts.delayDeps) {
                    const after = new Date(time.valueOf() + opts.delayDeps);
                    depMods.$max = { after };
                }
                const depLogObj = this._logMessage.resolved(id, runId);
                if (depLogObj) {
                    depMods.$push.log = depLogObj;
                }
                const n = await this.updateAsync({ _id: { $in: ids } }, depMods, { multi: true });
                if (n !== ids.length) {
                    console.warn(`Not all dependent jobs were resolved ${ids.length} > ${n}`);
                }
                await this._DDPMethod_jobReady(ids);
            }
            if (opts.repeatId && jobId) {
                return jobId;
            }
            else {
                return true;
            }
        }
        else {
            console.warn('jobDone failed');
        }
        return false;
    }
    async _DDPMethod_jobFail(id, runId, err, options = {}) {
        check(id, Match.Where(validators_1.validId));
        check(runId, Match.Where(validators_1.validId));
        check(err, Object);
        check(options, Match.Optional({
            fatal: Match.Optional(Boolean)
        }));
        const opts = options ?? {};
        opts.fatal = opts.fatal ?? false;
        const time = new Date();
        const doc = await this.findOneAsync({
            _id: id,
            runId: runId,
            status: 'running'
        }, {
            fields: {
                log: 0,
                failures: 0,
                progress: 0,
                updated: 0,
                after: 0,
                runId: 0,
                status: 0
            },
            transform: null
        });
        if (!doc) {
            console.warn('Running job not found', id, runId);
            return false;
        }
        const after = doc.retryBackoff === 'exponential'
            ? new Date(time.valueOf() + doc.retryWait * Math.pow(2, doc.retried - 1))
            : new Date(time.valueOf() + doc.retryWait);
        const newStatus = !opts.fatal && doc.retries > 0 && doc.retryUntil >= after ? 'waiting' : 'failed';
        const errorObj = err;
        errorObj.runId = runId;
        const mods = {
            $set: {
                status: newStatus,
                runId: null,
                after,
                updated: time
            },
            $push: {
                failures: errorObj
            }
        };
        const logObj = this._logMessage.failed(runId, newStatus === 'failed', errorObj);
        if (logObj) {
            mods.$push.log = logObj;
        }
        const num = await this.updateAsync({
            _id: id,
            runId: runId,
            status: 'running'
        }, mods);
        if (newStatus === 'failed' && num === 1) {
            const dependentJobs = await this.find({ depends: { $all: [id] } }, { transform: null }).fetchAsync();
            for (const d of dependentJobs) {
                await this._DDPMethod_jobCancel(d._id);
            }
        }
        if (num === 1) {
            return true;
        }
        else {
            console.warn('jobFail failed');
        }
        return false;
    }
}
exports.JobCollectionBase = JobCollectionBase;
exports.JobCollection = JobCollectionBase;
if (typeof share !== 'undefined') {
    share.JobCollectionBase = JobCollectionBase;
}
//# sourceMappingURL=shared.js.map