# Meteor 3.x API Changes

## Overview

This document details all Meteor API changes that affect the meteor-job-collection package and provides migration strategies for each.

## Core API Changes

### 1. WebApp Package - Connect to Express Migration

The WebApp package now uses Express 5 instead of Connect.

**API Mapping:**

| Old API | New API |
|---------|---------|
| `WebApp.connectHandlers` | `WebApp.handlers` |
| `WebApp.rawConnectHandlers` | `WebApp.rawHandlers` |
| `WebApp.connectApp` | `WebApp.expressApp` |

**Implementation Changes:**

```javascript
// Before (Meteor 2.x)
if (Meteor.isServer) {
  WebApp.connectHandlers.use('/job-status', (req, res, next) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'running' }));
  });
}

// After (Meteor 3.x)
if (Meteor.isServer) {
  WebApp.handlers.use('/job-status', (req, res, next) => {
    res.status(200).json({ status: 'running' });
  });
}
```

### 2. Assets API Changes

The synchronous Assets API has been replaced with async versions.

**Before:**
```javascript
const configText = Assets.getText('config.json');
const configBinary = Assets.getBinary('data.bin');
```

**After:**
```javascript
const configText = await Assets.getTextAsync('config.json');
const configBinary = await Assets.getBinaryAsync('data.bin');
```

### 3. Email Package

Email sending is now asynchronous.

**Before:**
```javascript
Email.send({
  to: 'user@example.com',
  from: 'noreply@example.com',
  subject: 'Job Completed',
  text: 'Your job has completed successfully'
});
```

**After:**
```javascript
await Email.sendAsync({
  to: 'user@example.com',
  from: 'noreply@example.com',
  subject: 'Job Completed',
  text: 'Your job has completed successfully'
});
```

### 4. Accounts Package

User management methods are now async.

**Before:**
```javascript
const user = Meteor.user();
const userId = Meteor.userId();
```

**After (server-side):**
```javascript
const user = await Meteor.userAsync();
const userId = await Meteor.userId(); // Still sync on client
```

### 5. Check Package

The check package remains mostly unchanged but needs consideration for async contexts.

```javascript
// Still works the same
check(doc, {
  type: String,
  status: Match.Where(validStatus),
  data: Object
});

// But in async methods
Meteor.methods({
  async 'jobQueue_save'(doc) {
    check(doc, validJobDoc); // Still synchronous
    return await this.insertAsync(doc);
  }
});
```

## Package-Specific Changes

### 1. Package.js Configuration

Update for Meteor 3.x compatibility:

```javascript
Package.describe({
  name: 'vsivsi:job-collection',
  version: '2.0.0',
  summary: 'A persistent and reactive job queue for Meteor 3.x',
  git: 'https://github.com/yourusername/meteor-job-collection.git',
  documentation: 'README.md'
});

Package.onUse(function(api) {
  // Specify Meteor 3.x compatibility
  api.versionsFrom(['3.0']);
  
  // Core dependencies
  api.use([
    'ecmascript',           // ES6+ support
    'mongo',               // MongoDB driver
    'check',               // Type checking
    'random',              // ID generation
    'ddp',                 // DDP protocol
    'ejson',               // EJSON support
    'tracker',             // Reactivity (client)
    'reactive-var'         // Reactive variables (client)
  ]);
  
  // Remove deprecated packages
  // api.use('coffeescript'); // REMOVED
  // api.use('fibers');       // REMOVED
  
  // Replace later package if needed
  api.use('littledata:synced-cron@1.5.1', 'server', { weak: true });
  
  // Add files
  api.addFiles('lib/common/shared.js', ['client', 'server']);
  api.addFiles('lib/server/server.js', 'server');
  api.addFiles('lib/client/client.js', 'client');
  api.addFiles('lib/common/job_class.js', ['client', 'server']);
  
  // Exports
  api.export('Job');
  api.export('JobCollection');
});

Package.onTest(function(api) {
  api.use('vsivsi:job-collection');
  api.use([
    'ecmascript',
    'tinytest',
    'test-helpers',
    'mongo'
  ]);
  
  api.addFiles('test/job_collection_tests.js', ['client', 'server']);
});
```

### 2. Later.js Replacement

The `mrt:later` package may not be compatible with Meteor 3.x. Consider alternatives:

**Option 1: Use synced-cron**
```javascript
import { SyncedCron } from 'meteor/littledata:synced-cron';

// Replace later.js scheduling
SyncedCron.add({
  name: 'Process scheduled jobs',
  schedule: function(parser) {
    return parser.text('every 5 minutes');
  },
  job: async function() {
    await processScheduledJobs();
  }
});
```

