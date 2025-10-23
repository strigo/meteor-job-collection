import { EventEmitter } from 'events';
import { JobCollectionBase } from './shared';
import type { AllowDenyRules } from './types';
export declare class JobCollection extends JobCollectionBase {
    events: EventEmitter;
    stopped: boolean | number;
    logStream: any;
    allows: Record<string, any[]>;
    denys: Record<string, any[]>;
    isSimulation: boolean;
    interval?: any;
    private _localServerMethods?;
    private _ddp_apply?;
    constructor(root?: string, options?: any);
    private _onError;
    private _onCall;
    private _toLogServer;
    private _emit;
    _methodWrapper(method: string, func: Function): Function;
    setLogStream(writeStream?: any): void;
    setJobAllow(allowOptions: AllowDenyRules): void;
    setJobDeny(denyOptions: AllowDenyRules): void;
    scrubJobDoc?: (job: any) => any;
    promote(milliseconds?: number): void;
    private _promote_jobs;
    _DDPMethod_startJobServer(options?: any): Promise<boolean>;
    _DDPMethod_shutdownJobServer(options?: any): Promise<boolean>;
    _DDPMethod_getWork(type: any, options?: any): Promise<any>;
    _DDPMethod_jobReady(ids?: any, options?: any): Promise<boolean>;
}
//# sourceMappingURL=server.d.ts.map