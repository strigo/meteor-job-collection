/* eslint-disable @typescript-eslint/ban-types */
////////////////////////////////////////////////////////////////////////////
//     Copyright (C) 2014-2017 by Vaughn Iverson
//     job-collection is free software released under the MIT/X11 license.
//     See included LICENSE file for details.
////////////////////////////////////////////////////////////////////////////

import type { 
  JobType, 
  JobQueueOptions, 
  JobQueueShutdownOptions, 
  WorkerFunction, 
  Callback 
} from '../types';
import { Job } from './job-class';
import {
  isInteger,
  isBoolean,
  isFunction,
  isNonEmptyString,
  isNonEmptyStringOrArrayOfNonEmptyStrings
} from '../utils/validators';
import {
  optionsHelp,
  setImmediate,
  setInterval,
  clearInterval
} from '../utils/callback-helpers';

/**
 * JobQueue class for automatically processing jobs
 */
export class JobQueue {
  root!: string;
  type!: JobType | JobType[];
  worker!: WorkerFunction;
  errorCallback!: (error: Error) => void;
  pollInterval!: number;
  concurrency!: number;
  payload!: number;
  prefetch!: number;
  workTimeout?: number;
  callbackStrict?: boolean;
  
  private _workers: Record<string, Job | Job[]> = {};
  private _tasks: Job[] = [];
  private _taskNumber = 0;
  private _stoppingGetWork?: Callback;
  private _stoppingTasks?: Callback;
  private _interval: any = null;
  private _getWorkOutstanding = false;
  paused = true;

  constructor(
    root: string,
    type: JobType | JobType[],
    options: JobQueueOptions | WorkerFunction,
    worker?: WorkerFunction
  ) {
    // Support both new JobQueue() and JobQueue() without new
    if (!(this instanceof JobQueue)) {
      return new JobQueue(root, type, options, worker);
    }

    // Handle options parameter
    let opts: JobQueueOptions;
    let workerFn: WorkerFunction;
    
    if (typeof options === 'function') {
      workerFn = options;
      opts = {};
    } else {
      const result = optionsHelp<JobQueueOptions>(options, worker!);
      opts = result[0];
      workerFn = result[1] as WorkerFunction;
    }
    
    this.worker = workerFn;

    if (!isNonEmptyString(root)) {
      throw new Error('JobQueue: Invalid root, must be nonempty string');
    }

    if (!isNonEmptyStringOrArrayOfNonEmptyStrings(type)) {
      throw new Error('JobQueue: Invalid type, must be nonempty string or array of nonempty strings');
    }

    if (!isFunction(this.worker)) {
      throw new Error('JobQueue: Invalid worker, must be a function');
    }

    this.root = root;
    this.type = type;

    this.errorCallback = opts.errorCallback ?? ((e: Error) => {
      console.error('JobQueue: ', e);
    });
    
    if (!isFunction(this.errorCallback)) {
      throw new Error('JobQueue: Invalid errorCallback, must be a function');
    }

    // Handle pollInterval: false means Job.forever, undefined means default
    if (opts.pollInterval !== undefined && !opts.pollInterval) {
      this.pollInterval = Job.forever;
    } else if (opts.pollInterval === undefined || !isInteger(opts.pollInterval)) {
      this.pollInterval = 5000; // ms
    } else {
      this.pollInterval = opts.pollInterval;
    }
    
    if (!isInteger(this.pollInterval) || this.pollInterval < 0) {
      throw new Error('JobQueue: Invalid pollInterval, must be a positive integer');
    }

    this.concurrency = opts.concurrency ?? 1;
    if (!isInteger(this.concurrency) || this.concurrency < 0) {
      throw new Error('JobQueue: Invalid concurrency, must be a positive integer');
    }

    this.payload = opts.payload ?? 1;
    if (!isInteger(this.payload) || this.payload < 0) {
      throw new Error('JobQueue: Invalid payload, must be a positive integer');
    }

    this.prefetch = opts.prefetch ?? 0;
    if (!isInteger(this.prefetch) || this.prefetch < 0) {
      throw new Error('JobQueue: Invalid prefetch, must be a positive integer');
    }

    this.workTimeout = opts.workTimeout;
    if (this.workTimeout !== undefined && (!isInteger(this.workTimeout) || this.workTimeout < 0)) {
      throw new Error('JobQueue: Invalid workTimeout, must be a positive integer');
    }

    this.callbackStrict = opts.callbackStrict;
    if (this.callbackStrict !== undefined && !isBoolean(this.callbackStrict)) {
      throw new Error('JobQueue: Invalid callbackStrict, must be a boolean');
    }

    this.resume();
  }

