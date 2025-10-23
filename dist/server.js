"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobCollection = void 0;
const events_1 = require("events");
const shared_1 = require("./shared");
const job_class_1 = require("./job/job-class");
const validators_1 = require("./utils/validators");
function userHelper(user, connection) {
    let ret = user ?? '[UNAUTHENTICATED]';
    if (!connection) {
        ret = '[SERVER]';
    }
    return ret;
}
class JobCollectionServer extends shared_1.JobCollectionBase {
    events;
    stopped = true;
    logStream = null;
    allows = {};
    denys = {};
    isSimulation = false;
    interval;
    _localServerMethods;
    _ddp_apply;
    constructor(root = 'queue', options = {}) {
        if (!(new.target)) {
            return new JobCollectionServer(root, options);
        }
        super(root, options);
        this.events = new events_1.EventEmitter();
        this.events.on('error', this._onError.bind(this));
        this.events.on('error', (msg) => {
            this.events.emit(msg.method, msg);
        });
        this.events.on('call', this._onCall.bind(this));
        this.events.on('call', (msg) => {
            this.events.emit(msg.method, msg);
        });
        this.stopped = true;
        this._toLog = this._toLogServer.bind(this);
        const denyAll = () => true;
        Mongo.Collection.prototype.deny.call(this, {
            update: denyAll,
            insert: denyAll,
            remove: denyAll
        });
        this.promote();
        this.logStream = null;
        this.allows = {};
        this.denys = {};
        for (const level of [...this.ddpPermissionLevels, ...this.ddpMethods]) {
            this.allows[level] = [];
            this.denys[level] = [];
        }
        if (!options.connection) {
            this.createIndexAsync({ type: 1, status: 1 }).catch((err) => {
                console.warn('Failed to create index:', err);
            });
            this.createIndexAsync({ priority: 1, retryUntil: 1, after: 1 }).catch((err) => {
                console.warn('Failed to create index:', err);
            });
            this.isSimulation = false;
            const localMethods = this._generateMethods();
            this._localServerMethods = {};
            for (const [methodName, methodFunction] of Object.entries(localMethods)) {
                this._localServerMethods[methodName] = methodFunction;
            }
            this._ddp_apply = async (name, params, cb) => {
                if (cb) {
                    Meteor.setTimeout(async () => {
                        let err = null;
                        let res = null;
                        try {
                            res = await this._localServerMethods[name](...params);
                        }
                        catch (e) {
                            err = e;
                        }
                        cb(err, res);
                    }, 0);
                }
                else {
                    return await this._localServerMethods[name](...params);
                }
            };
            job_class_1.Job._setDDPApply(this._ddp_apply, root);
            const meteorMethods = {};
            for (const [key, value] of Object.entries(localMethods)) {
                meteorMethods[key] = value;
            }
            Meteor.methods(meteorMethods);
        }
    }
    _onError(msg) {
        const user = userHelper(msg.userId, msg.connection);
        this._toLogServer(user, msg.method, `${msg.error}`);
    }
    _onCall(msg) {
        const user = userHelper(msg.userId, msg.connection);
        this._toLogServer(user, msg.method, 'params: ' + JSON.stringify(msg.params));
        this._toLogServer(user, msg.method, 'returned: ' + JSON.stringify(msg.returnVal));
    }
    _toLogServer(userId, method, message) {
        if (this.logStream && this.logStream.write) {
            this.logStream.write(`${new Date()}, ${userId}, ${method}, ${message}\n`);
        }
    }
    _emit(method, connection, userId, err, ret, ...params) {
        if (err) {
            this.events.emit('error', {
                error: err,
                method,
                connection,
                userId,
                params,
                returnVal: null
            });
        }
        else {
            this.events.emit('call', {
                error: null,
                method,
                connection,
                userId,
                params,
                returnVal: ret
            });
        }
    }
    _methodWrapper(method, func) {
        const self = this;
        const myTypeof = (val) => {
            const type = typeof val;
            if (type === 'object' && val instanceof Array) {
                return 'array';
            }
            return type;
        };
        const permitted = (userId, params) => {
            const performTest = (tests) => {
                let result = false;
                for (const test of tests) {
                    if (result)
                        break;
                    switch (myTypeof(test)) {
                        case 'array':
                            result = result || (userId !== null && test.includes(userId));
                            break;
                        case 'function':
                            result = result || test(userId, method, params);
                            break;
                        default:
                            result = false;
                    }
                }
                return result;
            };
            const performAllTests = (allTests) => {
                let result = false;
                const permissions = this.ddpMethodPermissions[method];
                const permArray = Array.from(permissions);
                for (const t of permArray) {
                    if (result)
                        break;
                    result = result || performTest(allTests[t]);
                }
                return result;
            };
            return !performAllTests(this.denys) && performAllTests(this.allows);
        };
        return function (...params) {
            try {
                let retval;
                if (!this.connection || permitted(this.userId, params)) {
                    retval = func(...params);
                }
                else {
                    const err = new Meteor.Error(403, 'Method not authorized', 'Authenticated user is not permitted to invoke this method.');
                    throw err;
                }
                self._emit(method, this.connection, this.userId, null, retval, ...params);
                return retval;
            }
            catch (err) {
                self._emit(method, this.connection, this.userId, err, null, ...params);
                throw err;
            }
        };
    }
    setLogStream(writeStream = null) {
        if (this.logStream) {
            throw new Error('logStream may only be set once per job-collection startup/shutdown cycle');
        }
        this.logStream = writeStream;
        if (this.logStream &&
            (!this.logStream.write ||
                typeof this.logStream.write !== 'function' ||
                !this.logStream.end ||
                typeof this.logStream.end !== 'function')) {
            throw new Error('logStream must be a valid writable node.js Stream');
        }
    }
    setJobAllow(allowOptions) {
        for (const [type, func] of Object.entries(allowOptions)) {
            if (type in this.allows) {
                this.allows[type].push(func);
            }
        }
    }
    setJobDeny(denyOptions) {
        for (const [type, func] of Object.entries(denyOptions)) {
            if (type in this.denys) {
                this.denys[type].push(func);
            }
        }
    }
    promote(milliseconds = 15 * 1000) {
        if (typeof milliseconds === 'number' && milliseconds > 0) {
            if (this.interval) {
                Meteor.clearInterval(this.interval);
            }
            this._promote_jobs();
            this.interval = Meteor.setInterval(this._promote_jobs.bind(this), milliseconds);
        }
        else {
            console.warn(`jobCollection.promote: invalid timeout: ${this.root}, ${milliseconds}`);
        }
    }
    async _promote_jobs(_ids = []) {
        if (this.stopped) {
            return;
        }
        const zombieJobs = await this.find({
            status: 'running',
            expiresAfter: { $lt: new Date() }
        }).fetchAsync();
        for (const job of zombieJobs) {
            const jobInstance = new job_class_1.Job(this.root, job);
            await jobInstance.fail('Failed for exceeding worker set workTimeout');
        }
        await this.readyJobs();
    }
    async _DDPMethod_startJobServer(options = {}) {
        check(options, Match.Optional({}));
        if (this.stopped && this.stopped !== true) {
            Meteor.clearTimeout(this.stopped);
        }
        this.stopped = false;
        return true;
    }
    async _DDPMethod_shutdownJobServer(options = {}) {
        check(options, Match.Optional({
            timeout: Match.Optional(Match.Where(validators_1.validIntGTEOne))
        }));
        const opts = options ?? {};
        opts.timeout = opts.timeout ?? 60 * 1000;
        if (this.stopped && this.stopped !== true) {
            Meteor.clearTimeout(this.stopped);
        }
        const timeoutMs = opts.timeout;
        this.stopped = Meteor.setTimeout(async () => {
            const runningJobs = await this.find({ status: 'running' }, { transform: null }).fetchAsync();
            const failedJobs = runningJobs.length;
            if (failedJobs !== 0) {
                console.warn(`Failing ${failedJobs} jobs on queue stop.`);
            }
            for (const d of runningJobs) {
                await this._DDPMethod_jobFail(d._id, d.runId, 'Running at Job Server shutdown.');
            }
            if (this.logStream) {
                this.logStream.end();
                this.logStream = null;
            }
        }, timeoutMs);
        return true;
    }
    async _DDPMethod_getWork(type, options = {}) {
        if (this.isSimulation) {
            return [];
        }
        if (this.stopped) {
            return [];
        }
        return super._DDPMethod_getWork(type, options);
    }
    async _DDPMethod_jobReady(ids = [], options = {}) {
        if (this.isSimulation) {
            return false;
        }
        return super._DDPMethod_jobReady(ids, options);
    }
}
exports.JobCollection = JobCollectionServer;
if (typeof share !== 'undefined') {
    share.JobCollection = JobCollectionServer;
}
if (typeof Meteor !== 'undefined' && Meteor.isServer) {
    global.JobCollection = JobCollectionServer;
}
//# sourceMappingURL=server.js.map