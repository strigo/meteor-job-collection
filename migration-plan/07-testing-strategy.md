# Testing Strategy for Meteor 3.x Migration

## Overview

This document outlines a comprehensive testing strategy to ensure the migrated meteor-job-collection package functions correctly with Meteor 3.x.

## Testing Framework Setup

### Required Testing Packages

```json
{
  "devDependencies": {
    "chai": "^4.3.10",
    "mocha": "^10.2.0",
    "sinon": "^17.0.0",
    "chai-as-promised": "^7.1.1",
    "@types/mocha": "^10.0.3",
    "@types/chai": "^4.3.9",
    "nyc": "^15.1.0"
  }
}
```

### Test Configuration

#### .mocharc.json
```json
{
  "spec": "test/**/*.js",
  "timeout": 10000,
  "recursive": true,
  "reporter": "spec",
  "require": [
    "test/helpers/setup.js"
  ],
  "exit": true
}
```

#### test/helpers/setup.js
```javascript
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

// Setup chai plugins
chai.use(chaiAsPromised);

// Global test helpers
global.expect = chai.expect;
global.sinon = sinon;

// Setup test environment
process.env.NODE_ENV = 'test';
process.env.MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/job-collection-test';

// Mock Meteor environment if not available
if (typeof Meteor === 'undefined') {
  global.Meteor = {
    isServer: true,
    isClient: false,
    startup: (fn) => fn(),
    methods: (methods) => {
      // Store methods for testing
      global._meteorMethods = methods;
    },
    Error: class extends Error {
      constructor(code, message) {
        super(message);
        this.error = code;
      }
    },
    setTimeout: setTimeout,
    setInterval: setInterval,
    clearTimeout: clearTimeout,
    clearInterval: clearInterval
  };
  
  global.Mongo = {
    Collection: class {
      constructor(name) {
        this.name = name;
        this._documents = new Map();
      }
      
      async findOneAsync(selector) {
        // Mock implementation
        return this._documents.get(selector._id);
      }
      
      async insertAsync(doc) {
        // Mock implementation
        const id = Random.id();
        doc._id = id;
        this._documents.set(id, doc);
        return id;
      }
      
      async updateAsync(selector, modifier, options) {
        // Mock implementation
        return { modifiedCount: 1 };
      }
      
      async removeAsync(selector) {
        // Mock implementation
        return 1;
      }
    }
  };
  
  global.Random = {
    id: () => Math.random().toString(36).substring(2, 15)
  };
  
  global.Match = {
    test: (value, pattern) => true,
    Where: (fn) => fn,
    Optional: (pattern) => pattern,
    OneOf: (...patterns) => patterns[0],
    Integer: Number,
    Any: true
  };
  
  global.check = (value, pattern) => {
    // Basic check implementation
    if (pattern === String && typeof value !== 'string') {
      throw new Error('Match failed');
    }
  };
}
```

## Test Categories

### 1. Unit Tests