  private async _getWork(): Promise<void> {
    // Don't reenter, or run when paused or stopping
    if (this._getWorkOutstanding || this.paused) {
      return;
    }

    const numJobsToGet = this.prefetch + this.payload * (this.concurrency - this.running()) - this.length();
    
    if (numJobsToGet > 0) {
      this._getWorkOutstanding = true;
      const options: any = { maxJobs: numJobsToGet };
      if (this.workTimeout !== undefined) {
        options.workTimeout = this.workTimeout;
      }

      try {
        const jobs = await Job.getWork(this.root, this.type, options);
        this._getWorkOutstanding = false;
        
        if (jobs && Array.isArray(jobs)) {
          if (jobs.length > numJobsToGet) {
            this.errorCallback(new Error(`getWork() returned jobs (${jobs.length}) in excess of maxJobs (${numJobsToGet})`));
          }
          
          for (const j of jobs) {
            this._tasks.push(j);
            if (!this._stoppingGetWork) {
              setImmediate(this._process.bind(this));
            }
          }
          
          if (this._stoppingGetWork) {
            this._stoppingGetWork();
          }
        } else {
          this.errorCallback(new Error('Nonarray response from server from getWork()'));
        }
      } catch (err) {
        this._getWorkOutstanding = false;
        this.errorCallback(new Error(`Received error from getWork(): ${err}`));
      }
    }
  }

  private _only_once(fn: Function): (...args: any[]) => void {
    let called = false;
    return (...args: any[]) => {
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

  private _process(): void {
    if (!this.paused && this.running() < this.concurrency && this.length()) {
      let job: any;
      
      if (this.payload > 1) {
        job = this._tasks.splice(0, this.payload);
      } else {
        job = this._tasks.shift()!;
      }

      const taskId = `Task_${this._taskNumber++}`;
      if (Array.isArray(job)) {
        for (const j of job) {
          (j as any)._taskId = taskId;
        }
      } else {
        (job as any)._taskId = taskId;
      }
      this._workers[taskId] = job;

      const next = () => {
        delete this._workers[taskId];
        
        if (this._stoppingTasks && this.running() === 0 && this.length() === 0) {
          this._stoppingTasks();
        } else {
          setImmediate(this._process.bind(this));
          setImmediate(this._getWork.bind(this));
        }
      };

      const cb = this._only_once(next);
      this.worker(job, cb);
    }
  }

  private _stopGetWork(callback: Callback): void {
    clearInterval(this._interval);
    this._interval = null;
    
    if (this._getWorkOutstanding) {
      this._stoppingGetWork = callback;
    } else {
      setImmediate(callback); // No Zalgo, thanks
    }
  }

  private _waitForTasks(callback: Callback): void {
    if (this.running() !== 0) {
      this._stoppingTasks = callback;
    } else {
      setImmediate(callback); // No Zalgo, thanks
    }
  }

  private async _failJobs(tasks: any[], callback: Callback): Promise<void> {
    if (tasks.length === 0) {
      setImmediate(callback); // No Zalgo, thanks
      return;
    }

    let count = 0;
    
    for (const job of tasks) {
      try {
        if (Array.isArray(job)) {
          for (const j of job) {
            await j.fail('Worker shutdown');
          }
        } else {
          await job.fail('Worker shutdown');
        }
      } catch (err) {
        console.error('Error failing job during shutdown:', err);
      } finally {
        count++;
        if (count === tasks.length) {
          callback();
        }
      }
    }
  }

  private _hard(callback: Callback): void {
    this.paused = true;
    this._stopGetWork(async () => {
      const tasks: any[] = [...this._tasks];
      this._tasks = [];
      
      for (const [, r] of Object.entries(this._workers)) {
        if (Array.isArray(r)) {
          tasks.push(...r);
        } else {
          tasks.push(r);
        }
      }
      
      await this._failJobs(tasks, callback);
    });
  }

  private _stop(callback: Callback): void {
    this.paused = true;
    this._stopGetWork(() => {
      const tasks = this._tasks;
      this._tasks = [];
      this._waitForTasks(async () => {
        await this._failJobs(tasks, callback);
      });
    });
  }

  private _soft(callback: Callback): void {
    this._stopGetWork(() => {
      this._waitForTasks(callback);
    });
  }

  length(): number {
    return this._tasks.length;
  }

  running(): number {
    return Object.keys(this._workers).length;
  }

  idle(): boolean {
    return this.length() + this.running() === 0;
  }

  full(): boolean {
    return this.running() === this.concurrency;
  }

  pause(): this {
    if (this.paused) {
      return this;
    }

    if (this.pollInterval < Job.forever) {
      clearInterval(this._interval);
      this._interval = null;
    }
    
    this.paused = true;
    return this;
  }

  resume(): this {
    if (!this.paused) {
      return this;
    }

    this.paused = false;
    setImmediate(this._getWork.bind(this));
    
    if (this.pollInterval < Job.forever) {
      this._interval = setInterval(this._getWork.bind(this), this.pollInterval);
    }
    
    for (let w = 1; w <= this.concurrency; w++) {
      setImmediate(this._process.bind(this));
    }
    
    return this;
  }

  trigger(): this {
    if (this.paused) {
      return this;
    }

    setImmediate(this._getWork.bind(this));
    return this;
  }

  shutdown(options?: JobQueueShutdownOptions | Callback, cb?: Callback): void {
    let opts: JobQueueShutdownOptions;
    let callback: Callback | undefined;

    if (typeof options === 'function') {
      callback = options;
      opts = {};
    } else {
      [opts, callback] = optionsHelp<JobQueueShutdownOptions>(options ?? {}, cb);
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
        if (!opts.quiet) console.warn('Shutting down hard');
        this._hard(callback);
        break;
      case 'soft':
        if (!opts.quiet) console.warn('Shutting down soft');
        this._soft(callback);
        break;
      default:
        if (!opts.quiet) console.warn('Shutting down normally');
        this._stop(callback);
    }
  }
}

