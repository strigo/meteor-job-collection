"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.callbackOrPromise = callbackOrPromise;
exports.optionsHelp = optionsHelp;
exports.splitLongArray = splitLongArray;
exports.reduceCallbacks = reduceCallbacks;
exports.concatReduce = concatReduce;
exports.setImmediate = setImmediate;
exports.setInterval = setInterval;
exports.clearInterval = clearInterval;
function callbackOrPromise(fn, callback) {
    if (callback && typeof callback === 'function') {
        return fn(callback);
    }
    return new Promise((resolve, reject) => {
        fn((err, result) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(result);
            }
        });
    });
}
function optionsHelp(options, cb) {
    if (cb !== undefined && typeof cb !== 'function') {
        options = cb;
        cb = undefined;
    }
    else {
        if (Array.isArray(options) && options.length >= 2) {
            throw new Error('options... in optionsHelp must be an Array with zero or one elements');
        }
        options = (Array.isArray(options) ? options[0] : options) ?? {};
    }
    if (typeof options !== 'object' || Array.isArray(options)) {
        throw new Error('in optionsHelp options not an object or bad callback');
    }
    return [options, cb];
}
function splitLongArray(arr, max) {
    if (!Array.isArray(arr) || max <= 0) {
        throw new Error('splitLongArray: bad params');
    }
    const result = [];
    for (let i = 0; i < Math.ceil(arr.length / max); i++) {
        result.push(arr.slice(i * max, (i + 1) * max));
    }
    return result;
}
function reduceCallbacks(cb, num, reduce = (a, b) => (a || b), init = false) {
    if (!cb) {
        return undefined;
    }
    if (typeof cb !== 'function' || num <= 0 || typeof reduce !== 'function') {
        throw new Error('Bad params given to reduceCallbacks');
    }
    let cbRetVal = init;
    let cbCount = 0;
    let cbErr = null;
    return (err, res) => {
        if (cbErr) {
            return;
        }
        if (err) {
            cbErr = err;
            cb(err);
        }
        else {
            cbCount++;
            cbRetVal = reduce(cbRetVal, res);
            if (cbCount === num) {
                cb(null, cbRetVal);
            }
            else if (cbCount > num) {
                throw new Error(`reduceCallbacks callback invoked more than requested ${num} times`);
            }
        }
    };
}
function concatReduce(a, b) {
    const arr = Array.isArray(a) ? a : [a];
    return arr.concat(b);
}
function setImmediate(func, ...args) {
    if (typeof Meteor !== 'undefined' && Meteor.setTimeout) {
        return Meteor.setTimeout(func, 0, ...args);
    }
    else if (typeof globalThis.setImmediate !== 'undefined') {
        return globalThis.setImmediate(func, ...args);
    }
    else {
        return setTimeout(func, 0, ...args);
    }
}
function setInterval(func, timeout, ...args) {
    if (typeof Meteor !== 'undefined' && Meteor.setInterval) {
        return Meteor.setInterval(func, timeout, ...args);
    }
    else {
        return globalThis.setInterval(func, timeout, ...args);
    }
}
function clearInterval(id) {
    if (typeof Meteor !== 'undefined' && Meteor.clearInterval) {
        Meteor.clearInterval(id);
    }
    else {
        globalThis.clearInterval(id);
    }
}
//# sourceMappingURL=callback-helpers.js.map