# Async/Await Migration Guide

## Overview

Meteor 3.x completely removes Fibers, requiring all server-side code to use async/await. This is the most critical part of the migration, affecting every database operation and DDP method.

## Key Changes Required

### 1. MongoDB Operations

All MongoDB operations must use the new async API:

| Synchronous (Old) | Asynchronous (New) |
|-------------------|-------------------|
| `collection.findOne()` | `await collection.findOneAsync()` |
| `collection.find().fetch()` | `await collection.find().fetchAsync()` |
| `collection.insert()` | `await collection.insertAsync()` |
| `collection.update()` | `await collection.updateAsync()` |
| `collection.upsert()` | `await collection.upsertAsync()` |
| `collection.remove()` | `await collection.removeAsync()` |
| `cursor.count()` | `await cursor.countAsync()` |
| `cursor.forEach()` | `await cursor.forEachAsync()` |
| `collection._ensureIndex()` | `await collection.createIndexAsync()` |

### 2. Meteor Methods

All Meteor methods must be async:

**Before:**
```javascript
Meteor.methods({
  'myJobQueue_jobSave': function(doc, options) {
    check(doc, validJobDoc);
    const result = this.insert(doc);
    return result;
  }
});
```

**After:**
```javascript
Meteor.methods({
  'myJobQueue_jobSave': async function(doc, options) {
    check(doc, validJobDoc);
    const result = await this.insertAsync(doc);
    return result;
  }
});
```

### 3. Method Calls

Replace synchronous calls with async versions:

**Before:**
```javascript
const result = Meteor.call('methodName', params);
```

**After:**
```javascript
const result = await Meteor.callAsync('methodName', params);
```

## File-by-File Async Migration

### 1. server.js - Core Server Implementation

