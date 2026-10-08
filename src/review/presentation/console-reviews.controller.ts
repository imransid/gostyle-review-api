import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, RequirePermissions } from '../../shared/auth/decorators';
import { PlatformJwtGuard } from '../../shared/auth/platform-jwt.guard';
import type { PlatformPrincipal } from '../../shared/auth/platform-token';
import {
  DeleteReplyCommand,
  EditReplyCommand,
  PostReplyCommand,
} from '../application/commands/post-reply/reply-commands';
import { ReportReviewCommand } from '../application/commands/report-review/report-review.command';
import { GetConsoleAggregateQuery } from '../application/queries/get-rating-summary/get-rating-summary.query';
import { ListConsoleReviewsQuery } from '../application/queries/list-console-reviews/list-console-reviews.query';
import {
  BranchScopeDto,
  ListStorefrontReviewsQueryDto,
  ReportReviewDto,
  ReviewReplyDto,
} from './dto/review.dto';
import { salonContext } from './salon-context';

/**
 * The salon console, at the paths gostyle-api serves today
 * (/v1/storefront/reviews/*), with the same permission codes, so the console
 * only changes its base URL. Every route: platform JWT, tenant from the JWT.
 *
 * Reply: marketing-reviews.update on all three verbs (one authority).
 * Report: marketing-reviews.create (the only "create" a salon has here).
 * Reading: storefront-edit.read.
 */
@ApiTags('console')
@ApiBearerAuth('platform-jwt')
@UseGuards(PlatformJwtGuard)
@Controller('v1/storefront/reviews')
export class ConsoleReviewsController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('storefront-edit.read')
  @ApiOperation({ summary: "The salon's reviews in every state, newest first, with replies, reports and the summary." })
  @ApiResponse({ status: 200, description: '{ data, total, offset, limit, summary }' })
  list(@CurrentPrincipal() p: PlatformPrincipal, @Query() q: ListStorefrontReviewsQueryDto) {
    const s = salonContext(p, q.branchId);
    return this.queries.execute(
      new ListConsoleReviewsQuery({ tenantId: s.tenantId, branchId: s.branchId, offset: q.offset, limit: q.limit, state: q.state }),
    );
  }

  @Get('aggregate')
  @RequirePermissions('storefront-edit.read')
  @ApiOperation({ summary: 'The rating: one average, one count, per-language counts, the histogram.' })
  @ApiResponse({ status: 200, description: '{ average, count, countByLanguage, histogram }' })
  aggregate(@CurrentPrincipal() p: PlatformPrincipal, @Query() q: BranchScopeDto) {
    const s = salonContext(p, q.branchId);
    return this.queries.execute(new GetConsoleAggregateQuery({ tenantId: s.tenantId, branchId: s.branchId }));
  }

  @Post(':reviewId/reply')
  @HttpCode(201)
  @RequirePermissions('marketing-reviews.update')
  @ApiOperation({ summary: 'Answer a review, once.' })
  @ApiParam({ name: 'reviewId', format: 'uuid' })
  @ApiResponse({ status: 201, description: '{ reviewId, body, createdAt, editedAt }' })
  @ApiResponse({ status: 404, description: 'REVIEW_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'REPLY_ALREADY_EXISTS' })
  @ApiResponse({ status: 422, description: 'VALIDATION_FAILED' })
  reply(
    @CurrentPrincipal() p: PlatformPrincipal,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() dto: ReviewReplyDto,
  ) {
    return this.commands.execute(new PostReplyCommand({ ...salonContext(p, dto.branchId), reviewId, body: dto.body }));
  }

  @Patch(':reviewId/reply')
  @RequirePermissions('marketing-reviews.update')
  @ApiOperation({ summary: 'Rewrite the reply (a full replacement).' })
  @ApiParam({ name: 'reviewId', format: 'uuid' })
  @ApiResponse({ status: 404, description: 'REVIEW_NOT_FOUND or REPLY_NOT_FOUND' })
  editReply(
    @CurrentPrincipal() p: PlatformPrincipal,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() dto: ReviewReplyDto,
  ) {
    return this.commands.execute(new EditReplyCommand({ ...salonContext(p, dto.branchId), reviewId, body: dto.body }));
  }

  @Delete(':reviewId/reply')
  @HttpCode(204)
  @RequirePermissions('marketing-reviews.update')
  @ApiOperation({ summary: 'Withdraw the reply. A HARD delete: the row is gone.' })
  @ApiParam({ name: 'reviewId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Gone.' })
  @ApiResponse({ status: 404, description: 'REVIEW_NOT_FOUND or REPLY_NOT_FOUND' })
  async deleteReply(
    @CurrentPrincipal() p: PlatformPrincipal,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Query() q: BranchScopeDto,
  ): Promise<void> {
    await this.commands.execute(new DeleteReplyCommand({ ...salonContext(p, q.branchId), reviewId }));
  }

  @Post(':reviewId/report')
  @HttpCode(201)
  @RequirePermissions('marketing-reviews.create')
  @ApiOperation({ summary: 'Ask HQ to look at a review. THIS HIDES NOTHING.' })
  @ApiParam({ name: 'reviewId', format: 'uuid' })
  @ApiResponse({ status: 201, description: '{ reportId, reviewId, status: OPEN, reviewState }' })
  @ApiResponse({ status: 404, description: 'REVIEW_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'REPORT_ALREADY_OPEN' })
  report(
    @CurrentPrincipal() p: PlatformPrincipal,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() dto: ReportReviewDto,
  ) {
    return this.commands.execute(
      new ReportReviewCommand({ ...salonContext(p, dto.branchId), reviewId, reason: dto.reason, note: dto.note ?? null }),
    );
  }
}
