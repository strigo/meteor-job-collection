/* eslint-disable @typescript-eslint/ban-types */
////////////////////////////////////////////////////////////////////////////
//     Copyright (C) 2014-2017 by Vaughn Iverson
//     job-collection is free software released under the MIT/X11 license.
//     See included LICENSE file for details.
////////////////////////////////////////////////////////////////////////////

import { EventEmitter } from 'events';
import { JobCollectionBase } from './shared';
import { Job } from './job/job-class';
import type { AllowDenyRules, EventMessage, Callback } from './types';
import { validIntGTEOne } from './utils/validators';

declare const share: any;

/**
 * Helper to format user identity for logging
 */
function userHelper(user: string | null | undefined, connection: any): string {
  let ret = user ?? '[UNAUTHENTICATED]';
  if (!connection) {
    ret = '[SERVER]';
  }
  return ret;
}

/**
 * Server-side JobCollection class
 */
class JobCollectionServer extends JobCollectionBase {
  events!: EventEmitter;
  stopped: boolean | number = true;
  logStream: any = null;
  allows: Record<string, any[]> = {};
  denys: Record<string, any[]> = {};
  isSimulation = false;
  interval?: any;
  private _localServerMethods?: Record<string, Function>;
  private _ddp_apply?: Function;

  constructor(root: string = 'queue', options: any = {}) {
    // Support calling without new
    if (!(new.target)) {
      return new JobCollectionServer(root, options);
    }

    // Call super constructor
    super(root, options);

    this.events = new EventEmitter();

    this.events.on('error', this._onError.bind(this));
    this.events.on('error', (msg: EventMessage) => {
      this.events.emit(msg.method, msg);
    });
    this.events.on('call', this._onCall.bind(this));
    this.events.on('call', (msg: EventMessage) => {
      this.events.emit(msg.method, msg);
    });

    this.stopped = true;

    // Set up server-side _toLog
    this._toLog = this._toLogServer.bind(this);

    // No client mutators allowed
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

    // Initialize allow/deny lists for permission levels and ddp methods
    for (const level of [...this.ddpPermissionLevels, ...this.ddpMethods]) {
      this.allows[level] = [];
      this.denys[level] = [];
    }

    // If a connection option is given, then this JobCollection is actually hosted
    // remotely, so don't establish local and remotely callable server methods in that case
    if (!options.connection) {
      // Default indexes, only when not remotely connected!
      this.createIndexAsync({ type: 1, status: 1 }).catch((err: Error) => {
        console.warn('Failed to create index:', err);
      });
      this.createIndexAsync({ priority: 1, retryUntil: 1, after: 1 }).catch((err: Error) => {
        console.warn('Failed to create index:', err);
      });

      this.isSimulation = false;
      const localMethods = this._generateMethods();
      this._localServerMethods = {};

      for (const [methodName, methodFunction] of Object.entries(localMethods)) {
        this._localServerMethods[methodName] = methodFunction;
      }

      // Create local async DDP apply function
      this._ddp_apply = async (name: string, params: any[], cb?: Callback) => {
        if (cb) {
          Meteor.setTimeout(async () => {
            let err: Error | null = null;
            let res: any = null;
            try {
              res = await this._localServerMethods![name](...params);
            } catch (e) {
              err = e as Error;
            }
            cb(err, res);
          }, 0);
        } else {
          return await this._localServerMethods![name](...params);
        }
      };

      Job._setDDPApply(this._ddp_apply as any, root);

      const meteorMethods: Record<string, (...args: any[]) => any> = {};
      for (const [key, value] of Object.entries(localMethods)) {
        meteorMethods[key] = value as any;
      }
      Meteor.methods(meteorMethods);
    }
  }

  private _onError(msg: EventMessage): void {
    const user = userHelper(msg.userId, msg.connection);
    this._toLogServer(user, msg.method, `${msg.error}`);
  }

  private _onCall(msg: EventMessage): void {
    const user = userHelper(msg.userId, msg.connection);
    this._toLogServer(user, msg.method, 'params: ' + JSON.stringify(msg.params));
    this._toLogServer(user, msg.method, 'returned: ' + JSON.stringify(msg.returnVal));
  }

  private _toLogServer(userId: string, method: string, message: string): void {
    if (this.logStream && this.logStream.write) {
      this.logStream.write(`${new Date()}, ${userId}, ${method}, ${message}\n`);
    }
  }

