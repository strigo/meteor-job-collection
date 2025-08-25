# CoffeeScript to JavaScript Conversion Guide

## Overview

This document provides a comprehensive guide for converting the meteor-job-collection package from CoffeeScript to modern JavaScript (ES6+).

## Conversion Strategy

### Step 1: Automated Conversion

Use `decaffeinate` for initial conversion:

```bash
# Convert all CoffeeScript files
decaffeinate src/shared.coffee --use-cs2 --loose
decaffeinate src/server.coffee --use-cs2 --loose
decaffeinate src/client.coffee --use-cs2 --loose
decaffeinate job/src/job_class.coffee --use-cs2 --loose
decaffeinate test/job_collection_tests.coffee --use-cs2 --loose
```

### Step 2: Manual Cleanup and Modernization

The automated conversion produces working but verbose JavaScript. Manual cleanup is essential for maintainability.

## Common Conversion Patterns

### 1. Class Definitions

**CoffeeScript:**
```coffeescript
class JobCollection extends share.JobCollectionBase
  constructor: (@root = 'queue', options = {}) ->
    unless @ instanceof JobCollection
      return new JobCollection(@root, options)
    super @root, options
    @stopped = true
```

**Modern JavaScript:**
```javascript
class JobCollection extends JobCollectionBase {
  constructor(root = 'queue', options = {}) {
    // Handle new-less constructor calls
    if (!(this instanceof JobCollection)) {
      return new JobCollection(root, options);
    }
    
    super(root, options);
    this.root = root;
    this.stopped = true;
  }
}
```

### 2. Fat Arrow Functions

**CoffeeScript:**
```coffeescript
_onError: (msg) =>
  user = userHelper msg.userId, msg.connection
  @_toLog user, msg.method, "#{msg.error}"
```

**Modern JavaScript:**
```javascript
_onError = (msg) => {
  const user = userHelper(msg.userId, msg.connection);
  this._toLog(user, msg.method, `${msg.error}`);
}
```

### 3. Default Parameters

**CoffeeScript:**
```coffeescript
methodCall = (root, method, params, cb, after = ((ret) -> ret)) ->
  # implementation
```

**Modern JavaScript:**
```javascript
const methodCall = (root, method, params, cb, after = (ret) => ret) => {
  // implementation
};
```

### 4. Destructuring

**CoffeeScript:**
```coffeescript
{type, status} = doc
```

**Modern JavaScript:**
```javascript
const { type, status } = doc;
```

### 5. Conditional Assignments

**CoffeeScript:**
```coffeescript
options ?= {}
value = options.value ? defaultValue
```

**Modern JavaScript:**
```javascript
options = options ?? {};
const value = options.value ?? defaultValue;
```

### 6. Array Comprehensions

**CoffeeScript:**
```coffeescript
ids = (job._id for job in jobs when job.status is 'ready')
```

**Modern JavaScript:**
```javascript
const ids = jobs
  .filter(job => job.status === 'ready')
  .map(job => job._id);
```

### 7. String Interpolation

**CoffeeScript:**
```coffeescript
message = "Job #{id} completed with status: #{status}"
```

**Modern JavaScript:**
```javascript
const message = `Job ${id} completed with status: ${status}`;
```

### 8. Existence Checks

**CoffeeScript:**
```coffeescript
if user?
  doSomething()
```

**Modern JavaScript:**
```javascript
if (user != null) {
  doSomething();
}
// Or using optional chaining
user?.doSomething();
```

## File-by-File Conversion Guide

### 1. shared.coffee → shared.js

Key conversions needed:

```javascript
// Convert validation functions
const _validNumGTEZero = (v) => {
  return Match.test(v, Number) && v >= 0.0;
};

const _validNumGTZero = (v) => {
  return Match.test(v, Number) && v > 0.0;
};

// Convert JobCollectionBase class
export class JobCollectionBase extends Mongo.Collection {
  constructor(root = 'queue', options = {}) {
    if (!(this instanceof JobCollectionBase)) {
      return new JobCollectionBase(root, options);
    }

    // Validate Mongo.Collection hasn't been modified
    if (!(this instanceof Mongo.Collection)) {
      throw new Meteor.Error(
        'The global definition of Mongo.Collection has changed since the job-collection package was loaded.'
      );
    }

    const collectionName = options.noCollectionSuffix ? root : `${root}.jobs`;
    
    super(collectionName, options);
    
    this.root = root;
    this.later = later; // later.js object reference
    
    // Initialize properties
    this._createLogEntry = (message = '', runId = null, level = 'info', time = new Date()) => {
      return {
        time,
        runId,
        message,
        level
      };
    };
    
    // Setup permissions
    this.jobLogLevels = ['info', 'success', 'warning', 'danger'];
    this.jobStatuses = ['waiting', 'paused', 'ready', 'running', 'failed', 'cancelled', 'completed'];
    this.jobStatusCancellable = ['running', 'ready', 'waiting', 'paused'];
    this.jobStatusPausable = ['ready', 'waiting'];
    this.jobStatusRemovable = ['cancelled', 'completed', 'failed'];
    this.jobStatusRestartable = ['cancelled', 'failed'];
    
    this.ddpMethods = [
      'startJobServer', 'shutdownJobServer', 'jobRemove',
      'jobPause', 'jobResume', 'jobReady', 'jobCancel',
      'jobRestart', 'jobSave', 'jobRerun', 'getWork', 'getJob',
      'jobLog', 'jobProgress', 'jobDone', 'jobFail'
    ];
    
    this.ddpPermissionLevels = ['admin', 'manager', 'creator', 'worker'];
    
    this.ddpMethodPermissions = {
      'startJobServer': ['startJobServer', 'admin'],
      'shutdownJobServer': ['shutdownJobServer', 'admin'],
      'jobRemove': ['jobRemove', 'admin', 'manager'],
      'jobPause': ['jobPause', 'admin', 'manager'],
      'jobResume': ['jobResume', 'admin', 'manager'],
      'jobReady': ['jobReady', 'admin', 'manager'],
      'jobCancel': ['jobCancel', 'admin', 'manager'],
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
  }

  // Convert methods
  _methodWrapper(method, func) {
    const self = this;
    return async function(...args) {
      try {
        return await func.apply(self, args);
      } catch (err) {
        throw new Meteor.Error('method-error', err.message);
      }
    };
  }
}
```

### 2. server.coffee → server.js

Key server-side conversions:

```javascript
import { Meteor } from 'meteor/meteor';
import { EventEmitter } from 'events';
import { JobCollectionBase } from './shared.js';

const userHelper = (user, connection) => {
  let ret = user ?? "[UNAUTHENTICATED]";
  if (!connection) {
    ret = "[SERVER]";
  }
  return ret;
};

export class JobCollection extends JobCollectionBase {
  constructor(root = 'queue', options = {}) {
    if (!(this instanceof JobCollection)) {
      return new JobCollection(root, options);
    }
    
    super(root, options);
    
    this.events = new EventEmitter();
    this._errorListener = this.events.on('error', this._onError.bind(this));
    this._callListener = this.events.on('call', this._onCall.bind(this));
    
    this.stopped = true;
    
    // Deny all client-side mutations
    this.deny({
      update: () => true,
      insert: () => true,
      remove: () => true
    });
    
    this.logStream = null;
    this.allows = {};
    this.denys = {};
    
    // Initialize allow/deny lists
    const levels = [...this.ddpPermissionLevels, ...this.ddpMethods];
    for (const level of levels) {
      this.allows[level] = [];
      this.denys[level] = [];
    }
    
    // Setup local server methods if not remote
    if (!options.connection) {
      // Create indexes
      this._ensureIndex({ type: 1, status: 1 });
      this._ensureIndex({ priority: 1, retryUntil: 1, after: 1 });
      
      this.isSimulation = false;
      
      const localMethods = this._generateMethods();
      this._localServerMethods = {};
      
      for (const [methodName, methodFunction] of Object.entries(localMethods)) {
        this._localServerMethods[methodName] = methodFunction;
      }
      
      // Setup DDP apply for Job class
      this._ddp_apply = async (name, params, cb) => {
        if (cb && typeof cb === 'function') {
          Meteor.setTimeout(async () => {
            let err = null;
            let res = null;
            try {
              res = await this._localServerMethods[name].apply(this, params);
            } catch (e) {
              err = e;
            }
            cb(err, res);
          }, 0);
        } else {
          return await this._localServerMethods[name].apply(this, params);
        }
      };
      
      Job._setDDPApply(this._ddp_apply, root);
      
      // Register Meteor methods
      Meteor.methods(localMethods);
    }
    
    // Start job promotion
    this.promote();
  }
  
  _onError(msg) {
    const user = userHelper(msg.userId, msg.connection);
    this._toLog(user, msg.method, `${msg.error}`);
  }
  
  _onCall(msg) {
    const user = userHelper(msg.userId, msg.connection);
    this._toLog(user, msg.method, `params: ${JSON.stringify(msg.params)}`);
    this._toLog(user, msg.method, `returned: ${JSON.stringify(msg.returnVal)}`);
  }
  
  _toLog(userId, method, message) {
    if (this.logStream) {
      const timestamp = new Date().toISOString();
      this.logStream.write(`${timestamp} ${userId} ${method} ${message}\n`);
    }
  }
  
  setLogStream(writeStream = null) {
    if (this.logStream) {
      throw new Error('logStream may only be set once per job-collection startup/shutdown cycle');
    }
    this.logStream = writeStream;
    return this;
  }
}
```

