import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { REPLY_MAX } from '../../domain/services/review-reply-rules';
import {
  REPORT_NOTE_MAX,
  REPORT_NOTE_MIN,
  REPORT_REASONS,
  REPORT_STATUSES,
} from '../../domain/services/review-report-rules';
import {
  AUTHOR_NAME_MAX,
  COMMENT_MAX,
  RATING_MAX,
  RATING_MIN,
  REVIEW_LANGUAGES,
  REVIEW_STATES,
} from '../../domain/services/review-rules';

// Copied from gostyle-api's dto/review.dto.ts: same names, same rules, so the
// front ends only change their base URL. The domain validates again behind
// these; the DTO is the first, friendlier line.

const trimmed = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const v = value.trim();
  return v.length > 0 ? v : undefined;
};

export class SubmitReviewDto {
  @ApiProperty({ minimum: RATING_MIN, maximum: RATING_MAX })
  @IsInt()
  @Min(RATING_MIN)
  @Max(RATING_MAX)
  rating!: number;

  @ApiPropertyOptional({ maxLength: COMMENT_MAX, description: 'Optional. A bare rating is a complete review.' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(COMMENT_MAX)
  comment?: string;

  @ApiProperty({ enum: REVIEW_LANGUAGES, description: 'The language the customer wrote in.' })
  @IsIn(REVIEW_LANGUAGES as unknown as string[])
  language!: string;

  @ApiPropertyOptional({
    maxLength: AUTHOR_NAME_MAX,
    description: 'Used only when the booking had no name on file (a walk-in). The booking name wins.',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(AUTHOR_NAME_MAX)
  authorDisplayName?: string;
}

/** The active branch: explicit wins over the JWT claim (the platform's BranchScopeDto). */
export class BranchScopeDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Defaults to the branch on the token.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class ListStorefrontReviewsQueryDto extends BranchScopeDto {
  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ enum: REVIEW_STATES, description: 'Omit for every state.' })
  @IsOptional()
  @IsString()
  state?: string;
}

export class ReviewReplyDto extends BranchScopeDto {
  @ApiProperty({ maxLength: REPLY_MAX, description: 'Rendered as "Response from the salon".' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(REPLY_MAX)
  body!: string;
}

export class ReportReviewDto extends BranchScopeDto {
  @ApiProperty({ enum: REPORT_REASONS })
  @IsIn(REPORT_REASONS as unknown as string[])
  reason!: string;

  @ApiPropertyOptional({ maxLength: REPORT_NOTE_MAX })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(REPORT_NOTE_MAX)
  note?: string;
}

export class ResolveReviewReportDto {
  @ApiProperty({ minLength: REPORT_NOTE_MIN, maxLength: REPORT_NOTE_MAX, description: 'Shown to the salon verbatim.' })
  @Transform(trimmed)
  @IsString()
  @MinLength(REPORT_NOTE_MIN)
  @MaxLength(REPORT_NOTE_MAX)
  note!: string;
}

/** Hide, restore and remove: a reason is required (DECISIONS D8). */
export class ModerateReviewDto extends ResolveReviewReportDto {}

export class ReviewReportQueueQueryDto {
  @ApiPropertyOptional({ enum: REPORT_STATUSES, default: 'OPEN' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class PublicReviewsQueryDto {
  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ enum: REVIEW_LANGUAGES })
  @IsOptional()
  @IsString()
  language?: string;
}

const toList = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : value;

export class RatingSummariesQueryDto {
  @ApiPropertyOptional({ description: 'Comma-separated storefront ids. Omit to page through all.' })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  storefrontIds?: string[];

  @ApiPropertyOptional({ format: 'uuid', description: 'nextCursor from the previous page.' })
  @IsOptional()
  @IsUUID()
  after?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
