////////////////////////////////////////////////////////////////////////////
//     Copyright (C) 2014-2017 by Vaughn Iverson
//     job-collection is free software released under the MIT/X11 license.
//     See included LICENSE file for details.
////////////////////////////////////////////////////////////////////////////

import { JobCollectionBase } from './shared';
import { Job } from './job/job-class';

declare const share: any;

/**
 * Function.prototype.bind polyfill for older environments (phantomjs)
 */
if (!Function.prototype.bind) {
  Function.prototype.bind = function(oThis: any, ...aArgs: any[]) {
    if (typeof this !== 'function') {
      // closest thing possible to the ECMAScript 5 internal IsCallable function
      throw new TypeError('Function.prototype.bind - what is trying to be bound is not callable');
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const fToBind = this;
    const fNOP: any = function() {};
    const fBound = function(this: any, ...args: any[]) {
      const func = this instanceof fNOP && oThis ? this : oThis;
      return fToBind.apply(func, aArgs.concat(args));
    };

    fNOP.prototype = this.prototype;
    fBound.prototype = new (fNOP as any)();
    return fBound;
  };
}

/**
 * Client-side JobCollection class
 */
class JobCollectionClient extends JobCollectionBase {
  logConsole = false;
  isSimulation = true;

  constructor(root: string = 'queue', options: any = {}) {
    // Support calling without new
    if (!(new.target)) {
      return new JobCollectionClient(root, options) as any;
    }

    // Call super constructor
    super(root, options);

    this.logConsole = false;
    this.isSimulation = true;

    // Set up client-side _toLog
    this._toLog = (userId: string, method: string, message: string) => {
      if (this.logConsole) {
        console.log(`${new Date()}, ${userId}, ${method}, ${message}\n`);
      }
    };

    const meteorMethods: Record<string, (...args: any[]) => any> = {};
    const methods = this._generateMethods();
    for (const [key, value] of Object.entries(methods)) {
      meteorMethods[key] = value as any;
    }

    if (!options.connection) {
      Meteor.methods(meteorMethods);
    } else {
      options.connection.methods(meteorMethods);
    }
  }
}

// Export with consistent name
export { JobCollectionClient as JobCollection };
export { Job };

// Share with the rest of the package
if (typeof share !== 'undefined') {
  share.JobCollection = JobCollectionClient;
}

// Also set as global for backward compatibility
if (typeof Meteor !== 'undefined' && Meteor.isClient) {
  (global as any).JobCollection = JobCollectionClient;
}

