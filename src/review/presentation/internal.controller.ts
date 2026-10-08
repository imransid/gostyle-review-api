import { Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ServiceCallers } from '../../shared/auth/decorators';
import { ServiceKeyGuard } from '../../shared/auth/service-key.guard';
import { OutboxRelay } from '../../shared/outbox/outbox-relay';
import { RecomputeRatingSummariesCommand } from '../application/commands/recompute-rating-summaries/recompute-rating-summaries.command';
import { GetRatingSummariesQuery } from '../application/queries/get-rating-summary/get-rating-summary.query';
import { RatingSummariesQueryDto } from './dto/review.dto';

/**
 * Service-to-service routes. `x-service-key`, one key per calling service,
 * compared in constant time; each route names the callers it accepts.
 */
@ApiTags('internal')
@ApiSecurity('service-key')
@UseGuards(ServiceKeyGuard)
@Controller('internal')
export class InternalController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
    private readonly relay: OutboxRelay,
  ) {}

  @Get('ratings')
  @ServiceCallers('customer-api', 'ops')
  @ApiOperation({ summary: 'Rating summaries for backfill and repair, in the rating.summary.changed.v1 shape.' })
  @ApiResponse({ status: 200, description: '{ data, nextCursor }' })
  ratings(@Query() q: RatingSummariesQueryDto) {
    return this.queries.execute(
      new GetRatingSummariesQuery({ storefrontIds: q.storefrontIds, after: q.after, limit: q.limit }),
    );
  }

  @Post('ratings/recompute')
  @HttpCode(200)
  @ServiceCallers('ops')
  @ApiOperation({ summary: 'Run the nightly recompute now: recount every storefront, log and repair any drift.' })
  @ApiResponse({ status: 200, description: '{ checked, repaired, differences }' })
  recompute() {
    return this.commands.execute(new RecomputeRatingSummariesCommand({ trigger: 'manual' }));
  }

  @Get('outbox')
  @ServiceCallers('ops')
  @ApiOperation({ summary: 'Outbox depth: pending, stuck, and the age of the oldest pending event.' })
  outbox() {
    return this.relay.stats();
  }
}
