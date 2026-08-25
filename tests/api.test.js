const request = require('supertest');

jest.mock('bullmq', () => ({
    Queue: jest.fn().mockImplementation(() => ({
        add: jest.fn().mockResolvedValue({ id: 'job-123' })
    })),
    Worker: jest.fn().mockImplementation(() => ({
        close: jest.fn()
    }))
}));

const { app, processQueue, worker } = require('../index');

describe('Async File Processing', () => {
    afterAll(async () => {
        await worker.close();
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
        expect(res.body.jobId).toEqual('job-123');
        expect(processQueue.add).toHaveBeenCalledWith('transcode', { key: 'uploads/123.mp4' });
    });
});