```javascript
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { check, Match } from 'meteor/check';
import { EventEmitter } from 'events';

export class JobCollection extends JobCollectionBase {
  constructor(root = 'queue', options = {}) {
    super(root, options);
    
    // Initialize async methods
    this._initializeAsyncMethods();
    
    // Start promotion with async support
    this._startAsyncPromotion();
  }
  
  _initializeAsyncMethods() {
    // Create async versions of all methods
    this._generateMethods = () => {
      const methods = {};
      
      // Start job server
      methods[`${this.root}_startJobServer`] = async (options = {}) => {
        check(options, Match.Optional({}));
        
        if (!this._checkPermission('startJobServer', this.userId)) {
          throw new Meteor.Error(403, 'Permission denied');
        }
        
        if (this.stopped) {
          this.stopped = false;
          await this._startProcessing();
          return true;
        }
        return false;
      };
      
      // Get work for workers
      methods[`${this.root}_getWork`] = async (type, options = {}) => {
        check(type, Match.OneOf(String, [String]));
        check(options, {
          maxJobs: Match.Optional(Match.Integer),
          workTimeout: Match.Optional(Match.Integer)
        });
        
        const types = Array.isArray(type) ? type : [type];
        const maxJobs = options.maxJobs ?? 1;
        const workTimeout = options.workTimeout ?? 60000; // 60 seconds default
        
        // Find available jobs
        const query = {
          type: { $in: types },
          status: 'ready',
          runId: null,
          after: { $lte: new Date() },
          retries: { $gt: 0 }
        };
        
        const jobs = await this.find(query, {
          sort: { priority: -1, after: 1 },
          limit: maxJobs
        }).fetchAsync();
        
        if (jobs.length === 0) {
          return maxJobs === 1 ? undefined : [];
        }
        
        // Mark jobs as running
        const runId = Random.id();
        const workUntil = new Date(Date.now() + workTimeout);
        
        const jobIds = jobs.map(job => job._id);
        
        const updateResult = await this.updateAsync(
          { _id: { $in: jobIds } },
          {
            $set: {
              status: 'running',
              runId: runId,
              updated: new Date(),
              workUntil: workUntil
            }
          },
          { multi: true }
        );
        
        if (updateResult.modifiedCount > 0) {
          // Fetch updated jobs
          const runningJobs = await this.find({ _id: { $in: jobIds } }).fetchAsync();
          return maxJobs === 1 ? runningJobs[0] : runningJobs;
        }
        
        return maxJobs === 1 ? undefined : [];
      };
      
      // Save job
      methods[`${this.root}_jobSave`] = async (doc, options = {}) => {
        check(doc, validJobDoc);
        check(options, {
          cancelRepeats: Match.Optional(Boolean)
        });
        
        if (!this._checkPermission('jobSave', this.userId)) {
          throw new Meteor.Error(403, 'Permission denied');
        }
        
        // Handle cancel repeats
        if (options.cancelRepeats && doc.repeats === Job.forever) {
          await this.updateAsync(
            {
              type: doc.type,
              status: { $in: ['waiting', 'ready'] },
              repeats: Job.forever
            },
            {
              $set: { status: 'cancelled', updated: new Date() }
            },
            { multi: true }
          );
        }
        
        // Save the job
        if (doc._id) {
          // Update existing job
          const { _id, ...updateDoc } = doc;
          updateDoc.updated = new Date();
          
          await this.updateAsync(_id, { $set: updateDoc });
          return _id;
        } else {
          // Insert new job
          doc.created = new Date();
          doc.updated = new Date();
          doc.status = doc.status ?? 'waiting';
          
          const id = await this.insertAsync(doc);
          return id;
        }
      };
      
      // Mark job as done
      methods[`${this.root}_jobDone`] = async (id, runId, result, options = {}) => {
        check(id, Match.Where(validId));
        check(runId, Match.Where(validId));
        check(result, Match.Any);
        check(options, {
          repeatId: Match.Optional(Boolean),
          delayDeps: Match.Optional(Match.Integer)
        });
        
        const job = await this.findOneAsync({ _id: id, runId: runId });
        
        if (!job) {
          throw new Meteor.Error(404, 'Job not found or not running');
        }
        
        // Update job status
        await this.updateAsync(
          { _id: id },
          {
            $set: {
              status: 'completed',
              result: result,
              progress: { completed: job.progress.total, total: job.progress.total, percent: 100 },
              updated: new Date()
            },
            $unset: { runId: '', workUntil: '' }
          }
        );
        
        // Handle repeating jobs
        if (job.repeats > job.repeated) {
          const newJob = await this._createRepeatJob(job);
          if (options.repeatId) {
            return newJob._id;
          }
        }
        
        // Process dependent jobs
        if (job.depends && job.depends.length > 0) {
          await this._processDependentJobs(id, options.delayDeps);
        }
        
        return true;
      };
      
      // Mark job as failed
      methods[`${this.root}_jobFail`] = async (id, runId, err, options = {}) => {
        check(id, Match.Where(validId));
        check(runId, Match.Where(validId));
        check(err, Match.Any);
        check(options, {
          fatal: Match.Optional(Boolean)
        });
        
        const job = await this.findOneAsync({ _id: id, runId: runId });
        
        if (!job) {
          throw new Meteor.Error(404, 'Job not found or not running');
        }
        
        const failures = job.failures ?? [];
        failures.push({
          runId: runId,
          time: new Date(),
          err: err
        });
        
        const isFatal = options.fatal || job.retried >= job.retries;
        
        if (isFatal) {
          // Job has failed permanently
          await this.updateAsync(
            { _id: id },
            {
              $set: {
                status: 'failed',
                failures: failures,
                updated: new Date()
              },
              $unset: { runId: '', workUntil: '' }
            }
          );
          
          // Cancel dependent jobs
          await this._cancelDependentJobs(id);
        } else {
          // Job will be retried
          const retryWait = this._calculateRetryWait(job);
          const retryTime = new Date(Date.now() + retryWait);
          
          await this.updateAsync(
            { _id: id },
            {
              $set: {
                status: 'waiting',
                failures: failures,
                after: retryTime,
                retried: job.retried + 1,
                updated: new Date()
              },
              $unset: { runId: '', workUntil: '' }
            }
          );
        }
        
        return true;
      };
      
      // Job progress update
      methods[`${this.root}_jobProgress`] = async (id, runId, completed, total, options = {}) => {
        check(id, Match.Where(validId));
        check(runId, Match.Where(validId));
        check(completed, Number);
        check(total, Number);
        
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        
        const result = await this.updateAsync(
          { _id: id, runId: runId },
          {
            $set: {
              progress: {
                completed: completed,
                total: total,
                percent: percent
              },
              updated: new Date()
            }
          }
        );
        
        return result.modifiedCount > 0;
      };
      
      // Add log entry
      methods[`${this.root}_jobLog`] = async (id, runId, message, options = {}) => {
        check(id, Match.Where(validId));
        check(runId, Match.Where(validId));
        check(message, String);
        check(options, {
          level: Match.Optional(Match.Where(validLogLevel)),
          data: Match.Optional(Object),
          echo: Match.Optional(Boolean)
        });
        
        const level = options.level ?? 'info';
        const logEntry = {
          time: new Date(),
          runId: runId,
          level: level,
          message: message
        };
        
        if (options.data) {
          logEntry.data = options.data;
        }
        
        const result = await this.updateAsync(
          { _id: id, runId: runId },
          {
            $push: { log: logEntry },
            $set: { updated: new Date() }
          }
        );
        
        if (options.echo) {
          this._toLog(this.userId, 'jobLog', `${id}: ${message}`);
        }
        
        return result.modifiedCount > 0;
      };
      
      // Get job by ID
      methods[`${this.root}_getJob`] = async (id, options = {}) => {
        check(id, Match.Where(validId));
        check(options, {
          getLog: Match.Optional(Boolean)
        });
        
        const projection = {};
        if (!options.getLog) {
          projection.log = 0;
        }
        
        const job = await this.findOneAsync({ _id: id }, { fields: projection });
        return job;
      };
      
      // Remove jobs
      methods[`${this.root}_jobRemove`] = async (ids, options = {}) => {
        check(ids, Match.OneOf(Match.Where(validId), [Match.Where(validId)]));
        
        const idArray = Array.isArray(ids) ? ids : [ids];
        
        const result = await this.removeAsync({
          _id: { $in: idArray },
          status: { $in: ['cancelled', 'completed', 'failed'] }
        });
        
        return result > 0;
      };
      
      // Pause jobs
      methods[`${this.root}_jobPause`] = async (ids, options = {}) => {
        check(ids, Match.OneOf(Match.Where(validId), [Match.Where(validId)]));
        
        const idArray = Array.isArray(ids) ? ids : [ids];
        
        const result = await this.updateAsync(
          {
            _id: { $in: idArray },
            status: { $in: ['waiting', 'ready'] }
          },
          {
            $set: { status: 'paused', updated: new Date() }
          },
          { multi: true }
        );
        
        return result.modifiedCount > 0;
      };
      
      // Resume jobs
      methods[`${this.root}_jobResume`] = async (ids, options = {}) => {
        check(ids, Match.OneOf(Match.Where(validId), [Match.Where(validId)]));
        
        const idArray = Array.isArray(ids) ? ids : [ids];
        
        const result = await this.updateAsync(
          {
            _id: { $in: idArray },
            status: 'paused'
          },
          {
            $set: { status: 'waiting', updated: new Date() }
          },
          { multi: true }
        );
        
        return result.modifiedCount > 0;
      };
      
      // Cancel jobs
      methods[`${this.root}_jobCancel`] = async (ids, options = {}) => {
        check(ids, Match.OneOf(Match.Where(validId), [Match.Where(validId)]));
        check(options, {
          antecedents: Match.Optional(Boolean),
          dependents: Match.Optional(Boolean)
        });
        
        const idArray = Array.isArray(ids) ? ids : [ids];
        
        // Get jobs to cancel
        const jobs = await this.find({ _id: { $in: idArray } }).fetchAsync();
        
        const allIds = [...idArray];
        
        // Add antecedents
        if (options.antecedents) {
          for (const job of jobs) {
            if (job.depends && job.depends.length > 0) {
              allIds.push(...job.depends);
            }
          }
        }
        
        // Add dependents
        if (options.dependents) {
          const dependentJobs = await this.find({
            depends: { $in: idArray }
          }).fetchAsync();
          
          allIds.push(...dependentJobs.map(j => j._id));
        }
        
        const result = await this.updateAsync(
          {
            _id: { $in: allIds },
            status: { $in: ['waiting', 'ready', 'running', 'paused'] }
          },
          {
            $set: { status: 'cancelled', updated: new Date() },
            $unset: { runId: '', workUntil: '' }
          },
          { multi: true }
        );
        
        return result.modifiedCount > 0;
      };
      
      // Ready jobs
      methods[`${this.root}_jobReady`] = async (ids, options = {}) => {
        check(ids, Match.OneOf(Match.Where(validId), [Match.Where(validId)]));
        check(options, {
          time: Match.Optional(Date),
          force: Match.Optional(Boolean)
        });
        
        const time = options.time ?? new Date();
        const query = { status: 'waiting', after: { $lte: time } };
        
        if (ids.length > 0) {
          const idArray = Array.isArray(ids) ? ids : [ids];
          query._id = { $in: idArray };
        }
        
        if (!options.force) {
          // Check dependencies
          query.$or = [
            { depends: { $size: 0 } },
            { resolved: { $ne: [] } }
          ];
        }
        
        const result = await this.updateAsync(
          query,
          {
            $set: { status: 'ready', updated: new Date() }
          },
          { multi: true }
        );
        
        return result.modifiedCount > 0;
      };
      
      // Restart jobs
      methods[`${this.root}_jobRestart`] = async (ids, options = {}) => {
        check(ids, Match.OneOf(Match.Where(validId), [Match.Where(validId)]));
        check(options, {
          retries: Match.Optional(Match.Integer),
          until: Match.Optional(Date),
          antecedents: Match.Optional(Boolean),
          dependents: Match.Optional(Boolean)
        });
        
        const idArray = Array.isArray(ids) ? ids : [ids];
        
        // Get jobs to restart
        const jobs = await this.find({ _id: { $in: idArray } }).fetchAsync();
        
        const allIds = [...idArray];
        
        // Add antecedents
        if (options.antecedents) {
          for (const job of jobs) {
            if (job.depends && job.depends.length > 0) {
              allIds.push(...job.depends);
            }
          }
        }
        
        // Add dependents
        if (options.dependents) {
          const dependentJobs = await this.find({
            depends: { $in: idArray }
          }).fetchAsync();
          
          allIds.push(...dependentJobs.map(j => j._id));
        }
        
        const update = {
          $set: {
            status: 'waiting',
            retried: 0,
            updated: new Date()
          },
          $unset: { failures: '', runId: '', workUntil: '' }
        };
        
        if (options.retries != null) {
          update.$set.retries = options.retries;
        }
        if (options.until != null) {
          update.$set.retryUntil = options.until;
        }
        
        const result = await this.updateAsync(
          {
            _id: { $in: allIds },
            status: { $in: ['cancelled', 'failed'] }
          },
          update,
          { multi: true }
        );
        
        return result.modifiedCount > 0;
      };
      
      // Rerun job
      methods[`${this.root}_jobRerun`] = async (id, options = {}) => {
        check(id, Match.Where(validId));
        check(options, {
          repeats: Match.Optional(Match.Integer),
          until: Match.Optional(Date),
          wait: Match.Optional(Match.Integer)
        });
        
        const job = await this.findOneAsync({ _id: id, status: 'completed' });
        
        if (!job) {
          throw new Meteor.Error(404, 'Job not found or not completed');
        }
        
        // Create new job based on completed one
        const newJob = {
          type: job.type,
          data: job.data,
          priority: job.priority,
          retries: job.retries,
          retryWait: job.retryWait,
          retryBackoff: job.retryBackoff,
          retryUntil: job.retryUntil,
          repeats: options.repeats ?? 0,
          repeatUntil: options.until ?? Job.foreverDate,
          repeatWait: options.wait ?? 0,
          after: new Date(),
          status: 'waiting',
          created: new Date(),
          updated: new Date()
        };
        
        const newId = await this.insertAsync(newJob);
        return newId;
      };
      
      // Shutdown job server
      methods[`${this.root}_shutdownJobServer`] = async (options = {}) => {
        check(options, {
          timeout: Match.Optional(Match.Integer)
        });
        
        if (!this._checkPermission('shutdownJobServer', this.userId)) {
          throw new Meteor.Error(403, 'Permission denied');
        }
        
        this.stopped = true;
        
        if (options.timeout) {
          // Wait for timeout then fail running jobs
          Meteor.setTimeout(async () => {
            await this.updateAsync(
              { status: 'running' },
              {
                $set: { status: 'failed', updated: new Date() },
                $unset: { runId: '', workUntil: '' }
              },
              { multi: true }
            );
          }, options.timeout);
        }
        
        return true;
      };
      
      return methods;
    };
  }
  
  // Helper methods
  async _startProcessing() {
    // Implementation for starting job processing
    this._promoteJobs();
    this._checkStaleJobs();
  }
  
  async _promoteJobs() {
    if (this.stopped) return;
    
    // Promote waiting jobs to ready
    await this.updateAsync(
      {
        status: 'waiting',
        after: { $lte: new Date() },
        depends: { $size: 0 }
      },
      {
        $set: { status: 'ready', updated: new Date() }
      },
      { multi: true }
    );
    
    // Check for resolved dependencies
    const jobsWithDeps = await this.find({
      status: 'waiting',
      depends: { $ne: [] }
    }).fetchAsync();
    
    for (const job of jobsWithDeps) {
      const completedDeps = await this.find({
        _id: { $in: job.depends },
        status: 'completed'
      }).countAsync();
      
      if (completedDeps === job.depends.length) {
        await this.updateAsync(
          { _id: job._id },
          {
            $set: { 
              status: 'ready', 
              resolved: job.depends,
              updated: new Date() 
            },
            $unset: { depends: '' }
          }
        );
      }
    }
    
    // Schedule next promotion
    if (!this.stopped) {
      Meteor.setTimeout(() => {
        this._promoteJobs();
      }, this.promoteInterval ?? 15000);
    }
  }
  
  async _checkStaleJobs() {
    if (this.stopped) return;
    
    // Find stale running jobs
    const staleJobs = await this.updateAsync(
      {
        status: 'running',
        workUntil: { $lt: new Date() }
      },
      {
        $set: { status: 'failed', updated: new Date() },
        $unset: { runId: '', workUntil: '' },
        $push: {
          failures: {
            time: new Date(),
            err: 'Job timed out'
          }
        }
      },
      { multi: true }
    );
    
    if (staleJobs.modifiedCount > 0) {
      this._toLog('[SERVER]', 'checkStaleJobs', `Failed ${staleJobs.modifiedCount} stale jobs`);
    }
    
    // Schedule next check
    if (!this.stopped) {
      Meteor.setTimeout(() => {
        this._checkStaleJobs();
      }, 30000); // Check every 30 seconds
    }
  }
  
  _calculateRetryWait(job) {
    const base = job.retryWait ?? 5 * 60 * 1000; // 5 minutes default
    
    if (job.retryBackoff === 'exponential') {
      return base * Math.pow(2, job.retried);
    }
    
    return base;
  }
  
  async _createRepeatJob(job) {
    const wait = typeof job.repeatWait === 'number' 
      ? job.repeatWait 
      : this._calculateNextSchedule(job.repeatWait);
    
    const newJob = {
      ...job,
      _id: undefined,
      runId: null,
      status: 'waiting',
      result: undefined,
      failures: [],
      retried: 0,
      repeated: job.repeated + 1,
      after: new Date(Date.now() + wait),
      progress: { completed: 0, total: 1, percent: 0 },
      created: new Date(),
      updated: new Date(),
      log: []
    };
    
    const newId = await this.insertAsync(newJob);
    return { _id: newId };
  }
  
  async _processDependentJobs(completedJobId, delay = 0) {
    const dependentJobs = await this.find({
      depends: completedJobId,
      status: 'waiting'
    }).fetchAsync();
    
    for (const job of dependentJobs) {
      const remainingDeps = job.depends.filter(id => id !== completedJobId);
      
      if (remainingDeps.length === 0) {
        // All dependencies resolved
        const after = delay > 0 ? new Date(Date.now() + delay) : new Date();
        
        await this.updateAsync(
          { _id: job._id },
          {
            $set: { 
              status: 'ready',
              after: after,
              updated: new Date()
            },
            $pull: { depends: completedJobId },
            $push: { resolved: completedJobId }
          }
        );
      } else {
        // Still has dependencies
        await this.updateAsync(
          { _id: job._id },
          {
            $pull: { depends: completedJobId },
            $push: { resolved: completedJobId },
            $set: { updated: new Date() }
          }
        );
      }
    }
  }
  
  async _cancelDependentJobs(failedJobId) {
    const result = await this.updateAsync(
      {
        depends: failedJobId,
        status: { $in: ['waiting', 'ready', 'paused'] }
      },
      {
        $set: { 
          status: 'cancelled',
          updated: new Date()
        }
      },
      { multi: true }
    );
    
    if (result.modifiedCount > 0) {
      this._toLog('[SERVER]', 'cancelDependentJobs', 
        `Cancelled ${result.modifiedCount} dependent jobs of ${failedJobId}`);
    }
  }
  
  _checkPermission(method, userId) {
    // Check allow/deny rules
    const allows = this.allows[method] ?? [];
    const denys = this.denys[method] ?? [];
    
    // Check deny rules first
    for (const denyFunc of denys) {
      if (denyFunc(userId, method)) {
        return false;
      }
    }
    
    // Check allow rules
    for (const allowFunc of allows) {
      if (allowFunc(userId, method)) {
        return true;
      }
    }
    
    // Default deny
    return false;
  }
  
  // Public API methods
  async startJobServer(options = {}) {
    if (Meteor.isClient) {
      return await Meteor.callAsync(`${this.root}_startJobServer`, options);
    } else {
      return await this._localServerMethods[`${this.root}_startJobServer`](options);
    }
  }
  
  async shutdownJobServer(options = {}) {
    if (Meteor.isClient) {
      return await Meteor.callAsync(`${this.root}_shutdownJobServer`, options);
    } else {
      return await this._localServerMethods[`${this.root}_shutdownJobServer`](options);
    }
  }
  
  async getJob(id, options = {}) {
    if (Meteor.isClient) {
      return await Meteor.callAsync(`${this.root}_getJob`, id, options);
    } else {
      return await this._localServerMethods[`${this.root}_getJob`](id, options);
    }
  }
  
  async getWork(type, options = {}) {
    if (Meteor.isClient) {
      return await Meteor.callAsync(`${this.root}_getWork`, type, options);
    } else {
      return await this._localServerMethods[`${this.root}_getWork`](type, options);
    }
  }
  
  processJobs(type, options = {}, worker) {
    // This returns a JobQueue object that manages workers
    return new JobQueue(this, type, options, worker);
  }
}
```

