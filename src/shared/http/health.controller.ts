import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RedisHealth } from '../redis/redis';

interface Check {
  status: 'up' | 'down';
  latencyMs?: number;
}

async function check(probe: () => Promise<number>): Promise<Check> {
  try {
    return { status: 'up', latencyMs: await probe() };
  } catch {
    // No error text: /health is unauthenticated, and a driver error can name
    // hosts and users.
    return { status: 'down' };
  }
}

/**
 * Green only when BOTH the database and Redis answer. A service that can read
 * reviews but cannot relay events is not healthy, it is quietly losing time.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisHealth,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Database and Redis reachability. 503 when either is down.' })
  async health(@Res() res: Response): Promise<void> {
    const [database, redis] = await Promise.all([
      check(() => this.prisma.ping()),
      check(() => this.redis.ping()),
    ]);
    const ok = database.status === 'up' && redis.status === 'up';
    res
      .status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json({ status: ok ? 'ok' : 'error', checks: { database, redis } });
  }
}
