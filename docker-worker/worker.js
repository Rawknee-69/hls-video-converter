const Redis = require('ioredis');
const { S3Client, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const { finished } = require('stream/promises');
const { Readable } = require('stream');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
const redisPass = process.env.REDIS_PASSWORD || '';
const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
const dbName = process.env.DB_NAME || 'hls_converter';
const dbUser = process.env.DB_USER || 'postgres';
const dbPass = process.env.DB_PASSWORD || 'postgres';
const tempBucket = process.env.TEMP_BUCKET || 'temp-videos';
const outputBucket = process.env.OUTPUT_BUCKET || 'hls-videos';
const deployType = process.env.DEPLOYMENT_TYPE || 'local';
const storageType = process.env.STORAGE_TYPE || 'minio';
const ffmpegThreads = parseInt(process.env.FFMPEG_THREADS || '4', 10);

const s3Config = {
  region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: true,
};

if (storageType === 'minio') {
  s3Config.endpoint = `http://${process.env.MINIO_ENDPOINT || 'localhost'}:${process.env.MINIO_PORT || '9000'}`;
  s3Config.credentials = {
    accessKeyId: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
  };
} else {
  s3Config.endpoint = process.env.S3_ENDPOINT || 'https://s3.amazonaws.com';
  s3Config.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

const s3Client = new S3Client(s3Config);

const redisClient = new Redis({
  host: redisHost,
  port: redisPort,
  password: redisPass || undefined,
});

const pgPool = new Pool({
  host: dbHost,
  port: dbPort,
  database: dbName,
  user: dbUser,
  password: dbPass,
});

const TEMP_DIR = path.join(__dirname, 'temp');

const RESOLUTIONS = [
  { name: '144p', width: 256, height: 144, videoBitrate: '200k', audioBitrate: '64k' },
  { name: '360p', width: 640, height: 360, videoBitrate: '800k', audioBitrate: '96k' },
  { name: '480p', width: 854, height: 480, videoBitrate: '1400k', audioBitrate: '128k' },
  { name: '720p', width: 1280, height: 720, videoBitrate: '2500k', audioBitrate: '128k' },
  { name: '1080p', width: 1920, height: 1080, videoBitrate: '4500k', audioBitrate: '192k' },
  { name: '2K', width: 2560, height: 1440, videoBitrate: '6000k', audioBitrate: '192k' }
];

const logger = {
  info: (message) => console.log(`[INFO] ${message}`),
  error: (message, error) => console.error(`[ERROR] ${message}`, error),
  warn: (message) => console.warn(`[WARN] ${message}`),
  debug: (message) => console.debug(`[DEBUG] ${message}`)
};

async function createDirectories(jobId) {
  const jobDir = path.join(TEMP_DIR, jobId);
  const inputDir = path.join(jobDir, 'input');
  const outputDir = path.join(jobDir, 'output');
  
  await fs.ensureDir(inputDir);
  await fs.ensureDir(outputDir);

  for (const res of RESOLUTIONS) {
    await fs.ensureDir(path.join(outputDir, res.name));
  }

  return { jobDir, inputDir, outputDir };
}

async function downloadVideo(jobId, videoKey, inputDir) {
  logger.info(`Downloading video: ${videoKey}`);
  
  const inputPath = path.join(inputDir, path.basename(videoKey));
  const getObjectParams = {
    Bucket: tempBucket,
    Key: videoKey,
  };

  try {
    const response = await s3Client.send(new GetObjectCommand(getObjectParams));
    const writeStream = fs.createWriteStream(inputPath);
    await finished(Readable.fromWeb(response.Body).pipe(writeStream));
    
    logger.info(`Downloaded video to: ${inputPath}`);
    return inputPath;
  } catch (error) {
    logger.error(`Failed to download video: ${videoKey}`, error);
    await updateJobStatus(jobId, 'failed', `Failed to download video: ${error.message}`);
    throw error;
  }
}

async function uploadHLSFiles(jobId, outputDir, videoName) {
  logger.info(`Uploading HLS files for job: ${jobId}`);

  try {
    const baseS3Path = `${videoName}/`;
    
    for (const resolution of RESOLUTIONS) {
      const resDir = path.join(outputDir, resolution.name);
      const resS3Path = `${baseS3Path}${resolution.name}/`;
      
      const files = await fs.readdir(resDir);
      
      for (const file of files) {
        const filePath = path.join(resDir, file);
        const fileKey = `${resS3Path}${file}`;
        
        const uploadParams = {
          Bucket: outputBucket,
          Key: fileKey,
          Body: fs.createReadStream(filePath),
          ContentType: file.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/MP2T',
        };
        
        const upload = new Upload({
          client: s3Client,
          params: uploadParams,
        });
        
        await upload.done();
        logger.info(`Uploaded: ${fileKey}`);
      }
    }
    
    const masterPath = path.join(outputDir, 'master.m3u8');
    const masterKey = `${baseS3Path}master.m3u8`;
    
    const uploadMasterParams = {
      Bucket: outputBucket,
      Key: masterKey,
      Body: fs.createReadStream(masterPath),
      ContentType: 'application/x-mpegURL',
    };
    
    const masterUpload = new Upload({
      client: s3Client,
      params: uploadMasterParams,
    });
    
    await masterUpload.done();
    logger.info(`Uploaded master playlist: ${masterKey}`);
    
    return {
      masterPlaylistUrl: `${baseS3Path}master.m3u8`,
      resolutions: RESOLUTIONS.map(res => res.name)
    };
  } catch (error) {
    logger.error(`Failed to upload HLS files for job: ${jobId}`, error);
    await updateJobStatus(jobId, 'failed', `Failed to upload HLS files: ${error.message}`);
    throw error;
  }
}

async function deleteTemporaryVideo(videoKey) {
  logger.info(`Deleting temporary video: ${videoKey}`);
  
  try {
    const deleteParams = {
      Bucket: tempBucket,
      Key: videoKey,
    };
    
    await s3Client.send(new DeleteObjectCommand(deleteParams));
    logger.info(`Deleted temporary video: ${videoKey}`);
  } catch (error) {
    logger.error(`Failed to delete temporary video: ${videoKey}`, error);
  }
}

async function cleanupTempFiles(jobDir) {
  logger.info(`Cleaning up temporary files: ${jobDir}`);
  
  try {
    await fs.remove(jobDir);
    logger.info(`Cleaned up temporary files: ${jobDir}`);
  } catch (error) {
    logger.error(`Failed to clean up temporary files: ${jobDir}`, error);
  }
}

async function updateJobStatus(jobId, status, message = null) {
  logger.info(`Updating job status: ${jobId} -> ${status}`);
  
  try {
    const query = `
      UPDATE jobs 
      SET status = $1, 
          updated_at = NOW(),
          error_message = $2
      WHERE job_id = $3
      RETURNING *
    `;
    
    await pgPool.query(query, [status, message, jobId]);
    logger.info(`Updated job status: ${jobId} -> ${status}`);
  } catch (error) {
    logger.error(`Failed to update job status: ${jobId} -> ${status}`, error);
  }
}

async function updateJobCompletion(jobId, outputInfo) {
  logger.info(`Updating job completion info: ${jobId}`);
  
  try {
    const query = `
      UPDATE jobs 
      SET status = 'completed', 
          completed_at = NOW(), 
          updated_at = NOW(),
          output_url = $1,
          available_resolutions = $2
      WHERE job_id = $3
      RETURNING *
    `;
    
    await pgPool.query(query, [outputInfo.masterPlaylistUrl, outputInfo.resolutions, jobId]);
    logger.info(`Updated job completion info: ${jobId}`);
  } catch (error) {
    logger.error(`Failed to update job completion info: ${jobId}`, error);
  }
}

function createMasterPlaylist(outputDir) {
  logger.info(`Creating master playlist`);
  
  let masterContent = '#EXTM3U\n#EXT-X-VERSION:3\n';
  
  for (const res of RESOLUTIONS) {
    const bandwidth = parseInt(res.videoBitrate) * 1000;
    const audioBandwidth = parseInt(res.audioBitrate) * 1000;
    const totalBandwidth = bandwidth + audioBandwidth;
    
    masterContent += `#EXT-X-STREAM-INF:BANDWIDTH=${totalBandwidth},RESOLUTION=${res.width}x${res.height}\n`;
    masterContent += `${res.name}/index.m3u8\n`;
  }
  
  const masterPath = path.join(outputDir, 'master.m3u8');
  fs.writeFileSync(masterPath, masterContent);
  
  logger.info(`Created master playlist: ${masterPath}`);
  return masterPath;
}

async function processVideo(jobId, inputPath, outputDir, videoName) {
  logger.info(`Processing video for job: ${jobId}`);
  
  try {
    await updateJobStatus(jobId, 'processing');
    
    for (const res of RESOLUTIONS) {
      const outPath = path.join(outputDir, res.name);
      const segmentPath = path.join(outPath, 'segment_%03d.ts');
      const playlistPath = path.join(outPath, 'index.m3u8');
      
      const ffmpegArgs = [
        '-i', inputPath,
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-b:v', res.videoBitrate,
        '-b:a', res.audioBitrate,
        '-s', `${res.width}x${res.height}`,
        '-profile:v', 'main',
        '-preset', 'medium',
        '-sc_threshold', '0',
        '-g', '48',
        '-keyint_min', '48',
        '-hls_time', '4',
        '-hls_playlist_type', 'vod',
        '-hls_segment_filename', segmentPath,
        '-threads', ffmpegThreads.toString(),
        '-f', 'hls',
        playlistPath
      ];
      
      const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
      
      ffmpegProcess.stdout.on('data', (data) => {
        logger.debug(`FFmpeg stdout: ${data}`);
      });
      
      ffmpegProcess.stderr.on('data', (data) => {
        logger.debug(`FFmpeg stderr: ${data}`);
      });
      
      await new Promise((resolve, reject) => {
        ffmpegProcess.on('close', (code) => {
          if (code === 0) {
            logger.info(`Completed transcoding for ${res.name}`);
            resolve();
          } else {
            const error = new Error(`FFmpeg exited with code ${code} for ${res.name}`);
            logger.error(`Transcoding failed for ${res.name}`, error);
            reject(error);
          }
        });
        
        ffmpegProcess.on('error', (error) => {
          logger.error(`FFmpeg process error for ${res.name}`, error);
          reject(error);
        });
      });
    }
    
    createMasterPlaylist(outputDir);
    
    logger.info(`Completed processing video for job: ${jobId}`);
    return true;
  } catch (error) {
    logger.error(`Failed to process video for job: ${jobId}`, error);
    await updateJobStatus(jobId, 'failed', `Transcoding failed: ${error.message}`);
    throw error;
  }
}

async function processJob(jobId, videoKey, videoName) {
  logger.info(`Starting to process job: ${jobId}`);
  
  try {
    await updateJobStatus(jobId, 'processing');
    
    const { jobDir, inputDir, outputDir } = await createDirectories(jobId);
    
    const inputPath = await downloadVideo(jobId, videoKey, inputDir);
    
    await processVideo(jobId, inputPath, outputDir, videoName);
    
    const outputInfo = await uploadHLSFiles(jobId, outputDir, videoName);
    
    await updateJobCompletion(jobId, outputInfo);
    
    await deleteTemporaryVideo(videoKey);
    
    await cleanupTempFiles(jobDir);
    
    logger.info(`Successfully completed job: ${jobId}`);
    return true;
  } catch (error) {
    logger.error(`Failed to process job: ${jobId}`, error);
    
    await updateJobStatus(jobId, 'failed', error.message);
    
    return false;
  } finally {
    await redisClient.decr('active_job_count');
  }
}

async function startWorker() {
  logger.info(`Starting worker process`);
  
  await fs.ensureDir(TEMP_DIR);
  
  await redisClient.incr('active_job_count');
  
  while (true) {
    try {
      const jobData = await redisClient.blpop('job_queue', 5);
      
      if (!jobData) {
        const keepAlive = await redisClient.get('keep_workers_alive');
        
        if (keepAlive !== '1') {
          logger.info('No jobs in queue and worker not required to stay alive, shutting down');
          break;
        }
        
        logger.info('No jobs in queue, waiting...');
        continue;
      }
      
      const job = JSON.parse(jobData[1]);
      const { jobId, videoKey, videoName } = job;
      
      await processJob(jobId, videoKey, videoName);
      
      const queueSize = await redisClient.llen('job_queue');
      const activeJobCount = await redisClient.get('active_job_count');
      const maxJobs = parseInt(process.env.MAX_CONCURRENT_JOBS || '5', 10);
      
      if (queueSize > 0 && parseInt(activeJobCount) < maxJobs) {
        await redisClient.publish('spawn_worker', 'true');
      }
    } catch (error) {
      logger.error('Error processing job from queue', error);
      
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  logger.info('Worker shutting down gracefully');
  await pgPool.end();
  await redisClient.quit();
  
  process.exit(0);
}

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal, shutting down gracefully');
  
  await redisClient.decr('active_job_count');
  
  await pgPool.end();
  await redisClient.quit();
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT signal, shutting down gracefully');
  
  await redisClient.decr('active_job_count');
  
  await pgPool.end();
  await redisClient.quit();
  
  process.exit(0);
});

startWorker().catch(error => {
  logger.error('Fatal error in worker process', error);
  process.exit(1);
}); 