#!/bin/bash

echo "Starting HLS converter worker container"

echo "Environment:"
echo "- REDIS_HOST: $REDIS_HOST"
echo "- REDIS_PORT: $REDIS_PORT"
echo "- DB_HOST: $DB_HOST"
echo "- DB_PORT: $DB_PORT"
echo "- DB_NAME: $DB_NAME"
echo "- TEMP_BUCKET: $TEMP_BUCKET"
echo "- OUTPUT_BUCKET: $OUTPUT_BUCKET"
echo "- DEPLOYMENT_TYPE: $DEPLOYMENT_TYPE"
echo "- STORAGE_TYPE: $STORAGE_TYPE"
echo "- MAX_CONCURRENT_JOBS: $MAX_CONCURRENT_JOBS"
echo "- FFMPEG_THREADS: $FFMPEG_THREADS"

mkdir -p /app/temp

echo "Starting worker process"
node /app/worker.js 