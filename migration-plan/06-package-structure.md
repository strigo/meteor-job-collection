# Package Structure and Dependencies

## Overview

This document outlines the new package structure, dependency updates, and file organization for the Meteor 3.x compatible version of meteor-job-collection.

## New Directory Structure

```
meteor-job-collection/
├── package.js                 # Meteor package configuration
├── package.json               # NPM dependencies
├── README.md                  # Updated documentation
├── LICENSE
├── HISTORY.md                 # Changelog
├── .eslintrc.json            # ESLint configuration
├── .prettierrc               # Prettier configuration
│
├── lib/                      # Main source code (JavaScript)
│   ├── common/              # Shared client/server code
│   │   ├── shared.js        # JobCollectionBase class
│   │   └── job_class.js    # Job class
│   ├── server/              # Server-only code
│   │   └── server.js        # Server JobCollection implementation
│   └── client/              # Client-only code
│       └── client.js        # Client JobCollection implementation
│
├── src-legacy/              # Original CoffeeScript (archived)
│   ├── shared.coffee
│   ├── server.coffee
│   └── client.coffee
│
├── job/                     # NPM package (meteor-job)
│   ├── package.json
│   ├── index.js            # Main entry point
│   └── lib/
│       └── job.js          # Standalone Job class
│
├── test/                    # Test files
│   ├── job_collection_tests.js
│   ├── async_tests.js
│   ├── migration_tests.js
│   └── helpers/
│       └── test_helpers.js
│
├── examples/                # Example implementations
│   ├── basic-queue/
│   ├── worker-pool/
│   └── scheduled-jobs/
│
└── migration-plan/          # Migration documentation
    └── ...
```

## Package.js Configuration

### Complete package.js for Meteor 3.x

```javascript
/* global Package, Npm */

Package.describe({
  name: 'vsivsi:job-collection',
  version: '2.0.0',
  summary: 'A persistent and reactive job queue for Meteor 3.x, supporting distributed workers',
  git: 'https://github.com/yourusername/meteor-job-collection.git',
  documentation: 'README.md'
});

// NPM dependencies
Npm.depends({
  'later': '1.2.0',  // For job scheduling (if not using synced-cron)
  'eventemitter3': '5.0.1'  // Lighter EventEmitter implementation
});

Package.onUse(function(api) {
  // Minimum Meteor version
  api.versionsFrom(['3.0']);
  
  // Core Meteor packages
  api.use([
    'ecmascript@0.16.8',        // ES6+ support
    'mongo@2.0.0',              // MongoDB driver with async support
    'check@1.3.2',              // Argument checking
    'random@1.2.1',             // Random ID generation
    'ddp@1.4.1',                // DDP protocol
    'ejson@1.1.3',              // Extended JSON
    'minimongo@2.0.0',          // Client-side Mongo
    'tracker@1.3.3',            // Dependency tracking (client)
    'reactive-var@1.0.13'       // Reactive variables (client)
  ]);
  
  // Weak dependencies (optional)
  api.use([
    'accounts-base@3.0.0'       // For user authentication
  ], ['client', 'server'], { weak: true });
  
  // Server-only weak dependencies
  api.use([
    'email@3.0.0'               // For job notifications
  ], 'server', { weak: true });
  
  // Add source files
  // Common files (both client and server)
  api.addFiles([
    'lib/common/shared.js',
    'lib/common/job_class.js'
  ], ['client', 'server']);
  
  // Server-only files
  api.addFiles([
    'lib/server/server.js'
  ], 'server');
  
  // Client-only files
  api.addFiles([
    'lib/client/client.js'
  ], 'client');
  
  // Export the main classes
  api.export('Job', ['client', 'server']);
  api.export('JobCollection', ['client', 'server']);
  
  // For testing purposes
  api.export('_JobCollectionBase', ['client', 'server'], { testOnly: true });
});

Package.onTest(function(api) {
  // Use the package itself
  api.use('vsivsi:job-collection');
  
  // Testing packages
  api.use([
    'ecmascript',
    'tinytest@1.2.2',
    'test-helpers@1.3.1',
    'mongo',
    'random',
    'ddp'
  ]);
  
  // Add test files
  api.addFiles([
    'test/helpers/test_helpers.js',
    'test/job_collection_tests.js',
    'test/async_tests.js',
    'test/migration_tests.js'
  ], ['client', 'server']);
  
  // Server-only tests
  api.addFiles([
    'test/server_specific_tests.js'
  ], 'server');
  
  // Client-only tests
  api.addFiles([
    'test/client_specific_tests.js'
  ], 'client');
});
```

