# HLS Converter Project Structure

## Overview

This document outlines the structure of the HLS Converter project, which is designed to convert videos to HLS (HTTP Live Streaming) format with multiple resolutions.

## Project Files

```
hls-converter/
├── .env                 - Environment variables 
├── .env.example         - Example environment variables template
├── Dockerfile           - Docker image for HLS conversion workers
├── package.json         - npm package configuration
├── README.md            - Project documentation
├── PROJECT_STRUCTURE.md - This file
│
├── scripts/
│   ├── setup.sh         - Setup script for initial installation
│   └── run.sh           - Script to run the server and consumer services
│
├── src/
│   ├── server.js        - Main Express API server
│   ├── consumer.js      - Redis queue consumer for managing docker containers
│   ├── database.js      - PostgreSQL database setup and video model
│   │
│   ├── services/
│   │   ├── minio.js     - MinIO/S3 services for file operations
│   │   └── redis.js     - Redis services for queue management
│   │
│   └── lambda/
│       └── bucket-trigger.js - AWS Lambda function triggered by S3 events
│
└── docker-worker/
    └── worker.js        - FFmpeg transcoding script running in Docker containers
```

## Main Components

1. **API Server (src/server.js)**
   - Handles video uploads
   - Provides status endpoint for checking conversion progress
   - Integrates with MinIO/S3 for file uploads

2. **Consumer Service (src/consumer.js)**
   - Monitors the Redis queue for new videos to process
   - Manages Docker containers for concurrent video processing
   - Controls the maximum number of concurrent jobs

3. **Database Layer (src/database.js)**
   - Defines the Video model using Sequelize
   - Manages video status and metadata
   - Provides functions for status updates

4. **Storage Services (src/services/minio.js)**
   - Manages temporary storage for uploaded videos
   - Handles output storage for HLS streams
   - Provides signed URLs for file access

5. **Queue Management (src/services/redis.js)**
   - Implements Redis-based queue for video processing
   - Tracks the number of processing jobs
   - Ensures concurrency limits are respected

6. **AWS Lambda Trigger (src/lambda/bucket-trigger.js)**
   - Triggered when a new video is uploaded to the temporary bucket
   - Adds the video to the Redis queue

7. **Docker Worker (docker-worker/worker.js)**
   - Runs FFmpeg to transcode videos into multiple resolutions
   - Creates HLS segments and playlists
   - Uploads processed files to the output bucket
   - Generates master playlist for adaptive streaming

## Flow of Operations

1. User uploads a video via the API server
2. Video is stored in temporary MinIO/S3 bucket
3. S3 event triggers AWS Lambda function
4. Lambda adds video to Redis queue
5. Consumer service monitors queue and starts Docker containers
6. Docker containers process videos with FFmpeg
7. Processed HLS files are uploaded to output bucket
8. Database is updated with status and URLs
9. User can check status via the API 