### 2. client.js - Client Implementation

```javascript
import { Meteor } from 'meteor/meteor';

export class JobCollection extends JobCollectionBase {
  constructor(root = 'queue', options = {}) {
    super(root, options);
    
    this.logConsole = false;
    this.isSimulation = true;
    
    // Register async methods
    const methods = this._generateAsyncMethods();
    if (!options.connection) {
      Meteor.methods(methods);
    } else {
      options.connection.methods(methods);
    }
  }
  
  _generateAsyncMethods() {
    const methods = {};
    
    // Client-side method stubs (if needed)
    methods[`${this.root}_jobSave`] = async function(doc, options) {
      // Client-side simulation
      return doc._id ?? Random.id();
    };
    
    // Add other method stubs as needed
    
    return methods;
  }
  
  // Public API methods - all async
  async getJob(id, options = {}, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    
    try {
      const result = await Meteor.callAsync(`${this.root}_getJob`, id, options);
      if (callback) callback(null, result);
      return result;
    } catch (err) {
      if (callback) callback(err);
      throw err;
    }
  }
  
  async getWork(type, options = {}, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    
    try {
      const result = await Meteor.callAsync(`${this.root}_getWork`, type, options);
      if (callback) callback(null, result);
      return result;
    } catch (err) {
      if (callback) callback(err);
      throw err;
    }
  }
}
```

