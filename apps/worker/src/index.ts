<<<<<<< HEAD
import { JobModel, connectMongo } from '@wcl/db';
import { createLogger, parseEnv } from '@wcl/shared';

const env = parseEnv(process.env);
const logger = createLogger('worker');

export interface Queue {
  enqueue(type: string, payload: unknown, runAt?: Date): Promise<void>;
  pollReadyJob(): Promise<any | null>;
}

class MongoQueue implements Queue {
  public async enqueue(type: string, payload: unknown, runAt = new Date()): Promise<void> {
    await JobModel.create({ type, payload, runAt, status: 'pending' });
  }

  public async pollReadyJob(): Promise<any | null> {
    return JobModel.findOneAndUpdate(
      { status: 'pending', runAt: { $lte: new Date() } },
      { $set: { status: 'running' }, $inc: { attempts: 1 } },
      { sort: { runAt: 1 }, new: true },
    );
  }
=======
import { JobModel, connectMongo } from "@wcl/db";
import { createLogger, parseEnv } from "@wcl/shared";

const env = parseEnv(process.env);
const logger = createLogger("worker");

export interface Queue {
    enqueue(type: string, payload: unknown, runAt?: Date): Promise<void>;
    pollReadyJob(): Promise<any | null>;
}

class MongoQueue implements Queue {
    public async enqueue(
        type: string,
        payload: unknown,
        runAt = new Date(),
    ): Promise<void> {
        await JobModel.create({ type, payload, runAt, status: "pending" });
    }

    public async pollReadyJob(): Promise<any | null> {
        return JobModel.findOneAndUpdate(
            { status: "pending", runAt: { $lte: new Date() } },
            { $set: { status: "running" }, $inc: { attempts: 1 } },
            { sort: { runAt: 1 }, new: true },
        );
    }
>>>>>>> c1868b4 (generated framework through codex)
}

const queue = new MongoQueue();

const handlers: Record<string, (payload: any) => Promise<void>> = {
<<<<<<< HEAD
  recompute_trends: async () => {
    // TODO: trend recomputation service integration
  },
  sync_subscription: async () => {
    // TODO: subscription sync integration
  },
};

const processNext = async (): Promise<void> => {
  const job = await queue.pollReadyJob();
  if (!job) return;

  try {
    const handler = handlers[job.type];
    if (!handler) throw new Error(`No handler for ${job.type}`);
    await handler(job.payload);
    await JobModel.updateOne({ _id: job._id }, { $set: { status: 'completed' } });
  } catch (error) {
    logger.error({ error, jobId: job._id }, 'job failed');
    await JobModel.updateOne(
      { _id: job._id },
      { $set: { status: 'failed', lastError: String(error) } },
    );
  }
};

const start = async () => {
  await connectMongo(env.MONGODB_URI);
  logger.info('worker started');
  setInterval(() => {
    void processNext();
  }, 1500);
};

start().catch((error) => {
  logger.fatal({ error }, 'worker startup failed');
  process.exit(1);
=======
    recompute_trends: async () => {
        // TODO: trend recomputation service integration
    },
    sync_subscription: async () => {
        // TODO: subscription sync integration
    },
};

const processNext = async (): Promise<void> => {
    const job = await queue.pollReadyJob();
    if (!job) return;

    try {
        const handler = handlers[job.type];
        if (!handler) throw new Error(`No handler for ${job.type}`);
        await handler(job.payload);
        await JobModel.updateOne(
            { _id: job._id },
            { $set: { status: "completed" } },
        );
    } catch (error) {
        logger.error({ error, jobId: job._id }, "job failed");
        await JobModel.updateOne(
            { _id: job._id },
            { $set: { status: "failed", lastError: String(error) } },
        );
    }
};

const start = async () => {
    await connectMongo(env.MONGODB_URI);
    logger.info("worker started");
    setInterval(() => {
        void processNext();
    }, 1500);
};

start().catch((error) => {
    logger.fatal({ error }, "worker startup failed");
    process.exit(1);
>>>>>>> c1868b4 (generated framework through codex)
});
