/* eslint-disable @typescript-eslint/ban-types */
////////////////////////////////////////////////////////////////////////////
//     Copyright (C) 2014-2017 by Vaughn Iverson
//     job-collection is free software released under the MIT/X11 license.
//     See included LICENSE file for details.
////////////////////////////////////////////////////////////////////////////

import { Job } from './job/job-class';
import type {
  JobId,
  JobType,
  JobDocument,
  JobLogEntry,
  JobLogLevel,
  JobStatus,
  LaterJSSchedule,
  GetWorkOptions,
  GetJobOptions,
  ReadyJobsOptions
} from './types';
import {
  validNumGTEZero,
  validNumGTZero,
  validNumGTEOne,
  validIntGTEZero,
  validIntGTEOne,
  validStatus,
  validLogLevel,
  validRetryBackoff,
  validId as isValidId
} from './utils/validators';

// Match pattern helpers
function validLog(): any {
  return [{
    time: Date,
    runId: Match.OneOf(Match.Where(isValidId), null),
    level: Match.Where(validLogLevel),
    message: String,
    data: Match.Optional(Object)
  }];
}

function validProgress(): any {
  return {
    completed: Match.Where(validNumGTEZero),
    total: Match.Where(validNumGTEZero),
    percent: Match.Where(validNumGTEZero)
  };
}

function validLaterJSObj(): any {
  return {
    schedules: [Object],
    exceptions: Match.Optional([Object])
  };
}

function validJobDoc(): any {
  return {
    _id: Match.Optional(Match.OneOf(Match.Where(isValidId), null)),
    runId: Match.OneOf(Match.Where(isValidId), null),
    type: String,
    status: Match.Where(validStatus),
    data: Object,
    result: Match.Optional(Object),
    failures: Match.Optional([Object]),
    priority: Match.Integer,
    depends: [Match.Where(isValidId)],
    resolved: [Match.Where(isValidId)],
    after: Date,
    updated: Date,
    workTimeout: Match.Optional(Match.Where(validIntGTEOne)),
    expiresAfter: Match.Optional(Date),
    log: Match.Optional(validLog()),
    progress: validProgress(),
    retries: Match.Where(validIntGTEZero),
    retried: Match.Where(validIntGTEZero),
    repeatRetries: Match.Optional(Match.Where(validIntGTEZero)),
    retryUntil: Date,
    retryWait: Match.Where(validIntGTEZero),
    retryBackoff: Match.Where(validRetryBackoff),
    repeats: Match.Where(validIntGTEZero),
    repeated: Match.Where(validIntGTEZero),
    repeatUntil: Date,
    repeatWait: Match.OneOf(Match.Where(validIntGTEZero), Match.Where(validLaterJSObj)),
    created: Date
  };
}

declare const later: any;
declare const share: any;

/**
 * Base JobCollection class (shared between client and server)
 */
export class JobCollectionBase extends Mongo.Collection<JobDocument> {
  root!: string;
  later: any;
  
  // Validation functions
  _validNumGTEZero = validNumGTEZero;
  _validNumGTZero = validNumGTZero;
  _validNumGTEOne = validNumGTEOne;
  _validIntGTEZero = validIntGTEZero;
  _validIntGTEOne = validIntGTEOne;
  _validStatus = validStatus;
  _validLogLevel = validLogLevel;
  _validRetryBackoff = validRetryBackoff;
  _validId = isValidId;
  _validLog = validLog;
  _validProgress = validProgress;
  _validJobDoc = validJobDoc;

  // Job constants (from Job class)
  jobLogLevels = Job.jobLogLevels;
  jobPriorities = Job.jobPriorities;
  jobStatuses = Job.jobStatuses;
  jobStatusCancellable = Job.jobStatusCancellable;
  jobStatusPausable = Job.jobStatusPausable;
  jobStatusRemovable = Job.jobStatusRemovable;
  jobStatusRestartable = Job.jobStatusRestartable;
  forever = Job.forever;
  foreverDate = Job.foreverDate;

  ddpMethods = Job.ddpMethods;
  ddpPermissionLevels = Job.ddpPermissionLevels;
  ddpMethodPermissions = Job.ddpMethodPermissions;

  jobDocPattern = validJobDoc();

