import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SubmitReviewCommand } from '../application/commands/submit-review/submit-review.command';
import { GetInviteQuery } from '../application/queries/get-invite/get-invite.query';
import { ListPublicReviewsQuery } from '../application/queries/list-public-reviews/list-public-reviews.query';
import { PublicReviewsQueryDto, SubmitReviewDto } from './dto/review.dto';

const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;

/** The submit limits, by throttler name: 10 an hour and 40 a day per IP. */
export const SUBMIT_THROTTLES = {
  'public-review-ip-hour': { limit: 10, ttl: ONE_HOUR_MS },
  'public-review-ip-day': { limit: 40, ttl: ONE_DAY_MS },
};

/**
 * The customer's way in. NO LOGIN, and nothing taken from the request context:
 * tenant, salon and booking all come back from the invite row the token
 * resolves to. A separate controller, so no console route sits beside a
 * public one.
 */
@ApiTags('public')
@Controller('v1/public')
export class PublicReviewsController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Post('reviews/:token')
  @HttpCode(201)
  // Tight on purpose: a token is single use, so a customer submits ONCE.
  // Past a handful an hour from one IP is somebody walking a token space.
  @UseGuards(ThrottlerGuard)
  @Throttle(SUBMIT_THROTTLES)
  @ApiOperation({ summary: 'Submit a review with an invite token (no login). One review per booking, ever.' })
  @ApiParam({ name: 'token', description: 'From the invite link. Never logged.' })
  @ApiResponse({ status: 201, description: '{ reviewId }' })
  @ApiResponse({ status: 404, description: 'INVITE_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'INVITE_ALREADY_USED' })
  @ApiResponse({ status: 410, description: 'INVITE_EXPIRED: the link was real but is past its 30 days' })
  @ApiResponse({ status: 422, description: 'VALIDATION_FAILED' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED: 10 an hour, 40 a day per IP' })
  submit(@Param('token') token: string, @Body() dto: SubmitReviewDto) {
    return this.commands.execute(
      new SubmitReviewCommand({
        token,
        rating: dto.rating,
        comment: dto.comment ?? null,
        language: dto.language,
        authorDisplayName: dto.authorDisplayName ?? null,
      }),
    );
  }

  @Get('review-invites/:token')
  @ApiOperation({ summary: 'What the review form shows: the salon, and whether the link is open, used or expired.' })
  @ApiResponse({ status: 200, description: '{ status: OPEN | USED | EXPIRED, salonName, storefrontId, expiresAt }' })
  @ApiResponse({ status: 404, description: 'INVITE_NOT_FOUND' })
  invite(@Param('token') token: string) {
    return this.queries.execute(new GetInviteQuery(token));
  }

  @Get('storefronts/:storefrontId/reviews')
  @ApiOperation({ summary: "A storefront's PUBLISHED reviews, newest first, with the salon's reply." })
  @ApiResponse({ status: 200, description: '{ data, total, offset, limit }' })
  reviews(@Param('storefrontId', ParseUUIDPipe) storefrontId: string, @Query() q: PublicReviewsQueryDto) {
    return this.queries.execute(
      new ListPublicReviewsQuery({ storefrontId, offset: q.offset, limit: q.limit, language: q.language }),
    );
  }
}
