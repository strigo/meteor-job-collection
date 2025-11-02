import { JobCollectionBase } from './shared';
import { Job } from './job/job-class';
declare class JobCollectionClient extends JobCollectionBase {
    logConsole: boolean;
    isSimulation: boolean;
    constructor(root?: string, options?: any);
}
export { JobCollectionClient as JobCollection };
export { Job };
//# sourceMappingURL=client.d.ts.map