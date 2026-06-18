import { GraphQLClient } from 'graphql-request';
import { IBufferPublisher, PublishResult } from '../types.js';

const BUFFER_API_URL = 'https://api.buffer.com';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5_000;

const CREATE_POST_MUTATION = `
  mutation CreatePost($text: String!, $channelId: String!, $videoUrl: String!) {
    createPost(
      input: {
        text: $text
        channelId: $channelId
        schedulingType: automatic
        mode: addToQueue
        assets: [{ video: { url: $videoUrl } }]
      }
    ) {
      ... on PostActionSuccess {
        post {
          id
          text
        }
      }
      ... on MutationError {
        message
      }
    }
  }
`;

interface CreatePostSuccessResponse {
  createPost: {
    post?: { id: string; text: string };
    message?: string;
  };
}

/**
 * Buffer GraphQL API client for scheduling TikTok posts.
 * Sends createPost mutations with Bearer token authentication,
 * 30-second timeout, and up to 3 retries with 5-second delay.
 */
export class BufferPublisher implements IBufferPublisher {
  private readonly client: GraphQLClient;
  private readonly profileId: string;

  constructor(accessToken: string, profileId: string) {
    this.profileId = profileId;
    this.client = new GraphQLClient(BUFFER_API_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

  async schedulePost(captionText: string, videoUrl: string): Promise<PublishResult> {
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await this.sendRequest(captionText, videoUrl);

        if (result.createPost.post) {
          return {
            success: true,
            postId: result.createPost.post.id,
            attempts: attempt,
          };
        }

        // MutationError from Buffer API
        lastError = result.createPost.message ?? 'Unknown Buffer API error';
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      // Don't delay after the last attempt
      if (attempt < MAX_RETRIES) {
        await this.delay(RETRY_DELAY_MS);
      }
    }

    return {
      success: false,
      error: lastError,
      attempts: MAX_RETRIES,
    };
  }

  private async sendRequest(captionText: string, videoUrl: string): Promise<CreatePostSuccessResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await this.client.request<CreatePostSuccessResponse>({
        document: CREATE_POST_MUTATION,
        variables: {
          text: captionText,
          channelId: this.profileId,
          videoUrl,
        },
        signal: controller.signal,
      });

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
