import { IRowValidator, SheetRow, ValidationError, ValidationResult } from '../types.js';

/**
 * Validates extracted row data before publishing.
 * Collects ALL validation errors for a row (does not short-circuit on first error).
 */
export class RowValidator implements IRowValidator {
  validate(row: SheetRow): ValidationResult {
    const errors: ValidationError[] = [];

    this.validateCaptionText(row.captionText, errors);
    this.validateVideoUrl(row.videoUrl, errors);

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private validateCaptionText(captionText: string, errors: ValidationError[]): void {
    if (!/\S/.test(captionText)) {
      errors.push({
        field: 'captionText',
        message: 'Caption text must contain at least one non-whitespace character',
      });
    }

    if (captionText.length > 4000) {
      errors.push({
        field: 'captionText',
        message: `Caption text must not exceed 4000 characters (got ${captionText.length})`,
      });
    }
  }

  private validateVideoUrl(videoUrl: string, errors: ValidationError[]): void {
    if (!videoUrl || videoUrl.trim().length === 0) {
      errors.push({
        field: 'videoUrl',
        message: 'Video URL must be non-empty',
      });
      return;
    }

    if (!videoUrl.startsWith('http://') && !videoUrl.startsWith('https://')) {
      errors.push({
        field: 'videoUrl',
        message: 'Video URL must start with "http://" or "https://"',
      });
      return;
    }

    // Extract the part after the protocol
    const protocolEnd = videoUrl.startsWith('https://') ? 8 : 7;
    const domainAndPath = videoUrl.slice(protocolEnd);

    // Domain must contain at least one dot, no spaces, and have content before/after the dot
    const domain = domainAndPath.split('/')[0];

    if (domain.includes(' ')) {
      errors.push({
        field: 'videoUrl',
        message: 'Video URL domain must not contain spaces',
      });
      return;
    }

    if (!domain.includes('.')) {
      errors.push({
        field: 'videoUrl',
        message: 'Video URL must contain a valid domain with at least one dot',
      });
    }
  }
}
