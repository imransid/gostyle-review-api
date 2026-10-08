import { Injectable } from '@nestjs/common';
import type { ReviewReport as Row } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { asPrisma, isUniqueViolation } from '../../../shared/prisma/prisma-tx';
import { DomainError } from '../../domain/domain.error';
import type { ReviewReportRepository } from '../../domain/ports/review-report.repository';
import type { TxHandle } from '../../domain/ports/unit-of-work.port';
import { ReviewReport } from '../../domain/report/review-report.aggregate';
import type { ReportStatus } from '../../domain/services/review-report-rules';

export function toReport(r: Row): ReviewReport {
  return ReviewReport.restore({
    id: r.id,
    tenantId: r.tenantId,
    reviewId: r.reviewId,
    reason: r.reason,
    note: r.note,
    status: r.status,
    reportedById: r.reportedById,
    resolvedById: r.resolvedById,
    resolvedAt: r.resolvedAt,
    resolutionNote: r.resolutionNote,
    createdAt: r.createdAt,
  });
}

@Injectable()
export class PrismaReviewReportRepository implements ReviewReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insert(report: ReviewReport, tx?: TxHandle): Promise<void> {
    try {
      await asPrisma(this.prisma, tx).reviewReport.create({
        data: {
          id: report.id,
          tenantId: report.tenantId,
          reviewId: report.reviewId,
          reason: report.reason,
          note: report.note,
          status: report.status,
          reportedById: report.reportedById,
          createdAt: report.createdAt,
        },
      });
    } catch (e) {
      // The partial unique index (review_id) WHERE status = 'OPEN', arriving
      // as a constraint violation. Prisma does not know the index exists, so
      // this catch is the only place it becomes a message.
      if (isUniqueViolation(e)) {
        throw new DomainError(
          'REPORT_ALREADY_OPEN',
          'This review already has a report waiting for a decision. You will be told the outcome.',
        );
      }
      throw e;
    }
  }

  async findById(id: string, tx?: TxHandle): Promise<ReviewReport | null> {
    const r = await asPrisma(this.prisma, tx).reviewReport.findUnique({ where: { id } });
    return r ? toReport(r) : null;
  }

  async saveResolution(
    report: ReviewReport,
    expected: ReportStatus,
    tx?: TxHandle,
  ): Promise<boolean> {
    // Compare-and-set: two reviewers working the same queue is ordinary.
    const { count } = await asPrisma(this.prisma, tx).reviewReport.updateMany({
      where: { id: report.id, status: expected },
      data: {
        status: report.status,
        resolvedById: report.resolvedById,
        resolvedAt: report.resolvedAt,
        resolutionNote: report.resolutionNote,
      },
    });
    return count === 1;
  }
}
