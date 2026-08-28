const request = require('supertest');
const { app, processQueue } = require('../index');

describe('Async File Processing (Queue Emulation)', () => {
    beforeEach(() => {
        // Reset queue state before each test
        processQueue.queue = [];
        processQueue.dlq = [];
        processQueue.processing = 0;
        processQueue.metrics = { processed: 0, failed: 0, dlq: 0, retries: 0 };
    });

    it('should get an upload url', async () => {
        const res = await request(app).get('/upload-url');
        expect(res.statusCode).toEqual(200);
        expect(res.body.uploadUrl).toBeDefined();
        expect(res.body.key).toBeDefined();
    });

    it('should queue a job when s3 event received', async () => {
        const res = await request(app)
            .post('/webhook/s3-event')
            .send({ key: 'uploads/123.mp4' });

        expect(res.statusCode).toEqual(200);
        expect(res.body.jobId).toBeDefined();
        expect(res.body.message).toEqual('Job queued');
        
        // Wait for processing to complete to avoid bleed
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should process a job successfully', async () => {
        await request(app).post('/webhook/s3-event').send({ key: 'uploads/good.mp4' });
        
        // Wait for processing to complete
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(processQueue.metrics.processed).toBe(1);
        expect(processQueue.metrics.failed).toBe(0);
        expect(processQueue.queue.length).toBe(0);
    });

    it('should retry a failing job and move to DLQ', async () => {
        // "fail" in key causes our mock handler to throw
        await request(app).post('/webhook/s3-event').send({ key: 'uploads/fail.mp4' });
        
        // Wait for all 3 attempts to fail (50ms each)
        await new Promise(resolve => setTimeout(resolve, 300));

        // It retries, so it should fail 3 times and go to DLQ once
        expect(processQueue.metrics.failed).toBe(3);
        expect(processQueue.metrics.dlq).toBe(1);
        expect(processQueue.queue.length).toBe(0);
        expect(processQueue.dlq.length).toBe(1);

        const dlqRes = await request(app).get('/queue/dlq');
        expect(dlqRes.body.dlq.length).toBe(1);
        expect(dlqRes.body.dlq[0].error).toBe('Simulated processing failure');
    });

    it('should respect concurrency limits (back-pressure)', async () => {
        // Add 5 jobs instantly. Concurrency is 2.
        for (let i = 0; i < 5; i++) {
            await request(app).post('/webhook/s3-event').send({ key: `uploads/test${i}.mp4` });
        }

        // Check metrics immediately - should be 2 processing, 3 in queue
        const metRes1 = await request(app).get('/queue/metrics');
        expect(metRes1.body.activeWorkers).toBe(2);
        expect(metRes1.body.currentQueueLength).toBe(3);

        // Wait for all to finish
        await new Promise(resolve => setTimeout(resolve, 300));

        const metRes2 = await request(app).get('/queue/metrics');
        expect(metRes2.body.activeWorkers).toBe(0);
        expect(metRes2.body.currentQueueLength).toBe(0);
        expect(metRes2.body.metrics.processed).toBe(5);
    });
});
