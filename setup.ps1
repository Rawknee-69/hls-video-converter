
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Please run this script as Administrator" -ForegroundColor Red
    exit 1
}


function Print-Status {
    param([string]$message)
    Write-Host "[✓] $message" -ForegroundColor Green
}

function Print-Warning {
    param([string]$message)
    Write-Host "[!] $message" -ForegroundColor Yellow
}

function Print-Error {
    param([string]$message)
    Write-Host "[✗] $message" -ForegroundColor Red
}


function Check-Docker {
    Print-Status "Checking Docker..."

    try {
        $dockerInfo = docker info 2>&1
        if ($LASTEXITCODE -ne 0) {
            Print-Error "Docker is not running. Please start Docker Desktop"
            exit 1
        }
        Print-Status "Docker is running"
    }
    catch {
        Print-Error "Docker is not installed or not in PATH. Please install Docker Desktop"
        exit 1
    }
}


function Check-NodeJS {
    Print-Status "Checking Node.js..."

    try {
        $nodeVersion = node -v
        Print-Status "Node.js is installed: $nodeVersion"
    }
    catch {
        Print-Error "Node.js is not installed or not in PATH. Please install Node.js"
        exit 1
    }
}

function Setup-PostgreSQL {
    Print-Status "Setting up PostgreSQL..."

    
    $pgService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue
    
    if ($null -eq $pgService) {
        Print-Warning "PostgreSQL service not found. Please ensure PostgreSQL is installed"
        Print-Warning "You can download PostgreSQL from: https://www.postgresql.org/download/windows/"
        
        $confirmed = Read-Host "Do you want to continue assuming PostgreSQL is installed but running in a different way? (y/n)"
        if ($confirmed -ne 'y') {
            exit 1
        }
    }
    else {
        if ($pgService.Status -ne 'Running') {
            Print-Warning "PostgreSQL service is not running. Starting..."
            Start-Service $pgService
            Start-Sleep -Seconds 5
            
            if ((Get-Service $pgService.Name).Status -ne 'Running') {
                Print-Error "Failed to start PostgreSQL service"
                exit 1
            }
            Print-Status "PostgreSQL service started"
        }
        else {
            Print-Status "PostgreSQL service is running"
        }
    }

  
    Print-Warning "Please create the hls_converter database manually using pgAdmin or psql"
    Print-Warning "Run: createdb hls_converter"
    
 
    Print-Status "Creating database schema file..."
    $schemaFilePath = Join-Path $PSScriptRoot "schema.sql"
    
    $schemaContent = @"
CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY,
    job_id VARCHAR(255) NOT NULL UNIQUE,
    video_key VARCHAR(255) NOT NULL,
    video_name VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'queued',
    error_message TEXT,
    output_url TEXT,
    available_resolutions TEXT[],
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_jobs_job_id ON jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
"@
    
    $schemaContent | Out-File -FilePath $schemaFilePath -Encoding utf8
    Print-Status "Schema file created at: $schemaFilePath"
    Print-Warning "Please run the schema.sql file using psql or pgAdmin"
}


function Setup-MinIO {
    Print-Status "Setting up MinIO..."

  
    $minioRunning = docker ps | Select-String -Pattern "minio/minio"
    
    if ($null -ne $minioRunning) {
        Print-Warning "MinIO container is already running"
    }
    else {
        
        $minioDataPath = "C:\data\minio"
        if (-not (Test-Path $minioDataPath)) {
            New-Item -Path $minioDataPath -ItemType Directory -Force | Out-Null
        }
        
      
        Print-Status "Starting MinIO container..."
        docker run -d --name minio -p 9000:9000 -p 9001:9001 -v "${minioDataPath}:/data" -e "MINIO_ROOT_USER=minioadmin" -e "MINIO_ROOT_PASSWORD=minioadmin" minio/minio server /data --console-address ":9001"
        
        if ($LASTEXITCODE -ne 0) {
            Print-Error "Failed to start MinIO container"
            exit 1
        }
        Print-Status "MinIO container started"
    }
    
    # Create buckets
    Print-Status "Creating MinIO buckets..."
    Start-Sleep -Seconds 5
    
  
    docker run --rm --network host minio/mc config host add myminio http://localhost:9000 minioadmin minioadmin
    docker run --rm --network host minio/mc mb myminio/temp-videos
    docker run --rm --network host minio/mc mb myminio/hls-videos
    
    Print-Status "MinIO buckets created"
}


