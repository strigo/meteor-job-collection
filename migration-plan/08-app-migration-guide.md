# Application Migration Guide

## Overview

This guide helps developers migrate applications using `meteor-job-collection` from Meteor 2.x to Meteor 3.x. The migration requires updating your application code to use async/await patterns and handling breaking changes.

## Prerequisites

Before migrating your application:

1. **Upgrade Meteor to 3.2+**
   ```bash
   meteor update --release 3.2
   ```

2. **Update Node.js to 20+**
   ```bash
   nvm install 20
   nvm use 20
   ```

3. **Update MongoDB to 7.0+**
   - Ensure your MongoDB instance is compatible

## Migration Steps

### Step 1: Update Package Version

#### Remove Old Package
```bash
meteor remove vsivsi:job-collection
```

#### Add Updated Package
```bash
meteor add vsivsi:job-collection@2.0.0
```

Or if using NPM:
```json
{
  "dependencies": {
    "meteor-job": "^2.0.0"
  }
}
```

### Step 2: Update Imports

No changes needed for imports:

```javascript
// These remain the same
import { JobCollection } from 'meteor/vsivsi:job-collection';
import { Job } from 'meteor/vsivsi:job-collection';
```

### Step 3: Update Server-Side Code

#### JobCollection Initialization

**Before (Meteor 2.x):**
```javascript
// server/jobs.js
import { JobCollection } from 'meteor/vsivsi:job-collection';

const myJobs = new JobCollection('myJobQueue');

Meteor.startup(() => {
  myJobs.allow({
    admin: (userId) => {
      const user = Meteor.users.findOne(userId);
      return user && user.roles.includes('admin');
    }
  });
  
  myJobs.startJobServer();
});
```

**After (Meteor 3.x):**
```javascript
// server/jobs.js
import { JobCollection } from 'meteor/vsivsi:job-collection';

const myJobs = new JobCollection('myJobQueue');

Meteor.startup(async () => {
  myJobs.allow({
    admin: async (userId) => {
      const user = await Meteor.users.findOneAsync(userId);
      return user && user.roles?.includes('admin');
    }
  });
  
  await myJobs.startJobServer();
});
```

#### Job Processing

**Before (Meteor 2.x):**
```javascript
// server/workers.js
myJobs.processJobs('sendEmail', {
  concurrency: 4,
  payload: 1
}, function (job, callback) {
  const email = job.data;
  
  Email.send({
    to: email.to,
    from: email.from,
    subject: email.subject,
    text: email.body
  });
  
  job.done();
  callback();
});
```

**After (Meteor 3.x):**
```javascript
// server/workers.js
myJobs.processJobs('sendEmail', {
  concurrency: 4,
  payload: 1
}, async (job, callback) => {
  const email = job.data;
  
  try {
    await Email.sendAsync({
      to: email.to,
      from: email.from,
      subject: email.subject,
      text: email.body
    });
    
    await job.done();
  } catch (error) {
    await job.fail(error.message);
  }
  
  callback();
});
```

#### Custom Methods

**Before (Meteor 2.x):**
```javascript
Meteor.methods({
  'createEmailJob'(emailData) {
    check(emailData, {
      to: String,
      subject: String,
      body: String
    });
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized');
    }
    
    const job = new Job(myJobs, 'sendEmail', emailData);
    job.priority('normal')
       .retry({ retries: 3, wait: 5 * 60 * 1000 })
       .save();
    
    return job.doc._id;
  },
  
  'getJobStatus'(jobId) {
    check(jobId, String);
    
    const job = myJobs.findOne(jobId);
    if (!job) {
      throw new Meteor.Error('job-not-found');
    }
    
    return {
      status: job.status,
      progress: job.progress
    };
  }
});
```

**After (Meteor 3.x):**
```javascript
Meteor.methods({
  async 'createEmailJob'(emailData) {
    check(emailData, {
      to: String,
      subject: String,
      body: String
    });
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized');
    }
    
    const job = new Job(myJobs, 'sendEmail', emailData);
    job.priority('normal')
       .retry({ retries: 3, wait: 5 * 60 * 1000 });
    
    const jobId = await job.save();
    return jobId;
  },
  
  async 'getJobStatus'(jobId) {
    check(jobId, String);
    
    const job = await myJobs.findOneAsync(jobId);
    if (!job) {
      throw new Meteor.Error('job-not-found');
    }
    
    return {
      status: job.status,
      progress: job.progress
    };
  }
});
```

