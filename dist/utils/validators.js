"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isInteger = isInteger;
exports.isBoolean = isBoolean;
exports.isFunction = isFunction;
exports.isNonEmptyString = isNonEmptyString;
exports.isNonEmptyStringOrArrayOfNonEmptyStrings = isNonEmptyStringOrArrayOfNonEmptyStrings;
exports.validNumGTEZero = validNumGTEZero;
exports.validNumGTZero = validNumGTZero;
exports.validNumGTEOne = validNumGTEOne;
exports.validIntGTEZero = validIntGTEZero;
exports.validIntGTEOne = validIntGTEOne;
exports.validStatus = validStatus;
exports.validLogLevel = validLogLevel;
exports.validRetryBackoff = validRetryBackoff;
exports.validId = validId;
function isInteger(i) {
    return typeof i === 'number' && Math.floor(i) === i;
}
function isBoolean(b) {
    return typeof b === 'boolean';
}
function isFunction(f) {
    return typeof f === 'function';
}
function isNonEmptyString(s) {
    return typeof s === 'string' && s.length > 0;
}
function isNonEmptyStringOrArrayOfNonEmptyStrings(sa) {
    return (isNonEmptyString(sa) ||
        (Array.isArray(sa) &&
            sa.length !== 0 &&
            sa.every(s => isNonEmptyString(s))));
}
function validNumGTEZero(v) {
    return Match.test(v, Number) && v >= 0.0;
}
function validNumGTZero(v) {
    return Match.test(v, Number) && v > 0.0;
}
function validNumGTEOne(v) {
    return Match.test(v, Number) && v >= 1.0;
}
function validIntGTEZero(v) {
    return validNumGTEZero(v) && Math.floor(v) === v;
}
function validIntGTEOne(v) {
    return validNumGTEOne(v) && Math.floor(v) === v;
}
function validStatus(v) {
    return Match.test(v, String) && ['waiting', 'paused', 'ready', 'running', 'failed', 'cancelled', 'completed'].includes(v);
}
function validLogLevel(v) {
    return Match.test(v, String) && ['info', 'success', 'warning', 'danger'].includes(v);
}
function validRetryBackoff(v) {
    return Match.test(v, String) && ['constant', 'exponential'].includes(v);
}
function validId(v) {
    if (typeof Mongo !== 'undefined' && Mongo.ObjectID) {
        return Match.test(v, Match.OneOf(String, Mongo.ObjectID));
    }
    return Match.test(v, String);
}
//# sourceMappingURL=validators.js.map