### 3. client.coffee → client.js

Client-side specific conversions:

```javascript
import { Meteor } from 'meteor/meteor';
import { JobCollectionBase } from './shared.js';

// Polyfill for older browsers (if needed)
if (!Function.prototype.bind) {
  Function.prototype.bind = function(oThis) {
    if (typeof this !== 'function') {
      throw new TypeError('Function.prototype.bind - what is trying to be bound is not callable');
    }
    
    const aArgs = Array.prototype.slice.call(arguments, 1);
    const fToBind = this;
    const fNOP = function() {};
    const fBound = function() {
      const func = (this instanceof fNOP && oThis) ? this : oThis;
      return fToBind.apply(func, aArgs.concat(Array.prototype.slice.call(arguments)));
    };
    
    fNOP.prototype = this.prototype;
    fBound.prototype = new fNOP();
    return fBound;
  };
}

export class JobCollection extends JobCollectionBase {
  constructor(root = 'queue', options = {}) {
    if (!(this instanceof JobCollection)) {
      return new JobCollection(root, options);
    }
    
    super(root, options);
    
    this.logConsole = false;
    this.isSimulation = true;
    
    // Register methods
    const methods = this._generateMethods();
    if (!options.connection) {
      Meteor.methods(methods);
    } else {
      options.connection.methods(methods);
    }
  }
  
  _toLog(userId, method, message) {
    if (this.logConsole) {
      console.log(`${new Date()}, ${userId}, ${method}, ${message}`);
    }
  }
}
```

### 4. job_class.coffee → job_class.js

Job class conversion with modern patterns:

```javascript
// Utility functions
const methodCall = async (root, method, params, cb, after = (ret) => ret) => {
  const apply = Job._ddp_apply?.[root.root ?? root] ?? Job._ddp_apply;
  if (typeof apply !== 'function') {
    throw new Error('Job remote method call error, no valid invocation method found.');
  }
  
  const name = `${root.root ?? root}_${method}`;
  
  if (cb && typeof cb === 'function') {
    try {
      const res = await apply(name, params);
      cb(null, after(res));
    } catch (err) {
      cb(err);
    }
  } else {
    return after(await apply(name, params));
  }
};

const optionsHelp = (options, cb) => {
  if (cb != null && typeof cb !== 'function') {
    options = cb;
    cb = undefined;
  } else {
    if (!(typeof options === 'object' && 
          options instanceof Array && 
          options.length < 2)) {
      throw new Error('options... in optionsHelp must be an Array with zero or one elements');
    }
    options = options?.[0] ?? {};
  }
  
  if (typeof options !== 'object') {
    throw new Error('in optionsHelp options not an object or bad callback');
  }
  
  return [options, cb];
};

// Main Job class
export class Job {
  static forever = 9007199254740991; // Number.MAX_SAFE_INTEGER
  static foreverDate = new Date(9999, 11, 31);
  static jobPriorities = {
    low: 10,
    normal: 0,
    medium: -5,
    high: -10,
    critical: -15
  };
  static jobRetryBackoffMethods = ['constant', 'exponential'];
  static jobStatuses = ['waiting', 'paused', 'ready', 'running', 'failed', 'cancelled', 'completed'];
  static jobLogLevels = ['info', 'success', 'warning', 'danger'];
  static jobStatusCancellable = ['running', 'ready', 'waiting', 'paused'];
  static jobStatusPausable = ['ready', 'waiting'];
  static jobStatusRemovable = ['cancelled', 'completed', 'failed'];
  static jobStatusRestartable = ['cancelled', 'failed'];
  
  constructor(root, type, data) {
    if (!(this instanceof Job)) {
      return new Job(root, type, data);
    }
    
    this.root = root;
    
    if (typeof type === 'object' && data == null) {
      // Creating from existing document
      this.doc = type;
    } else {
      // Creating new job
      this.type = type;
      this.data = data ?? {};
      this.doc = {
        runId: null,
        type: this.type,
        data: this.data,
        status: 'waiting',
        updated: new Date(),
        created: new Date()
      };
      this._initDoc();
    }
  }
  
  _initDoc() {
    // Initialize document with defaults
    this.doc.priority = this.doc.priority ?? 0;
    this.doc.retries = this.doc.retries ?? Job.forever;
    this.doc.retryWait = this.doc.retryWait ?? 5 * 60 * 1000; // 5 minutes
    this.doc.retryBackoff = this.doc.retryBackoff ?? 'constant';
    this.doc.retryUntil = this.doc.retryUntil ?? Job.foreverDate;
    this.doc.repeats = this.doc.repeats ?? 0;
    this.doc.repeatWait = this.doc.repeatWait ?? 0;
    this.doc.repeatUntil = this.doc.repeatUntil ?? Job.foreverDate;
    this.doc.after = this.doc.after ?? new Date();
    this.doc.progress = this.doc.progress ?? {
      completed: 0,
      total: 1,
      percent: 0
    };
    this.doc.depends = this.doc.depends ?? [];
    this.doc.resolved = this.doc.resolved ?? [];
    this.doc.log = this.doc.log ?? [];
    this.doc.failures = this.doc.failures ?? [];
    this.doc.retried = this.doc.retried ?? 0;
    this.doc.repeated = this.doc.repeated ?? 0;
  }
  
  // Method implementations
  async save(options = {}, cb) {
    [options, cb] = optionsHelp([options], cb);
    
    return await methodCall(
      this.root,
      'jobSave',
      [this.doc, options],
      cb,
      (id) => {
        if (id) {
          this.doc._id = id;
        }
        return id;
      }
    );
  }
  
  async refresh(options = {}, cb) {
    [options, cb] = optionsHelp([options], cb);
    
    if (!this.doc._id) {
      throw new Error('Can only refresh a saved job');
    }
    
    return await methodCall(
      this.root,
      'getJob',
      [this.doc._id, options],
      cb,
      (doc) => {
        if (doc) {
          this.doc = doc;
          return true;
        }
        return false;
      }
    );
  }
  
  priority(level = 0) {
    if (typeof level === 'string' && Job.jobPriorities[level] != null) {
      level = Job.jobPriorities[level];
    }
    
    if (typeof level !== 'number') {
      throw new Error('Invalid priority level');
    }
    
    this.doc.priority = level;
    return this;
  }
  
  retry(options = {}) {
    if (typeof options === 'number') {
      options = { retries: options };
    }
    
    if (options.retries != null) {
      this.doc.retries = options.retries;
    }
    if (options.until != null) {
      this.doc.retryUntil = options.until;
    }
    if (options.wait != null) {
      this.doc.retryWait = options.wait;
    }
    if (options.backoff != null) {
      this.doc.retryBackoff = options.backoff;
    }
    
    return this;
  }
  
  repeat(options = {}) {
    if (typeof options === 'number') {
      options = { repeats: options };
    }
    
    if (options.repeats != null) {
      this.doc.repeats = options.repeats;
    }
    if (options.until != null) {
      this.doc.repeatUntil = options.until;
    }
    if (options.wait != null) {
      this.doc.repeatWait = options.wait;
    }
    if (options.schedule != null) {
      this.doc.repeatWait = options.schedule;
    }
    
    return this;
  }
  
  delay(wait = 0) {
    if (typeof wait !== 'number' || wait < 0) {
      throw new Error('Invalid delay time');
    }
    
    this.doc.after = new Date(new Date().getTime() + wait);
    return this;
  }
  
  after(time = new Date()) {
    if (!(time instanceof Date)) {
      throw new Error('Invalid after time');
    }
    
    this.doc.after = time;
    return this;
  }
  
  depends(jobs = []) {
    if (!Array.isArray(jobs)) {
      jobs = [jobs];
    }
    
    this.doc.depends = jobs.map(job => {
      if (typeof job === 'object' && job.doc?._id) {
        return job.doc._id;
      }
      return job;
    }).filter(id => id != null);
    
    return this;
  }
  
  // Add more async methods...
  async log(message, options = {}, cb) {
    [options, cb] = optionsHelp([options], cb);
    
    if (!this.doc._id || !this.doc.runId) {
      throw new Error('Can only log on a running job');
    }
    
    return await methodCall(
      this.root,
      'jobLog',
      [this.doc._id, this.doc.runId, message, options],
      cb
    );
  }
  
  async progress(completed, total, options = {}, cb) {
    [options, cb] = optionsHelp([options], cb);
    
    if (!this.doc._id || !this.doc.runId) {
      throw new Error('Can only set progress on a running job');
    }
    
    if (typeof completed !== 'number' || typeof total !== 'number') {
      throw new Error('Invalid progress values');
    }
    
    return await methodCall(
      this.root,
      'jobProgress',
      [this.doc._id, this.doc.runId, completed, total, options],
      cb
    );
  }
  
  async done(result = {}, options = {}, cb) {
    [options, cb] = optionsHelp([options], cb);
    
    if (!this.doc._id || !this.doc.runId) {
      throw new Error('Can only finish a running job');
    }
    
    return await methodCall(
      this.root,
      'jobDone',
      [this.doc._id, this.doc.runId, result, options],
      cb
    );
  }
  
  async fail(err = 'Job failed', options = {}, cb) {
    [options, cb] = optionsHelp([options], cb);
    
    if (!this.doc._id || !this.doc.runId) {
      throw new Error('Can only fail a running job');
    }
    
    return await methodCall(
      this.root,
      'jobFail',
      [this.doc._id, this.doc.runId, err, options],
      cb
    );
  }
  
  // Static methods
  static _setDDPApply(apply, root) {
    if (!Job._ddp_apply) {
      Job._ddp_apply = {};
    }
    Job._ddp_apply[root] = apply;
  }
  
  static async processJobs(root, type, options = {}, worker) {
    // Implementation for job processing queue
    // This would be converted from the original CoffeeScript
  }
}

// Export for both Node.js and Meteor
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Job;
}
```

