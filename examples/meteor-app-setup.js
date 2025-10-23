////////////////////////////////////////////////////////////////////////////
// Example: Setting up job-collection in a Meteor app with permissions
////////////////////////////////////////////////////////////////////////////

import { Meteor } from 'meteor/meteor';
import { JobCollection, Job } from 'meteor/strigops:job-collection';

// Create your job collection
const myJobs = new JobCollection('myJobQueue');

if (Meteor.isServer) {
  
  // ========================================================================
  // EXAMPLE 1: Simple Permission Setup (Most Common)
  // ========================================================================
  
  // Allow all authenticated users to do everything
  myJobs.setJobAllow({
    admin: function(userId, method, params) {
      return userId !== null;  // Anyone logged in
    }
  });

  // ========================================================================
  // EXAMPLE 2: Role-Based Permissions (Using alanning:roles package)
  // ========================================================================
  
  myJobs.setJobAllow({
    // Admins can do everything (start/stop server, manage all jobs)
    admin: function(userId, method, params) {
      return Roles.userIsInRole(userId, 'admin');
    },
    
    // Managers can pause/resume/cancel jobs
    manager: function(userId, method, params) {
      return Roles.userIsInRole(userId, ['admin', 'manager']);
    },
    
    // Creators can create new jobs
    creator: function(userId, method, params) {
      return Roles.userIsInRole(userId, ['admin', 'manager', 'creator']);
    },
    
    // Workers can get work and update job status
    worker: function(userId, method, params) {
      return Roles.userIsInRole(userId, ['admin', 'worker']);
    }
  });

  // ========================================================================
  // EXAMPLE 3: Using User ID Arrays (Shorthand)
  // ========================================================================
  
  const adminUserIds = ['user123', 'user456'];
  
  myJobs.setJobAllow({
    admin: adminUserIds  // Only these specific users
  });

  // ========================================================================
  // EXAMPLE 4: Fine-Grained Permissions by Method
  // ========================================================================
  
  myJobs.setJobAllow({
    // Allow specific control over individual DDP methods
    
    jobSave: function(userId, method, params) {
      // params[0] is the job document
      const jobDoc = params[0];
      
      // Only allow creating 'sendEmail' jobs
      if (jobDoc.type === 'sendEmail') {
        return userId !== null;
      }
      
      // Only admins can create other job types
      return Roles.userIsInRole(userId, 'admin');
    },
    
    jobCancel: function(userId, method, params) {
      // Only managers and admins can cancel jobs
      return Roles.userIsInRole(userId, ['admin', 'manager']);
    },
    
    getWork: function(userId, method, params) {
      // Anyone can get work (useful for public workers)
      return true;
    }
  });

  // ========================================================================
  // EXAMPLE 5: Deny Rules (Override Allow)
  // ========================================================================
  
  // First, set up basic allow rules
  myJobs.setJobAllow({
    admin: function(userId) {
      return userId !== null;
    }
  });
  
  // Then deny specific users (overrides allow)
  myJobs.setJobDeny({
    admin: function(userId, method, params) {
      // Ban specific users
      const bannedUsers = ['bannedUser1', 'bannedUser2'];
      return bannedUsers.includes(userId);
    }
  });

  // ========================================================================
  // EXAMPLE 6: Complex Business Logic
  // ========================================================================
  
  myJobs.setJobAllow({
    jobSave: function(userId, method, params) {
      const jobDoc = params[0];
      const user = Meteor.users.findOne(userId);
      
      if (!user) return false;
      
      // Check user subscription status
      if (jobDoc.type === 'premiumFeature') {
        return user.subscription === 'premium';
      }
      
      // Check rate limiting
      const userJobCount = myJobs.find({
        'data.userId': userId,
        status: { $in: ['waiting', 'ready', 'running'] }
      }).count();
      
      if (userJobCount >= 10) {
        console.log(`User ${userId} has too many pending jobs`);
        return false;
      }
      
      return true;
    }
  });

  // ========================================================================
  // EXAMPLE 7: Development vs Production
  // ========================================================================
  
  if (Meteor.isDevelopment) {
    // In development, allow everything for testing
    myJobs.setJobAllow({
      admin: () => true
    });
  } else {
    // In production, strict permissions
    myJobs.setJobAllow({
      admin: (userId) => Roles.userIsInRole(userId, 'admin'),
      manager: (userId) => Roles.userIsInRole(userId, 'manager'),
      creator: (userId) => userId !== null,
      worker: (userId) => Roles.userIsInRole(userId, 'worker')
    });
  }

  // ========================================================================
  // EXAMPLE 8: Server-Only Operations (No Remote Access)
  // ========================================================================
  
  // Don't set any allow rules - jobs can only be created/managed from server
  // No myJobs.setJobAllow() call
  
  // Then on server:
  Meteor.methods({
    async 'createEmailJob'(emailData) {
      // This runs on server, bypasses allow/deny
      const job = new Job(myJobs, 'sendEmail', emailData);
      return await job.save();
    }
  });

  // ========================================================================
  // EXAMPLE 9: Backward Compatible (using allow/deny)
  // ========================================================================
  
  // These work the same as setJobAllow/setJobDeny
  myJobs.allow({
    admin: (userId) => !!userId
  });
  
  myJobs.deny({
    admin: (userId) => userId === 'bannedUser'
  });

  // ========================================================================
  // Start the job server
  // ========================================================================
  
  Meteor.startup(async () => {
    await myJobs.startJobServer();
    console.log('Job server started');
  });

  // ========================================================================
  // Publish jobs to clients (optional)
  // ========================================================================
  
  Meteor.publish('myJobs', function() {
    if (!this.userId) {
      return this.ready();
    }
    
    // Users can only see their own jobs
    return myJobs.find({
      'data.userId': this.userId
    }, {
      fields: {
        // Don't expose private data
        _private: 0,
        failures: 0
      }
    });
  });
  
  // Or publish all jobs to admins
  Meteor.publish('allJobs', function() {
    if (!Roles.userIsInRole(this.userId, 'admin')) {
      return this.ready();
    }
    
    return myJobs.find({});
  });

  // ========================================================================
  // Create worker (runs on server)
  // ========================================================================
  
  myJobs.processJobs('sendEmail', 
    { concurrency: 4 },
    async (job, callback) => {
      try {
        const { to, subject, body } = job.data;
        await sendEmail(to, subject, body);
        await job.done();
      } catch (error) {
        await job.fail(error.message);
      }
      callback();
    }
  );
}

