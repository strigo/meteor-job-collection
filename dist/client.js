"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobCollection = void 0;
const shared_1 = require("./shared");
if (!Function.prototype.bind) {
    Function.prototype.bind = function (oThis, ...aArgs) {
        if (typeof this !== 'function') {
            throw new TypeError('Function.prototype.bind - what is trying to be bound is not callable');
        }
        const fToBind = this;
        const fNOP = function () { };
        const fBound = function (...args) {
            const func = this instanceof fNOP && oThis ? this : oThis;
            return fToBind.apply(func, aArgs.concat(args));
        };
        fNOP.prototype = this.prototype;
        fBound.prototype = new fNOP();
        return fBound;
    };
}
class JobCollectionClient extends shared_1.JobCollectionBase {
    logConsole = false;
    isSimulation = true;
    constructor(root = 'queue', options = {}) {
        if (!(new.target)) {
            return new JobCollectionClient(root, options);
        }
        super(root, options);
        this.logConsole = false;
        this.isSimulation = true;
        this._toLog = (userId, method, message) => {
            if (this.logConsole) {
                console.log(`${new Date()}, ${userId}, ${method}, ${message}\n`);
            }
        };
        const meteorMethods = {};
        const methods = this._generateMethods();
        for (const [key, value] of Object.entries(methods)) {
            meteorMethods[key] = value;
        }
        if (!options.connection) {
            Meteor.methods(meteorMethods);
        }
        else {
            options.connection.methods(meteorMethods);
        }
    }
}
exports.JobCollection = JobCollectionClient;
if (typeof share !== 'undefined') {
    share.JobCollection = JobCollectionClient;
}
if (typeof Meteor !== 'undefined' && Meteor.isClient) {
    global.JobCollection = JobCollectionClient;
}
//# sourceMappingURL=client.js.map