## Best Practices for Conversion

### 1. Use Modern JavaScript Features

- **Arrow functions** for lexical `this` binding
- **Template literals** for string interpolation
- **Destructuring** for cleaner code
- **Default parameters** instead of manual checks
- **Spread operator** for array/object operations
- **Optional chaining** (`?.`) for safe property access
- **Nullish coalescing** (`??`) for default values

### 2. Maintain Backward Compatibility

While converting, ensure the public API remains unchanged:

```javascript
// Keep the same method signatures
class JobCollection {
  // Support both callback and promise-based usage
  async getJob(id, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    
    try {
      const result = await this._getJobAsync(id, options);
      if (callback) callback(null, result);
      return result;
    } catch (err) {
      if (callback) callback(err);
      throw err;
    }
  }
}
```

### 3. Type Safety Considerations

Add JSDoc comments for better IDE support:

```javascript
/**
 * Creates a new Job instance
 * @param {JobCollection|string} root - JobCollection instance or root name
 * @param {string|Object} type - Job type or existing job document
 * @param {Object} [data] - Job data payload
 * @returns {Job} New Job instance
 */
constructor(root, type, data) {
  // implementation
}
```

### 4. Testing During Conversion

Create test files alongside conversion:

```javascript
// test/conversion-tests.js
import { expect } from 'chai';
import { Job } from '../lib/common/job_class.js';

describe('Job Class Conversion', () => {
  it('should create a new job', () => {
    const job = new Job('testQueue', 'testType', { foo: 'bar' });
    expect(job.type).to.equal('testType');
    expect(job.data).to.deep.equal({ foo: 'bar' });
  });
  
  it('should handle newless constructor', () => {
    const job = Job('testQueue', 'testType', {});
    expect(job).to.be.instanceof(Job);
  });
});
```

## Common Pitfalls to Avoid

1. **Incorrect `this` binding**: Use arrow functions or `.bind()` appropriately
2. **Missing async/await**: Ensure all async operations are properly handled
3. **Type coercion differences**: Be explicit with comparisons (`===` vs `==`)
4. **Array method chains**: Ensure proper return values in map/filter/reduce
5. **Default parameter evaluation**: Default parameters are evaluated at call time

## Validation Checklist

- [ ] All CoffeeScript files converted to JavaScript
- [ ] No CoffeeScript syntax remaining
- [ ] Modern ES6+ features used throughout
- [ ] All tests passing
- [ ] ESLint configured and passing
- [ ] Code formatted with Prettier
- [ ] JSDoc comments added for public APIs
- [ ] No console.log statements in production code

## Next Steps

After completing the CoffeeScript conversion:
1. Run the test suite to ensure functionality
2. Begin async/await migration (see next document)
3. Update package.js to remove CoffeeScript dependency
4. Update documentation to reflect JavaScript usage