function Setup-Redis {
    Print-Status "Setting up Redis..."

  
    $redisRunning = docker ps | Select-String -Pattern "redis"
    
    if ($null -ne $redisRunning) {
        Print-Warning "Redis container is already running"
    }
    else {
     
        Print-Status "Starting Redis container..."
        docker run -d --name redis -p 6379:6379 redis:alpine --requirepass redis_password
        
        if ($LASTEXITCODE -ne 0) {
            Print-Error "Failed to start Redis container"
            exit 1
        }
        Print-Status "Redis container started"
    }
}

function Setup-Worker {
    Print-Status "Building and starting Docker worker..."

 
    Push-Location (Join-Path $PSScriptRoot "docker-worker")
    
    Print-Status "Building worker image..."
    docker build -t hls-converter-worker .
    
    if ($LASTEXITCODE -ne 0) {
        Print-Error "Failed to build worker image"
        exit 1
    }
    
    Pop-Location
  
    $workerRunning = docker ps | Select-String -Pattern "hls-worker"
    
    if ($null -ne $workerRunning) {
        Print-Warning "Worker container is already running"
    }
    else {
    
        Print-Status "Starting worker container..."
        docker run -d --name hls-worker --network host `
            -e REDIS_HOST=localhost `
            -e REDIS_PORT=6379 `
            -e REDIS_PASSWORD=redis_password `
            -e DB_HOST=localhost `
            -e DB_PORT=5432 `
            -e DB_NAME=hls_converter `
            -e DB_USER=postgres `
            -e DB_PASSWORD=postgres `
            -e TEMP_BUCKET=temp-videos `
            -e OUTPUT_BUCKET=hls-videos `
            -e DEPLOYMENT_TYPE=local `
            -e STORAGE_TYPE=minio `
            -e MINIO_ENDPOINT=localhost `
            -e MINIO_PORT=9000 `
            -e MINIO_ACCESS_KEY=minioadmin `
            -e MINIO_SECRET_KEY=minioadmin `
            -e MAX_CONCURRENT_JOBS=5 `
            -e FFMPEG_THREADS=4 `
            hls-converter-worker
        
        if ($LASTEXITCODE -ne 0) {
            Print-Error "Failed to start worker container"
            exit 1
        }
        Print-Status "Worker container started"
    }
}


function Setup-NodeApp {
    Print-Status "Setting up Node.js application..."

    
    Print-Status "Installing Node.js dependencies..."
    npm install
    
    if ($LASTEXITCODE -ne 0) {
        Print-Error "Failed to install Node.js dependencies"
        exit 1
    }
    
 
    $envFile = Join-Path $PSScriptRoot ".env"
    $envExampleFile = Join-Path $PSScriptRoot ".env.example"
    
    if (-not (Test-Path $envFile)) {
        Copy-Item -Path $envExampleFile -Destination $envFile
        Print-Status "Created .env file from .env.example"
    }
    

    $packageJsonPath = Join-Path $PSScriptRoot "package.json"
    $packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
    
    if ($null -ne $packageJson.scripts.build) {
        Print-Status "Building the application..."
        npm run build
        
        if ($LASTEXITCODE -ne 0) {
            Print-Error "Failed to build the application"
            exit 1
        }
    }
    

    $logsDir = "C:\var\log\hls-converter"
    if (-not (Test-Path $logsDir)) {
        New-Item -Path $logsDir -ItemType Directory -Force | Out-Null
        Print-Status "Created logs directory: $logsDir"
    }
}

function Main {
    Print-Status "Starting HLS Converter setup for Windows..."

  
    Check-Docker
    Check-NodeJS
    Setup-PostgreSQL
    Setup-MinIO
    Setup-Redis
    Setup-Worker
    Setup-NodeApp
    
    Print-Status "Setup completed successfully!"
    Print-Status "You can now start the application with: npm start"
    Print-Status ""
    Print-Status "Access the web interface at: http://localhost:3000"
    Print-Status "Access MinIO console at: http://localhost:9001 (login: minioadmin/minioadmin)"
    Print-Warning "Ensure your firewall allows connections to these ports"
}

Main 