### 3. Job Class Async Updates

```javascript
export class Job {
  // All methods that call server become async
  
  async save(options = {}, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    
    try {
      const id = await methodCall(
        this.root,
        'jobSave',
        [this.doc, options]
      );
      
      if (id) {
        this.doc._id = id;
      }
      
      if (callback) callback(null, id);
      return id;
    } catch (err) {
      if (callback) callback(err);
      throw err;
    }
  }
  
  async refresh(options = {}, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    
    if (!this.doc._id) {
      const err = new Error('Can only refresh a saved job');
      if (callback) callback(err);
      throw err;
    }
    
    try {
      const doc = await methodCall(
        this.root,
        'getJob',
        [this.doc._id, options]
      );
      
      if (doc) {
        this.doc = doc;
      }
      
      const result = !!doc;
      if (callback) callback(null, result);
      return result;
    } catch (err) {
      if (callback) callback(err);
      throw err;
    }
  }
  
  async log(message, options = {}, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    
    try {
      const result = await methodCall(
        this.root,
        'jobLog',
        [this.doc._id, this.doc.runId, message, options]
      );
      
      if (callback) callback(null, result);
      return result;
    } catch (err) {
      if (callback) callback(err);
      throw err;
    }
  }
  
  async progress(completed, total, options = {}, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    
    try {
      const result = await methodCall(
        this.root,
        'jobProgress',
        [this.doc._id, this.doc.runId, completed, total, options]
      );
      
      this.doc.progress = {
        completed: completed,
        total: total,
        percent: Math.round((completed / total) * 100)
      };
      
      if (callback) callback(null, result);
      return result;
    } catch (err) {
      if (callback) callback(err);
      throw err;
    }
  }
  
  async done(result = {}, options = {}, callback) {
    if (typeof result === 'function') {
      callback = result;
      result = {};
      options = {};
    } else if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    
    try {
      const res = await methodCall(
        this.root,
        'jobDone',
        [this.doc._id, this.doc.runId, result, options]
      );
      
      this.doc.status = 'completed';
      this.doc.result = result;
      
      if (callback) callback(null, res);
      return res;
    } catch (err) {
      if (callback) callback(err);
      throw err;
    }
  }
  
  async fail(err = 'Job failed', options = {}, callback) {
    if (typeof err === 'function') {
      callback = err;
      err = 'Job failed';
      options = {};
    } else if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    
    try {
      const result = await methodCall(
        this.root,
        'jobFail',
        [this.doc._id, this.doc.runId, err, options]
      );
      
      this.doc.status = 'failed';
      
      if (callback) callback(null, result);
      return result;
    } catch (err2) {
      if (callback) callback(err2);
      throw err2;
    }
  }
  
  // Status update methods
  async pause(options = {}, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    
    try {
      const result = await methodCall(
        this.root,
        'jobPause',
        [this.doc._id, options]
      );
      
      if (result) {
        this.doc.status = 'paused';
      }
      
      if (callback) callback(null, result);
      return result;
    } catch (err) {
      if (callback) callback(err);
      throw err;
    }
  }
  
  async resume(options = {}, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    
    try {
      const result = await methodCall(
        this.root,
        'jobResume',
        [this.doc._id, options]
      );
      
      if (result) {
        this.doc.status = 'waiting';
      }
      
      if (callback) callback(null, result);
      return result;
    } catch (err) {
      if (callback) callback(err);
      throw err;
    }
  }
  
  async cancel(options = {}, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    
    try {
      const result = await methodCall(
        this.root,
        'jobCancel',
        [this.doc._id, options]
      );
      
      if (result) {
        this.doc.status = 'cancelled';
      }
      
      if (callback) callback(null, result);
      return result;
    } catch (err) {
      if (callback) callback(err);
      throw err;
    }
  }
  
  async restart(options = {}, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    
    try {
      const result = await methodCall(
        this.root,
        'jobRestart',
        [this.doc._id, options]
      );
      
      if (result) {
        this.doc.status = 'waiting';
        this.doc.retried = 0;
      }
      
      if (callback) callback(null, result);
      return result;
    } catch (err) {
      if (callback) callback(err);
      throw err;
    }
  }
  
  async remove(options = {}, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    
    try {
      const result = await methodCall(
        this.root,
        'jobRemove',
        [this.doc._id, options]
      );
      
      if (callback) callback(null, result);
      return result;
    } catch (err) {
      if (callback) callback(err);
      throw err;
    }
  }
}
```