### Step 4: Update Client-Side Code

#### Method Calls

**Before (Meteor 2.x):**
```javascript
// client/job-creator.js
Template.jobCreator.events({
  'submit form'(event, template) {
    event.preventDefault();
    
    const emailData = {
      to: event.target.to.value,
      subject: event.target.subject.value,
      body: event.target.body.value
    };
    
    Meteor.call('createEmailJob', emailData, (error, jobId) => {
      if (error) {
        alert('Error creating job: ' + error.message);
      } else {
        alert('Job created: ' + jobId);
      }
    });
  }
});
```

**After (Meteor 3.x):**
```javascript
// client/job-creator.js
Template.jobCreator.events({
  async 'submit form'(event, template) {
    event.preventDefault();
    
    const emailData = {
      to: event.target.to.value,
      subject: event.target.subject.value,
      body: event.target.body.value
    };
    
    try {
      const jobId = await Meteor.callAsync('createEmailJob', emailData);
      alert('Job created: ' + jobId);
    } catch (error) {
      alert('Error creating job: ' + error.message);
    }
  }
});
```

#### Job Status Monitoring

**Before (Meteor 2.x):**
```javascript
// client/job-monitor.js
Template.jobMonitor.onCreated(function() {
  this.jobStatus = new ReactiveVar({});
  
  this.updateStatus = () => {
    const jobId = FlowRouter.getParam('jobId');
    
    Meteor.call('getJobStatus', jobId, (error, status) => {
      if (!error) {
        this.jobStatus.set(status);
      }
    });
  };
  
  this.interval = Meteor.setInterval(this.updateStatus, 1000);
  this.updateStatus();
});
```

**After (Meteor 3.x):**
```javascript
// client/job-monitor.js
Template.jobMonitor.onCreated(function() {
  this.jobStatus = new ReactiveVar({});
  
  this.updateStatus = async () => {
    const jobId = FlowRouter.getParam('jobId');
    
    try {
      const status = await Meteor.callAsync('getJobStatus', jobId);
      this.jobStatus.set(status);
    } catch (error) {
      console.error('Error fetching job status:', error);
    }
  };
  
  this.interval = Meteor.setInterval(this.updateStatus, 1000);
  this.updateStatus();
});
```

### Step 5: Update Publications and Subscriptions

#### Publications

**Before (Meteor 2.x):**
```javascript
// server/publications.js
Meteor.publish('userJobs', function(userId) {
  check(userId, String);
  
  if (!this.userId) {
    return this.ready();
  }
  
  const user = Meteor.users.findOne(this.userId);
  if (!user || user._id !== userId) {
    return this.ready();
  }
  
  return myJobs.find({
    'data.userId': userId,
    status: { $in: ['waiting', 'ready', 'running'] }
  });
});
```

**After (Meteor 3.x):**
```javascript
// server/publications.js
Meteor.publish('userJobs', async function(userId) {
  check(userId, String);
  
  if (!this.userId) {
    return this.ready();
  }
  
  const user = await Meteor.users.findOneAsync(this.userId);
  if (!user || user._id !== userId) {
    return this.ready();
  }
  
  return myJobs.find({
    'data.userId': userId,
    status: { $in: ['waiting', 'ready', 'running'] }
  });
});
```

### Step 6: Update Worker Implementations

#### Complex Worker with Progress

**Before (Meteor 2.x):**
```javascript
myJobs.processJobs('dataImport', {
  concurrency: 2,
  workTimeout: 5 * 60 * 1000
}, function(job, callback) {
  const importData = job.data;
  const totalRecords = importData.records.length;
  let processed = 0;
  
  importData.records.forEach((record, index) => {
    // Process record
    const existingRecord = Records.findOne({ id: record.id });
    
    if (existingRecord) {
      Records.update(existingRecord._id, { $set: record });
    } else {
      Records.insert(record);
    }
    
    processed++;
    
    // Update progress every 10 records
    if (processed % 10 === 0) {
      job.progress(processed, totalRecords);
    }
    
    // Log milestone
    if (processed % 100 === 0) {
      job.log(`Processed ${processed} records`, { level: 'info' });
    }
  });
  
  job.done({ processed: totalRecords });
  callback();
});
```