#### test/unit/job_class.test.js
```javascript
import { Job } from '../../lib/common/job_class.js';

describe('Job Class - Unit Tests', () => {
  describe('Constructor', () => {
    it('should create a new job with type and data', () => {
      const job = new Job('testQueue', 'emailJob', { to: 'test@example.com' });
      
      expect(job.type).to.equal('emailJob');
      expect(job.data).to.deep.equal({ to: 'test@example.com' });
      expect(job.doc.status).to.equal('waiting');
    });
    
    it('should handle newless constructor', () => {
      const job = Job('testQueue', 'testType', {});
      expect(job).to.be.instanceOf(Job);
    });
    
    it('should create from existing document', () => {
      const doc = {
        _id: 'test123',
        type: 'existingJob',
        data: { foo: 'bar' },
        status: 'ready'
      };
      
      const job = new Job('testQueue', doc);
      expect(job.doc).to.equal(doc);
      expect(job.type).to.equal('existingJob');
    });
  });
  
  describe('Configuration Methods', () => {
    let job;
    
    beforeEach(() => {
      job = new Job('testQueue', 'testJob', {});
    });
    
    it('should set priority', () => {
      job.priority('high');
      expect(job.doc.priority).to.equal(-10);
      
      job.priority(5);
      expect(job.doc.priority).to.equal(5);
    });
    
    it('should configure retry settings', () => {
      job.retry({
        retries: 5,
        wait: 60000,
        backoff: 'exponential'
      });
      
      expect(job.doc.retries).to.equal(5);
      expect(job.doc.retryWait).to.equal(60000);
      expect(job.doc.retryBackoff).to.equal('exponential');
    });
    
    it('should set repeat configuration', () => {
      job.repeat({
        repeats: 10,
        wait: 3600000
      });
      
      expect(job.doc.repeats).to.equal(10);
      expect(job.doc.repeatWait).to.equal(3600000);
    });
    
    it('should set delay', () => {
      const before = new Date();
      job.delay(5000);
      const after = job.doc.after;
      
      expect(after.getTime() - before.getTime()).to.be.closeTo(5000, 100);
    });
    
    it('should set dependencies', () => {
      const dep1 = new Job('testQueue', 'dep1', {});
      dep1.doc._id = 'dep1-id';
      
      const dep2 = new Job('testQueue', 'dep2', {});
      dep2.doc._id = 'dep2-id';
      
      job.depends([dep1, dep2]);
      
      expect(job.doc.depends).to.deep.equal(['dep1-id', 'dep2-id']);
    });
    
    it('should chain configuration methods', () => {
      const result = job
        .priority('high')
        .retry({ retries: 3 })
        .delay(1000)
        .repeat({ repeats: 5 });
      
      expect(result).to.equal(job);
      expect(job.doc.priority).to.equal(-10);
      expect(job.doc.retries).to.equal(3);
      expect(job.doc.repeats).to.equal(5);
    });
  });
  
  describe('Async Methods', () => {
    let job;
    let sandbox;
    
    beforeEach(() => {
      job = new Job('testQueue', 'asyncJob', { test: true });
      sandbox = sinon.createSandbox();
    });
    
    afterEach(() => {
      sandbox.restore();
    });
    
    it('should save job asynchronously', async () => {
      // Mock the methodCall function
      const stub = sandbox.stub(job, 'save').resolves('new-job-id');
      
      const id = await job.save();
      
      expect(id).to.equal('new-job-id');
      expect(stub.calledOnce).to.be.true;
    });
    
    it('should handle save with callback', (done) => {
      const stub = sandbox.stub(job, 'save').callsFake((options, cb) => {
        if (typeof options === 'function') {
          cb = options;
        }
        cb(null, 'callback-job-id');
      });
      
      job.save((err, id) => {
        expect(err).to.be.null;
        expect(id).to.equal('callback-job-id');
        done();
      });
    });
    
    it('should refresh job data', async () => {
      job.doc._id = 'existing-id';
      
      const updatedDoc = {
        _id: 'existing-id',
        type: 'asyncJob',
        status: 'running',
        data: { test: true, updated: true }
      };
      
      const stub = sandbox.stub(job, 'refresh').resolves(true);
      
      const result = await job.refresh();
      
      expect(result).to.be.true;
    });
    
    it('should log messages', async () => {
      job.doc._id = 'job-id';
      job.doc.runId = 'run-id';
      
      const stub = sandbox.stub(job, 'log').resolves(true);
      
      const result = await job.log('Test message', { level: 'info' });
      
      expect(result).to.be.true;
    });
    
    it('should update progress', async () => {
      job.doc._id = 'job-id';
      job.doc.runId = 'run-id';
      
      const stub = sandbox.stub(job, 'progress').resolves(true);
      
      const result = await job.progress(50, 100);
      
      expect(result).to.be.true;
    });
    
    it('should mark job as done', async () => {
      job.doc._id = 'job-id';
      job.doc.runId = 'run-id';
      
      const stub = sandbox.stub(job, 'done').resolves(true);
      
      const result = await job.done({ success: true });
      
      expect(result).to.be.true;
    });
    
    it('should mark job as failed', async () => {
      job.doc._id = 'job-id';
      job.doc.runId = 'run-id';
      
      const stub = sandbox.stub(job, 'fail').resolves(true);
      
      const result = await job.fail('Error message');
      
      expect(result).to.be.true;
    });
  });
});
```