// ========================================================================
// CLIENT CODE
// ========================================================================

if (Meteor.isClient) {
  
  // Subscribe to jobs
  Meteor.subscribe('myJobs');
  
  // Create a job (respects allow/deny rules)
  async function createJob() {
    const job = new Job(myJobs, 'sendEmail', {
      userId: Meteor.userId(),
      to: 'user@example.com',
      subject: 'Hello',
      body: 'World'
    });
    
    try {
      const id = await job.save();
      console.log('Job created:', id);
      return id;
    } catch (error) {
      console.error('Job creation failed:', error);
      // Will fail if user doesn't have permission
    }
  }
  
  // Get job and control it (respects allow/deny rules)
  async function pauseJob(jobId) {
    try {
      const job = await myJobs.getJob(jobId);
      if (job) {
        await job.pause();
        console.log('Job paused');
      }
    } catch (error) {
      console.error('Failed to pause job:', error);
      // Will fail if user doesn't have 'manager' permission
    }
  }
}

// ========================================================================
// PERMISSION LEVELS EXPLAINED
// ========================================================================

/*

The four built-in permission levels control these methods:

1. ADMIN - Full control of job server
   Methods: startJobServer, shutdownJobServer, jobRemove, jobPause, 
            jobResume, jobReady, jobCancel, jobRestart, jobSave, 
            jobRerun, getWork, getJob, jobLog, jobProgress, jobDone, jobFail

2. MANAGER - Manage existing jobs  
   Methods: jobRemove, jobPause, jobResume, jobReady, jobCancel, jobRestart

3. CREATOR - Create new jobs
   Methods: jobSave, jobRerun

4. WORKER - Get work and update status
   Methods: getWork, getJob, jobLog, jobProgress, jobDone, jobFail

You can also create rules for individual methods:
- jobSave, jobRemove, jobPause, jobResume, jobReady, jobCancel, 
  jobRestart, jobRerun, getWork, getJob, jobLog, jobProgress, 
  jobDone, jobFail, startJobServer, shutdownJobServer

*/

export { myJobs };

