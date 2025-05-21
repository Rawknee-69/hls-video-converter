const Redis = require('ioredis');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const logger = require('../utils/logger');

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
const redisPass = process.env.REDIS_PASSWORD || '';
const maxJobs = parseInt(process.env.MAX_CONCURRENT_JOBS || '5', 10);
const dockerImage = process.env.DOCKER_IMAGE || 'hls-converter-worker';
const containerName = process.env.WORKER_CONTAINER_NAME || 'hls-worker';

const redisClient = new Redis({
  host: redisHost,
  port: redisPort,
  password: redisPass || undefined,
});

const redisSubscriber = new Redis({
  host: redisHost,
  port: redisPort,
  password: redisPass || undefined,
});

async function initializeWorkerManager() {
  logger.info('Initializing worker manager');
  
  await redisClient.set('active_job_count', '0');
  await redisClient.set('keep_workers_alive', '1');
  
  redisSubscriber.subscribe('spawn_worker');
  
  redisSubscriber.on('message', async (channel, message) => {
    if (channel === 'spawn_worker' && message === 'true') {
      await spawnWorkerIfNeeded();
    }
  });
  
  await spawnWorkerIfNeeded();
  
  logger.info('Worker manager initialized');
}

async function spawnWorkerIfNeeded() {
  try {
    const activeCount = parseInt(await redisClient.get('active_job_count') || '0', 10);
    const queueSize = await redisClient.llen('job_queue');
    
    if (queueSize > 0 && activeCount < maxJobs) {
      logger.info(`Spawning new worker (active: ${activeCount}, queue: ${queueSize})`);
      
      const timestamp = Date.now();
      const workerName = `${containerName}-${timestamp}`;
      
      const dockerCmd = [
        'docker run -d',
        '--name', workerName,
        '--rm',
        '--network host',
        '-e REDIS_HOST=' + redisHost,
        '-e REDIS_PORT=' + redisPort,
        '-e REDIS_PASSWORD=' + (redisPass || ''),
        '-e DB_HOST=' + (process.env.DB_HOST || 'localhost'),
        '-e DB_PORT=' + (process.env.DB_PORT || '5432'),
        '-e DB_NAME=' + (process.env.DB_NAME || 'hls_converter'),
        '-e DB_USER=' + (process.env.DB_USER || 'postgres'),
        '-e DB_PASSWORD=' + (process.env.DB_PASSWORD || 'postgres'),
        '-e TEMP_BUCKET=' + (process.env.TEMP_BUCKET || 'temp-videos'),
        '-e OUTPUT_BUCKET=' + (process.env.OUTPUT_BUCKET || 'hls-videos'),
        '-e DEPLOYMENT_TYPE=' + (process.env.DEPLOYMENT_TYPE || 'local'),
        '-e STORAGE_TYPE=' + (process.env.STORAGE_TYPE || 'minio'),
        '-e MINIO_ENDPOINT=' + (process.env.MINIO_ENDPOINT || 'localhost'),
        '-e MINIO_PORT=' + (process.env.MINIO_PORT || '9000'),
        '-e MINIO_USE_SSL=' + (process.env.MINIO_USE_SSL || 'false'),
        '-e MINIO_ACCESS_KEY=' + (process.env.MINIO_ACCESS_KEY || 'minioadmin'),
        '-e MINIO_SECRET_KEY=' + (process.env.MINIO_SECRET_KEY || 'minioadmin'),
        '-e AWS_ACCESS_KEY_ID=' + (process.env.AWS_ACCESS_KEY_ID || ''),
        '-e AWS_SECRET_ACCESS_KEY=' + (process.env.AWS_SECRET_ACCESS_KEY || ''),
        '-e S3_ENDPOINT=' + (process.env.S3_ENDPOINT || ''),
        '-e S3_REGION=' + (process.env.S3_REGION || 'us-east-1'),
        '-e MAX_CONCURRENT_JOBS=' + maxJobs,
        '-e FFMPEG_THREADS=' + (process.env.FFMPEG_THREADS || '4'),
        dockerImage
      ].join(' ');
      
      const { stdout, stderr } = await execAsync(dockerCmd);
      
      if (stderr) {
        logger.error(`Error spawning worker: ${stderr}`);
      } else {
        logger.info(`Spawned worker container: ${workerName} (${stdout.trim()})`);
      }
    }
  } catch (error) {
    logger.error('Failed to spawn worker container', error);
  }
}

async function queueJob(jobData) {
  try {
    logger.info(`Queueing job: ${jobData.jobId}`);
    
    await redisClient.rpush('job_queue', JSON.stringify(jobData));
    await spawnWorkerIfNeeded();
    
    logger.info(`Job queued: ${jobData.jobId}`);
    return true;
  } catch (error) {
    logger.error(`Failed to queue job: ${jobData.jobId}`, error);
    throw error;
  }
}

async function getWorkerStatus() {
  try {
    const activeCount = parseInt(await redisClient.get('active_job_count') || '0', 10);
    const queueSize = await redisClient.llen('job_queue');
    
    return {
      activeWorkers: activeCount,
      queuedJobs: queueSize,
      maxConcurrentJobs: maxJobs
    };
  } catch (error) {
    logger.error('Failed to get worker status', error);
    throw error;
  }
}

async function cleanupWorkers() {
  try {
    logger.info('Cleaning up worker containers');
    
    await redisClient.set('keep_workers_alive', '0');
    
    const { stdout } = await execAsync(`docker ps -q --filter "name=${containerName}"`);
    
    if (stdout.trim()) {
      const containerIds = stdout.trim().split('\n');
      
      for (const containerId of containerIds) {
        logger.info(`Stopping worker container: ${containerId}`);
        await execAsync(`docker stop ${containerId}`);
      }
    }
    
    logger.info('Worker cleanup completed');
  } catch (error) {
    logger.error('Failed to clean up worker containers', error);
    throw error;
  }
}

async function shutdown() {
  try {
    logger.info('Shutting down worker manager');
    
    await cleanupWorkers();
    await redisClient.quit();
    await redisSubscriber.quit();
    
    logger.info('Worker manager shut down');
  } catch (error) {
    logger.error('Error during worker manager shutdown', error);
  }
}

module.exports = {
  initializeWorkerManager,
  queueJob,
  getWorkerStatus,
  cleanupWorkers,
  shutdown
}; 