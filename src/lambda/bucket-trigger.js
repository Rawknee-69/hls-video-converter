
const AWS = require('aws-sdk');
const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD || undefined
});

const QUEUE_KEY = 'hls:video:queue';


const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  endpoint: process.env.S3_ENDPOINT,
  s3ForcePathStyle: true,
  signatureVersion: 'v4'
});

exports.handler = async (event) => {
  try {
    console.log('Received event:', JSON.stringify(event, null, 2));
    
    // Process each record in the event
    for (const record of event.Records) {
      if (record.eventName.startsWith('ObjectCreated:')) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        
        console.log(`New file uploaded: ${key} in bucket ${bucket}`);
        
        await redis.rpush(QUEUE_KEY, key);
        console.log(`Added ${key} to the processing queue`);
      }
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Videos added to processing queue successfully' }),
    };
  } catch (error) {
    console.error('Error processing bucket event:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process bucket event' }),
    };
  } finally {

    redis.disconnect();
  }
}; 