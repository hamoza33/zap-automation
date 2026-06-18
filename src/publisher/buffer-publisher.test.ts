import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BufferPublisher } from './buffer-publisher.js';

const mockRequest = vi.fn();

vi.mock('graphql-request', () => {
  return {
    GraphQLClient: class {
      request = mockRequest;
      constructor() {}
    },
  };
});

describe('BufferPublisher', () => {
  let publisher: BufferPublisher;

  beforeEach(() => {
    vi.useFakeTimers();
    mockRequest.mockReset();
    publisher = new BufferPublisher('test-access-token', 'test-profile-id');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('successful post on first attempt', () => {
    it('should return success with postId and attempts=1', async () => {
      mockRequest.mockResolvedValueOnce({
        createPost: {
          post: { id: 'post-123', text: 'My caption' },
        },
      });

      const result = await publisher.schedulePost('My caption', 'https://example.com/video.mp4');

      expect(result).toEqual({
        success: true,
        postId: 'post-123',
        attempts: 1,
      });
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry after failure', () => {
    it('should retry and succeed on second attempt with attempts=2', async () => {
      mockRequest.mockRejectedValueOnce(new Error('Timeout'));
      mockRequest.mockResolvedValueOnce({
        createPost: {
          post: { id: 'post-456', text: 'Retry caption' },
        },
      });

      const resultPromise = publisher.schedulePost('Retry caption', 'https://example.com/video.mp4');

      // Advance past the 5-second retry delay
      await vi.advanceTimersByTimeAsync(5000);

      const result = await resultPromise;

      expect(result).toEqual({
        success: true,
        postId: 'post-456',
        attempts: 2,
      });
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it('should retry on MutationError and succeed on third attempt', async () => {
      // First two attempts return MutationError
      mockRequest.mockResolvedValueOnce({
        createPost: { message: 'Rate limited' },
      });
      mockRequest.mockResolvedValueOnce({
        createPost: { message: 'Still rate limited' },
      });
      // Third attempt succeeds
      mockRequest.mockResolvedValueOnce({
        createPost: {
          post: { id: 'post-789', text: 'Finally' },
        },
      });

      const resultPromise = publisher.schedulePost('Finally', 'https://example.com/video.mp4');

      // Advance past first retry delay (5s)
      await vi.advanceTimersByTimeAsync(5000);
      // Advance past second retry delay (5s)
      await vi.advanceTimersByTimeAsync(5000);

      const result = await resultPromise;

      expect(result).toEqual({
        success: true,
        postId: 'post-789',
        attempts: 3,
      });
      expect(mockRequest).toHaveBeenCalledTimes(3);
    });
  });

  describe('all retries exhausted', () => {
    it('should return failure with attempts=3 and last error message', async () => {
      mockRequest.mockRejectedValueOnce(new Error('Network error'));
      mockRequest.mockRejectedValueOnce(new Error('Connection reset'));
      mockRequest.mockRejectedValueOnce(new Error('Service unavailable'));

      const resultPromise = publisher.schedulePost('Caption', 'https://example.com/video.mp4');

      // Advance past the two retry delays (no delay after last attempt)
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      const result = await resultPromise;

      expect(result).toEqual({
        success: false,
        error: 'Service unavailable',
        attempts: 3,
      });
      expect(mockRequest).toHaveBeenCalledTimes(3);
    });

    it('should return MutationError message when all attempts get MutationError', async () => {
      mockRequest.mockResolvedValueOnce({
        createPost: { message: 'First error' },
      });
      mockRequest.mockResolvedValueOnce({
        createPost: { message: 'Second error' },
      });
      mockRequest.mockResolvedValueOnce({
        createPost: { message: 'Final error from Buffer' },
      });

      const resultPromise = publisher.schedulePost('Caption', 'https://example.com/video.mp4');

      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      const result = await resultPromise;

      expect(result).toEqual({
        success: false,
        error: 'Final error from Buffer',
        attempts: 3,
      });
    });
  });

  describe('30-second timeout triggers failure treatment', () => {
    it('should treat abort error as a failed attempt and retry', async () => {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';

      mockRequest.mockRejectedValueOnce(abortError);
      mockRequest.mockResolvedValueOnce({
        createPost: {
          post: { id: 'post-after-timeout', text: 'Success after timeout' },
        },
      });

      const resultPromise = publisher.schedulePost('Timeout test', 'https://example.com/video.mp4');

      // Advance past the retry delay
      await vi.advanceTimersByTimeAsync(5000);

      const result = await resultPromise;

      expect(result).toEqual({
        success: true,
        postId: 'post-after-timeout',
        attempts: 2,
      });
    });

    it('should return failure when all attempts timeout', async () => {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';

      mockRequest.mockRejectedValue(abortError);

      const resultPromise = publisher.schedulePost('All timeouts', 'https://example.com/video.mp4');

      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      const result = await resultPromise;

      expect(result).toEqual({
        success: false,
        error: 'This operation was aborted',
        attempts: 3,
      });
    });
  });

  describe('retry delay timing', () => {
    it('should wait 5 seconds between retry attempts', async () => {
      mockRequest.mockRejectedValueOnce(new Error('fail 1'));
      mockRequest.mockRejectedValueOnce(new Error('fail 2'));
      mockRequest.mockRejectedValueOnce(new Error('fail 3'));

      const resultPromise = publisher.schedulePost('Timing test', 'https://example.com/video.mp4');

      // After first attempt fails, only 1 call should have been made
      expect(mockRequest).toHaveBeenCalledTimes(1);

      // Advance 4.9 seconds — not enough for retry
      await vi.advanceTimersByTimeAsync(4900);
      expect(mockRequest).toHaveBeenCalledTimes(1);

      // Advance remaining 100ms to hit 5s total
      await vi.advanceTimersByTimeAsync(100);
      // Second attempt should now be made
      expect(mockRequest).toHaveBeenCalledTimes(2);

      // Advance another 5s for the third attempt
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockRequest).toHaveBeenCalledTimes(3);

      const result = await resultPromise;
      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
    });
  });
});
