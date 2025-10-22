# meteor-job-collection v2.0

[![Atmosphere](https://img.shields.io/badge/meteor-strigo%3Ajob--collection-blue)](https://atmospherejs.com/strigo/job-collection)
[![npm](https://img.shields.io/badge/npm-%40strigo%2Fmeteor--job--collection-red)](https://www.npmjs.com/package/@strigo/meteor-job-collection)
[![GitHub](https://img.shields.io/github/stars/strigo/meteor-job-collection?style=social)](https://github.com/strigo/meteor-job-collection)

## Persistent Reactive Job Queue for Meteor 3.x

A powerful and easy-to-use job queue for Meteor, supporting distributed workers that can run anywhere. **Version 2.0** is completely rewritten in **TypeScript** with full **async/await** support for Meteor 3.x and Node.js 18+.

> **Note:** This is a modernized TypeScript fork of the original [vsivsi:job-collection](https://github.com/vsivsi/meteor-job-collection). All credit for the original design and implementation goes to Vaughn Iverson.

### ✨ What's New in v2.0

- 🔄 **Full async/await support** - Modern promise-based API
- 📘 **TypeScript** - Complete type definitions included  
- 🚀 **Meteor 3.x compatible** - No Fibers dependency (100% removed)
- ⚡ **Node.js 22 ready** - Supports Node 18, 20, and 22
- 🔙 **Backward compatible** - Callback APIs still supported
- 🎯 **Better performance** - Faster with native promises

### 🚨 Upgrading from v1.x?

**Key Changes:**
- Meteor 3.0+ and Node.js 18+ now required
- All methods now return Promises - use `async/await` or callbacks
- No Fibers dependency - pure async/await throughout
- Use `setJobAllow`/`setJobDeny` for permissions (or `allow`/`deny` for backward compat)

```javascript
// OLD (v1.x with Fibers)
const job = myJobs.getJob(id);
job.done();

// NEW (v2.x)
const job = await myJobs.getJob(id);
await job.done();
```

---

## 📦 Installation

### For Meteor Apps (Recommended)

```bash
meteor add strigo:job-collection
```

Use this in your Meteor application (server and client code).

### For Standalone Node.js Workers

```bash
npm install @strigo/meteor-job-collection
```

Use this for remote workers that connect to your Meteor app via DDP.

**Requirements:**
- Meteor 3.0+ (for Meteor apps)
- Node.js 18+ (20+ or 22 recommended)
- MongoDB 5.0+

**Which one should I use?**
- 🏠 **Meteor App**: Use `meteor add strigo:job-collection`
- 🚀 **Remote Workers**: Use `npm install @strigo/meteor-job-collection`
- 📊 **Both**: Meteor package in your app + npm package for scaled workers

---

## 🚀 Quick Start

### Server Setup

```javascript
import { JobCollection } from 'meteor/strigo:job-collection';

// Create job collection
const myJobs = new JobCollection('myJobQueue');

// Set up permissions
myJobs.setJobAllow({
  admin: (userId) => !!userId  // Authenticated users only
});

// Start server on startup
Meteor.startup(async () => {
  await myJobs.startJobServer();
});

// Publish jobs (optional)
Meteor.publish('allJobs', function() {
  return myJobs.find({});
});
```

### Create and Submit Jobs

```javascript
import { Job } from 'meteor/strigo:job-collection';

// Create a job with async/await
async function scheduleEmail() {
  const job = new Job(myJobs, 'sendEmail', {
    to: 'user@example.com',
    subject: 'Hello',
    body: 'Welcome!'
  });

  const id = await job
    .priority('normal')
    .retry({ retries: 5, wait: 15*60*1000 })  // 15 min between retries
    .save();

  return id;
}
```

### Process Jobs (Workers)

```javascript
// Worker with async/await
myJobs.processJobs(
  'sendEmail',
  { concurrency: 4 },
  async (job, callback) => {
    try {
      await sendEmail(job.data);
      await job.done();
    } catch (error) {
      await job.fail(error.message);
    }
    callback();  // Always call callback!
  }
);
```

---

## 📖 Core Concepts

### Job Lifecycle

```
waiting → ready → running → completed
   ↓        ↓        ↓
paused   ready    failed → waiting (retry)
   ↓                 ↓
waiting          cancelled
```

### Job Configuration

```javascript
const job = new Job(myJobs, 'processImage', data)
  .priority('high')              // low, normal, medium, high, critical
  .retry({
    retries: 5,
    wait: 5*60*1000,             // 5 minutes between retries
    backoff: 'exponential'        // or 'constant'
  })
  .repeat({
    repeats: 10,                  // or Job.forever
    wait: 60*60*1000             // 1 hour between repeats
  })
  .delay(30*1000)                // Delay 30 seconds
  .depends([job1, job2])         // Wait for dependencies
  .after(new Date('2024-01-01')) // Run after date
  .save();
```

---

## 🔧 TypeScript Support

Full type safety out of the box:

```typescript
import { Job, JobCollection } from 'meteor/strigo:job-collection';

// Define job data types
interface EmailJobData {
  to: string;
  subject: string;
  body: string;
}

// Type-safe job creation
const job = new Job<EmailJobData>(myJobs, 'sendEmail', {
  to: 'user@example.com',
  subject: 'Hello',
  body: 'Welcome!'
});

// Type-safe workers
myJobs.processJobs<EmailJobData>(
  'sendEmail',
  async (job, callback) => {
    const { to, subject, body } = job.data;  // Fully typed!
    await sendEmail(to, subject, body);
    await job.done();
    callback();
  }
);
```

---

## 🎯 API Reference

### Job Methods

All methods support both `async/await` and callbacks:

```javascript
// With async/await
const id = await job.save();
await job.done(result);
await job.fail(error);
await job.log('message', { level: 'info' });
await job.progress(50, 100);
await job.pause();
await job.resume();
await job.cancel();
await job.restart();
await job.remove();

// With callbacks (backward compatible)
job.save((err, id) => { /* ... */ });
job.done(result, (err, success) => { /* ... */ });
```

**Job Creation:**
- `new Job(collection, type, data)` - Create new job
- `.priority(level)` - Set priority (low/normal/medium/high/critical)
- `.retry(options)` - Configure retry behavior
- `.repeat(options)` - Configure repeat behavior
- `.delay(ms)` - Delay before first run
- `.after(date)` - Run after specific date
- `.depends(jobs)` - Set job dependencies
- `.save([options])` - Save to collection

**Job Control:**
- `job.refresh()` - Reload from server
- `job.done([result])` - Mark as completed
- `job.fail([error])` - Mark as failed
- `job.pause()` - Pause job
- `job.resume()` - Resume paused job
- `job.cancel()` - Cancel job
- `job.restart()` - Restart failed/cancelled job
- `job.rerun()` - Clone and rerun completed job
- `job.remove()` - Remove from collection
- `job.ready()` - Force to ready state

**Job Monitoring:**
- `job.log(message, [options])` - Add log entry
- `job.progress(completed, total)` - Update progress

### JobCollection Methods

```javascript
// Get jobs
await myJobs.getJob(id)
await myJobs.getJobs([id1, id2, id3])
await myJobs.getWork(type, options)

// Bulk operations
await myJobs.readyJobs([id1, id2])
await myJobs.pauseJobs([id1, id2])
await myJobs.resumeJobs([id1, id2])
await myJobs.cancelJobs([id1, id2])
await myJobs.restartJobs([id1, id2])
await myJobs.removeJobs([id1, id2])

// Server control
await myJobs.startJobServer()
await myJobs.shutdownJobServer({ timeout: 60000 })

// Worker queue
const workers = myJobs.processJobs(type, options, worker)
```

### JobQueue Methods (Workers)

```javascript
const workers = myJobs.processJobs('type', options, worker);

workers.pause()          // Pause processing
workers.resume()         // Resume processing
workers.trigger()        // Manually trigger work check
workers.length()         // Jobs waiting in queue
workers.running()        // Jobs currently running
workers.idle()           // True if no jobs
workers.full()           // True if at max concurrency

// Graceful shutdown
workers.shutdown({ level: 'soft' }, () => {
  console.log('Shutdown complete');
});
```

---

## 🔒 Security

Fine-grained permission control:

```javascript
// Use setJobAllow/setJobDeny (or allow/deny for backward compatibility)
myJobs.setJobAllow({
  // Admin: full control
  admin: (userId, method, params) => {
    return Roles.userIsInRole(userId, 'admin');
  },
  
  // Manager: can manage existing jobs
  manager: (userId, method, params) => {
    return Roles.userIsInRole(userId, 'manager');
  },
  
  // Creator: can create new jobs
  creator: (userId, method, params) => {
    return userId !== null;
  },
  
  // Worker: can get work and update status
  worker: (userId, method, params) => {
    return Roles.userIsInRole(userId, 'worker');
  }
});

// Deny rules (override allow)
myJobs.setJobDeny({
  admin: (userId) => userId === 'bannedUserId'
});

// Note: You can also use allow/deny for backward compatibility
// myJobs.allow({ ... }) and myJobs.deny({ ... }) work the same way
```

---

## 📡 Remote Workers (Node.js)

Run workers outside Meteor:

```javascript
// worker.js
import DDP from 'ddp';
import DDPLogin from 'ddp-login';
import { Job } from '@strigo/meteor-job-collection';

const ddp = new DDP({
  host: 'localhost',
  port: 3000,
  use_ejson: true
});

Job.setDDP(ddp);

ddp.connect(async (err) => {
  if (err) throw err;
  
  await DDPLogin(ddp, { /* credentials */ });
  
  const workers = Job.processJobs(
    'myQueue',
    'sendEmail',
    { concurrency: 10 },
    async (job, callback) => {
      await sendEmail(job.data);
      await job.done();
      callback();
    }
  );
});
```

---

## 🔄 Advanced Features

### Job Dependencies

```javascript
// Job 2 waits for Job 1
const job1 = await new Job(myJobs, 'download', data).save();
const job2 = await new Job(myJobs, 'process', data)
  .depends([job1])
  .save();
```

### Scheduled Jobs (Later.js)

```javascript
const job = new Job(myJobs, 'dailyReport', {})
  .repeat({
    schedule: myJobs.later.parse.text('at 9:00 am every weekday')
  })
  .save();
```

### Progress Tracking

```javascript
myJobs.processJobs('process', async (job, callback) => {
  const total = 100;
  for (let i = 0; i < total; i++) {
    await processItem(i);
    await job.progress(i + 1, total);
  }
  await job.done();
  callback();
});
```

### Logging

```javascript
// Set up file logging
import fs from 'fs';
const logStream = fs.createWriteStream('jobs.log', { flags: 'a' });
myJobs.setLogStream(logStream);

// Or use event-based logging
myJobs.events.on('call', (msg) => {
  console.log(`${msg.method}:`, msg.returnVal);
});
```

---

## 🧹 Maintenance

### Cleaning Up Old Jobs

```javascript
// Periodic cleanup
async function cleanupJobs() {
  const weekAgo = new Date(Date.now() - 7*24*60*60*1000);
  const oldJobs = await myJobs
    .find({
      status: { $in: ['completed', 'cancelled'] },
      updated: { $lt: weekAgo }
    })
    .fetchAsync();
  
  const ids = oldJobs.map(j => j._id);
  await myJobs.removeJobs(ids);
}

// Schedule cleanup job
new Job(myJobs, 'cleanup', {})
  .repeat({
    schedule: myJobs.later.parse.text('at 3:00 am')
  })
  .save();

myJobs.processJobs('cleanup', async (job, callback) => {
  await cleanupJobs();
  await job.done();
  callback();
});
```

### Monitoring

```javascript
// Count jobs by status
const stats = await Promise.all([
  myJobs.find({ status: 'waiting' }).countAsync(),
  myJobs.find({ status: 'running' }).countAsync(),
  myJobs.find({ status: 'completed' }).countAsync(),
  myJobs.find({ status: 'failed' }).countAsync()
]);

console.log('Jobs:', {
  waiting: stats[0],
  running: stats[1],
  completed: stats[2],
  failed: stats[3]
});
```

---

## ⚡ Performance Tips

1. **Use appropriate concurrency**
   ```javascript
   myJobs.processJobs('type', { concurrency: 10 }, worker);
   ```

2. **Batch operations**
   ```javascript
   await myJobs.pauseJobs(manyIds);  // Better than loop
   ```

3. **Add indexes** for custom queries
   ```javascript
   await myJobs.createIndexAsync({ type: 1, created: -1 });
   ```

4. **Clean up old jobs** regularly

5. **Use prefetch** to reduce latency
   ```javascript
   myJobs.processJobs('type', { prefetch: 5 }, worker);
   ```

---

## 🐛 Troubleshooting

### Jobs Not Processing?

```javascript
// Check job status
const ready = await myJobs.find({ status: 'ready' }).countAsync();
console.log('Ready jobs:', ready);

// Check worker status
console.log('Running:', workers.running());
console.log('Queued:', workers.length());

// Monitor errors
myJobs.events.on('error', (msg) => {
  console.error('Error:', msg.error);
});
```

### Jobs Stuck in Running?

- Check `workTimeout` configuration
- Look for worker crashes
- Auto-fail for expired jobs is built-in

### Performance Issues?

- Add database indexes
- Increase concurrency
- Use prefetch option
- Clean up old jobs

---

## 🏗️ Building from Source

```bash
# Clone repository
git clone https://github.com/strigo/meteor-job-collection.git
cd meteor-job-collection

# Install dependencies
npm install

# Build TypeScript
npm run build

# Test
meteor test-packages ./
```

---

## 📚 Documentation

### Job Document Schema

```typescript
{
  _id: JobId,
  runId: JobId | null,
  type: string,
  status: 'waiting' | 'paused' | 'ready' | 'running' | 'failed' | 'cancelled' | 'completed',
  data: object,
  result?: object,
  failures?: object[],
  priority: number,
  depends: JobId[],
  resolved: JobId[],
  after: Date,
  updated: Date,
  created: Date,
  workTimeout?: number,
  expiresAfter?: Date,
  log?: LogEntry[],
  progress: { completed: number, total: number, percent: number },
  retries: number,
  retried: number,
  retryUntil: Date,
  retryWait: number,
  retryBackoff: 'constant' | 'exponential',
  repeats: number,
  repeated: number,
  repeatUntil: Date,
  repeatWait: number | LaterJSSchedule
}
```

### DDP Methods

All DDP methods are prefixed with the collection name (e.g., `myQueue_getWork`):

- `startJobServer(options)` - Start server
- `shutdownJobServer(options)` - Stop server
- `getJob(ids, options)` - Get job(s) by ID
- `getWork(type, options)` - Get ready jobs
- `jobSave(doc, options)` - Save job
- `jobRemove(ids)` - Remove jobs
- `jobPause(ids)` - Pause jobs
- `jobResume(ids)` - Resume jobs
- `jobReady(ids, options)` - Ready jobs
- `jobCancel(ids, options)` - Cancel jobs
- `jobRestart(ids, options)` - Restart jobs
- `jobRerun(id, options)` - Rerun job
- `jobLog(id, runId, message, options)` - Add log
- `jobProgress(id, runId, completed, total)` - Update progress
- `jobDone(id, runId, result, options)` - Mark complete
- `jobFail(id, runId, error, options)` - Mark failed

---

## 📄 License

MIT License - Copyright (C) 2014-2024 by Vaughn Iverson

This is a modernized fork with TypeScript and async/await support. Original project: [vsivsi/meteor-job-collection](https://github.com/vsivsi/meteor-job-collection)

---

## 🤝 Contributing

Contributions welcome! Please:

1. Write tests in TypeScript
2. Use async/await patterns
3. Follow existing code style
4. Add documentation
5. Update changelog

### Development Setup

```bash
git clone YOUR_REPO_URL
cd meteor-job-collection
npm install
npm run watch  # Auto-compile on changes
```

### Running Tests

```bash
meteor test-packages ./
```

---

## 🔗 Links

- [Changelog](./HISTORY.md)
- [Test Guide](./test/README.md)
- [Publishing Guide](./PUBLISH.md)
- Original Package: [vsivsi:job-collection](https://github.com/vsivsi/meteor-job-collection)

---

**Made with ❤️ for the Meteor community**
