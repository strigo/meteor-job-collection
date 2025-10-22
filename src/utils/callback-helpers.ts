////////////////////////////////////////////////////////////////////////////
//     Copyright (C) 2014-2017 by Vaughn Iverson
//     job-collection is free software released under the MIT/X11 license.
//     See included LICENSE file for details.
////////////////////////////////////////////////////////////////////////////

import type { Callback } from '../types';

/**
 * Utility to support both callback and promise-based APIs
 * If callback is provided, executes function with callback
 * If no callback, returns a promise
 */
export function callbackOrPromise<T>(
  fn: (cb: Callback<T>) => void,
  callback?: Callback<T>
): Promise<T> | void {
  if (callback && typeof callback === 'function') {
    return fn(callback);
  }
  
  return new Promise<T>((resolve, reject) => {
    fn((err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result as T);
      }
    });
  });
}

/**
 * Handles options and callback parameters for methods that accept both
 * Returns normalized [options, callback] tuple
 */
export function optionsHelp<T = any>(
  options: T | Callback<any>,
  cb?: Callback<any>
): [T, Callback<any> | undefined] {
  // If cb isn't a function, it's assumed to be options...
  if (cb !== undefined && typeof cb !== 'function') {
    options = cb as T;
    cb = undefined;
  } else {
    // Validate options is an array with 0 or 1 elements when it's an array
    if (Array.isArray(options) && options.length >= 2) {
      throw new Error('options... in optionsHelp must be an Array with zero or one elements');
    }
    options = (Array.isArray(options) ? options[0] : options) ?? ({} as T);
  }
  
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('in optionsHelp options not an object or bad callback');
  }
  
  return [options as T, cb];
}

/**
 * Splits a long array into chunks of maximum size
 */
export function splitLongArray<T>(arr: T[], max: number): T[][] {
  if (!Array.isArray(arr) || max <= 0) {
    throw new Error('splitLongArray: bad params');
  }
  
  const result: T[][] = [];
  for (let i = 0; i < Math.ceil(arr.length / max); i++) {
    result.push(arr.slice(i * max, (i + 1) * max));
  }
  return result;
}

/**
 * Creates a callback that collects multiple callback results
 * Useful for parallel operations that need to be reduced to a single result
 */
export function reduceCallbacks<T>(
  cb: Callback<T> | undefined,
  num: number,
  reduce: (a: T, b: T) => T = (a, b) => (a || b) as T,
  init: T = false as T
): Callback<T> | undefined {
  if (!cb) {
    return undefined;
  }
  
  if (typeof cb !== 'function' || num <= 0 || typeof reduce !== 'function') {
    throw new Error('Bad params given to reduceCallbacks');
  }
  
  let cbRetVal = init;
  let cbCount = 0;
  let cbErr: Error | null = null;
  
  return (err, res) => {
    if (cbErr) {
      return; // Already errored
    }
    
    if (err) {
      cbErr = err;
      cb(err);
    } else {
      cbCount++;
      cbRetVal = reduce(cbRetVal, res as T);
      if (cbCount === num) {
        cb(null, cbRetVal);
      } else if (cbCount > num) {
        throw new Error(`reduceCallbacks callback invoked more than requested ${num} times`);
      }
    }
  };
}

/**
 * Reduce function for concatenating arrays
 */
export function concatReduce<T>(a: T | T[], b: T): T[] {
  const arr = Array.isArray(a) ? a : [a];
  return arr.concat(b);
}

/**
 * Cross-platform setImmediate implementation
 */
export function setImmediate(func: (...args: any[]) => void, ...args: any[]): any {
  if (typeof Meteor !== 'undefined' && Meteor.setTimeout) {
    return (Meteor.setTimeout as any)(func, 0, ...args);
  } else if (typeof globalThis.setImmediate !== 'undefined') {
    return globalThis.setImmediate(func, ...args);
  } else {
    // Browser fallback
    return setTimeout(func, 0, ...args);
  }
}

/**
 * Cross-platform setInterval implementation
 */
export function setInterval(func: (...args: any[]) => void, timeout: number, ...args: any[]): any {
  if (typeof Meteor !== 'undefined' && Meteor.setInterval) {
    return (Meteor.setInterval as any)(func, timeout, ...args);
  } else {
    // Browser / node.js fallback
    return globalThis.setInterval(func, timeout, ...args);
  }
}

/**
 * Cross-platform clearInterval implementation
 */
export function clearInterval(id: any): void {
  if (typeof Meteor !== 'undefined' && Meteor.clearInterval) {
    Meteor.clearInterval(id);
  } else {
    // Browser / node.js fallback
    globalThis.clearInterval(id);
  }
}