  // Internal properties
  _createLogEntry!: (message: string, runId?: JobId | null, level?: JobLogLevel, time?: Date, data?: any) => JobLogEntry;
  _logMessage!: Record<string, (...args: any[]) => JobLogEntry>;
  _toLog?: (userId: string, method: string, message: string) => void;
  _unblockDDPMethods?: boolean;
  scrubJobDoc?: (job: JobDocument) => JobDocument;

  constructor(root: string = 'queue', options: any = {}) {
    // Validate Mongo.Collection hasn't been modified in an incompatible way
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

    // Remove non-standard options before calling Mongo.Collection constructor
    delete options.noCollectionSuffix;

    // Call super constructor FIRST
    super(collectionName, options);

    this.root = root;
    this.later = typeof later !== 'undefined' ? later : undefined;

    Job.setDDP(options.connection, this.root);

    // Create log entry helper
    this._createLogEntry = (
      message = '',
      runId: JobId | null = null,
      level: JobLogLevel = 'info',
      time = new Date(),
      data: any = null
    ): JobLogEntry => {
      const entry: JobLogEntry = {
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

    // Log message templates
    this._logMessage = {
      readied: () => this._createLogEntry('Promoted to ready'),
      forced: (_id: JobId) => this._createLogEntry('Dependencies force resolved', null, 'warning'),
      rerun: (id: JobId, runId: JobId) =>
        this._createLogEntry('Rerunning job', null, 'info', new Date(), {
          previousJob: { id, runId }
        }),
      running: (runId: JobId) => this._createLogEntry('Job Running', runId),
      paused: () => this._createLogEntry('Job Paused'),
      resumed: () => this._createLogEntry('Job Resumed'),
      cancelled: () => this._createLogEntry('Job Cancelled', null, 'warning'),
      restarted: () => this._createLogEntry('Job Restarted'),
      resubmitted: () => this._createLogEntry('Job Resubmitted'),
      submitted: () => this._createLogEntry('Job Submitted'),
      completed: (runId: JobId) => this._createLogEntry('Job Completed', runId, 'success'),
      resolved: (id: JobId, runId: JobId) =>
        this._createLogEntry('Dependency resolved', null, 'info', new Date(), {
          dependency: { id, runId }
        }),
      failed: (runId: JobId, fatal: boolean, err: any) => {
        const value = err.value;
        const msg = `Job Failed with${fatal ? ' Fatal' : ''} Error${
          value && typeof value === 'string' ? ': ' + value : ''
        }.`;
        const level: JobLogLevel = fatal ? 'danger' : 'warning';
        return this._createLogEntry(msg, runId, level);
      }
    };
  }

  // API methods that delegate to Job class static methods
  processJobs(type: any, options: any, worker?: any) {
    if (worker) {
      return new Job.processJobs(this.root, type, options, worker);
    } else {
      return new Job.processJobs(this.root, type, options);
    }
  }

  getJob(id: JobId, options?: any, cb?: any) {
    return Job.getJob(this.root, id, options, cb);
  }

  getWork(type: any, options?: any, cb?: any) {
    return Job.getWork(this.root, type, options, cb);
  }

  getJobs(ids: JobId[], options?: any, cb?: any) {
    return Job.getJobs(this.root, ids, options, cb);
  }

  readyJobs(ids?: JobId[], options?: any, cb?: any) {
    return Job.readyJobs(this.root, ids, options, cb);
  }

  cancelJobs(ids: JobId[], options?: any, cb?: any) {
    return Job.cancelJobs(this.root, ids, options, cb);
  }

  pauseJobs(ids: JobId[], options?: any, cb?: any) {
    return Job.pauseJobs(this.root, ids, options, cb);
  }

  resumeJobs(ids: JobId[], options?: any, cb?: any) {
    return Job.resumeJobs(this.root, ids, options, cb);
  }

  restartJobs(ids: JobId[], options?: any, cb?: any) {
    return Job.restartJobs(this.root, ids, options, cb);
  }

  removeJobs(ids: JobId[], options?: any, cb?: any) {
    return Job.removeJobs(this.root, ids, options, cb);
  }

  setDDP(ddp?: any, names?: any) {
    return Job.setDDP(ddp, names);
  }

  startJobServer(options?: any, cb?: any) {
    return Job.startJobServer(this.root, options, cb);
  }

  shutdownJobServer(options?: any, cb?: any) {
    return Job.shutdownJobServer(this.root, options, cb);
  }

  // Deprecated methods
  startJobs(options?: any, cb?: any) {
    return Job.startJobs(this.root, options, cb);
  }

  stopJobs(options?: any, cb?: any) {
    return Job.stopJobs(this.root, options, cb);
  }

  // Server-only methods (will be overridden on server, throw error on client)
  setJobPermissions(type: 'allow' | 'deny', _options: any): void {
    throw new Error(`Server-only function jc.${type}() invoked on client.`);
  }

  promote(_milliseconds?: number): void {
    throw new Error('Server-only function jc.promote() invoked on client.');
  }

  setLogStream(_writeStream?: any): void {
    throw new Error('Server-only function jc.setLogStream() invoked on client.');
  }

  // Client-only property (will be overridden in client.ts)
  logConsole?: boolean;

  // Deprecated methods
  makeJob(type: any, data?: any): Job {
    console.warn('WARNING: jc.makeJob() has been deprecated. Use new Job(jc, doc) instead.');
    return new Job(this.root, type, data);
  }

  createJob(type: any, data?: any): Job {
    console.warn('WARNING: jc.createJob() has been deprecated. Use new Job(jc, type, data) instead.');
    return new Job(this.root, type, data);
  }

  _methodWrapper(method: string, func: Function): Function {
    const toLog = this._toLog;
    const unblockDDPMethods = this._unblockDDPMethods ?? false;
    
    // Return the wrapper function that the Meteor method will actually invoke
    return function(this: any, ...params: any[]) {
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

  _generateMethods(): Record<string, Function> {
    const methodsOut: Record<string, Function> = {};
    const methodPrefix = '_DDPMethod_';
    
    // Get all property names from the prototype chain
    let obj = this;
    const propertyNames = new Set<string>();
    
    while (obj && obj !== Object.prototype) {
      Object.getOwnPropertyNames(obj).forEach(name => propertyNames.add(name));
      obj = Object.getPrototypeOf(obj);
    }
    
    // Now check each property
    for (const methodName of propertyNames) {
      if (methodName.startsWith(methodPrefix)) {
        const methodFunc = (this as any)[methodName];
        if (typeof methodFunc === 'function') {
          const baseMethodName = methodName.substring(methodPrefix.length);
          methodsOut[`${this.root}_${baseMethodName}`] = this._methodWrapper(baseMethodName, methodFunc.bind(this));
        }
      }
    }
    
    return methodsOut;
  }

  _idsOfDeps(
    ids: JobId[],
    antecedents: boolean,
    dependents: boolean,
    jobStatuses: readonly JobStatus[] | JobStatus[]
  ): JobId[] {
    const dependsIds: JobId[] = [];
    const dependsQuery: any[] = [];

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
      const antsArray: JobId[] = [];
      this.find(
        { _id: { $in: ids } },
        {
          fields: { depends: 1 },
          transform: null
        }
      ).forEach((d: any) => {
        for (const i of d.depends) {
          if (!antsArray.includes(i)) {
            antsArray.push(i);
          }
        }
      });

      if (antsArray.length > 0) {
        dependsQuery.push({
          _id: { $in: antsArray }
        });
      }
    }

    if (dependsQuery.length > 0) {
      this.find(
        {
          status: { $in: jobStatuses as any },
          $or: dependsQuery
        },
        {
          fields: { _id: 1 },
          transform: null
        }
      ).forEach((d: any) => {
        if (!dependsIds.includes(d._id)) {
          dependsIds.push(d._id);
        }
      });
    }

    return dependsIds;
  }

  async _rerun_job(
    doc: JobDocument,
    repeats: number = doc.repeats - 1,
    wait: number | LaterJSSchedule = doc.repeatWait,
    repeatUntil: Date = doc.repeatUntil
  ): Promise<JobId | null> {
    const id = doc._id;
    const runId = doc.runId;
    const time = new Date();

    // Clone document for new job
    delete (doc as any)._id;
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

    const logObj = this._logMessage.rerun(id!, runId!);
    doc.log = logObj ? [logObj] : [];

    if (typeof wait === 'number') {
      doc.after = new Date(time.valueOf() + wait);
    } else {
      doc.after = time;
    }

    const jobId = await this.insertAsync(doc);
    if (jobId) {
      await this._DDPMethod_jobReady(jobId);
      return jobId;
    } else {
      console.warn('Job rerun/repeat failed to reschedule!', id, runId);
    }
    
    return null;
  }

  async _checkDeps(job: JobDocument, dryRun = true): Promise<any> {
    let cancel = false;
    const resolved: JobId[] = [];
    const failed: JobId[] = [];
    const cancelled: JobId[] = [];
    const removed: JobId[] = [];
    const log: JobLogEntry[] = [];

    if (job.depends.length > 0) {
      const deps = await this.find(
        { _id: { $in: job.depends } },
        { fields: { _id: 1, runId: 1, status: 1 } }
      ).fetchAsync();

      if (deps.length !== job.depends.length) {
        const foundIds = deps.map((d: any) => d._id);
        for (const j of job.depends) {
          if (!foundIds.includes(j)) {
            if (!dryRun) {
              await this._DDPMethod_jobLog(job._id!, null, `Antecedent job ${j} missing at save`);
            }
            removed.push(j);
          }
        }
        cancel = true;
      }

      for (const depJob of deps) {
        if (!(this.jobStatusCancellable as readonly string[]).includes(depJob.status)) {
          switch (depJob.status) {
            case 'completed':
              if (depJob._id) resolved.push(depJob._id);
              if (depJob._id && depJob.runId) {
                log.push(this._logMessage.resolved(depJob._id, depJob.runId));
              }
              break;
            case 'failed':
              cancel = true;
              if (depJob._id) failed.push(depJob._id);
              if (!dryRun && job._id) {
                await this._DDPMethod_jobLog(job._id, null, 'Antecedent job failed before save');
              }
              break;
            case 'cancelled':
              cancel = true;
              if (depJob._id) cancelled.push(depJob._id);
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
        const mods: any = {
          $pull: {
            depends: { $in: resolved }
          },
          $push: {
            resolved: { $each: resolved },
            log: { $each: log }
          }
        };

        const n = await this.updateAsync(
          {
            _id: job._id,
            status: 'waiting'
          },
          mods
        );

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
      } else {
        return false;
      }
    } else {
      return true;
    }
  }

  // DDP Methods (these will be registered as Meteor methods)

  async _DDPMethod_startJobServer(options: any = {}): Promise<boolean> {
    check(options, Match.Optional({}));
    return true;
  }

  _DDPMethod_startJobs(options: any = {}): Promise<boolean> {
    console.warn('Deprecation Warning: jc.startJobs() has been renamed to jc.startJobServer()');
    return this._DDPMethod_startJobServer(options);
  }

  async _DDPMethod_shutdownJobServer(options: any = {}): Promise<boolean> {
    check(
      options,
      Match.Optional({
        timeout: Match.Optional(Match.Where(validIntGTEOne))
      })
    );
    return true;
  }

  _DDPMethod_stopJobs(options: any = {}): Promise<boolean> {
    console.warn('Deprecation Warning: jc.stopJobs() has been renamed to jc.shutdownJobServer()');
    return this._DDPMethod_shutdownJobServer(options);
  }

  async _DDPMethod_getJob(ids: JobId | JobId[], options: GetJobOptions = {}): Promise<JobDocument | JobDocument[] | null> {
    check(ids, Match.OneOf(Match.Where(isValidId), [Match.Where(isValidId)]));
    check(
      options,
      Match.Optional({
        getLog: Match.Optional(Boolean),
        getFailures: Match.Optional(Boolean)
      })
    );

    options.getLog = options.getLog ?? false;
    options.getFailures = options.getFailures ?? false;

    const single = !Array.isArray(ids);
    const idsArray = Array.isArray(ids) ? ids : [ids];

    if (idsArray.length === 0) {
      return null;
    }

    const fields: any = { _private: 0 };
    if (!options.getLog) {
      fields.log = 0;
    }
    if (!options.getFailures) {
      fields.failures = 0;
    }

    const docs = await this.find(
      { _id: { $in: idsArray } },
      {
        fields,
        transform: null
      }
    ).fetchAsync();

    if (docs && docs.length) {
      let scrubbedDocs = docs;
      if (this.scrubJobDoc) {
        scrubbedDocs = docs.map(d => this.scrubJobDoc!(d));
      }
      check(scrubbedDocs, [validJobDoc()]);
      return single ? scrubbedDocs[0] : scrubbedDocs;
    }

    return null;
  }

  async _DDPMethod_getWork(type: JobType | JobType[], options: GetWorkOptions = {}): Promise<JobDocument[]> {
    check(type, Match.OneOf(String, [String]));
    check(
      options,
      Match.Optional({
        maxJobs: Match.Optional(Match.Where(validIntGTEOne)),
        workTimeout: Match.Optional(Match.Where(validIntGTEOne))
      })
    );

    options.maxJobs = options.maxJobs ?? 1;

    const typeArray = typeof type === 'string' ? [type] : type;
    const time = new Date();
    const docs: JobDocument[] = [];
    // Generate a new run ID
    const runId = (this as any)._makeNewID ? (this as any)._makeNewID() : new Mongo.ObjectID().toHexString();

    while (docs.length < options.maxJobs) {
      const ids = (
        await this.find(
          {
            type: { $in: typeArray },
            status: 'ready',
            runId: null
          },
          {
            sort: {
              priority: 1,
              retryUntil: 1,
              after: 1
            },
            limit: options.maxJobs - docs.length,
            fields: { _id: 1 },
            transform: null
          }
        ).fetchAsync()
      ).map((d: any) => d._id);

      if (!ids || ids.length === 0) {
        break;
      }

      const mods: any = {
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
      } else {
        mods.$unset = {
          workTimeout: '',
          expiresAfter: ''
        };
      }

      const num = await this.updateAsync(
        {
          _id: { $in: ids },
          status: 'ready',
          runId: null
        },
        mods,
        { multi: true }
      );

      if (num > 0) {
        let foundDocs = await this.find(
          {
            _id: { $in: ids },
            runId: runId
          },
          {
            fields: {
              log: 0,
              failures: 0,
              _private: 0
            },
            transform: null
          }
        ).fetchAsync();

        if (foundDocs && foundDocs.length > 0) {
          if (this.scrubJobDoc) {
            foundDocs = foundDocs.map(d => this.scrubJobDoc!(d));
          }
          check(docs, [validJobDoc()]);
          docs.push(...foundDocs);
        }
      }
    }

    return docs;
  }

  async _DDPMethod_jobRemove(ids: JobId | JobId[], options: any = {}): Promise<boolean> {
    check(ids, Match.OneOf(Match.Where(isValidId), [Match.Where(isValidId)]));
    check(options, Match.Optional({}));

    const idsArray = Array.isArray(ids) ? ids : [ids];
    
    if (idsArray.length === 0) {
      return false;
    }

    const num = await this.removeAsync({
      _id: { $in: idsArray },
      status: { $in: this.jobStatusRemovable as any }
    });

    if (num > 0) {
      return true;
    } else {
      console.warn('jobRemove failed');
    }
    
    return false;
  }

  async _DDPMethod_jobPause(ids: JobId | JobId[], options: any = {}): Promise<boolean> {
    check(ids, Match.OneOf(Match.Where(isValidId), [Match.Where(isValidId)]));
    check(options, Match.Optional({}));

    const idsArray = Array.isArray(ids) ? ids : [ids];
    
    if (idsArray.length === 0) {
      return false;
    }

    const time = new Date();
    const mods: any = {
      $set: {
        status: 'paused',
        updated: time
      }
    };

    const logObj = this._logMessage.paused();
    if (logObj) {
      mods.$push = { log: logObj };
    }

    const num = await this.updateAsync(
      {
        _id: { $in: idsArray },
        status: { $in: this.jobStatusPausable as any }
      },
      mods,
      { multi: true }
    );

    if (num > 0) {
      return true;
    } else {
      console.warn('jobPause failed');
    }
    
    return false;
  }

  async _DDPMethod_jobResume(ids: JobId | JobId[], options: any = {}): Promise<boolean> {
    check(ids, Match.OneOf(Match.Where(isValidId), [Match.Where(isValidId)]));
    check(options, Match.Optional({}));

    const idsArray = Array.isArray(ids) ? ids : [ids];
    
    if (idsArray.length === 0) {
      return false;
    }

    const time = new Date();
    const mods: any = {
      $set: {
        status: 'waiting',
        updated: time
      }
    };

    const logObj = this._logMessage.resumed();
    if (logObj) {
      mods.$push = { log: logObj };
    }

    const num = await this.updateAsync(
      {
        _id: { $in: idsArray },
        status: 'paused',
        updated: { $ne: time }
      },
      mods,
      { multi: true }
    );

    if (num > 0) {
      await this._DDPMethod_jobReady(idsArray);
      return true;
    } else {
      console.warn('jobResume failed');
    }
    
    return false;
  }

  async _DDPMethod_jobReady(ids: JobId | JobId[] = [], options: ReadyJobsOptions = {}): Promise<boolean> {
    check(ids, Match.OneOf(Match.Where(isValidId), [Match.Where(isValidId)]));
    check(
      options,
      Match.Optional({
        force: Match.Optional(Boolean),
        time: Match.Optional(Date)
      })
    );

    const now = new Date();
    const opts = options ?? {};
    opts.force = opts.force ?? false;
    opts.time = opts.time ?? now;

    const idsArray: JobId[] = Array.isArray(ids) ? ids : [ids];

    const query: any = {
      status: 'waiting',
      after: { $lte: opts.time }
    };

    const mods: any = {
      $set: {
        status: 'ready',
        updated: now
      }
    };

    if (idsArray.length > 0) {
      query._id = { $in: idsArray };
      mods.$set.after = now;
    }

    const logObj: JobLogEntry[] = [];

    if (opts.force) {
      mods.$set.depends = [];
      const l = this._logMessage.forced(idsArray[0]);
      if (l) logObj.push(l);
    } else {
      query.depends = { $size: 0 };
    }

    const l = this._logMessage.readied();
    if (l) logObj.push(l);

    if (logObj.length > 0) {
      mods.$push = {
        log: { $each: logObj }
      };
    }

    const num = await this.updateAsync(query, mods, { multi: true });

    return num > 0;
  }

  async _DDPMethod_jobCancel(ids: JobId | JobId[], options: any = {}): Promise<boolean> {
    check(ids, Match.OneOf(Match.Where(isValidId), [Match.Where(isValidId)]));
    check(
      options,
      Match.Optional({
        antecedents: Match.Optional(Boolean),
        dependents: Match.Optional(Boolean)
      })
    );

    const opts: any = options ?? {};
    opts.antecedents = opts.antecedents ?? false;
    opts.dependents = opts.dependents ?? true;

    const idsArray = Array.isArray(ids) ? ids : [ids];
    
    if (idsArray.length === 0) {
      return false;
    }

    const time = new Date();
    const mods: any = {
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

    const num = await this.updateAsync(
      {
        _id: { $in: idsArray },
        status: { $in: this.jobStatusCancellable as any }
      },
      mods,
      { multi: true }
    );

    const cancelIds = this._idsOfDeps(idsArray, opts.antecedents, opts.dependents, this.jobStatusCancellable);

    let depsCancelled = false;
    if (cancelIds.length > 0) {
      depsCancelled = await this._DDPMethod_jobCancel(cancelIds, opts);
    }

    if (num > 0 || depsCancelled) {
      return true;
    } else {
      console.warn('jobCancel failed');
    }
    
    return false;
  }

  async _DDPMethod_jobRestart(ids: JobId | JobId[], options: any = {}): Promise<boolean> {
    check(ids, Match.OneOf(Match.Where(isValidId), [Match.Where(isValidId)]));
    check(
      options,
      Match.Optional({
        retries: Match.Optional(Match.Where(validIntGTEZero)),
        until: Match.Optional(Date),
        antecedents: Match.Optional(Boolean),
        dependents: Match.Optional(Boolean)
      })
    );

    const opts: any = options ?? {};
    opts.retries = opts.retries ?? 1;
    opts.retries = Math.min(opts.retries, this.forever);
    opts.dependents = opts.dependents ?? false;
    opts.antecedents = opts.antecedents ?? true;

    const idsArray = Array.isArray(ids) ? ids : [ids];
    
    if (idsArray.length === 0) {
      return false;
    }

    const time = new Date();
    const query: any = {
      _id: { $in: idsArray },
      status: { $in: this.jobStatusRestartable as any }
    };

    const mods: any = {
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

    const restartIds = this._idsOfDeps(idsArray, opts.antecedents!, opts.dependents!, this.jobStatusRestartable);

    let depsRestarted = false;
    if (restartIds.length > 0) {
      depsRestarted = await this._DDPMethod_jobRestart(restartIds, opts);
    }

    if (num > 0 || depsRestarted) {
      await this._DDPMethod_jobReady(idsArray);
      return true;
    } else {
      console.warn('jobRestart failed');
    }
    
    return false;
  }

  async _DDPMethod_jobSave(doc: JobDocument, options: any = {}): Promise<JobId | false | null> {
    check(doc, validJobDoc());
    check(
      options,
      Match.Optional({
        cancelRepeats: Match.Optional(Boolean)
      })
    );
    check(doc.status, Match.Where((v) => Match.test(v, String) && ['waiting', 'paused'].includes(v)));

    const opts: any = options ?? {};
    opts.cancelRepeats = opts.cancelRepeats ?? false;
    doc.repeats = Math.min(doc.repeats, this.forever);
    doc.retries = Math.min(doc.retries, this.forever);

    const time = new Date();

    // Adjust times if they're in the past
    if (doc.after < time) doc.after = time;
    if (doc.retryUntil < time) doc.retryUntil = time;
    if (doc.repeatUntil < time) doc.repeatUntil = time;

    // Handle later.js scheduling
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
    } else if (!this.later && typeof doc.repeatWait !== 'number') {
      console.warn('Later.js not loaded...');
      return null;
    }

    if (doc._id) {
      // Update existing job
      const mods: any = {
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

      const num = await this.updateAsync(
        {
          _id: doc._id,
          status: 'paused',
          runId: null
        },
        mods
      );

      if (num && (await this._checkDeps(doc, false))) {
        await this._DDPMethod_jobReady(doc._id);
        return doc._id;
      } else {
        return null;
      }
    } else {
      // Insert new job
      if (doc.repeats === this.forever && opts.cancelRepeats) {
        // Cancel any existing jobs of the same type
        const existingJobs = await this.find(
          {
            type: doc.type,
            status: { $in: this.jobStatusCancellable as any }
          },
          { transform: null }
        ).fetchAsync();

        for (const d of existingJobs) {
          await this._DDPMethod_jobCancel(d._id!, {});
        }
      }

      doc.created = time;
      doc.log!.push(this._logMessage.submitted());
      doc._id = await this.insertAsync(doc);

      if (doc._id && (await this._checkDeps(doc, false))) {
        await this._DDPMethod_jobReady(doc._id);
        return doc._id;
      } else {
        return null;
      }
    }
  }

  async _DDPMethod_jobProgress(id: JobId, runId: JobId, completed: number, total: number, options: any = {}): Promise<boolean | null> {
    check(id, Match.Where(isValidId));
    check(runId, Match.Where(isValidId));
    check(completed, Match.Where(validNumGTEZero));
    check(total, Match.Where(validNumGTZero));
    check(options, Match.Optional({}));

    const progress = {
      completed,
      total,
      percent: (100 * completed) / total
    };

    check(
      progress,
      Match.Where((v: any) => v.total >= v.completed && v.percent >= 0 && v.percent <= 100)
    );

    const time = new Date();
    const job = await this.findOneAsync({ _id: id }, { fields: { workTimeout: 1 } });

    const mods: any = {
      $set: {
        progress,
        updated: time
      }
    };

    if (job?.workTimeout) {
      mods.$set.expiresAfter = new Date(time.valueOf() + job.workTimeout);
    }

    const num = await this.updateAsync(
      {
        _id: id,
        runId: runId,
        status: 'running'
      },
      mods
    );

    if (num === 1) {
      return true;
    } else {
      console.warn('jobProgress failed');
    }
    
    return false;
  }

  async _DDPMethod_jobLog(id: JobId, runId: JobId | null, message: string, options: any = {}): Promise<boolean> {
    check(id, Match.Where(isValidId));
    check(runId, Match.OneOf(Match.Where(isValidId), null));
    check(message, String);
    check(
      options,
      Match.Optional({
        level: Match.Optional(Match.Where(validLogLevel)),
        data: Match.Optional(Object)
      })
    );

    const opts: any = options ?? {};
    const time = new Date();
    const logObj: JobLogEntry = {
      time,
      runId,
      level: opts.level ?? 'info',
      message
    };
    
    if (opts.data) {
      logObj.data = opts.data;
    }

    const job = await this.findOneAsync({ _id: id }, { fields: { status: 1, workTimeout: 1 } });

    const mods: any = {
      $push: { log: logObj },
      $set: { updated: time }
    };

    if (job?.workTimeout && job.status === 'running') {
      mods.$set.expiresAfter = new Date(time.valueOf() + job.workTimeout);
    }

    const num = await this.updateAsync({ _id: id }, mods);
    
    if (num === 1) {
      return true;
    } else {
      console.warn('jobLog failed');
    }
    
    return false;
  }

  async _DDPMethod_jobRerun(id: JobId, options: any = {}): Promise<JobId | false> {
    check(id, Match.Where(isValidId));
    check(
      options,
      Match.Optional({
        repeats: Match.Optional(Match.Where(validIntGTEZero)),
        until: Match.Optional(Date),
        wait: Match.OneOf(Match.Where(validIntGTEZero), Match.Where(validLaterJSObj))
      })
    );

    const opts: any = options ?? {};
    const doc = await this.findOneAsync(
      { _id: id, status: 'completed' },
      {
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
      }
    );

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

  async _DDPMethod_jobDone(id: JobId, runId: JobId, result: any, options: any = {}): Promise<boolean | JobId> {
    check(id, Match.Where(isValidId));
    check(runId, Match.Where(isValidId));
    check(result, Object);
    check(
      options,
      Match.Optional({
        repeatId: Match.Optional(Boolean),
        delayDeps: Match.Optional(Match.Where(validIntGTEZero))
      })
    );

    const opts: any = options ?? {};
    opts.repeatId = opts.repeatId ?? false;

    const time = new Date();
    const doc = await this.findOneAsync(
      {
        _id: id,
        runId: runId,
        status: 'running'
      },
      {
        fields: {
          log: 0,
          failures: 0,
          updated: 0,
          after: 0,
          status: 0
        },
        transform: null
      }
    );

    if (!doc) {
      console.warn('Running job not found', id, runId);
      return false;
    }

    const mods: any = {
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

    const num = await this.updateAsync(
      {
        _id: id,
        runId: runId,
        status: 'running'
      },
      mods
    );

    if (num === 1) {
      let jobId: JobId | null = null;

      // Handle repeating jobs
      if (doc.repeats > 0) {
        if (typeof doc.repeatWait === 'number') {
          if (doc.repeatUntil.valueOf() - doc.repeatWait >= time.valueOf()) {
            jobId = await this._rerun_job(doc);
          }
        } else {
          // Later.js scheduling
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

      // Resolve dependencies
      const ids = (
        await this.find(
          { depends: { $all: [id] } },
          {
            transform: null,
            fields: { _id: 1 }
          }
        ).fetchAsync()
      ).map((d: any) => d._id);

      if (ids.length > 0) {
        const depMods: any = {
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

        const n = await this.updateAsync(
          { _id: { $in: ids } },
          depMods,
          { multi: true }
        );

        if (n !== ids.length) {
          console.warn(`Not all dependent jobs were resolved ${ids.length} > ${n}`);
        }

        await this._DDPMethod_jobReady(ids);
      }

      if (opts.repeatId && jobId) {
        return jobId;
      } else {
        return true;
      }
    } else {
      console.warn('jobDone failed');
    }
    
    return false;
  }

  async _DDPMethod_jobFail(id: JobId, runId: JobId, err: any, options: any = {}): Promise<boolean> {
    check(id, Match.Where(isValidId));
    check(runId, Match.Where(isValidId));
    check(err, Object);
    check(
      options,
      Match.Optional({
        fatal: Match.Optional(Boolean)
      })
    );

    const opts: any = options ?? {};
    opts.fatal = opts.fatal ?? false;

    const time = new Date();
    const doc = await this.findOneAsync(
      {
        _id: id,
        runId: runId,
        status: 'running'
      },
      {
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
      }
    );

    if (!doc) {
      console.warn('Running job not found', id, runId);
      return false;
    }

    const after =
      doc.retryBackoff === 'exponential'
        ? new Date(time.valueOf() + doc.retryWait * Math.pow(2, doc.retried - 1))
        : new Date(time.valueOf() + doc.retryWait);

    const newStatus = !opts.fatal && doc.retries > 0 && doc.retryUntil >= after ? 'waiting' : 'failed';

    const errorObj = err as any;
    errorObj.runId = runId;

    const mods: any = {
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

    const num = await this.updateAsync(
      {
        _id: id,
        runId: runId,
        status: 'running'
      },
      mods
    );

    if (newStatus === 'failed' && num === 1) {
      // Cancel dependent jobs
      const dependentJobs = await this.find(
        { depends: { $all: [id] } },
        { transform: null }
      ).fetchAsync();

      for (const d of dependentJobs) {
        await this._DDPMethod_jobCancel(d._id!);
      }
    }

    if (num === 1) {
      return true;
    } else {
      console.warn('jobFail failed');
    }
    
    return false;
  }
}

// Share with server and client
if (typeof share !== 'undefined') {
  share.JobCollectionBase = JobCollectionBase;
}

export { JobCollectionBase as JobCollection };