**After (Meteor 3.x):**
```javascript
myJobs.processJobs('dataImport', {
  concurrency: 2,
  workTimeout: 5 * 60 * 1000
}, async (job, callback) => {
  const importData = job.data;
  const totalRecords = importData.records.length;
  let processed = 0;
  
  try {
    for (const record of importData.records) {
      // Process record
      const existingRecord = await Records.findOneAsync({ id: record.id });
      
      if (existingRecord) {
        await Records.updateAsync(existingRecord._id, { $set: record });
      } else {
        await Records.insertAsync(record);
      }
      
      processed++;
      
      // Update progress every 10 records
      if (processed % 10 === 0) {
        await job.progress(processed, totalRecords);
      }
      
      // Log milestone
      if (processed % 100 === 0) {
        await job.log(`Processed ${processed} records`, { level: 'info' });
      }
    }
    
    await job.done({ processed: totalRecords });
  } catch (error) {
    await job.fail(`Import failed: ${error.message}`);
  }
  
  callback();
});
```

### Step 7: Update Scheduled Jobs

#### Using synced-cron (Recommended)

**Before (Meteor 2.x):**
```javascript
// Using later.js
const schedule = later.parse.text('every 5 minutes');

Meteor.startup(() => {
  const job = new Job(myJobs, 'cleanup', {})
    .repeat({ schedule: schedule })
    .save();
});
```

**After (Meteor 3.x):**
```javascript
// Using synced-cron
import { SyncedCron } from 'meteor/littledata:synced-cron';

SyncedCron.add({
  name: 'Create cleanup job',
  schedule: (parser) => parser.text('every 5 minutes'),
  job: async () => {
    const job = new Job(myJobs, 'cleanup', {});
    await job.save();
  }
});

Meteor.startup(async () => {
  SyncedCron.start();
});
```

## Common Migration Issues and Solutions

### Issue 1: Methods Not Found

**Problem:** `Method 'methodName' not found` errors after migration.

**Solution:** Ensure all methods are defined as async and registered before use:

```javascript
// Ensure methods are registered in startup
Meteor.startup(async () => {
  // Register methods first
  Meteor.methods({
    async 'myMethod'() {
      // method implementation
    }
  });
  
  // Then start services
  await myJobs.startJobServer();
});
```

### Issue 2: Callback Hell to Async/Await

**Problem:** Complex nested callbacks need conversion.

**Before:**
```javascript
job.save((err, jobId) => {
  if (err) {
    console.error(err);
  } else {
    job.refresh((err, refreshed) => {
      if (err) {
        console.error(err);
      } else {
        job.ready((err, readied) => {
          if (err) {
            console.error(err);
          } else {
            console.log('Job ready');
          }
        });
      }
    });
  }
});
```

**After:**
```javascript
try {
  const jobId = await job.save();
  await job.refresh();
  await job.ready();
  console.log('Job ready');
} catch (error) {
  console.error(error);
}
```

### Issue 3: Reactive Queries

**Problem:** Find queries not updating reactively in async context.

**Solution:** Use cursor observation for reactive updates:

```javascript
// Client-side reactive job list
Template.jobList.onCreated(function() {
  this.jobs = new ReactiveVar([]);
  
  this.autorun(async () => {
    const handle = this.subscribe('userJobs', Meteor.userId());
    
    if (handle.ready()) {
      const cursor = myJobs.find({ 'data.userId': Meteor.userId() });
      
      // Use observe for reactivity
      cursor.observe({
        added: (doc) => {
          const jobs = this.jobs.get();
          jobs.push(doc);
          this.jobs.set(jobs);
        },
        changed: (newDoc, oldDoc) => {
          const jobs = this.jobs.get();
          const index = jobs.findIndex(j => j._id === newDoc._id);
          if (index !== -1) {
            jobs[index] = newDoc;
            this.jobs.set(jobs);
          }
        },
        removed: (doc) => {
          const jobs = this.jobs.get();
          this.jobs.set(jobs.filter(j => j._id !== doc._id));
        }
      });
    }
  });
});
```

### Issue 4: Worker Memory Leaks

**Problem:** Workers not cleaning up properly.

**Solution:** Implement proper cleanup:

```javascript
let queue;

Meteor.startup(async () => {
  queue = myJobs.processJobs('worker', {
    concurrency: 4
  }, async (job, cb) => {
    // Process job
    await processJob(job);
    cb();
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down workers...');
  if (queue) {
    queue.shutdown({ quiet: true, level: 'soft' }, () => {
      process.exit(0);
    });
  }
});
```

## Performance Optimization

### 1. Batch Operations