## NPM Package Configuration

### package.json for the Meteor package

```json
{
  "name": "meteor-job-collection",
  "private": true,
  "version": "2.0.0",
  "description": "A persistent and reactive job queue for Meteor 3.x",
  "main": "index.js",
  "scripts": {
    "test": "meteor test-packages ./",
    "test:watch": "TEST_WATCH=1 meteor test-packages ./",
    "lint": "eslint lib/ test/",
    "lint:fix": "eslint lib/ test/ --fix",
    "format": "prettier --write 'lib/**/*.js' 'test/**/*.js'",
    "convert": "bash scripts/convert.sh",
    "build:npm": "cd job && npm run build"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/meteor-job-collection.git"
  },
  "keywords": [
    "meteor",
    "job",
    "queue",
    "task",
    "worker",
    "async",
    "mongodb"
  ],
  "author": "Your Name",
  "license": "MIT",
  "devDependencies": {
    "@babel/core": "^7.23.0",
    "@babel/preset-env": "^7.23.0",
    "chai": "^4.3.10",
    "decaffeinate": "^7.0.0",
    "eslint": "^8.52.0",
    "eslint-config-meteor": "^1.0.0",
    "eslint-plugin-meteor": "^7.3.0",
    "mocha": "^10.2.0",
    "prettier": "^3.0.3",
    "sinon": "^17.0.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

### job/package.json for the NPM package

```json
{
  "name": "meteor-job",
  "version": "2.0.0",
  "description": "Job class for Meteor job-collection, usable in Node.js and Meteor",
  "main": "lib/job.js",
  "types": "lib/job.d.ts",
  "scripts": {
    "build": "babel src --out-dir lib",
    "prepare": "npm run build",
    "test": "mocha test/*.js"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/meteor-job.git"
  },
  "keywords": [
    "meteor",
    "job",
    "queue",
    "ddp",
    "node"
  ],
  "author": "Your Name",
  "license": "MIT",
  "dependencies": {
    "ddp": "^0.12.0",
    "ddp-login": "^1.0.0",
    "later": "^1.2.0"
  },
  "devDependencies": {
    "@babel/cli": "^7.23.0",
    "@babel/core": "^7.23.0",
    "@babel/preset-env": "^7.23.0",
    "chai": "^4.3.10",
    "mocha": "^10.2.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

## TypeScript Definitions

### lib/common/job_class.d.ts

```typescript
declare module 'meteor/vsivsi:job-collection' {
  import { Mongo } from 'meteor/mongo';
  
  export interface JobDocument {
    _id?: string;
    runId?: string | null;
    type: string;
    status: 'waiting' | 'paused' | 'ready' | 'running' | 'failed' | 'cancelled' | 'completed';
    data: any;
    result?: any;
    failures?: Array<{
      runId: string;
      time: Date;
      err: any;
    }>;
    priority: number;
    depends: string[];
    resolved: string[];
    after: Date;
    updated: Date;
    created: Date;
    workTimeout?: number;
    expiresAfter?: Date;
    log?: Array<{
      time: Date;
      runId: string | null;
      level: 'info' | 'success' | 'warning' | 'danger';
      message: string;
      data?: any;
    }>;
    progress: {
      completed: number;
      total: number;
      percent: number;
    };
    retries: number;
    retried: number;
    repeatRetries?: number;
    retryUntil: Date;
    retryWait: number;
    retryBackoff: 'constant' | 'exponential';
    repeats: number;
    repeated: number;
    repeatUntil: Date;
    repeatWait: number | any; // number or later.js object
  }
  
  export interface JobOptions {
    cancelRepeats?: boolean;
  }
  
  export interface JobProgressOptions {
    echo?: boolean;
  }
  
  export interface JobLogOptions {
    level?: 'info' | 'success' | 'warning' | 'danger';
    echo?: boolean;
    data?: any;
  }
  
  export interface JobDoneOptions {
    repeatId?: boolean;
    delayDeps?: number;
  }
  
  export interface JobFailOptions {
    fatal?: boolean;
  }
  
  export class Job {
    static forever: number;
    static foreverDate: Date;
    static jobPriorities: {
      low: number;
      normal: number;
      medium: number;
      high: number;
      critical: number;
    };
    static jobRetryBackoffMethods: string[];
    static jobStatuses: string[];
    static jobLogLevels: string[];
    static jobStatusCancellable: string[];
    static jobStatusPausable: string[];
    static jobStatusRemovable: string[];
    static jobStatusRestartable: string[];
    
    constructor(root: JobCollection | string, type: string | JobDocument, data?: any);
    
    doc: JobDocument;
    type: string;
    data: any;
    
    // Configuration methods (chainable)
    priority(level: string | number): this;
    retry(options: any): this;
    repeat(options: any): this;
    delay(wait: number): this;
    after(time: Date): this;
    depends(jobs: Job | Job[] | string | string[]): this;
    
    // Async action methods
    save(options?: JobOptions): Promise<string>;
    save(options: JobOptions, callback: (err: Error | null, id?: string) => void): void;
    save(callback: (err: Error | null, id?: string) => void): void;
    
    refresh(options?: any): Promise<boolean>;
    refresh(options: any, callback: (err: Error | null, result?: boolean) => void): void;
    refresh(callback: (err: Error | null, result?: boolean) => void): void;
    
    log(message: string, options?: JobLogOptions): Promise<boolean>;
    log(message: string, options: JobLogOptions, callback: (err: Error | null, result?: boolean) => void): void;
    log(message: string, callback: (err: Error | null, result?: boolean) => void): void;
    
    progress(completed: number, total: number, options?: JobProgressOptions): Promise<boolean>;
    progress(completed: number, total: number, options: JobProgressOptions, callback: (err: Error | null, result?: boolean) => void): void;
    progress(completed: number, total: number, callback: (err: Error | null, result?: boolean) => void): void;
    
    done(result?: any, options?: JobDoneOptions): Promise<boolean | string>;
    done(result: any, options: JobDoneOptions, callback: (err: Error | null, result?: boolean | string) => void): void;
    done(result: any, callback: (err: Error | null, result?: boolean | string) => void): void;
    done(callback: (err: Error | null, result?: boolean | string) => void): void;
    
    fail(err?: any, options?: JobFailOptions): Promise<boolean>;
    fail(err: any, options: JobFailOptions, callback: (err: Error | null, result?: boolean) => void): void;
    fail(err: any, callback: (err: Error | null, result?: boolean) => void): void;
    fail(callback: (err: Error | null, result?: boolean) => void): void;
    
    pause(options?: any): Promise<boolean>;
    pause(options: any, callback: (err: Error | null, result?: boolean) => void): void;
    pause(callback: (err: Error | null, result?: boolean) => void): void;
    
    resume(options?: any): Promise<boolean>;
    resume(options: any, callback: (err: Error | null, result?: boolean) => void): void;
    resume(callback: (err: Error | null, result?: boolean) => void): void;
    
    ready(options?: any): Promise<boolean>;
    ready(options: any, callback: (err: Error | null, result?: boolean) => void): void;
    ready(callback: (err: Error | null, result?: boolean) => void): void;
    
    cancel(options?: any): Promise<boolean>;
    cancel(options: any, callback: (err: Error | null, result?: boolean) => void): void;
    cancel(callback: (err: Error | null, result?: boolean) => void): void;
    
    restart(options?: any): Promise<boolean>;
    restart(options: any, callback: (err: Error | null, result?: boolean) => void): void;
    restart(callback: (err: Error | null, result?: boolean) => void): void;
    
    rerun(options?: any): Promise<boolean>;
    rerun(options: any, callback: (err: Error | null, result?: boolean) => void): void;
    rerun(callback: (err: Error | null, result?: boolean) => void): void;
    
    remove(options?: any): Promise<boolean>;
    remove(options: any, callback: (err: Error | null, result?: boolean) => void): void;
    remove(callback: (err: Error | null, result?: boolean) => void): void;
    
    // Static methods
    static processJobs(
      root: string | JobCollection,
      type: string | string[],
      options: any,
      worker: (job: Job, cb: () => void) => void
    ): any; // Returns JobQueue
    
    static getWork(
      root: string | JobCollection,
      type: string | string[],
      options?: any
    ): Promise<Job | Job[]>;
    
    static getJob(
      root: string | JobCollection,
      id: string,
      options?: any
    ): Promise<Job | undefined>;
  }
  
  export interface JobCollectionOptions {
    connection?: any;
    idGeneration?: string;
    transform?: (doc: any) => any;
    noCollectionSuffix?: boolean;
  }
  
  export interface WorkOptions {
    maxJobs?: number;
    workTimeout?: number;
  }
  
  export interface ProcessOptions {
    concurrency?: number;
    payload?: number;
    pollInterval?: number;
    prefetch?: number;
    workTimeout?: number;
  }
  
  export class JobCollection extends Mongo.Collection<JobDocument> {
    constructor(root?: string, options?: JobCollectionOptions);
    
    root: string;
    stopped: boolean;
    logStream: any;
    later: any;
    
    // Allow/Deny rules
    allow(rules: any): void;
    deny(rules: any): void;
    
    // Server control
    startJobServer(options?: any): Promise<boolean>;
    shutdownJobServer(options?: any): Promise<boolean>;
    
    // Job management
    getJob(id: string, options?: any): Promise<Job | undefined>;
    getWork(type: string | string[], options?: WorkOptions): Promise<Job | Job[] | undefined>;
    
    // Job processing
    processJobs(
      type: string | string[],
      options: ProcessOptions,
      worker: (job: Job, cb: () => void) => void
    ): JobQueue;
    
    // Events (server-only)
    events?: any;
    
    // Configuration
    promote(milliseconds?: number): void;
    setLogStream(stream: any): this;
  }
  
  export interface JobQueue {
    pause(): void;
    resume(): void;
    shutdown(options?: any, callback?: () => void): void;
    trigger(): void;
    length(): number;
    full(): boolean;
    running(): number;
    idle(): boolean;
  }
}
```

## Dependency Analysis

### Core Dependencies

1. **ecmascript**: Required for ES6+ features
2. **mongo**: Async MongoDB operations
3. **check**: Type validation
4. **random**: ID generation
5. **ddp**: Method communication
6. **ejson**: Extended JSON support

### Optional Dependencies

1. **accounts-base**: User authentication
2. **email**: Job notifications
3. **synced-cron**: Scheduled jobs

### Removed Dependencies

1. **coffeescript**: No longer needed
2. **mrt:later**: Replaced with NPM package or synced-cron
3. **fibers**: Not compatible with Meteor 3.x

## Build and Release Process

### 1. Build Script

Create `scripts/build.sh`:

```bash
#!/bin/bash

echo "Building meteor-job-collection for Meteor 3.x..."

# Clean previous builds
rm -rf lib/

# Convert CoffeeScript if needed
if [ -d "src" ]; then
  echo "Converting CoffeeScript files..."
  npm run convert
fi

# Format code
echo "Formatting code..."
npm run format

# Lint code
echo "Linting code..."
npm run lint:fix

# Run tests
echo "Running tests..."
npm test

# Build NPM package
echo "Building NPM package..."
cd job
npm run build
cd ..

echo "Build complete!"
```

### 2. Release Checklist

```markdown
## Release Checklist

### Pre-release
- [ ] All tests passing
- [ ] Code linted and formatted
- [ ] TypeScript definitions updated
- [ ] Documentation updated
- [ ] HISTORY.md updated with changes
- [ ] Package version bumped

### Testing
- [ ] Test with Meteor 3.2+
- [ ] Test with MongoDB 7.0+
- [ ] Test client/server functionality
- [ ] Test worker processing
- [ ] Performance benchmarks completed

### Release
- [ ] Tag release in git
- [ ] Publish to Atmosphere
- [ ] Publish NPM package
- [ ] Update README with version
- [ ] Announce on forums

### Post-release
- [ ] Monitor for issues
- [ ] Respond to user feedback
- [ ] Plan next iteration
```

## Migration Path for Users

### For Atmosphere Users

```bash
# Remove old version
meteor remove vsivsi:job-collection

# Add new version
meteor add vsivsi:job-collection@2.0.0
```

### For NPM Users

```bash
# Update package.json
npm uninstall meteor-job
npm install meteor-job@2.0.0
```

### Code Updates Required

```javascript
// Before (Meteor 2.x)
const job = jc.findOne({ _id: jobId });
job.done();

// After (Meteor 3.x)
const job = await jc.findOneAsync({ _id: jobId });
await job.done();
```

## Testing Strategy

### 1. Unit Tests

- Test each class method
- Test async behavior
- Test error conditions
- Test edge cases

### 2. Integration Tests

- Test client-server communication
- Test job lifecycle
- Test worker processing
- Test dependencies

### 3. Performance Tests

- Benchmark job throughput
- Test memory usage
- Test with large job volumes
- Compare with Meteor 2.x version

## Maintenance Considerations

### 1. Version Support

- Support Meteor 3.0+
- Node.js 20+
- MongoDB 7.0+

### 2. Deprecation Strategy

- Mark old methods as deprecated
- Provide migration warnings
- Remove in next major version

### 3. Documentation

- Keep README updated
- Maintain API documentation
- Provide migration guides
- Include examples

## Next Steps

1. Implement new package structure
2. Update all dependencies
3. Add TypeScript definitions
4. Create build automation
5. Test with Meteor 3.2+
6. Prepare for release