## Testing Async Migration

### 1. Unit Tests

```javascript
import { expect } from 'chai';
import { JobCollection } from '../lib/server/server.js';

describe('Async JobCollection', () => {
  let jc;
  
  beforeEach(async () => {
    jc = new JobCollection('testQueue');
    await jc.removeAsync({});
  });
  
  it('should save a job asynchronously', async () => {
    const job = new Job(jc, 'testType', { foo: 'bar' });
    const id = await job.save();
    
    expect(id).to.be.a('string');
    
    const savedJob = await jc.findOneAsync({ _id: id });
    expect(savedJob.type).to.equal('testType');
    expect(savedJob.data).to.deep.equal({ foo: 'bar' });
  });
  
  it('should get work asynchronously', async () => {
    const job = new Job(jc, 'testType', { test: true });
    await job.save();
    
    // Promote to ready
    await jc.updateAsync(
      { type: 'testType' },
      { $set: { status: 'ready' } }
    );
    
    const work = await jc.getWork('testType');
    expect(work).to.be.an('object');
    expect(work.status).to.equal('running');
  });
  
  it('should handle job completion asynchronously', async () => {
    const job = new Job(jc, 'testType', {});
    await job.save();
    
    // Simulate getting work
    await jc.updateAsync(
      { _id: job.doc._id },
      { 
        $set: { 
          status: 'running',
          runId: 'test-run-id'
        }
      }
    );
    
    job.doc.runId = 'test-run-id';
    
    const result = await job.done({ success: true });
    expect(result).to.be.true;
    
    const completedJob = await jc.findOneAsync({ _id: job.doc._id });
    expect(completedJob.status).to.equal('completed');
    expect(completedJob.result).to.deep.equal({ success: true });
  });
});
```

