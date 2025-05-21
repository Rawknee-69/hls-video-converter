const Minio = require('minio');
const { createVideoEntry } = require('../database');

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT,
  port: parseInt(process.env.MINIO_PORT),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY
});

const ensureBuckets = async () => {
  try {
    const tempBucketExists = await minioClient.bucketExists(process.env.TEMP_BUCKET);
    if (!tempBucketExists) {
      await minioClient.makeBucket(process.env.TEMP_BUCKET, 'us-east-1');
      console.log(`Created temp bucket: ${process.env.TEMP_BUCKET}`);
    }

    const outputBucketExists = await minioClient.bucketExists(process.env.OUTPUT_BUCKET);
    if (!outputBucketExists) {
      await minioClient.makeBucket(process.env.OUTPUT_BUCKET, 'us-east-1');
      console.log(`Created output bucket: ${process.env.OUTPUT_BUCKET}`);
      

      const policy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${process.env.OUTPUT_BUCKET}/*`]
          }
        ]
      };
      
      await minioClient.setBucketPolicy(process.env.OUTPUT_BUCKET, JSON.stringify(policy));
      console.log(`Set public read policy for output bucket: ${process.env.OUTPUT_BUCKET}`);
    }
  } catch (error) {
    console.error('Error ensuring buckets exist:', error);
    throw error;
  }
};


const uploadToTempBucket = async (fileBuffer, fileName, contentType) => {
  try {
    await ensureBuckets();
    

    await minioClient.putObject(
      process.env.TEMP_BUCKET,
      fileName,
      fileBuffer,
      fileBuffer.length,
      { 'Content-Type': contentType }
    );

    const url = await minioClient.presignedGetObject(
      process.env.TEMP_BUCKET,
      fileName,
      60 * 60
    );
    

    await createVideoEntry(fileName, fileName);
    
    return {
      fileName,
      url,
      bucket: process.env.TEMP_BUCKET
    };
  } catch (error) {
    console.error('Error uploading file to temp bucket:', error);
    throw error;
  }
};

const listFilesInTempBucket = async () => {
  try {
    const filesList = [];
    const stream = minioClient.listObjects(process.env.TEMP_BUCKET, '', true);
    
    return new Promise((resolve, reject) => {
      stream.on('data', (obj) => {
        filesList.push({
          name: obj.name,
          size: obj.size,
          lastModified: obj.lastModified
        });
      });
      
      stream.on('error', (err) => {
        reject(err);
      });
      
      stream.on('end', () => {
        resolve(filesList);
      });
    });
  } catch (error) {
    console.error('Error listing files in temp bucket:', error);
    throw error;
  }
};


const getFileFromTempBucket = async (fileName) => {
  try {
  
    await minioClient.statObject(process.env.TEMP_BUCKET, fileName);
    
 
    const url = await minioClient.presignedGetObject(
      process.env.TEMP_BUCKET,
      fileName,
      60 * 60 
    );
    
    return {
      fileName,
      url,
      bucket: process.env.TEMP_BUCKET
    };
  } catch (error) {
    console.error(`Error getting file ${fileName} from temp bucket:`, error);
    throw error;
  }
};


const deleteFileFromTempBucket = async (fileName) => {
  try {
    await minioClient.removeObject(process.env.TEMP_BUCKET, fileName);
    
    return {
      fileName,
      deleted: true,
      bucket: process.env.TEMP_BUCKET
    };
  } catch (error) {
    console.error(`Error deleting file ${fileName} from temp bucket:`, error);
    throw error;
  }
};


const uploadToOutputBucket = async (fileBuffer, outputPath, contentType) => {
  try {
    await ensureBuckets();
    

    await minioClient.putObject(
      process.env.OUTPUT_BUCKET,
      outputPath,
      fileBuffer,
      fileBuffer.length,
      { 'Content-Type': contentType }
    );
    

    const url = `http://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}/${process.env.OUTPUT_BUCKET}/${outputPath}`;
    
    return {
      outputPath,
      url,
      bucket: process.env.OUTPUT_BUCKET
    };
  } catch (error) {
    console.error('Error uploading file to output bucket:', error);
    throw error;
  }
};

module.exports = {
  minioClient,
  ensureBuckets,
  uploadToTempBucket,
  listFilesInTempBucket,
  getFileFromTempBucket,
  deleteFileFromTempBucket,
  uploadToOutputBucket
}; 