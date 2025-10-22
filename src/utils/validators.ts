////////////////////////////////////////////////////////////////////////////
//     Copyright (C) 2014-2017 by Vaughn Iverson
//     job-collection is free software released under the MIT/X11 license.
//     See included LICENSE file for details.
////////////////////////////////////////////////////////////////////////////

/**
 * Validation helper functions
 */

export function isInteger(i: any): i is number {
  return typeof i === 'number' && Math.floor(i) === i;
}

export function isBoolean(b: any): b is boolean {
  return typeof b === 'boolean';
}

export function isFunction(f: any): f is Function {
  return typeof f === 'function';
}

export function isNonEmptyString(s: any): s is string {
  return typeof s === 'string' && s.length > 0;
}

export function isNonEmptyStringOrArrayOfNonEmptyStrings(sa: any): sa is string | string[] {
  return (
    isNonEmptyString(sa) ||
    (Array.isArray(sa) &&
      sa.length !== 0 &&
      sa.every(s => isNonEmptyString(s)))
  );
}

export function validNumGTEZero(v: any): boolean {
  return Match.test(v, Number) && v >= 0.0;
}

export function validNumGTZero(v: any): boolean {
  return Match.test(v, Number) && v > 0.0;
}

export function validNumGTEOne(v: any): boolean {
  return Match.test(v, Number) && v >= 1.0;
}

export function validIntGTEZero(v: any): boolean {
  return validNumGTEZero(v) && Math.floor(v) === v;
}

export function validIntGTEOne(v: any): boolean {
  return validNumGTEOne(v) && Math.floor(v) === v;
}

export function validStatus(v: any): boolean {
  return Match.test(v, String) && ['waiting', 'paused', 'ready', 'running', 'failed', 'cancelled', 'completed'].includes(v);
}

export function validLogLevel(v: any): boolean {
  return Match.test(v, String) && ['info', 'success', 'warning', 'danger'].includes(v);
}

export function validRetryBackoff(v: any): boolean {
  return Match.test(v, String) && ['constant', 'exponential'].includes(v);
}

export function validId(v: any): boolean {
  // Check for string or MongoDB ObjectID
  if (typeof Mongo !== 'undefined' && Mongo.ObjectID) {
    return Match.test(v, Match.OneOf(String, Mongo.ObjectID));
  }
  return Match.test(v, String);
}

