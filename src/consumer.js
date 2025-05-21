require('dotenv').config();
const { spawn } = require('child_process');
const { setupDatabase } = require('./database');
const { initializeRedis, getNextJob, completeJob, getQueueStats } = require('./services/redis');
const { getFileFromTempBucket, deleteFileFromTempBucket } = require('./services/minio');


const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS) || 5;


const runningContainers = new Map();


const setupServices = async () => {
  try {
   
    await setupDatabase();
    

    await initializeRedis();
    
    console.log('Consumer services initialized successfully');
  } catch (error) {
    console.error('Failed to initialize consumer services:', error);
    process.exit(1);
  }
};

const startContainer = async (videoId) => {
  try {
    console.log(`Starting Docker container for video ${videoId}`);
    
    const videoData = await getFileFromTempBucket(videoId);
    

    const containerName = `hls-converter-${videoId.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const dockerArgs = [
      'run',
      '-d',
      '--name', containerName,
      '--rm',
      '-e', `VIDEO_ID=${videoId}`,
      '-e', `VIDEO_URL=${videoData.url}`,
      '-e', `MINIO_ENDPOINT=${process.env.MINIO_ENDPOINT}`,
      '-e', `MINIO_PORT=${process.env.MINIO_PORT}`,
      '-e', `MINIO_ACCESS_KEY=${process.env.MINIO_ACCESS_KEY}`,
      '-e', `MINIO_SECRET_KEY=${process.env.MINIO_SECRET_KEY}`,
      '-e', `MINIO_USE_SSL=${process.env.MINIO_USE_SSL}`,
      '-e', `OUTPUT_BUCKET=${process.env.OUTPUT_BUCKET}`,
      process.env.DOCKER_IMAGE
    ];
    
 
    const dockerProcess = spawn('docker', dockerArgs);
    

    return new Promise((resolve, reject) => {
      let containerId = '';
      let errorOutput = '';
      
      dockerProcess.stdout.on('data', (data) => {
        containerId += data.toString().trim();
      });
      
      dockerProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      dockerProcess.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Docker container failed to start: ${errorOutput}`));
          return;
        }
        

        runningContainers.set(videoId, containerId);
        console.log(`Started Docker container ${containerId} for video ${videoId}`);
        resolve(containerId);
      });
    });
  } catch (error) {
    console.error(`Failed to start Docker container for video ${videoId}:`, error);
    throw error;
  }
};


const monitorContainer = async (videoId, containerId) => {
  try {
    console.log(`Monitoring Docker container ${containerId} for video ${videoId}`);
    

    const checkInterval = setInterval(async () => {
      const statusProcess = spawn('docker', ['inspect', '--format={{.State.Status}}', containerId]);
      
      let status = '';
      let errorOutput = '';
      
      statusProcess.stdout.on('data', (data) => {
        status += data.toString().trim();
      });
      
      statusProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      statusProcess.on('close', async (code) => {
       
        if (code !== 0 || status !== 'running') {
          clearInterval(checkInterval);
  
          const exitCodeProcess = spawn('docker', ['inspect', '--format={{.State.ExitCode}}', containerId]);
          
          let exitCode = '';
          
          exitCodeProcess.stdout.on('data', (data) => {
            exitCode += data.toString().trim();
          });
          
          exitCodeProcess.on('close', async () => {
        
            const success = exitCode === '0';
            
         
            await completeJob(videoId, success, success ? null : `Container exited with code ${exitCode}`);
            
            console.log(`Container ${containerId} for video ${videoId} ${success ? 'completed successfully' : 'failed'}`);
            
         
            runningContainers.delete(videoId);
            
       
            if (success) {
              try {
                await deleteFileFromTempBucket(videoId);
                console.log(`Deleted video ${videoId} from temp bucket`);
              } catch (deleteError) {
                console.error(`Failed to delete video ${videoId} from temp bucket:`, deleteError);
              }
            }
            

            processQueue();
          });
        }
      });
    }, 5000); 
  } catch (error) {
    console.error(`Failed to monitor Docker container for video ${videoId}:`, error);
    

    await completeJob(videoId, false, error.message);
    

    runningContainers.delete(videoId);
  }
};


const processQueue = async () => {
  try {
    const stats = await getQueueStats();
    console.log('Current queue stats:', stats);
    

    if (stats.processingJobs >= MAX_CONCURRENT_JOBS) {
      console.log('Maximum number of concurrent jobs reached, waiting...');
      return;
    }
    

    const videoId = await getNextJob();
    
    if (!videoId) {
      console.log('No jobs in the queue');
      return;
    }
    
    console.log(`Processing video ${videoId}`);
    

    const containerId = await startContainer(videoId);
    

    await monitorContainer(videoId, containerId);
  } catch (error) {
    console.error('Failed to process queue:', error);
  }
};


const startConsumer = async () => {
  try {
    console.log('Starting HLS converter consumer');
    

    await setupServices();
    

    processQueue();

    setInterval(processQueue, 10000); 
    
    console.log('HLS converter consumer started successfully');
  } catch (error) {
    console.error('Failed to start consumer:', error);
    process.exit(1);
  }
};


startConsumer(); 