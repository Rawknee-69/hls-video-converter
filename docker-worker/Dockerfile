FROM node:18-slim

RUN apt-get update && \
    apt-get install -y ffmpeg python3 python3-pip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*


WORKDIR /app

COPY package*.json ./


RUN npm install

COPY worker.js ./
COPY run.sh ./

RUN chmod +x /app/run.sh

RUN mkdir -p /app/temp

ENV NODE_ENV=production
CMD ["/app/run.sh"] 