**Option 2: Use node-cron**
```javascript
import cron from 'node-cron';

// Schedule job processing
cron.schedule('*/5 * * * *', async () => {
  await processScheduledJobs();
});
```

**Option 3: Bundle later.js directly**
```javascript
// Download and include later.js in the package
// lib/vendor/later.js
import later from './vendor/later.js';

// Use as before
const schedule = later.parse.text('every 5 minutes');
```

### 3. DDP Connection Handling

DDP connections now support async operations natively:

```javascript
// Before
if (Meteor.isServer) {
  Meteor.onConnection((connection) => {
    console.log('New connection:', connection.id);
    
    connection.onClose(() => {
      // Clean up jobs for this connection
      JobCollection.update(
        { connectionId: connection.id },
        { $set: { status: 'failed' } },
        { multi: true }
      );
    });
  });
}

// After
if (Meteor.isServer) {
  Meteor.onConnection((connection) => {
    console.log('New connection:', connection.id);
    
    connection.onClose(async () => {
      // Clean up jobs for this connection
      await JobCollection.updateAsync(
        { connectionId: connection.id },
        { $set: { status: 'failed' } },
        { multi: true }
      );
    });
  });
}
```

### 4. Publications and Subscriptions

Publications must be async when using async operations:

```javascript
// Before
Meteor.publish('activeJobs', function(userId) {
  if (!this.userId) {
    return this.ready();
  }
  
  return JobCollection.find({
    userId: userId,
    status: { $in: ['waiting', 'ready', 'running'] }
  });
});

// After
Meteor.publish('activeJobs', async function(userId) {
  if (!this.userId) {
    return this.ready();
  }
  
  // Can use async operations if needed
  const user = await Meteor.users.findOneAsync(this.userId);
  if (!user) {
    return this.ready();
  }
  
  return JobCollection.find({
    userId: userId,
    status: { $in: ['waiting', 'ready', 'running'] }
  });
});
```

### 5. Method Validation

Update method validation for async context:

```javascript
// Before
Meteor.methods({
  'jobQueue_save': function(doc, options) {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized');
    }
    
    check(doc, validJobDoc);
    
    const user = Meteor.users.findOne(this.userId);
    if (!user.roles.includes('job-creator')) {
      throw new Meteor.Error('insufficient-permissions');
    }
    
    return JobCollection.insert(doc);
  }
});

// After
Meteor.methods({
  'jobQueue_save': async function(doc, options) {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized');
    }
    
    check(doc, validJobDoc);
    
    const user = await Meteor.users.findOneAsync(this.userId);
    if (!user.roles?.includes('job-creator')) {
      throw new Meteor.Error('insufficient-permissions');
    }
    
    return await JobCollection.insertAsync(doc);
  }
});
```

## Environment Variables and Settings

### 1. MongoDB URL Configuration

Meteor 3.x requires MongoDB 7.0+:

```javascript
// settings.json
{
  "galaxy.meteor.com": {
    "env": {
      "MONGO_URL": "mongodb://user:pass@host:port/database?replicaSet=rs0&authSource=admin",
      "MONGO_OPLOG_URL": "mongodb://user:pass@host:port/local?replicaSet=rs0&authSource=admin"
    }
  },
  "packages": {
    "mongo": {
      "options": {
        "tlsAllowInvalidCertificates": false,
        "tlsAllowInvalidHostnames": false,
        "connectTimeoutMS": 30000,
        "socketTimeoutMS": 360000,
        "maxPoolSize": 10
      }
    }
  }
}
```

### 2. Node.js Options

Meteor 3.x uses Node.js 20+:

```bash
# Set Node options for better async performance
export NODE_OPTIONS="--max-old-space-size=4096 --async-stack-traces"
```

## Error Handling Updates

### 1. Promise Rejection Handling

```javascript
// Global unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Log to your error tracking service
});

// In job processing
class JobProcessor {
  async processJob(job) {
    try {
      await this.runJob(job);
      await job.done();
    } catch (error) {
      console.error(`Job ${job._id} failed:`, error);
      await job.fail(error.message);
    }
  }
}
```

### 2. Method Error Handling

