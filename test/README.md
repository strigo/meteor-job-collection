# Tests - To Be Migrated

The original CoffeeScript tests have been removed as part of the v2.0 modernization.

## Status

- ❌ Old CoffeeScript tests removed
- ⏳ TypeScript tests need to be written

## What's Needed

The test suite needs to be rewritten in TypeScript to match the new async/await architecture.

### Original Test File

The original test file was `job_collection_tests.coffee` (~580 lines) and covered:
- Job creation and lifecycle
- Job dependencies
- Job retries and repeats
- Job queues and workers
- Bulk operations
- Security (allow/deny)
- DDP methods

### New Test Structure

Tests should be written in TypeScript:

```typescript
// test/job-collection-tests.ts
import { Tinytest } from 'meteor/tinytest';
import { JobCollection, Job } from 'meteor/vsivsi:job-collection';

Tinytest.addAsync('Job - create and save', async (test) => {
  const myJobs = new JobCollection('testQueue');
  
  const job = new Job(myJobs, 'testJob', { data: 'test' });
  const id = await job.save();
  
  test.isTrue(!!id, 'Job should have an ID after save');
});

Tinytest.addAsync('Job - worker processing', async (test, onComplete) => {
  const myJobs = new JobCollection('testQueue');
  
  const job = new Job(myJobs, 'testWork', { value: 42 });
  await job.save();
  
  const workers = myJobs.processJobs('testWork', async (job, callback) => {
    test.equal(job.data.value, 42);
    await job.done();
    callback();
    workers.shutdown({ level: 'soft' }, () => {
      onComplete();
    });
  });
});
```

### Running Tests

Once tests are written:

```bash
# Run all tests
meteor test-packages ./

# Run with specific reporter
meteor test-packages --driver-package meteortesting:mocha ./
```

### Test Coverage Areas

1. **Job Lifecycle**
   - Creation, save, refresh
   - Status transitions (waiting → ready → running → completed)
   - Pause/resume
   - Cancel/restart

2. **Job Operations**
   - done(), fail()
   - log(), progress()
   - retry() configuration
   - repeat() configuration

3. **Dependencies**
   - Job depends on other jobs
   - Dependency resolution
   - Failure cascades

4. **JobCollection**
   - getJob(), getJobs()
   - getWork()
   - Bulk operations (pauseJobs, resumeJobs, etc.)
   - readyJobs()

5. **JobQueue**
   - Worker processing
   - Concurrency
   - Payload
   - Error handling
   - Shutdown

6. **Security**
   - allow/deny rules
   - Permission levels (admin, manager, creator, worker)
   - Method authorization

7. **Async/Await**
   - All methods return promises
   - Callback compatibility
   - Error handling

8. **TypeScript**
   - Type checking
   - Generic types
   - Inference

### Contributing Tests

If you'd like to contribute tests, please:

1. Write tests in TypeScript
2. Use async/await patterns
3. Test both promise and callback APIs
4. Include edge cases
5. Add comments for complex scenarios

### Migration Priority

**High Priority:**
- Basic job lifecycle tests
- Worker processing tests
- DDP method tests

**Medium Priority:**
- Dependency tests
- Retry/repeat tests
- Security tests

**Low Priority:**
- Performance tests
- Edge case tests
- Integration tests

## Resources

- [Meteor Testing Guide](https://guide.meteor.com/testing.html)
- [Tinytest Documentation](https://docs.meteor.com/api/tinytest.html)
- [Original test file](https://github.com/vsivsi/meteor-job-collection/blob/v1.5.2/test/job_collection_tests.coffee) (for reference)

