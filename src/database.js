const { Sequelize } = require('sequelize');

const sequelize = new Sequelize({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  dialect: 'postgres',
  logging: false
});


const Video = sequelize.define('Video', {
  id: {
    type: Sequelize.STRING,
    primaryKey: true
  },
  originalName: {
    type: Sequelize.STRING,
    allowNull: false
  },
  status: {
    type: Sequelize.ENUM('uploaded', 'queued', 'processing', 'completed', 'failed'),
    defaultValue: 'uploaded'
  },
  processingDetails: {
    type: Sequelize.JSONB,
    defaultValue: {}
  },
  outputPath: {
    type: Sequelize.STRING
  },
  resolutions: {
    type: Sequelize.ARRAY(Sequelize.STRING),
    defaultValue: []
  },
  masterPlaylistUrl: {
    type: Sequelize.STRING
  },
  error: {
    type: Sequelize.TEXT
  },
  createdAt: {
    type: Sequelize.DATE,
    defaultValue: Sequelize.NOW
  },
  updatedAt: {
    type: Sequelize.DATE,
    defaultValue: Sequelize.NOW
  }
});


const setupDatabase = async () => {
  try {
    await sequelize.authenticate();
    console.log('Database connection established successfully');

    await sequelize.sync();
    console.log('Database models synchronized');
    
    return true;
  } catch (error) {
    console.error('Failed to connect to database:', error);
    throw error;
  }
};


const updateVideoStatus = async (videoId, status, details = {}) => {
  try {
    const video = await Video.findByPk(videoId);
    
    if (!video) {
      throw new Error(`Video with ID ${videoId} not found`);
    }
    
    video.status = status;
    
    if (details.outputPath) {
      video.outputPath = details.outputPath;
    }
    
    if (details.resolutions) {
      video.resolutions = details.resolutions;
    }
    
    if (details.masterPlaylistUrl) {
      video.masterPlaylistUrl = details.masterPlaylistUrl;
    }
    
    if (details.error) {
      video.error = details.error;
    }
    
    if (details.processingDetails) {
      video.processingDetails = {
        ...video.processingDetails,
        ...details.processingDetails
      };
    }
    
    await video.save();
    return video;
  } catch (error) {
    console.error(`Failed to update video status for ${videoId}:`, error);
    throw error;
  }
};

const getVideoStatus = async (videoId) => {
  try {
    const video = await Video.findByPk(videoId);
    
    if (!video) {
      throw new Error(`Video with ID ${videoId} not found`);
    }
    
    return {
      id: video.id,
      status: video.status,
      resolutions: video.resolutions,
      masterPlaylistUrl: video.masterPlaylistUrl,
      error: video.error,
      createdAt: video.createdAt,
      updatedAt: video.updatedAt
    };
  } catch (error) {
    console.error(`Failed to get video status for ${videoId}:`, error);
    throw error;
  }
};

const createVideoEntry = async (videoId, originalName) => {
  try {
    const video = await Video.create({
      id: videoId,
      originalName,
      status: 'uploaded'
    });
    
    return video;
  } catch (error) {
    console.error(`Failed to create video entry for ${videoId}:`, error);
    throw error;
  }
};

module.exports = {
  sequelize,
  Video,
  setupDatabase,
  updateVideoStatus,
  getVideoStatus,
  createVideoEntry
}; 