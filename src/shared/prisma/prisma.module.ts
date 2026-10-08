import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Global: one pool per process, shared by every module that needs it. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