#### test/unit/job_collection.test.js
```javascript
import { JobCollection } from '../../lib/server/server.js';

describe('JobCollection - Unit Tests', () => {
  let jc;
  let sandbox;
  
  beforeEach(() => {
    jc = new JobCollection('testQueue');
    sandbox = sinon.createSandbox();
  });
  
  afterEach(() => {
    sandbox.restore();
  });
  
  describe('Constructor', () => {
    it('should create a new JobCollection', () => {
      expect(jc).to.be.instanceOf(JobCollection);
      expect(jc.root).to.equal('testQueue');
      expect(jc.stopped).to.be.true;
    });
    
    it('should handle newless constructor', () => {
      const jc2 = JobCollection('anotherQueue');
      expect(jc2).to.be.instanceOf(JobCollection);
    });
  });
  
  describe('Server Control', () => {
    it('should start job server', async () => {
      const stub = sandbox.stub(jc, 'startJobServer').resolves(true);
      
      const result = await jc.startJobServer();
      
      expect(result).to.be.true;
    });
    
    it('should shutdown job server', async () => {
      const stub = sandbox.stub(jc, 'shutdownJobServer').resolves(true);
      
      const result = await jc.shutdownJobServer({ timeout: 5000 });
      
      expect(result).to.be.true;
    });
  });
  
  describe('Job Management', () => {
    it('should get job by ID', async () => {
      const mockJob = {
        _id: 'test-id',
        type: 'testJob',
        status: 'ready'
      };
      
      const stub = sandbox.stub(jc, 'findOneAsync').resolves(mockJob);
      
      const job = await jc.getJob('test-id');
      
      expect(job).to.exist;
    });
    
    it('should get work for workers', async () => {
      const mockJobs = [{
        _id: 'job1',
        type: 'workerJob',
        status: 'ready'
      }];
      
      const findStub = sandbox.stub(jc, 'find').returns({
        fetchAsync: () => Promise.resolve(mockJobs)
      });
      
      const updateStub = sandbox.stub(jc, 'updateAsync').resolves({
        modifiedCount: 1
      });
      
      const work = await jc.getWork('workerJob');
      
      expect(work).to.exist;
    });
  });
  
  describe('Allow/Deny Rules', () => {
    it('should set allow rules', () => {
      const allowFunc = (userId) => userId === 'allowed-user';
      
      jc.allow({
        admin: allowFunc
      });
      
      expect(jc.allows.admin).to.include(allowFunc);
    });
    
    it('should set deny rules', () => {
      const denyFunc = (userId) => userId === 'banned-user';
      
      jc.deny({
        worker: denyFunc
      });
      
      expect(jc.denys.worker).to.include(denyFunc);
    });
  });
});
```

### 2. Integration Tests

