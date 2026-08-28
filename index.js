const express = require('express');
const crypto = require('crypto');

// In-Memory Queue Emulator (Replaces BullMQ/SQS for standalone execution)
class LocalQueue {
    constructor(concurrencyLimit) {
        this.queue = [];
        this.dlq = [];
        this.processing = 0;
        this.concurrencyLimit = concurrencyLimit;
        this.handlers = {};
        this.metrics = {
            processed: 0,
            failed: 0,
            dlq: 0,
            retries: 0
        };
    }

    registerHandler(topic, handler, maxRetries = 3) {
        this.handlers[topic] = { handler, maxRetries };
    }

    async add(topic, data) {
        const job = { id: crypto.randomUUID(), topic, data, attempts: 0 };
        this.queue.push(job);
        this.processNext();
        return job;
    }

    async processNext() {
        if (this.processing >= this.concurrencyLimit || this.queue.length === 0) {
            return; // Back-pressure applied
        }

        const job = this.queue.shift();
        this.processing++;

        const { handler, maxRetries } = this.handlers[job.topic];

        try {
            job.attempts++;
            await handler(job);
            this.metrics.processed++;
        } catch (err) {
            if (job.attempts >= maxRetries) {
                // Move to Dead-Letter Queue (DLQ)
                this.dlq.push({ ...job, error: err.message });
                this.metrics.dlq++;
            } else {
                // Retry (add back to front or end of queue)
                this.metrics.retries++;
                this.queue.push(job); // push to back
            }
            this.metrics.failed++;
        } finally {
            this.processing--;
            // recursively process next
            setTimeout(() => this.processNext(), 0);
        }
    }
}

// 2 concurrency limit to demonstrate back-pressure
const processQueue = new LocalQueue(2);

// Register a handler that simulates file processing (transcoding)
// For testing purposes, if job.data.key includes "fail", we throw an error.
processQueue.registerHandler('transcode', async (job) => {
    // console.log(`Processing file ${job.data.key}... (Attempt ${job.attempts})`);
    await new Promise(resolve => setTimeout(resolve, 50)); // Simulate work
    if (job.data.key.includes('fail')) {
        throw new Error('Simulated processing failure');
    }
}, 3);

const app = express();
app.use(express.json());

app.get('/upload-url', (req, res) => {
    const key = `uploads/${Date.now()}.mp4`;
    // Mocking S3 Signed URL logic
    const url = `https://mock-s3.local/put?key=${key}`;
    res.json({ uploadUrl: url, key });
});

app.post('/webhook/s3-event', async (req, res) => {
    // S3 notifies us file is uploaded
    const { key } = req.body;
    if (!key) {
        return res.status(400).json({ error: 'key is required' });
    }
    const job = await processQueue.add('transcode', { key });
    res.json({ jobId: job.id, message: 'Job queued' });
});

app.get('/queue/metrics', (req, res) => {
    res.json({
        metrics: processQueue.metrics,
        currentQueueLength: processQueue.queue.length,
        currentDlqLength: processQueue.dlq.length,
        activeWorkers: processQueue.processing
    });
});

app.get('/queue/dlq', (req, res) => {
    res.json({ dlq: processQueue.dlq });
});

if (require.main === module) {
    app.listen(3000, () => console.log('Async file API on 3000'));
}

module.exports = { app, processQueue };
