# HLS Video Converter

A powerful video transcoder that converts your videos to HLS format with adaptive bitrate streaming. Works on your local machine, bare metal servers, or in AWS. No need for complex cloud setups - just run it anywhere!

## What it does

- Converts any video to HLS format with adaptive streaming
- Creates multiple quality levels (144p, 360p, 480p, 720p, 1080p, 2K)
- Slick, modern web interface with drag-and-drop uploads
- Shows real-time conversion progress
- Keeps track of your conversion history
- Works anywhere - local dev machine, your own servers, or AWS
- Smart worker system that scales based on load

## What you'll need

- Node.js 16+
- PostgreSQL 12+
- Redis 6+
- FFmpeg 4+
- Docker
- MinIO (for local/bare metal setups)

## Getting started

### On Linux/Mac

1. Clone the repo:
```bash
git clone https://github.com/yourusername/hls-converter.git
cd hls-converter
```

2. Run our setup script:
```bash
chmod +x setup.sh
sudo ./setup.sh
```

This script handles everything for you - installs dependencies, sets up PostgreSQL, configures MinIO storage, gets Redis ready, builds the Docker worker, and sets up the Node.js app.

3. Start it up:
```bash
npm start
```

### On Windows

1. Clone the repo:
```powershell
git clone https://github.com/yourusername/hls-converter.git
cd hls-converter
```

2. Run our PowerShell setup script (as Administrator):
```powershell
.\setup.ps1
```

The Windows script takes care of everything - checks for Docker and Node.js, helps you set up PostgreSQL, configures MinIO in Docker, gets Redis ready, builds the worker container, and sets up the Node.js app.

3. Start it up:
```powershell
npm start
```

4. Open your browser and go to http://localhost:3000

## How it works

The system uses a smart worker architecture to handle video processing:

1. When you upload a video, it's stored in a temp bucket
2. A job gets added to the Redis queue
3. Worker containers are automatically spawned based on load
4. Each worker:
   - Grabs your video
   - Transcodes it to multiple quality levels with FFmpeg
   - Creates all the HLS segments and playlists
   - Makes a master playlist for adaptive streaming
   - Uploads everything to storage
   - Updates the job status in the database
   - Cleans up temp files
   - Shuts down if no more jobs are waiting

The workers automatically scale up and down based on how many videos are in the queue. If you have a big server, you can process multiple videos at once!

## Deployment options

### Local development
Just set `DEPLOYMENT_TYPE=local` in your `.env` file to use MinIO for storage.

### Your own server
To run on your own server:
1. Set `DEPLOYMENT_TYPE=baremetal` in `.env`
2. Update your server's IP in the env variables
3. Run the setup script
4. Access it at your server's IP address

### AWS
To run in AWS:
1. Set `DEPLOYMENT_TYPE=aws` in `.env`
2. Add your AWS credentials
3. Set `STORAGE_TYPE=s3` to use S3 for storage
4. Run the setup script

## Configuration

Copy `.env.example` to `.env` and configure these settings:

```env
# Deployment Type (local, aws, baremetal)
DEPLOYMENT_TYPE=local

# Server Configuration
PORT=3000
NODE_ENV=production

# PostgreSQL Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=hls_converter
DB_USER=postgres
DB_PASSWORD=postgres

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=redis_password

# Storage Configuration
STORAGE_TYPE=minio  # minio or s3

# MinIO Configuration (for local and baremetal)
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin

# AWS S3 Configuration (only used if STORAGE_TYPE=s3 and DEPLOYMENT_TYPE=aws)
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
S3_ENDPOINT=https://s3.amazonaws.com
S3_REGION=us-east-1
```

## System components

The app consists of these main parts:

1. **Web Interface**: A slick modern web app for uploading and managing videos
2. **API Server**: Node.js server handling uploads and conversion requests
3. **Redis Queue**: Manages jobs and worker communication
4. **Docker Worker**: Handles video transcoding with FFmpeg
5. **Storage**: Uses MinIO locally or S3 in AWS
6. **Database**: PostgreSQL for tracking everything

## Output structure

Your transcoded videos are organized like this:

```
output-bucket/
└── video-name/
    ├── master.m3u8           # Master playlist for adaptive streaming
    ├── 144p/
    │   ├── index.m3u8        # Playlist for 144p
    │   ├── segment_000.ts    # Video segments
    │   ├── segment_001.ts
    │   └── ...
    ├── 360p/
    │   ├── index.m3u8
    │   ├── segment_000.ts
    │   └── ...
    ├── 480p/
    │   └── ...
    ├── 720p/
    │   └── ...
    ├── 1080p/
    │   └── ...
    └── 2K/
        └── ...
```

## API endpoints

- `POST /api/upload`: Upload a video file
- `GET /api/status/:jobId`: Check conversion status
- `GET /api/download/:jobId`: Download converted HLS files
- `GET /api/conversions`: Get list of your conversions

## Troubleshooting

### Docker issues
- On Windows, make sure Docker Desktop is running
- If containers won't start, check Docker logs: `docker logs [container-name]`
- Network issues? Try using Docker bridge network instead of host mode

### Database issues
- Check PostgreSQL is running: `systemctl status postgresql` (Linux) or Services app (Windows)
- Verify the database exists: `psql -l`
- Test the connection: `psql -h localhost -U postgres -d hls_converter`

### Storage issues
- Make sure MinIO is running: `docker ps | grep minio`
- Check the MinIO console at http://localhost:9001 (login: minioadmin/minioadmin)
- Verify buckets: `docker run --rm --network host minio/mc ls myminio`

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b cool-new-feature`)
3. Make your changes
4. Commit (`git commit -m 'Added something awesome'`)
5. Push to your branch (`git push origin cool-new-feature`)
6. Open a Pull Request

## License

MIT - see the LICENSE file for details. 