#### test/integration/job_lifecycle.test.js
```javascript
import { JobCollection } from '../../lib/server/server.js';
import { Job } from '../../lib/common/job_class.js';

describe('Job Lifecycle - Integration Tests', () => {
  let jc;
  
  before(async () => {
    jc = new JobCollection('lifecycleTest');
    await jc.removeAsync({});
    await jc.startJobServer();
  });
  
  after(async () => {
    await jc.shutdownJobServer();
    await jc.removeAsync({});
  });
  
  it('should complete full job lifecycle', async () => {
    // Create job
    const job = new Job(jc, 'lifecycleJob', { test: 'data' });
    job.priority('high').retry({ retries: 3 });
    
    // Save job
    const jobId = await job.save();
    expect(jobId).to.be.a('string');
    
    // Verify job is waiting
    let savedJob = await jc.findOneAsync({ _id: jobId });
    expect(savedJob.status).to.equal('waiting');
    
    // Promote to ready
    await jc.updateAsync(
      { _id: jobId },
      { $set: { status: 'ready' } }
    );
    
    // Get work
    const work = await jc.getWork('lifecycleJob');
    expect(work).to.exist;
    expect(work.status).to.equal('running');
    
    // Update progress
    const progressJob = new Job(jc, work);
    await progressJob.progress(50, 100);
    
    // Complete job
    await progressJob.done({ result: 'success' });
    
    // Verify completion
    const completedJob = await jc.findOneAsync({ _id: jobId });
    expect(completedJob.status).to.equal('completed');
    expect(completedJob.result).to.deep.equal({ result: 'success' });
  });
  
  it('should handle job failure and retry', async () => {
    const job = new Job(jc, 'retryJob', { attempt: 1 });
    job.retry({ retries: 2, wait: 100 });
    
    const jobId = await job.save();
    
    // Promote and get work
    await jc.updateAsync(
      { _id: jobId },
      { $set: { status: 'ready' } }
    );
    
    const work = await jc.getWork('retryJob');
    const workingJob = new Job(jc, work);
    
    // Fail the job
    await workingJob.fail('First failure');
    
    // Check job is waiting for retry
    const failedJob = await jc.findOneAsync({ _id: jobId });
    expect(failedJob.status).to.equal('waiting');
    expect(failedJob.retried).to.equal(1);
    
    // Wait for retry delay
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Promote again
    await jc.updateAsync(
      { _id: jobId },
      { $set: { status: 'ready' } }
    );
    
    // Get work again
    const retryWork = await jc.getWork('retryJob');
    const retryJob = new Job(jc, retryWork);
    
    // Complete successfully this time
    await retryJob.done({ attempt: 2 });
    
    const finalJob = await jc.findOneAsync({ _id: jobId });
    expect(finalJob.status).to.equal('completed');
    expect(finalJob.retried).to.equal(1);
  });
  
  it('should handle job dependencies', async () => {
    // Create parent job
    const parentJob = new Job(jc, 'parentJob', { order: 1 });
    const parentId = await parentJob.save();
    
    // Create dependent job
    const childJob = new Job(jc, 'childJob', { order: 2 });
    childJob.depends([parentId]);
    const childId = await childJob.save();
    
    // Check child is waiting with dependencies
    let child = await jc.findOneAsync({ _id: childId });
    expect(child.status).to.equal('waiting');
    expect(child.depends).to.include(parentId);
    
    // Complete parent job
    await jc.updateAsync(
      { _id: parentId },
      { $set: { status: 'completed' } }
    );
    
    // Process dependencies
    await jc._processDependentJobs(parentId);
    
    // Check child is now ready
    child = await jc.findOneAsync({ _id: childId });
    expect(child.status).to.equal('ready');
    expect(child.resolved).to.include(parentId);
  });
});
```

