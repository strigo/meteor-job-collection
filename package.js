/***************************************************************************
###     Copyright (C) 2014-2024 by Vaughn Iverson
###     Modernized with TypeScript and async/await support
###     job-collection is free software released under the MIT/X11 license.
###     See included LICENSE file for details.
***************************************************************************/

const currentVersion = '2.0.1';

Package.describe({
  summary: 'Persistent job queue for Meteor - TypeScript, async/await, Meteor 3.x',
  name: 'strigops:job-collection',
  version: currentVersion,
  git: 'https://github.com/strigo/meteor-job-collection.git'
});

Package.onUse(function(api) {
  // Minimum Meteor version for async/await support
  api.versionsFrom(['3.0']);
  
  // Core dependencies - let Meteor resolve compatible versions
  api.use('mrt:later@1.6.1', ['server','client']);
  api.use('mongo', ['server','client']);
  api.use('check', ['server','client']);
  api.use('ecmascript', ['server','client']);
  
  // Export main entry points (pre-compiled JavaScript, no TypeScript needed at runtime)
  api.mainModule('dist/index.js', 'server');
  api.mainModule('dist/index.js', 'client');
  
  api.export('Job');
  api.export('JobCollection');
});

Package.onTest(function (api) {
  api.use('strigops:job-collection@' + currentVersion, ['server','client']);
  api.use('mrt:later@1.6.1', ['server','client']);
  api.use('check', ['server','client']);
  api.use('tinytest', ['server','client']);
  api.use('test-helpers', ['server','client']);
  api.use('ddp', 'client');
  api.use('ecmascript', ['server','client']);
  
  // TODO: Convert test files to TypeScript
  // api.addFiles('test/job_collection_tests.ts', ['server', 'client']);
});