### 2. Integration Tests

```javascript
describe('Async Worker Processing', () => {
  it('should process jobs with async workers', async () => {
    const jc = new JobCollection('testQueue');
    
    let processedJobs = [];
    
    const queue = jc.processJobs('asyncTest', {
      concurrency: 2,
      pollInterval: 100
    }, async (job, cb) => {
      // Async worker function
      await new Promise(resolve => setTimeout(resolve, 100));
      
      processedJobs.push(job.data);
      await job.done();
      cb();
    });
    
    // Create test jobs
    for (let i = 0; i < 5; i++) {
      const job = new Job(jc, 'asyncTest', { index: i });
      await job.save();
    }
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    queue.shutdown();
    
    expect(processedJobs).to.have.lengthOf(5);
  });
});
```

## Common Async Pitfalls and Solutions

### 1. Forgetting await

**Problem:**
```javascript
// Missing await - won't wait for completion
const job = jc.findOneAsync({ _id: id });
console.log(job.type); // Error: job is a Promise
```

**Solution:**
```javascript
const job = await jc.findOneAsync({ _id: id });
console.log(job.type); // Works correctly
```

### 2. Mixing Callbacks and Promises

**Problem:**
```javascript
// Inconsistent error handling
job.save((err, id) => {
  if (err) throw err; // Won't be caught
  return id;
});
```

