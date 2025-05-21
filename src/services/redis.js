const Redis = require('ioredis');
const { updateVideoStatus } = require('../database');

// Redis client configuration
const redisConfig = {
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
};

// Create Redis clients
const redisClient = new Redis(redisConfig);
const redisSubscriber = new Redis(redisConfig);

// Redis keys
const QUEUE_KEY = 'hls:video:queue';
const PROCESSING_COUNT_KEY = 'hls:processing:count';
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS) || 5;

// Initialize Redis
const initializeRedis = async () => {
  try {
    // Reset processing count on startup
    await redisClient.set(PROCESSING_COUNT_KEY, 0);
    console.log('Redis connection established successfully');
    return true;
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
    throw error;
  }
};

// Add a video job to the queue
const addToQueue = async (videoId) => {
  try {
    // Update video status to queued
    await updateVideoStatus(videoId, 'queued');
    
    // Add to Redis queue
    await redisClient.rpush(QUEUE_KEY, videoId);
    console.log(`Added video ${videoId} to the processing queue`);
    
    return true;
  } catch (error) {
    console.error(`Failed to add video ${videoId} to queue:`, error);
    throw error;
  }
};

// Get the current processing count
const getProcessingCount = async () => {
  try {
    const count = await redisClient.get(PROCESSING_COUNT_KEY);
    return parseInt(count) || 0;
  } catch (error) {
    console.error('Failed to get processing count:', error);
    throw error;
  }
};

// Increment the processing count
const incrementProcessingCount = async () => {
  try {
    const newCount = await redisClient.incr(PROCESSING_COUNT_KEY);
    return newCount;
  } catch (error) {
    console.error('Failed to increment processing count:', error);
    throw error;
  }
};


const decrementProcessingCount = async () => {
  try {
    const newCount = await redisClient.decr(PROCESSING_COUNT_KEY);

    if (newCount < 0) {
      await redisClient.set(PROCESSING_COUNT_KEY, 0);
      return 0;
    }
    return newCount;
  } catch (error) {
    console.error('Failed to decrement processing count:', error);
    throw error;
  }
};

const getNextJob = async () => {
  try {
    const currentCount = await getProcessingCount();
    

    if (currentCount >= MAX_CONCURRENT_JOBS) {
      return null;
    }
    
    // Get next job from queue (non-blocking)
    const videoId = await redisClient.lpop(QUEUE_KEY);
    
    if (!videoId) {
      return null;
    }
    
    // Increment processing count
    await incrementProcessingCount();
    
    // Update video status
    await updateVideoStatus(videoId, 'processing');
    
    return videoId;
  } catch (error) {
    console.error('Failed to get next job:', error);
    throw error;
  }
};


const completeJob = async (videoId, success = true, error = null) => {
  try {
    // Update video status
    if (success) {
      await updateVideoStatus(videoId, 'completed');
    } else {
      await updateVideoStatus(videoId, 'failed', { error });
    }
    

    await decrementProcessingCount();
    
    return true;
  } catch (error) {
    console.error(`Failed to complete job for video ${videoId}:`, error);
    throw error;
  }
};


const getQueueStats = async () => {
  try {
    const queueLength = await redisClient.llen(QUEUE_KEY);
    const processingCount = await getProcessingCount();
    
    return {
      queuedJobs: queueLength,
      processingJobs: processingCount,
      maxConcurrentJobs: MAX_CONCURRENT_JOBS,
      availableSlots: MAX_CONCURRENT_JOBS - processingCount
    };
  } catch (error) {
    console.error('Failed to get queue stats:', error);
    throw error;
  }
};

module.exports = {
  redisClient,
  redisSubscriber,
  initializeRedis,
  addToQueue,
  getProcessingCount,
  incrementProcessingCount,
  decrementProcessingCount,
  getNextJob,
  completeJob,
  getQueueStats
}; 