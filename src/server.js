require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { uploadToTempBucket } = require('./services/minio');
const { setupDatabase, getVideoStatus, createVideoEntry } = require('./database');
const { initializeRedis, addToQueue } = require('./services/redis');

const app = express();
const PORT = process.env.PORT || 3000;


const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 500 
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
  res.send('HLS Converter API is running');
});


app.post('/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const file = req.file;
    const fileExtension = path.extname(file.originalname);
    const fileName = `${uuidv4()}${fileExtension}`;


    const uploadResult = await uploadToTempBucket(file.buffer, fileName, file.mimetype);
    

    await addToQueue(fileName);

    return res.status(200).json({
      message: 'Video uploaded successfully and queued for processing',
      videoId: fileName,
      url: uploadResult.url,
      statusUrl: `/status/${fileName}`
    });
  } catch (error) {
    console.error('Error uploading video:', error);
    return res.status(500).json({ error: 'Failed to upload video' });
  }
});


app.get('/status/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    

    const status = await getVideoStatus(videoId);
    
    return res.status(200).json({
      videoId: status.id,
      status: status.status,
      resolutions: status.resolutions || [],
      masterPlaylistUrl: status.masterPlaylistUrl || null,
      error: status.error || null,
      createdAt: status.createdAt,
      updatedAt: status.updatedAt
    });
  } catch (error) {
    console.error('Error getting video status:', error);
    return res.status(500).json({ error: 'Failed to get video status' });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const startServer = async () => {
  try {

    await setupDatabase();
    

    await initializeRedis();
    

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer(); 