```javascript
// Instead of individual operations
for (const jobData of jobDataArray) {
  const job = new Job(myJobs, 'batch', jobData);
  await job.save();
}

// Use Promise.all for parallel saves
const savePromises = jobDataArray.map(jobData => {
  const job = new Job(myJobs, 'batch', jobData);
  return job.save();
});

await Promise.all(savePromises);
```

### 2. Optimize Worker Concurrency

```javascript
// Adjust based on your server capacity
const optimalConcurrency = Meteor.settings.workerConcurrency || 4;

myJobs.processJobs('heavyWork', {
  concurrency: optimalConcurrency,
  prefetch: optimalConcurrency * 2,
  pollInterval: 1000
}, async (job, cb) => {
  // Worker implementation
  cb();
});
```

### 3. Use Indexes

```javascript
// Add custom indexes for better query performance
Meteor.startup(async () => {
  await myJobs.createIndexAsync({ 'data.userId': 1, status: 1 });
  await myJobs.createIndexAsync({ type: 1, priority: -1, created: 1 });
});
```

## Testing Your Migration

### 1. Unit Test Example

```javascript
// tests/job-creation.test.js
import { expect } from 'chai';
import { Job, JobCollection } from 'meteor/vsivsi:job-collection';

if (Meteor.isServer) {
  describe('Job Creation', () => {
    let testJobs;
    
    beforeEach(async () => {
      testJobs = new JobCollection('test');
      await testJobs.removeAsync({});
    });
    
    it('should create and save a job', async () => {
      const job = new Job(testJobs, 'test', { foo: 'bar' });
      const jobId = await job.save();
      
      expect(jobId).to.be.a('string');
      
      const savedJob = await testJobs.findOneAsync(jobId);
      expect(savedJob.type).to.equal('test');
      expect(savedJob.data).to.deep.equal({ foo: 'bar' });
    });
  });
}
```

### 2. Integration Test Example

```javascript
// tests/worker-processing.test.js
describe('Worker Processing', () => {
  it('should process jobs', async () => {
    const processedJobs = [];
    
    const queue = testJobs.processJobs('integration', {
      concurrency: 1
    }, async (job, cb) => {
      processedJobs.push(job.data);
      await job.done();
      cb();
    });
    
    // Create test job
    const job = new Job(testJobs, 'integration', { test: true });
    await job.save();
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    expect(processedJobs).to.have.lengthOf(1);
    expect(processedJobs[0]).to.deep.equal({ test: true });
    
    queue.shutdown();
  });
});
```

## Migration Checklist

### Pre-Migration
- [ ] Backup your database
- [ ] Update Meteor to 3.2+
- [ ] Update Node.js to 20+
- [ ] Update MongoDB to 7.0+
- [ ] Review all job processing code

### Code Updates
- [ ] Update package version
- [ ] Convert all server methods to async
- [ ] Update all MongoDB operations to async
- [ ] Convert Meteor.call to Meteor.callAsync
- [ ] Update worker functions to async
- [ ] Update publications if needed
- [ ] Fix all callback-based code

### Testing
- [ ] All unit tests passing
- [ ] Integration tests working
- [ ] Worker processing functional
- [ ] Job lifecycle complete
- [ ] Performance acceptable

### Deployment
- [ ] Test in staging environment
- [ ] Monitor for errors
- [ ] Check performance metrics
- [ ] Verify job processing
- [ ] Document any issues

## Resources

### Documentation
- [Meteor 3.0 Migration Guide](https://v3-migration-docs.meteor.com/)
- [Job Collection API Documentation](https://github.com/vsivsi/meteor-job-collection)
- [Meteor Forums](https://forums.meteor.com/)

### Tools
- [ESLint Meteor Plugin](https://www.npmjs.com/package/eslint-plugin-meteor)
- [Meteor TypeScript](https://docs.meteor.com/api/typescript.html)

### Support
- GitHub Issues: [Report bugs](https://github.com/yourusername/meteor-job-collection/issues)
- Discord/Slack: Meteor community channels
- Stack Overflow: Tag with `meteor` and `job-collection`

## Conclusion

Migrating to Meteor 3.x with the updated job-collection package primarily involves:

1. Converting all code to use async/await
2. Updating MongoDB operations to use async methods
3. Ensuring proper error handling with try/catch
4. Testing thoroughly before deployment

The migration effort is worthwhile as it provides:
- Better performance through native async operations
- Improved error handling
- Modern JavaScript patterns
- Future compatibility with Node.js ecosystem

Take your time with the migration, test thoroughly, and don't hesitate to reach out for help if needed.
