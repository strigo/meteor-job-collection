import type { Callback } from '../types';
export declare function callbackOrPromise<T>(fn: (cb: Callback<T>) => void, callback?: Callback<T>): Promise<T> | void;
export declare function optionsHelp<T = any>(options: T | Callback<any>, cb?: Callback<any>): [T, Callback<any> | undefined];
export declare function splitLongArray<T>(arr: T[], max: number): T[][];
export declare function reduceCallbacks<T>(cb: Callback<T> | undefined, num: number, reduce?: (a: T, b: T) => T, init?: T): Callback<T> | undefined;
export declare function concatReduce<T>(a: T | T[], b: T): T[];
export declare function setImmediate(func: (...args: any[]) => void, ...args: any[]): any;
export declare function setInterval(func: (...args: any[]) => void, timeout: number, ...args: any[]): any;
export declare function clearInterval(id: any): void;
//# sourceMappingURL=callback-helpers.d.ts.map