  private _emit(
    method: string,
    connection: any,
    userId: string | null,
    err: Error | null,
    ret: any,
    ...params: any[]
  ): void {
    if (err) {
      this.events.emit('error', {
        error: err,
        method,
        connection,
        userId,
        params,
        returnVal: null
      });
    } else {
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

  _methodWrapper(method: string, func: Function): Function {
    const self = this;

    const myTypeof = (val: any): string => {
      const type = typeof val;
      if (type === 'object' && val instanceof Array) {
        return 'array';
      }
      return type;
    };

    const permitted = (userId: string | null, params: any[]): boolean => {
      const performTest = (tests: any[]): boolean => {
        let result = false;
        for (const test of tests) {
          if (result) break;
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

      const performAllTests = (allTests: Record<string, any[]>): boolean => {
        let result = false;
        const permissions = this.ddpMethodPermissions[method as keyof typeof this.ddpMethodPermissions];
        const permArray = Array.from(permissions as readonly string[]);
        for (const t of permArray) {
          if (result) break;
          result = result || performTest(allTests[t]);
        }
        return result;
      };

      return !performAllTests(this.denys) && performAllTests(this.allows);
    };

    // Return the wrapper function that the Meteor method will actually invoke
    return function(this: any, ...params: any[]) {
      try {
        let retval: any;
        if (!this.connection || permitted(this.userId, params)) {
          retval = func(...params);
        } else {
          const err = new Meteor.Error(
            403,
            'Method not authorized',
            'Authenticated user is not permitted to invoke this method.'
          );
          throw err;
        }
        self._emit(method, this.connection, this.userId, null, retval, ...params);
        return retval;
      } catch (err) {
        self._emit(method, this.connection, this.userId, err as Error, null, ...params);
        throw err;
      }
    };
  }

  override setLogStream(writeStream: any = null): void {
    if (this.logStream) {
      throw new Error('logStream may only be set once per job-collection startup/shutdown cycle');
    }
    this.logStream = writeStream;
    if (
      this.logStream &&
      (!this.logStream.write ||
        typeof this.logStream.write !== 'function' ||
        !this.logStream.end ||
        typeof this.logStream.end !== 'function')
    ) {
      throw new Error('logStream must be a valid writable node.js Stream');
    }
  }

  // Register application allow rules
  setJobAllow(allowOptions: AllowDenyRules): void {
    for (const [type, func] of Object.entries(allowOptions)) {
      if (type in this.allows) {
        this.allows[type].push(func);
      }
    }
  }

  // Register application deny rules
  setJobDeny(denyOptions: AllowDenyRules): void {
    for (const [type, func] of Object.entries(denyOptions)) {
      if (type in this.denys) {
        this.denys[type].push(func);
      }
    }
  }


  // Hook function to sanitize documents before validating them in getWork() and getJob()
  declare scrubJobDoc?: (job: any) => any;

  override promote(milliseconds = 15 * 1000): void {
    if (typeof milliseconds === 'number' && milliseconds > 0) {
      if (this.interval) {
        Meteor.clearInterval(this.interval);
      }
      this._promote_jobs();
      this.interval = Meteor.setInterval(this._promote_jobs.bind(this), milliseconds);
    } else {
      console.warn(`jobCollection.promote: invalid timeout: ${this.root}, ${milliseconds}`);
    }
  }

  private async _promote_jobs(_ids: any[] = []): Promise<void> {
    if (this.stopped) {
      return;
    }

    // This looks for zombie running jobs and autofails them
    const zombieJobs = await this.find({
      status: 'running',
      expiresAfter: { $lt: new Date() }
    }).fetchAsync();

    for (const job of zombieJobs) {
      const jobInstance = new Job(this.root, job);
      await jobInstance.fail('Failed for exceeding worker set workTimeout');
    }

    // Change jobs from waiting to ready when their time has come
    // and dependencies have been satisfied
    await this.readyJobs();
  }

  // Override DDP methods to handle server-specific logic

  override async _DDPMethod_startJobServer(options: any = {}): Promise<boolean> {
    check(options, Match.Optional({}));

    if (this.stopped && this.stopped !== true) {
      Meteor.clearTimeout(this.stopped as number);
    }
    this.stopped = false;

    return true;
  }

  override async _DDPMethod_shutdownJobServer(options: any = {}): Promise<boolean> {
    check(
      options,
      Match.Optional({
        timeout: Match.Optional(Match.Where(validIntGTEOne))
      })
    );

    const opts: any = options ?? {};
    opts.timeout = opts.timeout ?? 60 * 1000;

    if (this.stopped && this.stopped !== true) {
      Meteor.clearTimeout(this.stopped as number);
    }

    const timeoutMs = opts.timeout;
    this.stopped = Meteor.setTimeout(async () => {
      const runningJobs = await this.find(
        { status: 'running' },
        { transform: null }
      ).fetchAsync();

      const failedJobs = runningJobs.length;
      if (failedJobs !== 0) {
        console.warn(`Failing ${failedJobs} jobs on queue stop.`);
      }

      for (const d of runningJobs) {
        await this._DDPMethod_jobFail(d._id!, d.runId!, 'Running at Job Server shutdown.');
      }

      if (this.logStream) {
        this.logStream.end();
        this.logStream = null;
      }
    }, timeoutMs) as any;

    return true;
  }

  override async _DDPMethod_getWork(type: any, options: any = {}): Promise<any> {
    // Don't simulate getWork on client
    if (this.isSimulation) {
      return [];
    }

    // Don't put out any more jobs while shutting down
    if (this.stopped) {
      return [];
    }

    return super._DDPMethod_getWork(type, options);
  }

  override async _DDPMethod_jobReady(ids: any = [], options: any = {}): Promise<boolean> {
    // Don't simulate jobReady on client. It has a strong chance of causing issues with
    // Meteor on the client, particularly if an observeChanges() is triggering
    // a processJobs queue (which in turn sets timers.)
    if (this.isSimulation) {
      return false;
    }

    return super._DDPMethod_jobReady(ids, options);
  }
}

// Export with consistent name
export { JobCollectionServer as JobCollection };

// Share with the rest of the package
if (typeof share !== 'undefined') {
  share.JobCollection = JobCollectionServer;
}

// Also set as global for backward compatibility
if (typeof Meteor !== 'undefined' && Meteor.isServer) {
  (global as any).JobCollection = JobCollectionServer;
}

