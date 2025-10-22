////////////////////////////////////////////////////////////////////////////
//     Copyright (C) 2014-2017 by Vaughn Iverson
//     job-collection is free software released under the MIT/X11 license.
//     See included LICENSE file for details.
////////////////////////////////////////////////////////////////////////////

import type {
  JobId,
  JobType,
  JobDocument,
  JobLogLevel,
  JobRetryOptions,
  JobRepeatOptions,
  JobLogOptions,
  JobProgressOptions,
  JobSaveOptions,
  JobRefreshOptions,
  JobDoneOptions,
  JobFailOptions,
  JobReadyOptions,
  JobCancelOptions,
  JobRestartOptions,
  JobRerunOptions,
  GetWorkOptions,
  GetJobOptions,
  ReadyJobsOptions,
  Callback,
  DDPApply,
  LaterJSSchedule
} from '../types';
import { JobQueue } from './job-queue';
import {
  callbackOrPromise,
  optionsHelp,
  splitLongArray,
  reduceCallbacks,
  concatReduce,
  setImmediate
} from '../utils/callback-helpers';
import { 
  isInteger
} from '../utils/validators';

/**
 * DDP method invocation helper
 */
async function methodCall(
  root: string | { root?: string },
  method: string,
  params: any[],
  cb?: Callback,
  after: (ret: any) => any = (ret) => ret
): Promise<any> {
  const rootStr = typeof root === 'object' && root.root ? root.root : root as string;
  const apply: DDPApply = (Job._ddp_apply as any)?.[rootStr] ?? Job._ddp_apply;
  
  if (typeof apply !== 'function') {
    throw new Error('Job remote method call error, no valid invocation method found.');
  }

  const name = `${rootStr}_${method}`;

  if (cb && typeof cb === 'function') {
    apply(name, params, (err?: Error | null, res?: any) => {
      if (err) return cb(err);
      cb(null, after(res));
    });
    return;
  } else {
    return new Promise((resolve, reject) => {
      apply(name, params, (err?: Error | null, res?: any) => {
        if (err) reject(err);
        else resolve(after(res));
      });
    });
  }
}

/**
 * Job class - Represents a single job
 */
export class Job {
  // Static constants
  static readonly forever = 9007199254740992; // JS max safe integer (2^53)
  static readonly foreverDate = new Date(8640000000000000); // Max date value in JS

  static readonly jobPriorities = {
    low: 10,
    normal: 0,
    medium: -5,
    high: -10,
    critical: -15
  } as const;

  static readonly jobRetryBackoffMethods = ['constant', 'exponential'] as const;

  static readonly jobStatuses = [
    'waiting', 'paused', 'ready', 'running',
    'failed', 'cancelled', 'completed'
  ] as const;

  static readonly jobLogLevels = ['info', 'success', 'warning', 'danger'] as const;

  static readonly jobStatusCancellable = ['running', 'ready', 'waiting', 'paused'] as const;
  static readonly jobStatusPausable = ['ready', 'waiting'] as const;
  static readonly jobStatusRemovable = ['cancelled', 'completed', 'failed'] as const;
  static readonly jobStatusRestartable = ['cancelled', 'failed'] as const;

  static readonly ddpMethods = [
    'startJobs', 'stopJobs', // Deprecated!
    'startJobServer', 'shutdownJobServer',
    'jobRemove', 'jobPause', 'jobResume', 'jobReady',
    'jobCancel', 'jobRestart', 'jobSave', 'jobRerun', 'getWork',
    'getJob', 'jobLog', 'jobProgress', 'jobDone', 'jobFail'
  ] as const;

  static readonly ddpPermissionLevels = ['admin', 'manager', 'creator', 'worker'] as const;

  static readonly ddpMethodPermissions = {
    'startJobs': ['startJobs', 'admin'],  // Deprecated!
    'stopJobs': ['stopJobs', 'admin'],    // Deprecated!
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
  } as const;

  // Static DDP apply function
  static _ddp_apply: DDPApply | Record<string, DDPApply> | undefined = undefined;

  // Instance properties
  root!: string;
  private _root!: string | { root?: string };
  private _doc!: JobDocument;