```javascript
// Consistent error handling across methods
const wrapMethod = (fn) => {
  return async function(...args) {
    try {
      return await fn.apply(this, args);
    } catch (error) {
      // Log error
      console.error(`Method error: ${error.message}`, error.stack);
      
      // Throw Meteor.Error for client
      if (error instanceof Meteor.Error) {
        throw error;
      }
      
      throw new Meteor.Error('internal-error', 'An internal error occurred');
    }
  };
};

Meteor.methods({
  'jobQueue_save': wrapMethod(async function(doc, options) {
    // Method implementation
  })
});
```

## Performance Optimizations

### 1. Index Creation

Use async index creation:

```javascript
// Before
JobCollection._ensureIndex({ type: 1, status: 1 });
JobCollection._ensureIndex({ priority: -1, after: 1 });

// After
await JobCollection.createIndexAsync({ type: 1, status: 1 });
await JobCollection.createIndexAsync({ priority: -1, after: 1 });
await JobCollection.createIndexAsync({ status: 1, after: 1 });
await JobCollection.createIndexAsync({ depends: 1 });
```

### 2. Bulk Operations

Use bulk operations for better performance:

```javascript
// Bulk update multiple jobs
const bulk = JobCollection.rawCollection().initializeUnorderedBulkOp();

jobIds.forEach(id => {
  bulk.find({ _id: id }).updateOne({
    $set: { status: 'ready', updated: new Date() }
  });
});

await bulk.execute();
```

### 3. Aggregation Pipeline

Use aggregation for complex queries:

```javascript
const stats = await JobCollection.rawCollection().aggregate([
  {
    $match: {
      created: { $gte: startDate, $lte: endDate }
    }
  },
  {
    $group: {
      _id: '$status',
      count: { $sum: 1 },
      avgProcessingTime: { $avg: '$processingTime' }
    }
  }
]).toArray();
```

## Testing Considerations

### 1. Test Helpers

Update test helpers for async:

```javascript
// test/helpers.js
export const withJobCollection = async (fn) => {
  const jc = new JobCollection('test');
  await jc.removeAsync({});
  
  try {
    await fn(jc);
  } finally {
    await jc.removeAsync({});
  }
};

// Usage in tests
it('should process jobs', async () => {
  await withJobCollection(async (jc) => {
    const job = new Job(jc, 'test', {});
    await job.save();
    // test implementation
  });
});
```

### 2. Stub Async Methods

```javascript
import sinon from 'sinon';

// Stub async methods
const stub = sinon.stub(JobCollection.prototype, 'findOneAsync');
stub.resolves({ _id: 'test', status: 'ready' });

// Test with stub
const job = await jc.getJob('test');
expect(job.status).to.equal('ready');

// Restore
stub.restore();
```

## Migration Validation Checklist

- [ ] All WebApp handlers updated to Express syntax
- [ ] Assets API calls converted to async
- [ ] Email sending using sendAsync
- [ ] User lookups using userAsync on server
- [ ] Package.js updated for Meteor 3.x
- [ ] Later.js replacement implemented
- [ ] DDP connections handle async operations
- [ ] Publications updated for async operations
- [ ] Method validation works with async
- [ ] Error handling updated for promises
- [ ] Indexes created with createIndexAsync
- [ ] Tests updated for async operations

## Common Issues and Solutions

### Issue 1: Methods Not Found

**Problem:** Methods registered but not found by client.

**Solution:** Ensure methods are registered before client connects:
```javascript
Meteor.startup(async () => {
  // Register methods first
  const jc = new JobCollection('queue');
  
  // Then start server
  await jc.startJobServer();
});
```

### Issue 2: Reactive Queries Not Updating

**Problem:** Find queries not reactive in async context.

**Solution:** Use cursor observation:
```javascript
const handle = JobCollection.find({ status: 'ready' }).observeChanges({
  added: async (id, fields) => {
    await processNewJob(id);
  }
});
```

### Issue 3: Memory Leaks

**Problem:** Async operations not cleaning up properly.

**Solution:** Implement proper cleanup:
```javascript
class JobProcessor {
  constructor() {
    this.activeJobs = new Map();
  }
  
  async processJob(job) {
    const controller = new AbortController();
    this.activeJobs.set(job._id, controller);
    
    try {
      await this.runJob(job, controller.signal);
    } finally {
      this.activeJobs.delete(job._id);
    }
  }
  
  shutdown() {
    // Cancel all active jobs
    for (const controller of this.activeJobs.values()) {
      controller.abort();
    }
  }
}
```

## Next Steps

1. Implement all API changes in the codebase
2. Update package dependencies
3. Test with Meteor 3.2+
4. Performance testing
5. Update documentation
