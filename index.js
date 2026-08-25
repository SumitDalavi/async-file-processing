const express = require('express');
const AWS = require('aws-sdk');
const { Queue, Worker } = require('bullmq');
const connection = { host: 'localhost', port: 6379 };

const s3 = new AWS.S3({ accessKeyId: 'mock', secretAccessKey: 'mock', endpoint: 'http://localhost:9000', s3ForcePathStyle: true });
const processQueue = new Queue('file-processing', { connection });

const app = express();
app.use(express.json());

app.get('/upload-url', (req, res) => {
    const key = `uploads/${Date.now()}.mp4`;
    const url = s3.getSignedUrl('putObject', { Bucket: 'my-bucket', Key: key, Expires: 300 });
    res.json({ uploadUrl: url, key });
});

app.post('/webhook/s3-event', async (req, res) => {
    // S3 notifies us file is uploaded
    const { key } = req.body;
    const job = await processQueue.add('transcode', { key });
    res.json({ jobId: job.id });
});

const worker = new Worker('file-processing', async job => {
    console.log(`Processing file ${job.data.key} off the main thread...`);
    await new Promise(resolve => setTimeout(resolve, 5000)); // Simulate work
    console.log('Done!');
}, { connection });

if (require.main === module) {
    app.listen(3000, () => console.log('Async file API on 3000'));
}
module.exports = { app, processQueue, worker };