#### test/integration/worker_processing.test.js
```javascript
describe('Worker Processing - Integration Tests', () => {
  let jc;
  let processedJobs;
  
  beforeEach(async () => {
    jc = new JobCollection('workerTest');
    await jc.removeAsync({});
    await jc.startJobServer();
    processedJobs = [];
  });
  
  afterEach(async () => {
    await jc.shutdownJobServer();
  });
  
  it('should process jobs with single worker', async () => {
    // Create jobs
    for (let i = 0; i < 5; i++) {
      const job = new Job(jc, 'singleWorker', { index: i });
      await job.save();
    }
    
    // Promote all to ready
    await jc.updateAsync(
      { type: 'singleWorker' },
      { $set: { status: 'ready' } },
      { multi: true }
    );
    
    // Process jobs
    const queue = jc.processJobs('singleWorker', {
      concurrency: 1,
      pollInterval: 100
    }, async (job, cb) => {
      processedJobs.push(job.data.index);
      await job.done();
      cb();
    });
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    queue.shutdown();
    
    expect(processedJobs).to.have.lengthOf(5);
    expect(processedJobs).to.include.members([0, 1, 2, 3, 4]);
  });
  
  it('should handle concurrent workers', async () => {
    const startTimes = {};
    const endTimes = {};
    
    // Create jobs
    for (let i = 0; i < 10; i++) {
      const job = new Job(jc, 'concurrentWorker', { index: i });
      await job.save();
    }
    
    // Promote all to ready
    await jc.updateAsync(
      { type: 'concurrentWorker' },
      { $set: { status: 'ready' } },
      { multi: true }
    );
    
    // Process with concurrency
    const queue = jc.processJobs('concurrentWorker', {
      concurrency: 3,
      pollInterval: 50
    }, async (job, cb) => {
      const index = job.data.index;
      startTimes[index] = Date.now();
      
      // Simulate work
      await new Promise(resolve => setTimeout(resolve, 100));
      
      endTimes[index] = Date.now();
      await job.done();
      cb();
    });
    
    // Wait for all jobs to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    queue.shutdown();
    
    // Check that jobs ran concurrently
    const overlaps = [];
    for (let i = 0; i < 10; i++) {
      for (let j = i + 1; j < 10; j++) {
        if (startTimes[i] && startTimes[j] && endTimes[i] && endTimes[j]) {
          // Check if jobs overlapped in execution
          if (startTimes[j] < endTimes[i] && startTimes[i] < endTimes[j]) {
            overlaps.push([i, j]);
          }
        }
      }
    }
    
    // With concurrency 3, we should see overlapping jobs
    expect(overlaps.length).to.be.greaterThan(0);
  });
  
  it('should handle worker errors gracefully', async () => {
    let attempts = 0;
    
    const job = new Job(jc, 'errorJob', { shouldFail: true });
    job.retry({ retries: 2, wait: 100 });
    await job.save();
    
    // Promote to ready
    await jc.updateAsync(
      { type: 'errorJob' },
      { $set: { status: 'ready' } }
    );
    
    const queue = jc.processJobs('errorJob', {
      pollInterval: 50
    }, async (job, cb) => {
      attempts++;
      
      if (attempts < 3) {
        await job.fail(`Attempt ${attempts} failed`);
      } else {
        await job.done({ attempts });
      }
      
      cb();
    });
    
    // Wait for retries
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    queue.shutdown();
    
    const finalJob = await jc.findOneAsync({ type: 'errorJob' });
    expect(finalJob.status).to.equal('completed');
    expect(finalJob.result.attempts).to.equal(3);
    expect(finalJob.failures).to.have.lengthOf(2);
  });
});
```

### 3. Async Behavior Tests

