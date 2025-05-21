FROM node:16-slim

# Install FFmpeg and other dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package.json ./

# Install dependencies
RUN npm install --only=production

# Copy application files
COPY docker-worker/ ./

# Set environment variables
ENV NODE_ENV=production

# Set entry point
CMD ["node", "worker.js"] 