  constructor(rootVal: string | { root?: string }, type: JobType | JobDocument, data?: Record<string, any>) {
    // Support calling without new
    if (!(this instanceof Job)) {
      return new Job(rootVal, type, data);
    }

    // Set the root value
    this.root = typeof rootVal === 'object' && rootVal.root ? rootVal.root : rootVal as string;
    this._root = rootVal;

    let doc: Partial<JobDocument>;

    // Handle (root, doc) signature
    if (!data && typeof type === 'object' && 'data' in type && 'type' in type) {
      if (type instanceof Job) {
        return type;
      }

      doc = type as JobDocument;
      data = doc.data;
      type = doc.type as JobType;
    } else {
      doc = {};
    }

    // Validate parameters
    if (
      typeof doc !== 'object' ||
      typeof data !== 'object' ||
      typeof type !== 'string' ||
      typeof this.root !== 'string'
    ) {
      throw new Error(`new Job: bad parameter(s), ${this.root} (${typeof this.root}), ${type} (${typeof type}), ${data} (${typeof data}), ${doc} (${typeof doc})`);
    }

    // Create job document
    if (doc.type && doc.data) {
      this._doc = doc as JobDocument;
    } else {
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

  // Property getters
  get doc(): JobDocument {
    return this._doc;
  }

  get type(): JobType {
    return this._doc.type;
  }

  get data(): Record<string, any> {
    return this._doc.data;
  }

  // Static class methods

  static _setDDPApply(apply: DDPApply, collectionName?: string): void {
    if (typeof apply !== 'function') {
      throw new Error('Bad function in Job.setDDPApply()');
    }

    if (typeof collectionName === 'string') {
      this._ddp_apply = this._ddp_apply ?? {};
      if (typeof this._ddp_apply === 'function') {
        throw new Error('Job.setDDP must specify a collection name each time if called more than once.');
      }
      (this._ddp_apply as Record<string, DDPApply>)[collectionName] = apply;
    } else if (!this._ddp_apply) {
      this._ddp_apply = apply;
    } else {
      throw new Error('Job.setDDP must specify a collection name each time if called more than once.');
    }
  }

  static setDDP(
    ddp: any = null,
    collectionNames: string | string[] | null = null
  ): void {
    let names: (string | undefined)[];

    if (typeof collectionNames === 'string') {
      names = [collectionNames];
    } else if (Array.isArray(collectionNames)) {
      names = collectionNames;
    } else {
      // If collectionNames not provided, use undefined
      names = [undefined];
    }

    for (const collName of names) {
      if (!ddp || !ddp.close || !ddp.subscribe) {
        // Not the DDP npm package
        if (ddp === null && typeof Meteor !== 'undefined' && Meteor.apply) {
          // Meteor local server/client
          const meteorApply = (name: string, params: any[], callback?: Callback) => {
            return Meteor.apply(name, params, callback as any);
          };
          this._setDDPApply(meteorApply, collName);
        } else {
          throw new Error('Bad ddp object in Job.setDDP()');
        }
      } else if (!ddp.observe) {
        // This is a Meteor DDP connection object
        const ddpApply = (name: string, params: any[], callback?: Callback) => {
          return ddp.apply(name, params, callback);
        };
        this._setDDPApply(ddpApply, collName);
      } else {
        // This is the npm DDP package
        // Note: Fiber support removed in v2.0 - use async/await
        const ddpCall = (name: string, params: any[], callback?: Callback) => {
          return ddp.call(name, params, callback);
        };
        this._setDDPApply(ddpCall, collName);
      }
    }
  }

  static async getWork(
    root: string,
    type: JobType | JobType[],
    options?: GetWorkOptions | Callback,
    cb?: Callback
  ): Promise<Job | Job[]> {
    let opts: GetWorkOptions;
    [opts, cb] = optionsHelp<GetWorkOptions>(options ?? {}, cb);

    const typeArray = typeof type === 'string' ? [type] : type;

    if (opts.workTimeout !== undefined) {
      if (!isInteger(opts.workTimeout) || opts.workTimeout <= 0) {
        throw new Error('getWork: workTimeout must be a positive integer');
      }
    }

    return methodCall(
      root,
      'getWork',
      [typeArray, opts],
      cb,
      (res: JobDocument[]) => {
        const jobs = res.map(doc => new Job(root, doc));
        if (opts.maxJobs !== undefined) {
          return jobs;
        } else {
          return jobs[0];
        }
      }
    );
  }

  static processJobs = JobQueue;

  static async getJob(
    root: string,
    id: JobId,
    options?: GetJobOptions | Callback,
    cb?: Callback
  ): Promise<Job | undefined> {
    let opts: GetJobOptions;
    [opts, cb] = optionsHelp<GetJobOptions>(options ?? {}, cb);

    opts.getLog = opts.getLog ?? false;

    return methodCall(
      root,
      'getJob',
      [id, opts],
      cb,
      (doc: JobDocument | null) => {
        if (doc) {
          return new Job(root, doc);
        }
        return undefined;
      }
    );
  }

  static async getJobs(
    root: string,
    ids: JobId[],
    options?: GetJobOptions | Callback,
    cb?: Callback
  ): Promise<Job[]> {
    let opts: GetJobOptions;
    [opts, cb] = optionsHelp<GetJobOptions>(options ?? {}, cb);

    opts.getLog = opts.getLog ?? false;

    const chunksOfIds = splitLongArray(ids, 32);
    const myCb = reduceCallbacks(cb, chunksOfIds.length, concatReduce as any, [] as any);

    if (!cb) {
      const results: Job[][] = [];
      for (const chunkOfIds of chunksOfIds) {
        const docs = await methodCall(
          root,
          'getJob',
          [chunkOfIds, opts],
          undefined,
          (docs: JobDocument[] | null) => {
            if (docs) {
              return docs.map(d => new Job(root, d));
            }
            return [];
          }
        );
        results.push(docs);
      }
      return results.flat();
    } else {
      for (const chunkOfIds of chunksOfIds) {
        methodCall(
          root,
          'getJob',
          [chunkOfIds, opts],
          myCb,
          (docs: JobDocument[] | null) => {
            if (docs) {
              return docs.map(d => new Job(root, d));
            }
            return [];
          }
        );
      }
      return [] as any;
    }
  }

  static async pauseJobs(
    root: string,
    ids: JobId[],
    options?: Record<string, any> | Callback,
    cb?: Callback
  ): Promise<boolean> {
    let opts: Record<string, any>;
    [opts, cb] = optionsHelp<Record<string, any>>(options ?? {}, cb);

    const chunksOfIds = splitLongArray(ids, 256);
    let retVal = false;
    const myCb = reduceCallbacks(cb, chunksOfIds.length);

    for (const chunkOfIds of chunksOfIds) {
      const result = await methodCall(root, 'jobPause', [chunkOfIds, opts], myCb);
      retVal = retVal || result;
    }

    return retVal;
  }

  static async resumeJobs(
    root: string,
    ids: JobId[],
    options?: Record<string, any> | Callback,
    cb?: Callback
  ): Promise<boolean> {
    let opts: Record<string, any>;
    [opts, cb] = optionsHelp<Record<string, any>>(options ?? {}, cb);

    const chunksOfIds = splitLongArray(ids, 256);
    let retVal = false;
    const myCb = reduceCallbacks(cb, chunksOfIds.length);

    for (const chunkOfIds of chunksOfIds) {
      const result = await methodCall(root, 'jobResume', [chunkOfIds, opts], myCb);
      retVal = retVal || result;
    }

    return retVal;
  }

  static async readyJobs(
    root: string,
    ids: JobId[] = [],
    options?: ReadyJobsOptions | Callback,
    cb?: Callback
  ): Promise<boolean> {
    let opts: ReadyJobsOptions;
    [opts, cb] = optionsHelp<ReadyJobsOptions>(options ?? {}, cb);

    opts.force = opts.force ?? false;

    let chunksOfIds = splitLongArray(ids, 256);
    if (chunksOfIds.length === 0) {
      chunksOfIds = [[]];
    }

    let retVal = false;
    const myCb = reduceCallbacks(cb, chunksOfIds.length);

    for (const chunkOfIds of chunksOfIds) {
      const result = await methodCall(root, 'jobReady', [chunkOfIds, opts], myCb);
      retVal = retVal || result;
    }

    return retVal;
  }

  static async cancelJobs(
    root: string,
    ids: JobId[],
    options?: JobCancelOptions | Callback,
    cb?: Callback
  ): Promise<boolean> {
    let opts: JobCancelOptions;
    [opts, cb] = optionsHelp<JobCancelOptions>(options ?? {}, cb);

    opts.antecedents = opts.antecedents ?? true;

    const chunksOfIds = splitLongArray(ids, 256);
    let retVal = false;
    const myCb = reduceCallbacks(cb, chunksOfIds.length);

    for (const chunkOfIds of chunksOfIds) {
      const result = await methodCall(root, 'jobCancel', [chunkOfIds, opts], myCb);
      retVal = retVal || result;
    }

    return retVal;
  }

  static async restartJobs(
    root: string,
    ids: JobId[],
    options?: JobRestartOptions | Callback,
    cb?: Callback
  ): Promise<boolean> {
    let opts: JobRestartOptions;
    [opts, cb] = optionsHelp<JobRestartOptions>(options ?? {}, cb);

    opts.retries = opts.retries ?? 1;
    opts.dependents = opts.dependents ?? true;

    const chunksOfIds = splitLongArray(ids, 256);
    let retVal = false;
    const myCb = reduceCallbacks(cb, chunksOfIds.length);

    for (const chunkOfIds of chunksOfIds) {
      const result = await methodCall(root, 'jobRestart', [chunkOfIds, opts], myCb);
      retVal = retVal || result;
    }

    return retVal;
  }

  static async removeJobs(
    root: string,
    ids: JobId[],
    options?: Record<string, any> | Callback,
    cb?: Callback
  ): Promise<boolean> {
    let opts: Record<string, any>;
    [opts, cb] = optionsHelp<Record<string, any>>(options ?? {}, cb);

    const chunksOfIds = splitLongArray(ids, 256);
    let retVal = false;
    const myCb = reduceCallbacks(cb, chunksOfIds.length);

    for (const chunkOfIds of chunksOfIds) {
      const result = await methodCall(root, 'jobRemove', [chunkOfIds, opts], myCb);
      retVal = retVal || result;
    }

    return retVal;
  }

  // Deprecated methods
  static startJobs(root: string, options?: Record<string, any> | Callback, cb?: Callback): Promise<boolean> {
    console.warn('Deprecation Warning: Job.startJobs() has been renamed to Job.startJobServer()');
    return Job.startJobServer(root, options, cb);
  }

  static stopJobs(root: string, options?: Record<string, any> | Callback, cb?: Callback): Promise<boolean> {
    console.warn('Deprecation Warning: Job.stopJobs() has been renamed to Job.shutdownJobServer()');
    return Job.shutdownJobServer(root, options, cb);
  }

  static async startJobServer(
    root: string,
    options?: Record<string, any> | Callback,
    cb?: Callback
  ): Promise<boolean> {
    let opts: Record<string, any>;
    [opts, cb] = optionsHelp<Record<string, any>>(options ?? {}, cb);

    return methodCall(root, 'startJobServer', [opts], cb);
  }

  static async shutdownJobServer(
    root: string,
    options?: { timeout?: number } | Callback,
    cb?: Callback
  ): Promise<boolean> {
    let opts: { timeout?: number };
    [opts, cb] = optionsHelp<{ timeout?: number }>(options ?? {}, cb);

    opts.timeout = opts.timeout ?? 60 * 1000;

    return methodCall(root, 'shutdownJobServer', [opts], cb);
  }

  // Deprecated - for backward compatibility
  static makeJob(root: string, doc: JobDocument): Job {
    console.warn('Job.makeJob(root, jobDoc) has been deprecated and will be removed in a future release, use "new Job(root, jobDoc)" instead.');
    return new Job(root, doc);
  }

  // Instance methods

  private _echo(message: string, level: JobLogLevel | null = null): void {
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

  depends(jobs?: Job | Job[] | null): this {
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
    } else {
      this._doc.depends = [];
    }

    this._doc.resolved = [];
    return this;
  }

  priority(level: number | keyof typeof Job.jobPriorities = 0): this {
    let priority: number;

    if (typeof level === 'string') {
      priority = Job.jobPriorities[level];
      if (priority === undefined) {
        throw new Error('Invalid string priority level provided');
      }
    } else if (isInteger(level)) {
      priority = level;
    } else {
      throw new Error('priority must be an integer or valid priority level');
    }

    this._doc.priority = priority;
    return this;
  }

  retry(options: number | JobRetryOptions = 0): this {
    let opts: JobRetryOptions;

    if (isInteger(options) && (options as number) >= 0) {
      opts = { retries: options as number };
    } else if (typeof options === 'object') {
      opts = options;
    } else {
      throw new Error('bad parameter: accepts either an integer >= 0 or an options object');
    }

    if (opts.retries !== undefined) {
      if (!isInteger(opts.retries) || opts.retries < 0) {
        throw new Error('bad option: retries must be an integer >= 0');
      }
      opts.retries++;
    } else {
      opts.retries = Job.forever;
    }

    if (opts.until !== undefined) {
      if (!(opts.until instanceof Date)) {
        throw new Error('bad option: until must be a Date object');
      }
    } else {
      opts.until = Job.foreverDate;
    }

    if (opts.wait !== undefined) {
      if (!isInteger(opts.wait) || opts.wait < 0) {
        throw new Error('bad option: wait must be an integer >= 0');
      }
    } else {
      opts.wait = 5 * 60 * 1000;
    }

    if (opts.backoff !== undefined) {
      if (!Job.jobRetryBackoffMethods.includes(opts.backoff as any)) {
        throw new Error('bad option: invalid retry backoff method');
      }
    } else {
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

  repeat(options: number | JobRepeatOptions = 0): this {
    let opts: JobRepeatOptions;

    if (isInteger(options) && (options as number) >= 0) {
      opts = { repeats: options as number };
    } else if (typeof options === 'object') {
      opts = options;
    } else {
      throw new Error('bad parameter: accepts either an integer >= 0 or an options object');
    }

    if (opts.wait && opts.schedule) {
      throw new Error('bad options: wait and schedule options are mutually exclusive');
    }

    if (opts.repeats !== undefined) {
      if (!isInteger(opts.repeats) || opts.repeats < 0) {
        throw new Error('bad option: repeats must be an integer >= 0');
      }
    } else {
      opts.repeats = Job.forever;
    }

    if (opts.until !== undefined) {
      if (!(opts.until instanceof Date)) {
        throw new Error('bad option: until must be a Date object');
      }
    } else {
      opts.until = Job.foreverDate;
    }

    let waitValue: number | LaterJSSchedule;

    if (opts.wait !== undefined) {
      if (!isInteger(opts.wait) || opts.wait < 0) {
        throw new Error('bad option: wait must be an integer >= 0');
      }
      waitValue = opts.wait;
    } else if (opts.schedule) {
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
    } else {
      waitValue = 5 * 60 * 1000;
    }

    this._doc.repeats = opts.repeats;
    this._doc.repeatWait = waitValue;
    this._doc.repeated = this._doc.repeated ?? 0;
    this._doc.repeatUntil = opts.until;

    return this;
  }

  delay(wait = 0): this {
    if (!isInteger(wait) || wait < 0) {
      throw new Error('Bad parameter, delay requires a non-negative integer.');
    }
    return this.after(new Date(new Date().valueOf() + wait));
  }

  after(time: Date = new Date(0)): this {
    if (!(time instanceof Date)) {
      throw new Error('Bad parameter, after requires a valid Date object');
    }
    this._doc.after = time;
    return this;
  }

  log(message: string, options?: JobLogOptions | Callback, cb?: Callback): Promise<boolean> | this {
    let opts: JobLogOptions;
    [opts, cb] = optionsHelp<JobLogOptions>(options ?? {}, cb);

    opts.level = opts.level ?? 'info';

    if (typeof message !== 'string') {
      throw new Error('Log message must be a string');
    }

    if (!Job.jobLogLevels.includes(opts.level as any)) {
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
      return callbackOrPromise<boolean>(
        (callback) => methodCall(this._root, 'jobLog', [this._doc._id, this._doc.runId, message, opts], callback),
        cb
      ) as Promise<boolean>;
    } else {
      // Log can be called on an unsaved job
      this._doc.log = this._doc.log ?? [];
      this._doc.log.push({
        time: new Date(),
        runId: null,
        level: opts.level,
        message: message,
        ...(opts.data && { data: opts.data })
      });

      if (cb) {
        setImmediate(() => cb(null, true));
      }
      return this;
    }
  }

  progress(
    completed = 0,
    total = 1,
    options?: JobProgressOptions | Callback,
    cb?: Callback
  ): Promise<boolean> | this | null {
    let opts: JobProgressOptions;
    [opts, cb] = optionsHelp<JobProgressOptions>(options ?? {}, cb);

    if (
      typeof completed !== 'number' ||
      typeof total !== 'number' ||
      completed < 0 ||
      total <= 0 ||
      total < completed
    ) {
      throw new Error(`job.progress: something is wrong with progress params: ${this._doc._id}, ${completed} out of ${total}`);
    }

    const progress = {
      completed: completed,
      total: total,
      percent: (100 * completed) / total
    };

    if (opts.echo) {
      delete opts.echo;
      this._echo(
        `PROGRESS: ${this._doc._id} ${this._doc.runId}: ${progress.completed} out of ${progress.total} (${progress.percent}%)`
      );
    }

    if (this._doc._id && this._doc.runId) {
      return callbackOrPromise<boolean>(
        (callback) =>
          methodCall(
            this._root,
            'jobProgress',
            [this._doc._id, this._doc.runId, completed, total, opts],
            (err, res) => {
              if (!err && res) {
                this._doc.progress = progress;
              }
              callback(err, res);
            }
          ),
        cb
      ) as Promise<boolean>;
    } else if (!this._doc._id) {
      this._doc.progress = progress;
      if (cb) {
        setImmediate(() => cb(null, true));
      }
      return this;
    }

    return null;
  }

  save(options?: JobSaveOptions | Callback, cb?: Callback): Promise<JobId> {
    let opts: JobSaveOptions;
    [opts, cb] = optionsHelp<JobSaveOptions>(options ?? {}, cb);

    return callbackOrPromise<JobId>(
      (callback) =>
        methodCall(this._root, 'jobSave', [this._doc, opts], (err, id) => {
          if (!err && id) {
            this._doc._id = id;
          }
          callback(err, id);
        }),
      cb
    ) as Promise<JobId>;
  }

  refresh(options?: JobRefreshOptions | Callback, cb?: Callback): Promise<Job | false> {
    let opts: JobRefreshOptions;
    [opts, cb] = optionsHelp<JobRefreshOptions>(options ?? {}, cb);

    opts.getLog = opts.getLog ?? false;

    if (!this._doc._id) {
      throw new Error("Can't call .refresh() on an unsaved job");
    }

    return callbackOrPromise<Job | false>(
      (callback) =>
        methodCall(this._root, 'getJob', [this._doc._id, opts], (err, doc) => {
          if (!err && doc) {
            this._doc = doc;
            callback(null, this);
          } else if (!err) {
            callback(null, false);
          } else {
            callback(err);
          }
        }),
      cb
    ) as Promise<Job | false>;
  }

  done(result: any = {}, options?: JobDoneOptions | Callback, cb?: Callback): Promise<boolean> {
    if (typeof result === 'function') {
      cb = result;
      result = {};
    }

    let opts: JobDoneOptions;
    [opts, cb] = optionsHelp<JobDoneOptions>(options ?? {}, cb);

    if (result === null || typeof result !== 'object') {
      result = { value: result };
    }

    if (!this._doc._id || !this._doc.runId) {
      throw new Error("Can't call .done() on an unsaved or non-running job");
    }

    return callbackOrPromise<boolean>(
      (callback) => methodCall(this._root, 'jobDone', [this._doc._id, this._doc.runId, result, opts], callback),
      cb
    ) as Promise<boolean>;
  }

  fail(result: any = 'No error information provided', options?: JobFailOptions | Callback, cb?: Callback): Promise<boolean> {
    if (typeof result === 'function') {
      cb = result;
      result = 'No error information provided';
    }

    let opts: JobFailOptions;
    [opts, cb] = optionsHelp<JobFailOptions>(options ?? {}, cb);

    if (result === null || typeof result !== 'object') {
      result = { value: result };
    }

    opts.fatal = opts.fatal ?? false;

    if (!this._doc._id || !this._doc.runId) {
      throw new Error("Can't call .fail() on an unsaved or non-running job");
    }

    return callbackOrPromise<boolean>(
      (callback) => methodCall(this._root, 'jobFail', [this._doc._id, this._doc.runId, result, opts], callback),
      cb
    ) as Promise<boolean>;
  }

  pause(options?: Record<string, any> | Callback, cb?: Callback): Promise<boolean> | this {
    let opts: Record<string, any>;
    [opts, cb] = optionsHelp<Record<string, any>>(options ?? {}, cb);

    if (this._doc._id) {
      return callbackOrPromise<boolean>(
        (callback) => methodCall(this._root, 'jobPause', [this._doc._id, opts], callback),
        cb
      ) as Promise<boolean>;
    } else {
      this._doc.status = 'paused';
      if (cb) {
        setImmediate(() => cb(null, true));
      }
      return this;
    }
  }

  resume(options?: Record<string, any> | Callback, cb?: Callback): Promise<boolean> | this {
    let opts: Record<string, any>;
    [opts, cb] = optionsHelp<Record<string, any>>(options ?? {}, cb);

    if (this._doc._id) {
      return callbackOrPromise<boolean>(
        (callback) => methodCall(this._root, 'jobResume', [this._doc._id, opts], callback),
        cb
      ) as Promise<boolean>;
    } else {
      this._doc.status = 'waiting';
      if (cb) {
        setImmediate(() => cb(null, true));
      }
      return this;
    }
  }

  ready(options?: JobReadyOptions | Callback, cb?: Callback): Promise<boolean> {
    let opts: JobReadyOptions;
    [opts, cb] = optionsHelp<JobReadyOptions>(options ?? {}, cb);

    opts.force = opts.force ?? false;

    if (!this._doc._id) {
      throw new Error("Can't call .ready() on an unsaved job");
    }

    return callbackOrPromise<boolean>(
      (callback) => methodCall(this._root, 'jobReady', [this._doc._id, opts], callback),
      cb
    ) as Promise<boolean>;
  }

  cancel(options?: JobCancelOptions | Callback, cb?: Callback): Promise<boolean> {
    let opts: JobCancelOptions;
    [opts, cb] = optionsHelp<JobCancelOptions>(options ?? {}, cb);

    opts.antecedents = opts.antecedents ?? true;

    if (!this._doc._id) {
      throw new Error("Can't call .cancel() on an unsaved job");
    }

    return callbackOrPromise<boolean>(
      (callback) => methodCall(this._root, 'jobCancel', [this._doc._id, opts], callback),
      cb
    ) as Promise<boolean>;
  }

  restart(options?: JobRestartOptions | Callback, cb?: Callback): Promise<boolean> {
    let opts: JobRestartOptions;
    [opts, cb] = optionsHelp<JobRestartOptions>(options ?? {}, cb);

    opts.retries = opts.retries ?? 1;
    opts.dependents = opts.dependents ?? true;

    if (!this._doc._id) {
      throw new Error("Can't call .restart() on an unsaved job");
    }

    return callbackOrPromise<boolean>(
      (callback) => methodCall(this._root, 'jobRestart', [this._doc._id, opts], callback),
      cb
    ) as Promise<boolean>;
  }

  rerun(options?: JobRerunOptions | Callback, cb?: Callback): Promise<JobId> {
    let opts: JobRerunOptions;
    [opts, cb] = optionsHelp<JobRerunOptions>(options ?? {}, cb);

    opts.repeats = opts.repeats ?? 0;
    opts.wait = opts.wait ?? this._doc.repeatWait as number;

    if (!this._doc._id) {
      throw new Error("Can't call .rerun() on an unsaved job");
    }

    return callbackOrPromise<JobId>(
      (callback) => methodCall(this._root, 'jobRerun', [this._doc._id, opts], callback),
      cb
    ) as Promise<JobId>;
  }

  remove(options?: Record<string, any> | Callback, cb?: Callback): Promise<boolean> {
    let opts: Record<string, any>;
    [opts, cb] = optionsHelp<Record<string, any>>(options ?? {}, cb);

    if (!this._doc._id) {
      throw new Error("Can't call .remove() on an unsaved job");
    }

    return callbackOrPromise<boolean>(
      (callback) => methodCall(this._root, 'jobRemove', [this._doc._id, opts], callback),
      cb
    ) as Promise<boolean>;
  }
}

// Default export for backward compatibility
export default Job;

