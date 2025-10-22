////////////////////////////////////////////////////////////////////////////
//     Copyright (C) 2014-2024 by Vaughn Iverson
//     job-collection is free software released under the MIT/X11 license.
//     See included LICENSE file for details.
////////////////////////////////////////////////////////////////////////////

/**
 * Main entry point for meteor-job-collection
 * Exports both Job and JobCollection classes
 */

// Export Job class and JobQueue
export { Job } from './job/job-class';
export { JobQueue } from './job/job-queue';

// Export JobCollection based on environment
// Use dynamic import to handle server/client/node.js differences
export { JobCollectionBase as JobCollection } from './shared';

// Export TypeScript types
export type {
  JobId,
  JobType,
  JobStatus,
  JobLogLevel,
  JobDocument,
  JobLogEntry,
  JobProgress,
  JobRetryOptions,
  JobRepeatOptions,
  JobSaveOptions,
  JobDoneOptions,
  JobFailOptions,
  JobCancelOptions,
  JobRestartOptions,
  JobQueueOptions,
  GetWorkOptions,
  Callback,
  WorkerFunction,
  AllowDenyRules
} from './types';