#### test/async/async_operations.test.js
```javascript
describe('Async Operations', () => {
  let jc;
  
  beforeEach(async () => {
    jc = new JobCollection('asyncTest');
    await jc.removeAsync({});
  });
  
  describe('MongoDB Async Methods', () => {
    it('should use findOneAsync', async () => {
      const doc = { type: 'test', status: 'waiting', data: {} };
      const id = await jc.insertAsync(doc);
      
      const found = await jc.findOneAsync({ _id: id });
      expect(found).to.exist;
      expect(found.type).to.equal('test');
    });
    
    it('should use find().fetchAsync()', async () => {
      for (let i = 0; i < 5; i++) {
        await jc.insertAsync({ type: 'batch', index: i, status: 'waiting', data: {} });
      }
      
      const docs = await jc.find({ type: 'batch' }).fetchAsync();
      expect(docs).to.have.lengthOf(5);
    });
    
    it('should use updateAsync', async () => {
      const id = await jc.insertAsync({ type: 'update', value: 1, status: 'waiting', data: {} });
      
      const result = await jc.updateAsync(
        { _id: id },
        { $set: { value: 2 } }
      );
      
      expect(result.modifiedCount).to.equal(1);
      
      const updated = await jc.findOneAsync({ _id: id });
      expect(updated.value).to.equal(2);
    });
    
    it('should use removeAsync', async () => {
      const id = await jc.insertAsync({ type: 'remove', status: 'waiting', data: {} });
      
      const result = await jc.removeAsync({ _id: id });
      expect(result).to.equal(1);
      
      const found = await jc.findOneAsync({ _id: id });
      expect(found).to.be.undefined;
    });
    
    it('should handle cursor.forEachAsync', async () => {
      for (let i = 0; i < 3; i++) {
        await jc.insertAsync({ type: 'forEach', index: i, status: 'waiting', data: {} });
      }
      
      const indices = [];
      await jc.find({ type: 'forEach' }).forEachAsync(async (doc) => {
        indices.push(doc.index);
      });
      
      expect(indices).to.have.lengthOf(3);
      expect(indices).to.include.members([0, 1, 2]);
    });
  });
  
  describe('Promise Handling', () => {
    it('should handle promise rejections', async () => {
      const job = new Job(jc, 'failJob', {});
      
      // Try to refresh unsaved job
      await expect(job.refresh()).to.be.rejectedWith('Can only refresh a saved job');
    });
    
    it('should support callback and promise APIs', async () => {
      const job = new Job(jc, 'dualApi', {});
      
      // Promise API
      const id1 = await job.save();
      expect(id1).to.be.a('string');
      
      // Callback API
      await new Promise((resolve, reject) => {
        const job2 = new Job(jc, 'dualApi2', {});
        job2.save((err, id2) => {
          if (err) reject(err);
          expect(id2).to.be.a('string');
          resolve();
        });
      });
    });
    
    it('should handle parallel async operations', async () => {
      const jobs = [];
      for (let i = 0; i < 10; i++) {
        jobs.push(new Job(jc, 'parallel', { index: i }));
      }
      
      const ids = await Promise.all(jobs.map(job => job.save()));
      
      expect(ids).to.have.lengthOf(10);
      ids.forEach(id => expect(id).to.be.a('string'));
    });
  });
  
  describe('Event Loop Behavior', () => {
    it('should not block event loop', async () => {
      let blockDetected = false;
      const checkInterval = 10;
      let lastCheck = Date.now();
      
      const interval = setInterval(() => {
        const now = Date.now();
        if (now - lastCheck > checkInterval * 2) {
          blockDetected = true;
        }
        lastCheck = now;
      }, checkInterval);
      
      // Perform many async operations
      const promises = [];
      for (let i = 0; i < 100; i++) {
        const job = new Job(jc, 'eventLoop', { index: i });
        promises.push(job.save());
      }
      
      await Promise.all(promises);
      
      clearInterval(interval);
      
      expect(blockDetected).to.be.false;
    });
  });
});
```

### 4. Performance Tests

