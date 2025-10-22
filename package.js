/***************************************************************************
###     Copyright (C) 2014-2024 by Vaughn Iverson
###     Modernized with TypeScript and async/await support
###     job-collection is free software released under the MIT/X11 license.
###     See included LICENSE file for details.
***************************************************************************/

const currentVersion = '2.0.0';

Package.describe({
  summary: 'A persistent and reactive job queue for Meteor, supporting distributed workers that can run anywhere - Modernized with TypeScript and async/await',
  name: 'strigo:job-collection',
  version: currentVersion,
  git: 'https://github.com/strigo/meteor-job-collection.git'
});

Package.onUse(function(api) {
  // Minimum Meteor version for async/await support
  api.versionsFrom(['3.0']);
  
  // Core dependencies
  api.use('mrt:later@1.6.1', ['server','client']);
  api.use('typescript@4.9.4 || 5.4.3', ['server','client']);
  api.use('mongo@2.0.0', ['server','client']);
  api.use('check@1.3.2', ['server','client']);
  api.use('ecmascript@0.16.7', ['server','client']);
  
  // Export main entry points
  api.mainModule('dist/index.js', 'server');
  api.mainModule('dist/index.js', 'client');
  
  api.export('Job');
  api.export('JobCollection');
});

Package.onTest(function (api) {
  api.use('strigo:job-collection@' + currentVersion, ['server','client']);
  api.use('mrt:later@1.6.1', ['server','client']);
  api.use('typescript@4.9.4 || 5.4.3', ['server','client']);
  api.use('check@1.3.2', ['server','client']);
  api.use('tinytest@1.1.0', ['server','client']);
  api.use('test-helpers@1.3.0', ['server','client']);
  api.use('ddp@1.4.1', 'client');
  
  // TODO: Convert test files to TypeScript
  // api.addFiles('test/job_collection_tests.ts', ['server', 'client']);
});