**Solution:**
```javascript
// Use async/await consistently
try {
  const id = await job.save();
  return id;
} catch (err) {
  // Handle error properly
  console.error(err);
}
```

### 3. Not Handling Promise Rejections

**Problem:**
```javascript
// Unhandled promise rejection
async function processJob() {
  const job = await getWork(); // May throw
  job.done(); // Missing await
}
```

**Solution:**
```javascript
async function processJob() {
  try {
    const job = await getWork();
    await job.done();
  } catch (err) {
    console.error('Job processing failed:', err);
  }
}
```

## Performance Considerations

### 1. Parallel Operations

Use `Promise.all` for parallel operations:

```javascript
// Process multiple independent operations in parallel
const [job1, job2, job3] = await Promise.all([
  jc.findOneAsync({ _id: id1 }),
  jc.findOneAsync({ _id: id2 }),
  jc.findOneAsync({ _id: id3 })
]);
```

### 2. Batch Processing

```javascript
// Batch update operations
const jobIds = jobs.map(j => j._id);
await jc.updateAsync(
  { _id: { $in: jobIds } },
  { $set: { status: 'ready' } },
  { multi: true }
);
```

### 3. Connection Pooling

Ensure MongoDB connection pool is properly configured:

```javascript
// In settings.json
{
  "packages": {
    "mongo": {
      "options": {
        "poolSize": 10,
        "bufferMaxEntries": 0,
        "useUnifiedTopology": true
      }
    }
  }
}
```

## Migration Checklist

- [ ] All MongoDB operations use `*Async` methods
- [ ] All Meteor methods are `async function`
- [ ] All method calls use `Meteor.callAsync`
- [ ] No `Meteor.wrapAsync` usage
- [ ] No `Promise.await` usage
- [ ] No Fibers references
- [ ] All callbacks converted to async/await
- [ ] Error handling with try/catch blocks
- [ ] Tests updated for async operations
- [ ] Performance testing completed
- [ ] No unhandled promise rejections

## Next Steps

1. Complete async migration in all files
2. Update tests for async behavior
3. Performance testing and optimization
4. Update documentation for async APIs
5. Test with real-world workloads