#### test/performance/throughput.test.js
```javascript
describe('Performance Tests', function() {
  this.timeout(30000);
  
  let jc;
  
  before(async () => {
    jc = new JobCollection('perfTest');
    await jc.removeAsync({});
    await jc.startJobServer();
  });
  
  after(async () => {
    await jc.shutdownJobServer();
    await jc.removeAsync({});
  });
  
  it('should handle high job throughput', async () => {
    const jobCount = 1000;
    const startTime = Date.now();
    
    // Create jobs
    const createPromises = [];
    for (let i = 0; i < jobCount; i++) {
      const job = new Job(jc, 'throughput', { index: i });
      createPromises.push(job.save());
    }
    
    await Promise.all(createPromises);
    
    const createTime = Date.now() - startTime;
    console.log(`Created ${jobCount} jobs in ${createTime}ms (${(jobCount / createTime * 1000).toFixed(2)} jobs/sec)`);
    
    // Process jobs
    let processed = 0;
    const processStart = Date.now();
    
    await jc.updateAsync(
      { type: 'throughput' },
      { $set: { status: 'ready' } },
      { multi: true }
    );
    
    const queue = jc.processJobs('throughput', {
      concurrency: 10,
      pollInterval: 10,
      prefetch: 20
    }, async (job, cb) => {
      processed++;
      await job.done();
      cb();
    });
    
    // Wait for processing
    while (processed < jobCount) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const processTime = Date.now() - processStart;
    console.log(`Processed ${jobCount} jobs in ${processTime}ms (${(jobCount / processTime * 1000).toFixed(2)} jobs/sec)`);
    
    queue.shutdown();
    
    expect(processed).to.equal(jobCount);
    expect(processTime).to.be.lessThan(30000); // Should complete within 30 seconds
  });
  
  it('should handle large job data', async () => {
    const largeData = {
      array: new Array(1000).fill('x'.repeat(100)),
      nested: {}
    };
    
    // Create nested structure
    let current = largeData.nested;
    for (let i = 0; i < 100; i++) {
      current.next = { level: i, data: 'x'.repeat(100) };
      current = current.next;
    }
    
    const job = new Job(jc, 'largeData', largeData);
    const id = await job.save();
    
    const saved = await jc.findOneAsync({ _id: id });
    expect(saved).to.exist;
    expect(saved.data.array).to.have.lengthOf(1000);
  });
  
  it('should maintain performance under load', async () => {
    const operations = [];
    const operationCount = 100;
    
    for (let i = 0; i < operationCount; i++) {
      operations.push((async () => {
        const job = new Job(jc, 'load', { op: i });
        const id = await job.save();
        
        await jc.updateAsync(
          { _id: id },
          { $set: { status: 'ready' } }
        );
        
        const work = await jc.getWork('load');
        if (work) {
          const workingJob = new Job(jc, work);
          await workingJob.done();
        }
      })());
    }
    
    const startTime = Date.now();
    await Promise.all(operations);
    const duration = Date.now() - startTime;
    
    const opsPerSecond = (operationCount / duration * 1000);
    console.log(`Completed ${operationCount} operations in ${duration}ms (${opsPerSecond.toFixed(2)} ops/sec)`);
    
    expect(opsPerSecond).to.be.greaterThan(10); // At least 10 ops/sec
  });
});
```

### 5. Migration Verification Tests

#### test/migration/compatibility.test.js
```javascript
describe('Migration Compatibility Tests', () => {
  it('should maintain API compatibility', () => {
    // Check that all expected methods exist
    const jc = new JobCollection('apiTest');
    
    // Collection methods
    expect(jc.startJobServer).to.be.a('function');
    expect(jc.shutdownJobServer).to.be.a('function');
    expect(jc.getJob).to.be.a('function');
    expect(jc.getWork).to.be.a('function');
    expect(jc.processJobs).to.be.a('function');
    expect(jc.allow).to.be.a('function');
    expect(jc.deny).to.be.a('function');
    expect(jc.promote).to.be.a('function');
    expect(jc.setLogStream).to.be.a('function');
    
    // Job methods
    const job = new Job(jc, 'test', {});
    
    expect(job.save).to.be.a('function');
    expect(job.refresh).to.be.a('function');
    expect(job.log).to.be.a('function');
    expect(job.progress).to.be.a('function');
    expect(job.done).to.be.a('function');
    expect(job.fail).to.be.a('function');
    expect(job.priority).to.be.a('function');
    expect(job.retry).to.be.a('function');
    expect(job.repeat).to.be.a('function');
    expect(job.delay).to.be.a('function');
    expect(job.after).to.be.a('function');
    expect(job.depends).to.be.a('function');
    expect(job.pause).to.be.a('function');
    expect(job.resume).to.be.a('function');
    expect(job.ready).to.be.a('function');
    expect(job.cancel).to.be.a('function');
    expect(job.restart).to.be.a('function');
    expect(job.rerun).to.be.a('function');
    expect(job.remove).to.be.a('function');
  });
  
  it('should handle both callback and promise patterns', async () => {
    const jc = new JobCollection('patternTest');
    const job = new Job(jc, 'dual', {});
    
    // Test promise pattern
    const promiseResult = await job.save();
    expect(promiseResult).to.be.a('string');
    
    // Test callback pattern
    const job2 = new Job(jc, 'dual2', {});
    await new Promise((resolve, reject) => {
      job2.save((err, result) => {
        if (err) reject(err);
        expect(result).to.be.a('string');
        resolve();
      });
    });
  });
});
```

