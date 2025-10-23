export type JobId = string | Mongo.ObjectID;
export type JobType = string;
export type JobStatus = 'waiting' | 'paused' | 'ready' | 'running' | 'failed' | 'cancelled' | 'completed';
export type JobLogLevel = 'info' | 'success' | 'warning' | 'danger';
export type JobRetryBackoffMethod = 'constant' | 'exponential';
export type JobPriorityLevel = 'low' | 'normal' | 'medium' | 'high' | 'critical';
export type DDPPermissionLevel = 'admin' | 'manager' | 'creator' | 'worker';
export interface JobLogEntry {
    time: Date;
    runId: JobId | null;
    level: JobLogLevel;
    message: string;
    data?: Record<string, any>;
}
export interface JobProgress {
    completed: number;
    total: number;
    percent: number;
}
export interface LaterJSSchedule {
    schedules: Record<string, any>[];
    exceptions?: Record<string, any>[];
}
export interface JobDocument {
    _id?: JobId | null;
    runId: JobId | null;
    type: JobType;
    status: JobStatus;
    data: Record<string, any>;
    result?: Record<string, any>;
    failures?: Record<string, any>[];
    priority: number;
    depends: JobId[];
    resolved: JobId[];
    after: Date;
    updated: Date;
    created: Date;
    workTimeout?: number;
    expiresAfter?: Date;
    log?: JobLogEntry[];
    progress: JobProgress;
    retries: number;
    retried: number;
    repeatRetries?: number;
    retryUntil: Date;
    retryWait: number;
    retryBackoff: JobRetryBackoffMethod;
    repeats: number;
    repeated: number;
    repeatUntil: Date;
    repeatWait: number | LaterJSSchedule;
    _private?: Record<string, any>;
}
export interface JobRetryOptions {
    retries?: number;
    until?: Date;
    wait?: number;
    backoff?: JobRetryBackoffMethod;
}
export interface JobRepeatOptions {
    repeats?: number;
    until?: Date;
    wait?: number;
    schedule?: LaterJSSchedule;
}
export interface JobDelayOptions {
    milliseconds?: number;
}
export interface JobLogOptions {
    level?: JobLogLevel;
    data?: Record<string, any>;
    echo?: boolean | JobLogLevel;
}
export interface JobProgressOptions {
    echo?: boolean;
}
export interface JobSaveOptions {
    cancelRepeats?: boolean;
}
export interface JobRefreshOptions {
    getLog?: boolean;
    getFailures?: boolean;
}
export interface JobDoneOptions {
    repeatId?: boolean;
    delayDeps?: number;
}
export interface JobFailOptions {
    fatal?: boolean;
}
export interface JobReadyOptions {
    time?: Date;
    force?: boolean;
}
export interface JobCancelOptions {
    antecedents?: boolean;
    dependents?: boolean;
}
export interface JobRestartOptions {
    retries?: number;
    until?: Date;
    antecedents?: boolean;
    dependents?: boolean;
}
export interface JobRerunOptions {
    repeats?: number;
    until?: Date;
    wait?: number;
}
export interface GetWorkOptions {
    maxJobs?: number;
    workTimeout?: number;
}
export interface GetJobOptions {
    getLog?: boolean;
    getFailures?: boolean;
}
export interface JobQueueOptions {
    concurrency?: number;
    payload?: number;
    pollInterval?: number | false;
    prefetch?: number;
    workTimeout?: number;
    callbackStrict?: boolean;
    errorCallback?: (error: Error) => void;
}
export interface JobQueueShutdownOptions {
    level?: 'soft' | 'normal' | 'hard';
    quiet?: boolean;
}
export interface StartJobServerOptions {
    [key: string]: any;
}
export interface ShutdownJobServerOptions {
    timeout?: number;
}
export interface ReadyJobsOptions {
    force?: boolean;
    time?: Date;
}
export type Callback<T = any> = (error?: Error | null, result?: T) => void;
export type DDPApply = (name: string, params: any[], callback?: Callback) => any;
export type WorkerFunction = (job: any, callback: Callback) => void;
export type AsyncWorkerFunction = (job: any, callback: Callback) => Promise<void>;
export type AllowDenyFunction = (userId: string | null, method: string, params: any[]) => boolean;
export type AllowDenyRule = AllowDenyFunction | string[];
export interface AllowDenyRules {
    admin?: AllowDenyRule;
    manager?: AllowDenyRule;
    creator?: AllowDenyRule;
    worker?: AllowDenyRule;
    [methodName: string]: AllowDenyRule | undefined;
}
export interface EventMessage {
    error: Error | null;
    method: string;
    connection?: any;
    userId?: string | null;
    params: any[];
    returnVal: any;
}
//# sourceMappingURL=index.d.ts.map