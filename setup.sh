#!/bin/bash

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'


print_status() {
    echo -e "${GREEN}[✓] $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}[!] $1${NC}"
}

print_error() {
    echo -e "${RED}[✗] $1${NC}"
}

# Detect OS
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if [ -f /etc/os-release ]; then
            . /etc/os-release
            OS=$NAME
        else
            OS="Linux"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="MacOS"
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" ]]; then
        OS="Windows"
    else
        OS="Unknown"
    fi
    
    print_status "Detected OS: $OS"
}

check_permissions() {
    if [[ "$OS" == "Windows" ]]; then
    
        if ! net session &>/dev/null; then
            print_error "Please run as Administrator"
            exit 1
        fi
    else
      
        if [ "$EUID" -ne 0 ]; then 
            print_error "Please run as root or with sudo"
            exit 1
        fi
    fi
}


install_dependencies() {
    print_status "Installing system dependencies..."
    
    case $OS in
        "Ubuntu"|"Debian GNU/Linux")
            apt-get update
            apt-get install -y docker.io docker-compose postgresql redis-server ffmpeg
            ;;
        "CentOS Linux"|"Red Hat Enterprise Linux")
            yum install -y docker docker-compose postgresql-server redis ffmpeg
            ;;
        "MacOS")
         
            if ! command -v brew &>/dev/null; then
                print_error "Homebrew not found. Please install Homebrew first: https://brew.sh/"
                exit 1
            fi
            
        
            brew install docker docker-compose postgresql redis ffmpeg
            ;;
        "Windows")
            print_warning "On Windows, please ensure you have installed the following manually:"
            print_warning "1. Docker Desktop: https://www.docker.com/products/docker-desktop"
            print_warning "2. PostgreSQL: https://www.postgresql.org/download/windows/"
            print_warning "3. Redis: Use Docker container or Redis Windows port"
            print_warning "4. FFmpeg: https://ffmpeg.org/download.html#build-windows"
            print_warning "Press any key to continue assuming these dependencies are installed..."
            read -n 1
            ;;
        *)
            print_error "Unsupported OS: $OS"
            exit 1
            ;;
    esac


    if [[ "$OS" != "Windows" && "$OS" != "MacOS" ]]; then
        systemctl start docker
        systemctl enable docker
        systemctl start postgresql
        systemctl enable postgresql
        systemctl start redis
        systemctl enable redis
    elif [[ "$OS" == "MacOS" ]]; then
        brew services start postgresql
        brew services start redis
    fi
}


setup_postgres() {
    print_status "Setting up PostgreSQL..."
    
    if [[ "$OS" == "Windows" ]]; then
        print_warning "Please ensure PostgreSQL is running and create the database manually with:"
        print_warning "createdb hls_converter"
        print_warning "Or use pgAdmin to create the database"
    else
       
        if [[ "$OS" == "MacOS" ]]; then
            createdb hls_converter
        else
            sudo -u postgres psql -c "CREATE DATABASE hls_converter;"
            sudo -u postgres psql -c "CREATE USER postgres WITH PASSWORD 'postgres';"
            sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE hls_converter TO postgres;"
        fi
    fi
    
    
    create_database_schema
}


create_database_schema() {
    print_status "Creating database schema..."
    
    cat > schema.sql << EOF
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
EOF
    
  
    if [[ "$OS" == "Windows" ]]; then
        print_warning "Please run the schema.sql file manually with PostgreSQL tools"
    elif [[ "$OS" == "MacOS" ]]; then
        psql -d hls_converter -f schema.sql
    else
        sudo -u postgres psql -d hls_converter -f schema.sql
    fi
}