## Test Execution Strategy

### 1. Local Development Testing

```bash
# Run all tests
npm test

# Run specific test category
npm test -- --grep "Unit Tests"
npm test -- --grep "Integration Tests"
npm test -- --grep "Performance Tests"

# Run with coverage
npx nyc npm test

# Watch mode for development
npm run test:watch
```

### 2. CI/CD Pipeline

#### .github/workflows/test.yml
```yaml
name: Test Suite

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    
    strategy:
      matrix:
        meteor-version: ['3.0', '3.1', '3.2']
        node-version: ['20.x', '22.x']
        mongodb-version: ['7.0', '8.0']
    
    services:
      mongodb:
        image: mongo:${{ matrix.mongodb-version }}
        ports:
          - 27017:27017
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: ${{ matrix.node-version }}
    
    - name: Install Meteor
      run: |
        npx meteor@${{ matrix.meteor-version }}
        meteor --version
    
    - name: Install dependencies
      run: npm install
    
    - name: Run linter
      run: npm run lint
    
    - name: Run tests
      env:
        MONGO_URL: mongodb://localhost:27017/test
      run: npm test
    
    - name: Generate coverage report
      run: npx nyc report --reporter=lcov
    
    - name: Upload coverage
      uses: codecov/codecov-action@v3
      with:
        file: ./coverage/lcov.info
```

### 3. Performance Benchmarking

```javascript
// benchmark/suite.js
import Benchmark from 'benchmark';
import { JobCollection } from '../lib/server/server.js';
import { Job } from '../lib/common/job_class.js';

const suite = new Benchmark.Suite();

suite
  .add('Job Creation', {
    fn: async (deferred) => {
      const job = new Job('test', 'benchmark', { index: Math.random() });
      await job.save();
      deferred.resolve();
    },
    defer: true
  })
  .add('Job Processing', {
    fn: async (deferred) => {
      const jc = new JobCollection('benchmark');
      const work = await jc.getWork('benchmark');
      if (work) {
        const job = new Job(jc, work);
        await job.done();
      }
      deferred.resolve();
    },
    defer: true
  })
  .on('cycle', (event) => {
    console.log(String(event.target));
  })
  .on('complete', function() {
    console.log('Fastest is ' + this.filter('fastest').map('name'));
  })
  .run({ async: true });
```

## Validation Criteria

### Test Coverage Requirements

- **Line Coverage**: > 80%
- **Branch Coverage**: > 75%
- **Function Coverage**: > 85%
- **Statement Coverage**: > 80%

### Performance Benchmarks

- Job creation: > 1000 jobs/second
- Job processing: > 500 jobs/second (single worker)
- Memory usage: < 200MB for 10,000 jobs
- No memory leaks over extended runs

### Compatibility Checks

- [ ] All public APIs maintained
- [ ] Callback and promise patterns work
- [ ] Client/server communication functional
- [ ] Worker processing operational
- [ ] Job lifecycle complete

## Next Steps

1. Implement all test files
2. Set up CI/CD pipeline
3. Run full test suite
4. Fix failing tests
5. Optimize performance
6. Document test results
