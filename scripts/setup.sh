#!/bin/bash

set -e

echo "Setting up HLS Converter..."

if [ ! -f .env ]; then
  echo "Creating .env file from template..."
  cp .env.example .env
  echo "Please update the .env file with your configuration settings before continuing."
  exit 1
fi


echo "Installing dependencies..."
npm install


echo "Building Docker image for worker..."
docker build -t hls-converter-worker .

if ! command -v mc &> /dev/null; then
  echo "MinIO client (mc) is not installed. Please install it to continue."
  echo "Visit https://min.io/docs/minio/linux/reference/minio-mc.html for installation instructions."
fi

echo "Setup completed successfully!"
echo ""
echo "To start the server: npm start"
echo "To start the consumer: node src/consumer.js" 