setup_minio() {
    print_status "Setting up MinIO..."
    

    mkdir -p /data/minio
    
  
    if docker ps | grep -q "minio/minio"; then
        print_warning "MinIO container is already running"
    else
       
        docker run -d \
            --name minio \
            -p 9000:9000 \
            -p 9001:9001 \
            -v /data/minio:/data \
            -e "MINIO_ROOT_USER=minioadmin" \
            -e "MINIO_ROOT_PASSWORD=minioadmin" \
            minio/minio server /data --console-address ":9001"
    fi
    
    print_status "Creating MinIO buckets..."
    sleep 5 
    
  
    docker run --rm --network host \
        minio/mc config host add myminio http://localhost:9000 minioadmin minioadmin && \
        docker run --rm --network host minio/mc mb myminio/temp-videos && \
        docker run --rm --network host minio/mc mb myminio/hls-videos
}


setup_redis() {
    print_status "Setting up Redis..."
    
    if [[ "$OS" == "Windows" ]]; then
        print_warning "For Windows, ensure Redis is running or use Docker container for Redis"
        
       
        if ! docker ps | grep -q "redis"; then
            docker run -d --name redis -p 6379:6379 redis:alpine --requirepass redis_password
        fi
    elif [[ "$OS" == "MacOS" ]]; then
      
        if [ -f /usr/local/etc/redis.conf ]; then
            sed -i '' 's/# requirepass foobared/requirepass redis_password/' /usr/local/etc/redis.conf
            brew services restart redis
        else
            print_warning "Redis config not found. Please set password manually"
        fi
    else
      
        sed -i 's/# requirepass foobared/requirepass redis_password/' /etc/redis/redis.conf
        systemctl restart redis
    fi
}

setup_worker() {
    print_status "Building and starting Docker worker..."
    
 
    docker build -t hls-converter-worker ./docker-worker
    
    
    if docker ps | grep -q "hls-worker"; then
        print_warning "Worker container is already running"
    else
      
        docker run -d \
            --name hls-worker \
            --network host \
            -e REDIS_HOST=localhost \
            -e REDIS_PORT=6379 \
            -e REDIS_PASSWORD=redis_password \
            -e DB_HOST=localhost \
            -e DB_PORT=5432 \
            -e DB_NAME=hls_converter \
            -e DB_USER=postgres \
            -e DB_PASSWORD=postgres \
            -e TEMP_BUCKET=temp-videos \
            -e OUTPUT_BUCKET=hls-videos \
            -e DEPLOYMENT_TYPE=local \
            -e STORAGE_TYPE=minio \
            -e MINIO_ENDPOINT=localhost \
            -e MINIO_PORT=9000 \
            -e MINIO_ACCESS_KEY=minioadmin \
            -e MINIO_SECRET_KEY=minioadmin \
            -e MAX_CONCURRENT_JOBS=5 \
            -e FFMPEG_THREADS=4 \
            hls-converter-worker
    fi
}


setup_app() {
    print_status "Setting up Node.js application..."
    
    
    if ! command -v node &>/dev/null; then
        print_error "Node.js not found. Please install Node.js first"
        exit 1
    fi
    
    npm install
    
    
    if [ ! -f .env ]; then
        cp .env.example .env
    fi
    

    if [ -f package.json ] && grep -q "build" package.json; then
        npm run build
    fi
    

    mkdir -p /var/log/hls-converter
    
    if [[ "$OS" != "Windows" ]]; then
      
        chmod 755 /var/log/hls-converter
    fi
}

# Final instructions
print_final_instructions() {
    print_status "Setup completed successfully!"
    print_status "You can now start the application with: npm start"
    print_status ""
    print_status "Access the web interface at: http://localhost:3000"
    print_status "Access MinIO console at: http://localhost:9001 (login: minioadmin/minioadmin)"
    
    if [[ "$OS" == "Windows" ]]; then
        print_warning "On Windows, ensure your firewall allows connections to these ports"
    fi
}


main() {
    print_status "Starting setup process..."
    detect_os
    check_permissions
    install_dependencies
    setup_postgres
    setup_minio
    setup_redis
    setup_worker
    setup_app
    print_final_instructions
}
main 