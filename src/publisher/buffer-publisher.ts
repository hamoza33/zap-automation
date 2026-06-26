import { GraphQLClient } from 'graphql-request';
import { IBufferPublisher, PublishResult } from '../types.js';

const BUFFER_API_URL = 'https://api.buffer.com';
const BUFFER_REST_API_URL = 'https://api.bufferapp.com/1';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5_000;

const CREATE_POST_MUTATION = `
  mutation CreatePost($text: String!, $channelId: ChannelId!, $videoUrl: String!) {
    createPost(
      input: {
        text: $text
        channelId: $channelId
        schedulingType: automatic
        mode: shareNow
        assets: [{ video: { url: $videoUrl } }]
      }
    ) {
      ... on PostActionSuccess {
        post {
          id
          text
          url
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
    post?: { id: string; text: string; url?: string };
    message?: string;
  };
}

export interface BufferTestResult {
  success: boolean;
  username?: string;
  channels?: Array<{ id: string; service: string; formatted_username: string }>;
  error?: string;
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

  /**
   * Test a Buffer access token by calling the REST API.
   * Returns user info and connected channels/profiles.
   */
  static async testConnection(accessToken: string): Promise<BufferTestResult> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        // Fetch user info
        const userResponse = await fetch(
          `${BUFFER_REST_API_URL}/user.json?access_token=${encodeURIComponent(accessToken)}`,
          { signal: controller.signal }
        );

        if (!userResponse.ok) {
          const errorText = await userResponse.text().catch(() => 'Unknown error');
          return { success: false, error: `Buffer API returned ${userResponse.status}: ${errorText}` };
        }

        const userData = await userResponse.json() as Record<string, unknown>;
        const username = String(userData.name || userData.id || 'Unknown');

        // Fetch profiles/channels
        const profilesResponse = await fetch(
          `${BUFFER_REST_API_URL}/profiles.json?access_token=${encodeURIComponent(accessToken)}`,
          { signal: controller.signal }
        );

        let channels: Array<{ id: string; service: string; formatted_username: string }> = [];
        if (profilesResponse.ok) {
          const profilesData = await profilesResponse.json() as Array<Record<string, unknown>>;
          if (Array.isArray(profilesData)) {
            channels = profilesData.map(p => ({
              id: String(p.id || ''),
              service: String(p.service || ''),
              formatted_username: String(p.formatted_username || p.service_username || ''),
            }));
          }
        }

        return { success: true, username, channels };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
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
            tiktokVideoLink: result.createPost.post.url || undefined,
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
