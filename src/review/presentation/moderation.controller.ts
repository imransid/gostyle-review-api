import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, RequirePermissions, RequirePlatformActor } from '../../shared/auth/decorators';
import { PlatformJwtGuard } from '../../shared/auth/platform-jwt.guard';
import type { PlatformPrincipal } from '../../shared/auth/platform-token';
import {
  HideReviewCommand,
  RemoveReviewCommand,
  RestoreReviewCommand,
} from '../application/commands/moderate-review/moderate-review.commands';
import {
  DismissReportCommand,
  UpholdReportCommand,
} from '../application/commands/uphold-report/report-decisions';
import { GetReportQuery, ListReportQueueQuery } from '../application/queries/report-queue/report-queue.query';
import { ModerateReviewDto, ResolveReviewReportDto, ReviewReportQueueQueryDto } from './dto/review.dto';

const MODERATION = 'storefront.review_moderation';

/**
 * HQ's report queue, at gostyle-api's path (/v1/platform/review-reports).
 * Two gates, both required: the JWT's actor is platform_admin, AND the caller
 * holds storefront.review_moderation. No tenant: the queue is every salon's.
 */
@ApiTags('moderation')
@ApiBearerAuth('platform-jwt')
@UseGuards(PlatformJwtGuard)
@RequirePlatformActor()
@RequirePermissions(MODERATION)
@Controller('v1/platform/review-reports')
export class ReviewReportsController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Get()
  @ApiOperation({ summary: 'The report queue across all salons, oldest first. Defaults to OPEN.' })
  @ApiResponse({ status: 200, description: '{ data, total, offset, limit }' })
  @ApiResponse({ status: 403, description: 'PLATFORM_ACCESS_REQUIRED or PERMISSION_DENIED' })
  queue(@Query() q: ReviewReportQueueQueryDto) {
    return this.queries.execute(new ListReportQueueQuery({ status: q.status, offset: q.offset, limit: q.limit }));
  }

  @Get(':id')
  @ApiOperation({ summary: 'One report, with the review it is about.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 404, description: 'REPORT_NOT_FOUND' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.queries.execute(new GetReportQuery(id));
  }

  @Post(':id/uphold')
  @HttpCode(200)
  @ApiOperation({ summary: 'Agree with the salon. The review is HIDDEN, in the same transaction.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'ReportDecisionView, reviewState HIDDEN (REMOVED stays REMOVED)' })
  @ApiResponse({ status: 404, description: 'REPORT_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'REPORT_TRANSITION_INVALID' })
  @ApiResponse({ status: 422, description: 'VALIDATION_FAILED' })
  uphold(@CurrentPrincipal() p: PlatformPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveReviewReportDto) {
    return this.commands.execute(new UpholdReportCommand({ reportId: id, reviewerId: p.userId, note: dto.note }));
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  @ApiOperation({ summary: 'Disagree with the salon. The review is not touched.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'ReportDecisionView, reviewState unchanged' })
  @ApiResponse({ status: 404, description: 'REPORT_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'REPORT_TRANSITION_INVALID' })
  dismiss(@CurrentPrincipal() p: PlatformPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveReviewReportDto) {
    return this.commands.execute(new DismissReportCommand({ reportId: id, reviewerId: p.userId, note: dto.note }));
  }
}

/**
 * HQ's direct moderation of a review: hide, restore, remove (final). New in
 * review-service (plan §5); same two gates as the queue.
 */
@ApiTags('moderation')
@ApiBearerAuth('platform-jwt')
@UseGuards(PlatformJwtGuard)
@RequirePlatformActor()
@RequirePermissions(MODERATION)
@Controller('v1/platform/reviews')
export class ReviewModerationController {
  constructor(private readonly commands: CommandBus) {}

  @Post(':id/hide')
  @HttpCode(200)
  @ApiOperation({ summary: 'PUBLISHED -> HIDDEN. Out of the page and the rating; reversible.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'REVIEW_TRANSITION_INVALID' })
  hide(@CurrentPrincipal() p: PlatformPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerateReviewDto) {
    return this.commands.execute(new HideReviewCommand({ reviewId: id, moderatorId: p.userId, note: dto.note }));
  }

  @Post(':id/restore')
  @HttpCode(200)
  @ApiOperation({ summary: 'HIDDEN -> PUBLISHED.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'REVIEW_TRANSITION_INVALID' })
  restore(@CurrentPrincipal() p: PlatformPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerateReviewDto) {
    return this.commands.execute(new RestoreReviewCommand({ reviewId: id, moderatorId: p.userId, note: dto.note }));
  }

  @Post(':id/remove')
  @HttpCode(200)
  @ApiOperation({ summary: 'PUBLISHED or HIDDEN -> REMOVED. FINAL.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'REVIEW_TRANSITION_INVALID' })
  remove(@CurrentPrincipal() p: PlatformPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerateReviewDto) {
    return this.commands.execute(new RemoveReviewCommand({ reviewId: id, moderatorId: p.userId, note: dto.note }));
  }
}
